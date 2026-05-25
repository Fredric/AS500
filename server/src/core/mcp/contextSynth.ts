// Synthesize a minimal CRUDContext from MCP tool input.
//
// The CRUDTable runtime expects a CRUDContext carrying `input`, `values`,
// `formMode`, `editRecord`, `selection`, etc. — populated normally by the
// in-process screen flow. For MCP calls there's no screen; we build a
// purpose-made context directly from the tool's validated input, so existing
// `services.*.params(ctx)` and `fieldConfigs.*.form.validators` keep working
// unchanged.
//
// Field string coercion: CRUDTable validators read `ctx.values[k]` as strings
// (the in-process client sends strings over the wire). MCP inputs may arrive
// as numbers/booleans (thanks to Zod). We coerce to string when writing
// `values`; service `params(ctx)` functions can re-cast as needed.

import type {
  CRUDContext,
  CRUDTableConfig,
  MCPScopeParam,
} from '../crudtable/types.js';
import type { McpOp } from './schemaBuilder.js';

/**
 * Subset of MCP call context we thread into synthesized CRUDContext.user.
 *
 * `permissions` is the user's effective permission set resolved at auth time
 * (same semantics as `Session.permissions` in the terminal flow). `isAdmin`
 * short-circuits every permission check to `true`.
 *
 * `clientId` is the OAuth client that obtained this token. Persisted on
 * every audit row so operators can tell which agent made a call. Optional
 * because local/test invocations (no OAuth flow) may leave it undefined.
 */
export interface McpCallUser {
  userId: number;
  username: string;
  isAdmin: boolean;
  permissions: Set<string>;
  clientId?: string;
  /** JWT id of the access token used. Used as a rate-limit key. */
  jti?: string;
}

/**
 * Coerce a scalar tool input into the string shape that CRUDTable validators
 * expect in `ctx.values`. `null`/`undefined` become empty string so the
 * `required` validator fires (mirroring the terminal behaviour where an
 * empty field is the only way to submit "no value").
 */
function valueToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : '';
  return String(v);
}

/**
 * Split the validated tool input into `(scope, body)`:
 *   - `scope` = values for keys declared on scope params
 *   - `body`  = everything else (form fields, `id`, `limit`, etc.)
 *
 * Scope is destined for `ctx.input`, the rest for wherever the handler wants
 * it (form body → `ctx.values`, primary key → `ctx.input.id`).
 *
 * Note: params marked `injectFromAuth` are NOT in the Zod schema so they will
 * never appear in `input`. Their values are injected separately inside
 * `synthesizeContext` using `McpCallUser`.
 *
 * @param scopeParamsOverride - When provided, use this instead of `config.mcp?.scope`.
 *   REST API handlers pass `config.api?.scope` here.
 */
export function splitScope(
  config: CRUDTableConfig,
  input: Record<string, unknown>,
  scopeParamsOverride?: MCPScopeParam[]
): { scope: Record<string, unknown>; body: Record<string, unknown> } {
  const scopeParams = scopeParamsOverride ?? config.mcp?.scope ?? [];
  const scopeKeys = new Set(
    scopeParams.filter((p: MCPScopeParam) => !p.injectFromAuth).map((p: MCPScopeParam) => p.name)
  );
  const scope: Record<string, unknown> = {};
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (scopeKeys.has(k)) scope[k] = v;
    else body[k] = v;
  }
  return { scope, body };
}

/**
 * Build the server-injected portion of the scope: values for every
 * `MCPScopeParam` whose `injectFromAuth` is set. These are sourced exclusively
 * from the authenticated `McpCallUser` — agents cannot supply or override them.
 *
 * Currently only `injectFromAuth: 'userId'` is supported, mapping to
 * `McpCallUser.userId` (the integer id that corresponds to
 * `auth_tokens.user_id` for the active OAuth session).
 *
 * @param scopeParamsOverride - When provided, use this instead of `config.mcp?.scope`.
 *   REST API handlers pass `config.api?.scope` here.
 */
export function buildInjectedScope(
  config: CRUDTableConfig,
  user: McpCallUser,
  scopeParamsOverride?: MCPScopeParam[]
): Record<string, unknown> {
  const injected: Record<string, unknown> = {};
  for (const p of scopeParamsOverride ?? config.mcp?.scope ?? []) {
    if (!p.injectFromAuth) continue;
    switch (p.injectFromAuth) {
      case 'userId':
        injected[p.name] = user.userId;
        break;
    }
  }
  return injected;
}

/**
 * Resolve the server-injected portion of a param list from the authenticated
 * caller. Unlike {@link buildInjectedScope}, this version takes a raw
 * `MCPScopeParam[]` directly — no `CRUDTableConfig` required — so it can be
 * used by custom action handlers and standalone tool handlers that aren't
 * backed by a CRUD config.
 */
export function injectFromAuthValues(
  params: MCPScopeParam[],
  user: McpCallUser
): Record<string, unknown> {
  const injected: Record<string, unknown> = {};
  for (const p of params) {
    if (!p.injectFromAuth) continue;
    switch (p.injectFromAuth) {
      case 'userId':
        injected[p.name] = user.userId;
        break;
    }
  }
  return injected;
}

