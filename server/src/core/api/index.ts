// Express router for the REST API layer.
//
// Mounted at `/api` on the MCP Express app (port 3002). Every CRUDTable config
// with an `api` block gets five routes: list, read, create, update, delete.
//
// Auth: same OAuth 2.1 Bearer tokens as MCP — passed in as `bearerAuth`
// middleware so the same `requireBearerAuth` instance covers both surfaces.
//
// Scope params:
//   - `injectFromAuth` params are resolved from the Bearer token (never from
//     the request). All other scope params are resolved from the query string.
//   - The request body (create/update) contains only the resource's own fields.
//
// Audit: every request writes a row to `mcp_audit_log` with `source='api'`,
// fire-and-forget (same as MCP).

import { Router, type Request, type Response, type RequestHandler } from 'express';
import { getAllConfigs, getConfig } from '../crudtable/registry.js';
import { loadUserPermissions } from '../services/access.js';
import type { McpCallUser } from '../mcp/contextSynth.js';
import { apiCallRateLimiter } from '../utils/rateLimiter.js';
import { writeAuditRow } from '../mcp/audit.js';
import { McpToolError } from '../mcp/errors.js';
import type { McpOp } from '../mcp/schemaBuilder.js';
import type { CRUDTableConfig, MCPScopeParam } from '../crudtable/types.js';
import type { McpCallToolResult } from '../mcp/errors.js';
import {
  handleApiList,
  handleApiRead,
  handleApiCreate,
  handleApiUpdate,
  handleApiDelete,
  apiResultFromThrown,
  type ApiResult,
} from './handlers.js';

// ============================================
// User resolution
// ============================================

async function resolveUser(req: Request): Promise<McpCallUser> {
  const auth = req.auth!;
  const extra = auth.extra as { userId?: unknown; username?: unknown; jti?: unknown } | undefined;
  const userId = Number(extra?.userId ?? NaN);
  const username = String(extra?.username ?? '');
  const jtiRaw = extra?.jti;

  const { isAdminForUser } = await import('../mcp/oauth/userFacts.js');
  const [isAdmin, permissions] = await Promise.all([
    isAdminForUser(userId),
    loadUserPermissions(userId),
  ]);

  return {
    userId,
    username,
    isAdmin,
    permissions: permissions as Set<string>,
    clientId: auth.clientId,
    jti: typeof jtiRaw === 'string' ? jtiRaw : undefined,
  };
}

// ============================================
// Scope input resolution
// ============================================

function coerceScopeParam(raw: unknown, type: 'string' | 'number' | 'boolean'): unknown {
  if (typeof raw !== 'string') return raw;
  switch (type) {
    case 'number': return Number(raw);
    case 'boolean': return raw === 'true' || raw === '1';
    default: return raw;
  }
}

function buildScopeInput(
  config: CRUDTableConfig,
  query: Record<string, unknown>,
  user: McpCallUser
): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  for (const p of config.api?.scope ?? []) {
    if (p.injectFromAuth) {
      if (p.injectFromAuth === 'userId') scope[p.name] = user.userId;
    } else {
      const raw = query[p.name];
      if (raw !== undefined) {
        scope[p.name] = coerceScopeParam(raw, p.type);
      }
    }
  }
  return scope;
}

// ============================================
// Operation enabled check
// ============================================

function isOpEnabled(config: CRUDTableConfig, op: McpOp): boolean {
  const entry = config.api?.operations?.[op];
  return entry === true || (typeof entry === 'object' && entry !== null);
}

// ============================================
// Rate limiter middleware
// ============================================

function makeRateLimitMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: () => void): void => {
    const key = req.auth?.clientId ?? req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    if (apiCallRateLimiter.check(`api:${key}`)) {
      next();
      return;
    }
    res.setHeader('Retry-After', '60');
    res.status(429).json({
      error: { code: 'rate_limited', message: 'Rate limit exceeded' },
    });
  };
}

// ============================================
// Send helper
// ============================================

function sendResult(res: Response, result: ApiResult): void {
  if (result.status === 204 || result.body === null) {
    res.status(204).end();
    return;
  }
  res.status(result.status).json(result.body);
}

