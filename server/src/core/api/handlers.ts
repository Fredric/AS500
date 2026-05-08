// Per-operation REST API handlers for CRUDTable-backed resources.
//
// Each exported function handles one HTTP operation end-to-end:
//   1. Check permissions (config, ServiceCall, per-op api override).
//   2. Synthesize the CRUDContext using the api scope config.
//   3. Run field validators (create/update only).
//   4. Invoke the ServiceCall from `config.services`.
//   5. Return an ApiResult with HTTP status + JSON body.
//
// Permission errors, validation errors, and not-found cases all surface as
// structured ApiResult bodies rather than thrown exceptions — callers convert
// them to Express responses. Any unexpected thrown value becomes a 500.

import type { CRUDTableConfig, APIOperationConfig, ServiceCall } from '../crudtable/types.js';
import { synthesizeContext, type McpCallUser } from '../mcp/contextSynth.js';
import { invokeServiceCall, runValidators, assertService } from '../mcp/toolHandlers.js';
import { McpToolError } from '../mcp/errors.js';
import type { McpOp } from '../mcp/schemaBuilder.js';

export const API_LIST_LIMIT_DEFAULT = 50;
export const API_LIST_LIMIT_MAX = 100;

// ============================================
// Result type
// ============================================

export interface ApiResult {
  status: number;
  body: unknown;
}

// ============================================
// Permission check
// ============================================

