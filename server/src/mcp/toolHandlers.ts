// Per-operation tool handlers for the MCP server.
//
// Each exported function runs one operation end-to-end:
//   1. Check permissions (config, ServiceCall, per-op override).
//   2. Synthesize the minimal CRUDContext the service expects.
//   3. Run CRUDTable field validators (create/update only).
//   4. Resolve + call the ServiceCall from `config.services`.
//   5. Return a CallToolResult-shaped payload via the `errors.ts` helpers.
//
// Phase 3 adds permission enforcement using the caller's resolved
// `McpCallUser.permissions` Set. Rate limiting and audit logging are
// handled upstream in the transport layer.

import type { CRUDContext, CRUDTableConfig, ServiceCall, MCPOperationOverride } from '../crudtable/types.js';
import { synthesizeContext, type McpCallUser } from './contextSynth.js';
import type { McpOp } from './schemaBuilder.js';
import { LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX } from './schemaBuilder.js';
import {
  McpToolError,
  toolResultOk,
  type McpCallToolResult,
} from './errors.js';

// ============================================
// Service-call invocation helper
// ============================================

/**
 * Invoke `ServiceCall.service[method](ServiceCall.params(ctx))`. Mirrors the
 * same pattern CRUDTable's runtime uses (`server/src/crudtable/runtime.ts`)
 * so behaviour is identical whether the call originates from the terminal UI,
 * an MCP agent, or the REST API.
 */
export async function invokeServiceCall(
  sc: ServiceCall,
  ctx: CRUDContext
): Promise<unknown> {
  const fn = sc.service[sc.method];
  if (typeof fn !== 'function') {
    throw new McpToolError(
      'internal_error',
      `Service method "${sc.method}" is not a function.`
    );
  }
  const args = sc.params ? await sc.params(ctx) : undefined;
  // `params` is expected to return a single object (or primitive for delete);
  // we pass it positionally — again matching the runtime's convention.
  return args === undefined ? await fn() : await fn(args);
}

// ============================================
// Validator dispatch
// ============================================

/**
 * Run every form validator declared on the config's field configs. Returns
 * all validation errors at once (never throws) so callers can report the whole
 * set in a single response rather than discovering errors one field at a time.
 *
 * Mirrors `server/src/crudtable/runtime.ts`'s validation pass — CRUDTable's
 * `validators` are `(ctx) => string | null`, so we run them against the
 * synthesized context.
 */
export function runValidators(
  config: CRUDTableConfig,
  ctx: CRUDContext
): { name: string; message: string }[] {
  const errors: { name: string; message: string }[] = [];
  for (const [name, field] of Object.entries(config.fieldConfigs)) {
    const validators = field.form?.validators;
    if (!validators || validators.length === 0) continue;
    for (const v of validators) {
      const msg = v(ctx);
      if (msg) {
        errors.push({ name, message: msg });
        // One error per field is enough — the terminal UI shows one at a time
        // and validator authors typically write them for that mode.
        break;
      }
    }
  }
  return errors;
}

// ============================================
// Helpers
// ============================================

export function assertService(sc: ServiceCall | undefined, op: McpOp): asserts sc is ServiceCall {
  if (!sc) {
    throw new McpToolError(
      'unsupported_operation',
      `Operation "${op}" is not configured on this resource.`
    );
  }
}

/**
 * Enforce AS500 RBAC on an MCP tool call.
 *
 * Three permission sources are checked, in order:
 *
 *   1. `config.requirePermission`          — screen-level gate
 *   2. `config.services[op].requirePermission` — per-op gate
 *   3. `config.mcp.operations[op].requirePermission` — per-MCP-op override
 *
 * Admins bypass all of them (matches `hasPermission` in `services/access.ts`).
 *
 * A single `permission_denied` error with `missing: string[]` lets agents
 * see which grants they need in one round-trip. Silent on all-pass.
 */
function requireMcpPermissions(
  config: CRUDTableConfig,
  op: McpOp,
  service: ServiceCall,
  user: McpCallUser
): void {
  if (user.isAdmin) return;

  const missing: string[] = [];
  const check = (key: string | undefined): void => {
    if (!key) return;
    if (!user.permissions.has(key)) missing.push(key);
  };

  check(config.requirePermission);
  check(service.requirePermission);

  const opEntry = config.mcp?.operations?.[op];
  if (opEntry && typeof opEntry === 'object') {
    check((opEntry as MCPOperationOverride).requirePermission);
  }

  if (missing.length > 0) {
    const unique = Array.from(new Set(missing));
    throw new McpToolError(
      'permission_denied',
      `Missing required permission${unique.length > 1 ? 's' : ''}: ${unique.join(', ')}`,
      unique.map((m) => ({ name: m, message: 'Permission not granted to caller.' }))
    );
  }
}

async function fetchById(
  config: CRUDTableConfig,
  scope: Record<string, unknown>,
  id: unknown,
  user: McpCallUser
): Promise<Record<string, unknown> | null> {
  assertService(config.services.read, 'read');
  const readCtx = synthesizeContext({
    config,
    op: 'read',
    input: { ...scope, id },
    user,
  });
  const rec = (await invokeServiceCall(config.services.read, readCtx)) as
    | Record<string, unknown>
    | null
    | undefined;
  return rec ?? null;
}

// ============================================
// Per-operation handlers
// ============================================

export interface HandlerArgs {
  config: CRUDTableConfig;
  input: Record<string, unknown>;
  user: McpCallUser;
  /**
   * The MCP operation being dispatched. Threaded in by `transport.ts` so
   * per-op permission overrides can be resolved without a reverse lookup
   * on the handler function reference.
   */
  op: McpOp;
}

