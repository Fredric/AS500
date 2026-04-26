// CRUDTable Registry
// Stores configs and derives screen IDs

import type { CRUDTableConfig, MCPConfig, APIConfig } from './types.js';

const configs = new Map<string, CRUDTableConfig>();

// Screen ID convention: CRUD_{ID} for list, CRUD_{ID}_FORM for form, CRUD_{ID}_DELETE_CONFIRM for delete confirmation
export function listScreenId(configId: string): string {
  return `CRUD_${configId.toUpperCase()}`;
}

export function formScreenId(configId: string): string {
  return `CRUD_${configId.toUpperCase()}_FORM`;
}

export function deleteConfirmScreenId(configId: string): string {
  return `CRUD_${configId.toUpperCase()}_DELETE_CONFIRM`;
}

/**
 * Register a CRUDTable config. Throws a clear startup error if the config is
 * malformed — in particular, if its optional `mcp` or `api` blocks are
 * inconsistent with the available services. Catching this at registration time
 * is the only way to prevent broken tools or endpoints from being exposed.
 */
export function registerConfig(config: CRUDTableConfig): void {
  if (config.mcp) {
    validateMcpConfig(config);
  }
  if (config.api) {
    validateApiConfig(config);
  }
  configs.set(config.id, config);
}

// Every MCP-exposable operation on a CRUDTableConfig maps 1:1 to a service name.
const MCP_OP_SERVICES = ['list', 'read', 'create', 'update', 'delete'] as const;
type McpOp = (typeof MCP_OP_SERVICES)[number];

function isOperationEnabled(
  operations: MCPConfig['operations'],
  op: McpOp
): boolean {
  const value = operations[op];
  // `true` or any object override both enable the op. Explicit `false`
  // / `undefined` leave it disabled.
  return value === true || (typeof value === 'object' && value !== null);
}

/**
 * Enforce the invariants documented on {@link MCPConfig}. Runs at
 * `registerConfig` time so misconfigurations surface during server startup,
 * never mid-request.
 */
function validateMcpConfig(config: CRUDTableConfig): void {
  const mcp = config.mcp!;
  const ctx = `CRUDTableConfig "${config.id}".mcp`;

  if (!mcp.description || !mcp.description.trim()) {
    throw new Error(
      `${ctx}: description is required when the mcp block is present — ` +
      `it is the primary signal external agents use to decide whether to ` +
      `call this tool.`
    );
  }

  if (!mcp.operations || typeof mcp.operations !== 'object') {
    throw new Error(`${ctx}: operations object is required.`);
  }

  const enabled = MCP_OP_SERVICES.filter((op) => isOperationEnabled(mcp.operations, op));
  if (enabled.length === 0) {
    throw new Error(
      `${ctx}: at least one entry in operations must be enabled; remove the ` +
      `mcp block entirely if you don't want to expose anything.`
    );
  }

  for (const op of enabled) {
    const serviceCall = config.services[op];
    if (!serviceCall) {
      throw new Error(
        `${ctx}.operations.${op} is enabled but services.${op} is missing. ` +
        `Either define the service or remove the operation from the mcp block.`
      );
    }
    if (typeof serviceCall.method !== 'string' || !serviceCall.method) {
      throw new Error(
        `${ctx}.operations.${op} is enabled but services.${op}.method is not a non-empty string.`
      );
    }
  }

  if (mcp.scope) {
    const seen = new Set<string>();
    for (const p of mcp.scope) {
      if (!p.name || !p.type || !p.description) {
        throw new Error(
          `${ctx}.scope entries must have name, type, and description set ` +
          `(offending entry: ${JSON.stringify(p)}).`
        );
      }
      if (seen.has(p.name)) {
        throw new Error(`${ctx}.scope has duplicate parameter name "${p.name}".`);
      }
      seen.add(p.name);
    }
  }
}

// Every API-exposable operation on a CRUDTableConfig maps 1:1 to a service name.
const API_OP_SERVICES = ['list', 'read', 'create', 'update', 'delete'] as const;
type ApiOpName = (typeof API_OP_SERVICES)[number];

function isApiOperationEnabled(
  operations: APIConfig['operations'],
  op: ApiOpName
): boolean {
  if (!operations) return false;
  const value = operations[op];
  return value === true || (typeof value === 'object' && value !== null);
}

/**
 * Enforce the invariants documented on {@link APIConfig}. Runs at
 * `registerConfig` time so misconfigurations surface during server startup.
 */
function validateApiConfig(config: CRUDTableConfig): void {
  const api = config.api!;
  const ctx = `CRUDTableConfig "${config.id}".api`;

  if (!api.operations || typeof api.operations !== 'object') {
    throw new Error(`${ctx}: operations object is required.`);
  }

  const enabled = API_OP_SERVICES.filter((op) => isApiOperationEnabled(api.operations, op));
  if (enabled.length === 0) {
    throw new Error(
      `${ctx}: at least one entry in operations must be enabled; remove the ` +
      `api block entirely if you don't want to expose anything.`
    );
  }

  for (const op of enabled) {
    const serviceCall = config.services[op];
    if (!serviceCall) {
      throw new Error(
        `${ctx}.operations.${op} is enabled but services.${op} is missing. ` +
        `Either define the service or remove the operation from the api block.`
      );
    }
    if (typeof serviceCall.method !== 'string' || !serviceCall.method) {
      throw new Error(
        `${ctx}.operations.${op} is enabled but services.${op}.method is not a non-empty string.`
      );
    }
  }

  // update and delete require read to pre-fetch the existing record.
  if (
    (isApiOperationEnabled(api.operations, 'update') ||
      isApiOperationEnabled(api.operations, 'delete')) &&
    !config.services.read
  ) {
    throw new Error(
      `${ctx}: update and delete operations require services.read to be defined ` +
      `(used to pre-fetch the record before mutation).`
    );
  }

  if (api.scope) {
    const seen = new Set<string>();
    for (const p of api.scope) {
      if (!p.name || !p.type || !p.description) {
        throw new Error(
          `${ctx}.scope entries must have name, type, and description set ` +
          `(offending entry: ${JSON.stringify(p)}).`
        );
      }
      if (seen.has(p.name)) {
        throw new Error(`${ctx}.scope has duplicate parameter name "${p.name}".`);
      }
      seen.add(p.name);
    }
  }
}

export function getConfig(id: string): CRUDTableConfig | undefined {
  return configs.get(id);
}

/**
 * Snapshot of every registered config. Used by infrastructure that needs to
 * enumerate the full registry once at startup (e.g. the MCP tool generator
 * in `server/src/mcp/transport.ts`). Returns an array copy — callers can
 * safely iterate without worrying about concurrent registration.
 */
export function getAllConfigs(): CRUDTableConfig[] {
  return [...configs.values()];
}

// Match a screen ID back to its config + mode
export function getConfigByScreenId(screenId: string): { config: CRUDTableConfig; mode: 'list' | 'form' | 'confirm_delete' } | null {
  if (!screenId.startsWith('CRUD_')) return null;

  for (const config of configs.values()) {
    if (screenId === listScreenId(config.id)) {
      return { config, mode: 'list' };
    }
    if (screenId === formScreenId(config.id)) {
      return { config, mode: 'form' };
    }
    if (screenId === deleteConfirmScreenId(config.id)) {
      return { config, mode: 'confirm_delete' };
    }
  }

  return null;
}