function requireApiPermissions(
  config: CRUDTableConfig,
  op: McpOp,
  service: ServiceCall | undefined,
  user: McpCallUser
): void {
  if (user.isAdmin) return;
  if (!service) return; // assertService will have caught this before we reach here

  const missing: string[] = [];
  const check = (key: string | undefined): void => {
    if (!key) return;
    if (!user.permissions.has(key)) missing.push(key);
  };

  check(config.requirePermission);
  check(service.requirePermission);

  const opEntry = config.api?.operations?.[op];
  if (opEntry && typeof opEntry === 'object') {
    check((opEntry as APIOperationConfig).requirePermission);
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

// ============================================
// Pre-fetch helper
// ============================================

async function fetchById(
  config: CRUDTableConfig,
  scopeInput: Record<string, unknown>,
  id: number,
  user: McpCallUser
): Promise<Record<string, unknown> | null> {
  assertService(config.services.read, 'read');
  const readCtx = synthesizeContext({
    config,
    op: 'read',
    input: { ...scopeInput, id },
    user,
    scopeParams: config.api?.scope,
  });
  const rec = (await invokeServiceCall(config.services.read, readCtx)) as
    | Record<string, unknown>
    | null
    | undefined;
  return rec ?? null;
}

// ============================================
// Error → ApiResult
// ============================================

function errorCodeToStatus(code: McpToolError['code']): number {
  switch (code) {
    case 'validation_failed': return 400;
    case 'permission_denied': return 403;
    case 'not_found':         return 404;
    case 'unsupported_operation': return 405;
    case 'rate_limited':      return 429;
    default:                  return 500;
  }
}

export function apiResultFromThrown(err: unknown, debug: boolean): ApiResult {
  if (err instanceof McpToolError) {
    return {
      status: errorCodeToStatus(err.code),
      body: {
        error: {
          code: err.code,
          message: err.message,
          ...(err.fields ? { fields: err.fields } : {}),
        },
      },
    };
  }
  const raw = err instanceof Error ? err.message : String(err);
  const message = debug ? raw : 'Internal server error';
  return {
    status: 500,
    body: { error: { code: 'internal_error', message } },
  };
}

// ============================================
// Handler args
// ============================================

export interface ApiHandlerArgs {
  config: CRUDTableConfig;
  /** Scope input pre-built by the router (auth-injected + query-resolved). */
  scopeInput: Record<string, unknown>;
  user: McpCallUser;
}

// ============================================
// List
// ============================================

export async function handleApiList(
  args: ApiHandlerArgs & { query: Record<string, unknown> }
): Promise<ApiResult> {
  const { config, scopeInput, user, query } = args;
  assertService(config.services.list, 'list');
  requireApiPermissions(config, 'list', config.services.list, user);

  const rawLimit = Number(query.limit ?? API_LIST_LIMIT_DEFAULT);
  const limit = Math.min(Math.max(1, Math.floor(isNaN(rawLimit) ? API_LIST_LIMIT_DEFAULT : rawLimit)), API_LIST_LIMIT_MAX);
  const rawOffset = Number(query.offset ?? 0);
  const offset = Math.max(0, Math.floor(isNaN(rawOffset) ? 0 : rawOffset));

  const input = { ...scopeInput, limit, offset };
  const ctx = synthesizeContext({ config, op: 'list', input, user, scopeParams: config.api?.scope });
  const allRaw = (await invokeServiceCall(config.services.list, ctx)) as unknown;
  const all = Array.isArray(allRaw) ? (allRaw as Record<string, unknown>[]) : [];

  const totalRecords = all.length;
  const page = all.slice(offset, offset + limit);
  const hasMore = offset + page.length < totalRecords;

  return {
    status: 200,
    body: { records: page, totalRecords, offset, limit, hasMore },
  };
}

// ============================================
// Read
// ============================================

export async function handleApiRead(
  args: ApiHandlerArgs & { id: number }
): Promise<ApiResult> {
  const { config, scopeInput, user, id } = args;
  assertService(config.services.read, 'read');
  requireApiPermissions(config, 'read', config.services.read, user);

  const input = { ...scopeInput, id };
  const ctx = synthesizeContext({ config, op: 'read', input, user, scopeParams: config.api?.scope });
  const rec = (await invokeServiceCall(config.services.read, ctx)) as
    | Record<string, unknown>
    | null
    | undefined;

  if (rec === null || rec === undefined) {
    throw new McpToolError('not_found', `No ${config.title} record found for id=${id}.`);
  }

  return { status: 200, body: { record: rec } };
}

// ============================================
// Create
// ============================================

export async function handleApiCreate(
  args: ApiHandlerArgs & { body: Record<string, unknown> }
): Promise<ApiResult> {
  const { config, scopeInput, user, body } = args;
  assertService(config.services.create, 'create');
  requireApiPermissions(config, 'create', config.services.create, user);

  // Scope keys win over body to prevent callers from overriding injected values.
  const input = { ...body, ...scopeInput };
  const ctx = synthesizeContext({ config, op: 'create', input, user, scopeParams: config.api?.scope });

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

  return { status: 201, body: created ? { record: created } : {} };
}

// ============================================
// Update
// ============================================

export async function handleApiUpdate(
  args: ApiHandlerArgs & { id: number; body: Record<string, unknown> }
): Promise<ApiResult> {
  const { config, scopeInput, user, id, body } = args;
  assertService(config.services.update, 'update');
  assertService(config.services.read, 'update'); // need read to populate editRecord
  requireApiPermissions(config, 'update', config.services.update, user);

  const existing = await fetchById(config, scopeInput, id, user);
  if (!existing) {
    throw new McpToolError('not_found', `No ${config.title} record found for id=${id}.`);
  }

  // Scope keys win over body to prevent callers from overriding injected values.
  const input = { ...body, id, ...scopeInput };
  const ctx = synthesizeContext({
    config,
    op: 'update',
    input,
    editRecord: existing,
    user,
    scopeParams: config.api?.scope,
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

  return { status: 200, body: updated ? { record: updated } : {} };
}

// ============================================
// Delete
// ============================================

export async function handleApiDelete(
  args: ApiHandlerArgs & { id: number }
): Promise<ApiResult> {
  const { config, scopeInput, user, id } = args;
  assertService(config.services.delete, 'delete');
  assertService(config.services.read, 'delete'); // need read to populate selection/deleteRecord
  requireApiPermissions(config, 'delete', config.services.delete, user);

  const existing = await fetchById(config, scopeInput, id, user);
  if (!existing) {
    throw new McpToolError('not_found', `No ${config.title} record found for id=${id}.`);
  }

  const input = { ...scopeInput, id };
  const ctx = synthesizeContext({
    config,
    op: 'delete',
    input,
    deleteRecord: existing,
    user,
    scopeParams: config.api?.scope,
  });

  await invokeServiceCall(config.services.delete, ctx);

  return { status: 204, body: null };
}