export async function handleList({
  config,
  input,
  user,
}: HandlerArgs): Promise<McpCallToolResult> {
  assertService(config.services.list, 'list');
  requireMcpPermissions(config, 'list', config.services.list, user);

  const rawLimit = (input.limit as number | undefined) ?? LIST_LIMIT_DEFAULT;
  const limit = Math.min(Math.max(1, Math.floor(rawLimit)), LIST_LIMIT_MAX);
  const offset = Math.max(0, Math.floor((input.offset as number | undefined) ?? 0));

  const ctx = synthesizeContext({ config, op: 'list', input, user });
  const allRaw = (await invokeServiceCall(config.services.list, ctx)) as unknown;
  const all = Array.isArray(allRaw) ? (allRaw as Record<string, unknown>[]) : [];

  const totalRecords = all.length;
  const page = all.slice(offset, offset + limit);
  const hasMore = offset + page.length < totalRecords;

  return toolResultOk(
    `Returned ${page.length} of ${totalRecords} ${config.title} record(s).`,
    {
      records: page,
      totalRecords,
      offset,
      limit,
      hasMore,
    }
  );
}

export async function handleRead({
  config,
  input,
  user,
}: HandlerArgs): Promise<McpCallToolResult> {
  assertService(config.services.read, 'read');
  requireMcpPermissions(config, 'read', config.services.read, user);

  const ctx = synthesizeContext({ config, op: 'read', input, user });
  const rec = (await invokeServiceCall(config.services.read, ctx)) as
    | Record<string, unknown>
    | null
    | undefined;

  if (rec === null || rec === undefined) {
    throw new McpToolError(
      'not_found',
      `No ${config.title} record found for id=${String(input.id)}.`
    );
  }

  return toolResultOk(`Found ${config.title} record id=${String(input.id)}.`, {
    record: rec,
  });
}

export async function handleCreate({
  config,
  input,
  user,
}: HandlerArgs): Promise<McpCallToolResult> {
  assertService(config.services.create, 'create');
  requireMcpPermissions(config, 'create', config.services.create, user);

  const ctx = synthesizeContext({ config, op: 'create', input, user });

  const validationErrors = runValidators(config, ctx);
  if (validationErrors.length > 0) {
    throw new McpToolError(
      'validation_failed',
      `Input failed field validation (${validationErrors.length} error(s)).`,
      validationErrors
    );
  }

  const created = (await invokeServiceCall(config.services.create, ctx)) as
    | Record<string, unknown>
    | undefined;

  return toolResultOk(
    `Created ${config.title} record.`,
    created ? { record: created } : undefined
  );
}

export async function handleUpdate({
  config,
  input,
  user,
}: HandlerArgs): Promise<McpCallToolResult> {
  assertService(config.services.update, 'update');
  assertService(config.services.read, 'update'); // we need read to populate editRecord
  requireMcpPermissions(config, 'update', config.services.update, user);

  const { scope, body } = splitByScope(config, input);
  const id = body.id;
  if (id === undefined) {
    throw new McpToolError('validation_failed', 'id is required for update.');
  }

  const existing = await fetchById(config, scope, id, user);
  if (!existing) {
    throw new McpToolError(
      'not_found',
      `No ${config.title} record found for id=${String(id)}.`
    );
  }

  const ctx = synthesizeContext({
    config,
    op: 'update',
    input,
    editRecord: existing,
    user,
  });

  const validationErrors = runValidators(config, ctx);
  if (validationErrors.length > 0) {
    throw new McpToolError(
      'validation_failed',
      `Input failed field validation (${validationErrors.length} error(s)).`,
      validationErrors
    );
  }

  const updated = (await invokeServiceCall(config.services.update, ctx)) as
    | Record<string, unknown>
    | undefined;

  return toolResultOk(
    `Updated ${config.title} record id=${String(id)}.`,
    updated ? { record: updated } : undefined
  );
}

export async function handleDelete({
  config,
  input,
  user,
}: HandlerArgs): Promise<McpCallToolResult> {
  assertService(config.services.delete, 'delete');
  assertService(config.services.read, 'delete'); // selection[0] sourced from read
  requireMcpPermissions(config, 'delete', config.services.delete, user);

  const { scope, body } = splitByScope(config, input);
  const id = body.id;
  if (id === undefined) {
    throw new McpToolError('validation_failed', 'id is required for delete.');
  }

  const existing = await fetchById(config, scope, id, user);
  if (!existing) {
    throw new McpToolError(
      'not_found',
      `No ${config.title} record found for id=${String(id)}.`
    );
  }

  const ctx = synthesizeContext({
    config,
    op: 'delete',
    input,
    deleteRecord: existing,
    user,
  });

  await invokeServiceCall(config.services.delete, ctx);

  return toolResultOk(`Deleted ${config.title} record id=${String(id)}.`, {
    id,
  });
}

// ============================================
// Local util — avoids a circular helper in contextSynth for caller use
// ============================================

function splitByScope(
  config: CRUDTableConfig,
  input: Record<string, unknown>
): { scope: Record<string, unknown>; body: Record<string, unknown> } {
  const scopeKeys = new Set((config.mcp?.scope ?? []).map((p) => p.name));
  const scope: Record<string, unknown> = {};
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (scopeKeys.has(k)) scope[k] = v;
    else body[k] = v;
  }
  return { scope, body };
}