export interface SynthContextArgs {
  config: CRUDTableConfig;
  op: McpOp;
  input: Record<string, unknown>;
  /** For `update`: the pre-fetched record being modified. */
  editRecord?: Record<string, unknown> | null;
  /** For `delete`: the pre-fetched record being deleted. */
  deleteRecord?: Record<string, unknown> | null;
  user: McpCallUser;
  /**
   * Override the scope params used to split input into (scope, body) and to
   * inject server-side values. MCP callers omit this (defaults to
   * `config.mcp?.scope`). REST API callers pass `config.api?.scope`.
   */
  scopeParams?: MCPScopeParam[];
}

/**
 * Build the CRUDContext used for one MCP tool call.
 *
 * `formMode`:
 *   - 'create' for create
 *   - 'edit'   for update
 *   - null     for list, read, delete
 *
 * `input`:
 *   - scope params verbatim (so `services.list.params(ctx).ctx.input.userId` works)
 *   - `id` additionally populated for read/update/delete so service adapters
 *     that pull the PK from ctx.input (rather than ctx.editRecord/selection)
 *     keep working.
 *
 * `values`:
 *   - for create/update: body fields coerced to string
 *   - for others: empty
 *
 * `editRecord` / `selection`:
 *   - update sets `editRecord` (and nothing else)
 *   - delete sets `selection = [deleteRecord]` to match
 *     the in-process contract where delete services read `ctx.selection[0]`
 */
export function synthesizeContext({
  config: _config,
  op,
  input,
  editRecord,
  deleteRecord,
  user,
  scopeParams,
}: SynthContextArgs): CRUDContext {
  const { scope, body } = splitScope(_config, input, scopeParams);

  // Merge agent-supplied scope first, then overwrite with server-injected
  // values so agents can never smuggle in their own userId (or any other
  // injectFromAuth param) even if they somehow include the key.
  const injected = buildInjectedScope(_config, user, scopeParams);
  const ctxInput: Record<string, unknown> = { ...scope, ...injected };
  const values: Record<string, string> = {};

  const formMode: CRUDContext['formMode'] =
    op === 'create' ? 'create' : op === 'update' ? 'edit' : null;

  // Per-op wiring.
  switch (op) {
    case 'list':
      // `limit` / `offset` / `filter` live on ctx.input so config authors can
      // pick them up in services.list.params(ctx) if they want server-side
      // pagination. Current configs ignore them (they paginate in memory);
      // the MCP handler re-enforces the limit/offset cap itself.
      if (body.limit !== undefined) ctxInput.limit = body.limit;
      if (body.offset !== undefined) ctxInput.offset = body.offset;
      if (body.filter !== undefined) ctxInput.filter = body.filter;
      break;

    case 'read':
    case 'delete':
      if (body.id !== undefined) ctxInput.id = body.id;
      break;

    case 'create':
      for (const [k, v] of Object.entries(body)) {
        values[k] = valueToString(v);
      }
      break;

    case 'update': {
      if (body.id !== undefined) ctxInput.id = body.id;

      // Build a partial context (input + formMode set, values still empty) so
      // formValue(ctx, rawVal) can be called during seeding. formValue
      // functions that only inspect `rawVal` work correctly; those that also
      // read ctx.values for dependent logic will see empty values for other
      // fields at this stage — acceptable since the agent overlays its own
      // values immediately after.
      //
      // NOTE: datasources is always {} in synthetic contexts. Config authors
      // must not rely on ctx.datasources inside formValue, cellRenderer,
      // validators, or BoolExprs that run in MCP/REST flows — datasources are
      // only loaded during the terminal screen build cycle.
      const partialCtx: CRUDContext = {
        records: [],
        selection: [],
        values,
        input: ctxInput,
        user: user.username,
        formMode,
        editRecord: editRecord ?? null,
        pendingDeleteRecord: null,
        pageOffset: 0,
        formPage: 0,
        datasources: {},
      };

      // Seed values from the existing record first so fields omitted from the
      // agent's input carry forward their current values. Apply formValue where
      // configured so the seeded strings match what the terminal would produce
      // (e.g. boolean true → 'Y' for an active flag, not raw 'true').
      if (editRecord) {
        for (const [k, v] of Object.entries(editRecord)) {
          if (k === 'id') continue;
          const fc = _config.fieldConfigs[k];
          values[k] = fc?.form?.formValue
            ? fc.form.formValue(partialCtx, v)
            : valueToString(v);
        }
      }
      // Overlay with the agent-supplied fields (only keys present in the input).
      for (const [k, v] of Object.entries(body)) {
        if (k === 'id') continue;
        values[k] = valueToString(v);
      }
      break;
    }
  }

  return {
    records: [],
    selection: op === 'delete' && deleteRecord ? [deleteRecord] : [],
    values,
    input: ctxInput,
    user: user.username,
    formMode,
    editRecord: op === 'update' ? (editRecord ?? null) : null,
    pendingDeleteRecord: op === 'delete' ? (deleteRecord ?? null) : null,
    pageOffset: 0,
    formPage: 0,
    // NOTE: datasources is always {} in synthetic (MCP/REST) contexts.
    // Functions that run in both terminal and MCP/REST paths (formValue,
    // cellRenderer, validators, BoolExprs) must not rely on datasources being
    // populated here — they are only loaded during the terminal screen build
    // cycle.
    datasources: {},
  };
}