// ============================================
// Audit helper
// ============================================

function auditResult(
  isError: boolean,
  errorCode?: string | null
): McpCallToolResult {
  return {
    content: [],
    isError,
    ...(isError ? { structuredContent: { error: { code: errorCode ?? 'internal_error' } } } : {}),
  };
}

// ============================================
// Router factory
// ============================================

export interface ApiRouterOptions {
  bearerAuth: RequestHandler;
  debug?: boolean;
}

export function buildApiRouter({ bearerAuth, debug = false }: ApiRouterOptions): Router {
  const router = Router();
  const rateLimit = makeRateLimitMiddleware();

  // -------- GET /api — discovery --------
  router.get('/', bearerAuth, (_req: Request, res: Response) => {
    const resources = getAllConfigs()
      .filter((c) => c.api)
      .map((c) => ({
        id: c.id,
        name: c.api!.name ?? c.id,
        description: c.api!.description,
        operations: Object.entries(c.api!.operations ?? {})
          .filter(([, v]) => v === true || (typeof v === 'object' && v !== null))
          .map(([op]) => op),
        // Omit injectFromAuth params — callers don't need to know about them.
        scope: (c.api!.scope ?? [])
          .filter((p: MCPScopeParam) => !p.injectFromAuth)
          .map((p: MCPScopeParam) => ({
            name: p.name,
            type: p.type,
            required: p.required,
            description: p.description,
          })),
      }));
    res.json({ resources });
  });

  // -------- GET /api/:configId — list --------
  router.get('/:configId', bearerAuth, rateLimit, async (req: Request, res: Response) => {
    const config = getConfig(req.params.configId as string);
    if (!config?.api) {
      res.status(404).json({ error: { code: 'not_found', message: `Resource '${req.params.configId}' not found.` } });
      return;
    }
    if (!isOpEnabled(config, 'list')) {
      res.status(405).json({ error: { code: 'unsupported_operation', message: 'list is not enabled for this resource.' } });
      return;
    }
    const startedAtMs = Date.now();
    let user: McpCallUser | undefined;
    let result: ApiResult;
    try {
      user = await resolveUser(req);
      const scopeInput = buildScopeInput(config, req.query as Record<string, unknown>, user);
      result = await handleApiList({ config, scopeInput, user, query: req.query as Record<string, unknown> });
    } catch (err) {
      result = apiResultFromThrown(err, debug);
    }
    sendResult(res, result);
    if (user) {
      void writeAuditRow({
        configId: config.id,
        toolName: `REST:${config.id}.list`,
        op: 'list',
        user,
        input: req.query,
        result: auditResult(result.status >= 400, result.status >= 400 ? (result.body as Record<string, unknown>)?.error as string : null),
        startedAtMs,
        source: 'api',
      });
    }
  });

  // -------- GET /api/:configId/:id — read --------
  router.get('/:configId/:id', bearerAuth, rateLimit, async (req: Request, res: Response) => {
    const config = getConfig(req.params.configId as string);
    if (!config?.api) {
      res.status(404).json({ error: { code: 'not_found', message: `Resource '${req.params.configId}' not found.` } });
      return;
    }
    if (!isOpEnabled(config, 'read')) {
      res.status(405).json({ error: { code: 'unsupported_operation', message: 'read is not enabled for this resource.' } });
      return;
    }
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: { code: 'validation_failed', message: 'id must be a number.' } });
      return;
    }
    const startedAtMs = Date.now();
    let user: McpCallUser | undefined;
    let result: ApiResult;
    try {
      user = await resolveUser(req);
      const scopeInput = buildScopeInput(config, req.query as Record<string, unknown>, user);
      result = await handleApiRead({ config, scopeInput, user, id });
    } catch (err) {
      result = apiResultFromThrown(err, debug);
    }
    sendResult(res, result);
    if (user) {
      void writeAuditRow({
        configId: config.id,
        toolName: `REST:${config.id}.read`,
        op: 'read',
        user,
        input: { id, ...req.query },
        result: auditResult(result.status >= 400),
        startedAtMs,
        source: 'api',
      });
    }
  });

  // -------- POST /api/:configId — create --------
  router.post('/:configId', bearerAuth, rateLimit, async (req: Request, res: Response) => {
    const config = getConfig(req.params.configId as string);
    if (!config?.api) {
      res.status(404).json({ error: { code: 'not_found', message: `Resource '${req.params.configId}' not found.` } });
      return;
    }
    if (!isOpEnabled(config, 'create')) {
      res.status(405).json({ error: { code: 'unsupported_operation', message: 'create is not enabled for this resource.' } });
      return;
    }
    const startedAtMs = Date.now();
    let user: McpCallUser | undefined;
    let result: ApiResult;
    try {
      user = await resolveUser(req);
      const scopeInput = buildScopeInput(config, req.query as Record<string, unknown>, user);
      const body = (req.body ?? {}) as Record<string, unknown>;
      result = await handleApiCreate({ config, scopeInput, user, body });
    } catch (err) {
      result = apiResultFromThrown(err, debug);
    }
    sendResult(res, result);
    if (user) {
      void writeAuditRow({
        configId: config.id,
        toolName: `REST:${config.id}.create`,
        op: 'create',
        user,
        input: req.body,
        result: auditResult(result.status >= 400),
        startedAtMs,
        source: 'api',
      });
    }
  });

  // -------- PUT /api/:configId/:id — update --------
  router.put('/:configId/:id', bearerAuth, rateLimit, async (req: Request, res: Response) => {
    const config = getConfig(req.params.configId as string);
    if (!config?.api) {
      res.status(404).json({ error: { code: 'not_found', message: `Resource '${req.params.configId}' not found.` } });
      return;
    }
    if (!isOpEnabled(config, 'update')) {
      res.status(405).json({ error: { code: 'unsupported_operation', message: 'update is not enabled for this resource.' } });
      return;
    }
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: { code: 'validation_failed', message: 'id must be a number.' } });
      return;
    }
    const startedAtMs = Date.now();
    let user: McpCallUser | undefined;
    let result: ApiResult;
    try {
      user = await resolveUser(req);
      const scopeInput = buildScopeInput(config, req.query as Record<string, unknown>, user);
      const body = (req.body ?? {}) as Record<string, unknown>;
      result = await handleApiUpdate({ config, scopeInput, user, id, body });
    } catch (err) {
      result = apiResultFromThrown(err, debug);
    }
    sendResult(res, result);
    if (user) {
      void writeAuditRow({
        configId: config.id,
        toolName: `REST:${config.id}.update`,
        op: 'update',
        user,
        input: { id, ...req.body },
        result: auditResult(result.status >= 400),
        startedAtMs,
        source: 'api',
      });
    }
  });

  // -------- DELETE /api/:configId/:id — delete --------
  router.delete('/:configId/:id', bearerAuth, rateLimit, async (req: Request, res: Response) => {
    const config = getConfig(req.params.configId as string);
    if (!config?.api) {
      res.status(404).json({ error: { code: 'not_found', message: `Resource '${req.params.configId}' not found.` } });
      return;
    }
    if (!isOpEnabled(config, 'delete')) {
      res.status(405).json({ error: { code: 'unsupported_operation', message: 'delete is not enabled for this resource.' } });
      return;
    }
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: { code: 'validation_failed', message: 'id must be a number.' } });
      return;
    }
    const startedAtMs = Date.now();
    let user: McpCallUser | undefined;
    let result: ApiResult;
    try {
      user = await resolveUser(req);
      const scopeInput = buildScopeInput(config, req.query as Record<string, unknown>, user);
      result = await handleApiDelete({ config, scopeInput, user, id });
    } catch (err) {
      result = apiResultFromThrown(err, debug);
    }
    sendResult(res, result);
    if (user) {
      void writeAuditRow({
        configId: config.id,
        toolName: `REST:${config.id}.delete`,
        op: 'delete',
        user,
        input: { id },
        result: auditResult(result.status >= 400),
        startedAtMs,
        source: 'api',
      });
    }
  });

  return router;
}
