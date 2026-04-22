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
 *   - `scope` = values for keys declared on `mcp.scope`
 *   - `body`  = everything else (form fields, `id`, `limit`, etc.)
 *
 * Scope is destined for `ctx.input`, the rest for wherever the handler wants
 * it (form body → `ctx.values`, primary key → `ctx.input.id`).
 */
export function splitScope(
  config: CRUDTableConfig,
  input: Record<string, unknown>
): { scope: Record<string, unknown>; body: Record<string, unknown> } {
  const scopeParams = config.mcp?.scope ?? [];
  const scopeKeys = new Set(scopeParams.map((p: MCPScopeParam) => p.name));
  const scope: Record<string, unknown> = {};
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (scopeKeys.has(k)) scope[k] = v;
    else body[k] = v;
  }
  return { scope, body };
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
}: SynthContextArgs): CRUDContext {
  const { scope, body } = splitScope(_config, input);

  const ctxInput: Record<string, unknown> = { ...scope };
  const values: Record<string, string> = {};

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

    case 'update':
      if (body.id !== undefined) ctxInput.id = body.id;
      for (const [k, v] of Object.entries(body)) {
        if (k === 'id') continue;
        values[k] = valueToString(v);
      }
      break;
  }

  const formMode: CRUDContext['formMode'] =
    op === 'create' ? 'create' : op === 'update' ? 'edit' : null;

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
    datasources: {},
  };
}
