// MCP server factory + tool registration.
//
// Walks the CRUDTable config registry and, for every config with an `mcp`
// block, registers one tool per enabled operation on a fresh `McpServer`
// instance. The registered callbacks delegate to `toolHandlers.ts` — this
// file is strictly plumbing.
//
// Why a new server per transport (per request) in stateless mode?
//   The MCP Streamable HTTP transport can run stateful (session id issued
//   once, subsequent calls reuse it) or stateless (every POST is independent,
//   no server→client push). The AS500 config registry is effectively static
//   for the lifetime of the process, so we could share a single `McpServer`
//   and attach a new transport per request. That's what `createMcpServer()`
//   returns — a long-lived singleton — and `index.ts` wires a fresh transport
//   per POST on top of it.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CRUDTableConfig } from '../crudtable/types.js';
import { getAllConfigs } from '../crudtable/registry.js';
import {
  buildInputShape,
  toolDescription,
  toolName,
  type McpOp,
} from './schemaBuilder.js';
import {
  handleCreate,
  handleDelete,
  handleList,
  handleRead,
  handleUpdate,
  type HandlerArgs,
} from './toolHandlers.js';
import type { McpCallUser } from './contextSynth.js';
import { toolResultFromThrown, type McpCallToolResult } from './errors.js';
import { writeAuditRow } from './audit.js';

const ALL_OPS: McpOp[] = ['list', 'read', 'create', 'update', 'delete'];

function isOpEnabled(config: CRUDTableConfig, op: McpOp): boolean {
  const entry = config.mcp?.operations?.[op];
  return entry === true || (typeof entry === 'object' && entry !== null);
}

/**
 * Fallback user. Used only when no authenticated caller has been threaded
 * through (i.e. in unit tests or when auth is explicitly bypassed). With
 * empty permissions + `isAdmin=false`, every handler will deny every op that
 * has a `requirePermission` — which is the conservative default.
 */
const ANONYMOUS_USER: McpCallUser = {
  userId: -1,
  username: 'mcp_anonymous',
  isAdmin: false,
  permissions: new Set(),
};

type Handler = (args: HandlerArgs) => Promise<McpCallToolResult>;

const HANDLERS: Record<McpOp, Handler> = {
  list: handleList,
  read: handleRead,
  create: handleCreate,
  update: handleUpdate,
  delete: handleDelete,
};

export interface BuildMcpServerOptions {
  /**
   * When true, internal error messages are returned verbatim to the caller.
   * Leave false in production to avoid leaking stack traces and DB errors to
   * external agents.
   */
  debug?: boolean;
  /**
   * Authenticated caller for this request. When omitted, falls back to an
   * anonymous user with no permissions — handy for introspection/test paths
   * that don't need to execute tools. The Express handler in `mcp/index.ts`
   * resolves this from `req.auth` on every request.
   */
  user?: McpCallUser;
}

/**
 * Build a fresh `McpServer` with every opted-in CRUDTable tool registered.
 *
 * Returns the server + a summary of what was registered so startup code can
 * log a sensible line instead of guessing.
 */
export function buildMcpServer(opts: BuildMcpServerOptions = {}): {
  server: McpServer;
  toolCount: number;
  configCount: number;
} {
  const server = new McpServer({
    name: 'as500-mcp',
    version: '1.0.0',
    title: 'AS500 — CRUDTable remote MCP',
  });

  const debug = opts.debug ?? false;
  const user = opts.user ?? ANONYMOUS_USER;
  let toolCount = 0;
  let configCount = 0;

  for (const config of getAllConfigs()) {
    if (!config.mcp) continue;
    configCount++;

    for (const op of ALL_OPS) {
      if (!isOpEnabled(config, op)) continue;

      const inputShape = buildInputShape(config, op);
      const description = toolDescription(config, op);
      const name = toolName(config.id, op);
      const handler = HANDLERS[op];

      server.registerTool(
        name,
        {
          title: `${config.mcp.name ?? config.id}.${op}`,
          description,
          inputSchema: inputShape,
        },
        async (args: unknown) => {
          const startedAtMs = Date.now();
          const input = (args ?? {}) as Record<string, unknown>;
          let result: McpCallToolResult;
          try {
            result = await handler({ config, input, user, op });
          } catch (err) {
            result = toolResultFromThrown(err, { debug });
          }
          // Fire-and-forget: audit writes must never delay the response or
          // fail the call. `writeAuditRow` already swallows its own errors.
          void writeAuditRow({
            configId: config.id,
            toolName: name,
            op,
            user,
            input,
            result,
            startedAtMs,
          });
          return result as never;
        }
      );

      toolCount++;
    }
  }

  return { server, toolCount, configCount };
}
