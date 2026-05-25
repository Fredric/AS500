// Standalone MCP tool registry (Option B).
//
// Provides a registration surface for custom MCP tools that are not tied to any
// CRUDTable config. Use this for aggregate queries, cross-entity operations,
// report-style reads, or anything that doesn't map to list/read/create/update/delete
// on a single entity.
//
// ## Registration pattern
//
//   registerMcpTools({
//     id: 'my_group',
//     description: '...',
//     requirePermission: 'some:permission',
//     tools: [
//       {
//         name: 'my_tool',
//         description: '...',
//         params: [
//           { name: 'userId', type: 'number', required: true, injectFromAuth: 'userId',
//             description: 'Injected from auth.' },
//           { name: 'input', type: 'string', required: true, description: '...' },
//         ],
//         handler: async ({ userId, input }, user) => { ... },
//       },
//     ],
//   });
//
// Tool names on the wire: `{group.id}_{tool.name}` — e.g. `user_info_get_me`.
// All tools appear alongside CRUD tools in the same MCP server instance;
// agents see one flat namespace of tool names.
//
// RBAC is checked per call: group.requirePermission → tool.requirePermission.
// Admins bypass all checks. injectFromAuth params are server-side only.
//
// ## Where to call registerMcpTools
//
// Import the file that calls it from `server/src/app/index.ts` (after config
// registrations). The import order doesn't matter relative to CRUD configs
// since standalone tools and CRUD tools are registered in separate loops in
// transport.ts. Example:
//
//   // server/src/app/index.ts
//   import './mcp/userTools.js';

import type { MCPCallUserContext, MCPScopeParam } from '../crudtable/types.js';

/**
 * A single custom MCP tool within a {@link McpToolGroup}.
 *
 * Tool name on the wire: `{group.id}_{tool.name}`.
 */
export interface McpToolDef {
  /**
   * Suffix appended to the group id to form the tool name.
   * Use lowercase_snake_case. Must be unique within the group.
   */
  name: string;
  /** Agent-facing description. Write for an LLM that has never seen the system. */
  description: string;
  /**
   * Optional additional permission required to invoke this tool, checked on
   * top of `McpToolGroup.requirePermission`. Both must pass.
   */
  requirePermission?: string;
  /**
   * Input parameters. Non-injected params appear in the generated tool schema.
   * Params with `injectFromAuth` are server-side only — agents cannot supply them.
   * Reuses {@link MCPScopeParam} for consistency with the rest of the MCP surface.
   */
  params?: MCPScopeParam[];
  /**
   * The function that implements the tool.
   *
   * @param args - Validated + injected args. Injected params (`injectFromAuth`)
   *   are already merged in; agents cannot override them.
   * @param user - Authenticated MCP caller. Useful for secondary permission checks
   *   or multi-tenancy guards inside the handler itself.
   * @returns Any JSON-serialisable value. Wrapped in a structured tool result.
   */
  handler: (
    args: Record<string, unknown>,
    user: MCPCallUserContext
  ) => Promise<unknown>;
}

/**
 * A named group of custom MCP tools registered via {@link registerMcpTools}.
 *
 * The `id` is used as a namespace prefix for all tool names in the group:
 * `{id}_{tool.name}`. Keep it short and lowercase_snake (e.g. `user_info`).
 */
export interface McpToolGroup {
  /**
   * Namespace prefix for all tool names in this group.
   * Must be unique across all registered groups. lowercase_snake_case.
   */
  id: string;
  /** Optional display name shown in discovery. Defaults to `id`. */
  name?: string;
  /** Free-form description of what this group of tools does. */
  description: string;
  /**
   * Base permission required to use any tool in the group. Checked before
   * the per-tool `requirePermission`. Omit to allow any authenticated caller.
   */
  requirePermission?: string;
  /** Optional rate-limit override (reads per minute). Inherited by all tools. */
  rateLimit?: { readsPerMin?: number };
  /** The tools in this group. Must contain at least one entry. */
  tools: McpToolDef[];
}

const registry: McpToolGroup[] = [];

/**
 * Register a group of custom MCP tools.
 *
 * Called from app-layer files (e.g. `server/src/app/mcp/userTools.ts`).
 * Duplicate group ids are detected at registration time to surface
 * misconfiguration early during startup.
 */
export function registerMcpTools(group: McpToolGroup): void {
  if (registry.some((g) => g.id === group.id)) {
    throw new Error(`[mcp-tool-registry] Duplicate group id: "${group.id}"`);
  }
  if (!group.tools.length) {
    throw new Error(`[mcp-tool-registry] Group "${group.id}" must define at least one tool.`);
  }
  registry.push(group);
}

/** Return all registered tool groups. Used by `transport.ts` at server build time. */
export function getAllMcpToolGroups(): McpToolGroup[] {
  return registry;
}
