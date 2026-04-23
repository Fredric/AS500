// Read-only admin service for inspecting mcp_audit_log — one row per MCP tool
// call. Joins users so each row shows the username instead of just a user_id.

import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { mcpAuditLog, users } from '../db/schema.js';

export interface McpAuditRow {
  id: number;
  created_at: Date;
  user_id: number | null;
  username: string | null;
  client_id: string | null;
  tool_name: string;
  config_id: string;
  action: string;
  ok: boolean;
  error_code: string | null;
  duration_ms: number;
}

const MAX_ROWS = 500;

export async function listMcpAudit(_params?: Record<string, unknown>): Promise<McpAuditRow[]> {
  const rows = await db
    .select({
      id: mcpAuditLog.id,
      created_at: mcpAuditLog.created_at,
      user_id: mcpAuditLog.user_id,
      username: users.username,
      client_id: mcpAuditLog.client_id,
      tool_name: mcpAuditLog.tool_name,
      config_id: mcpAuditLog.config_id,
      action: mcpAuditLog.action,
      ok: mcpAuditLog.ok,
      error_code: mcpAuditLog.error_code,
      duration_ms: mcpAuditLog.duration_ms,
    })
    .from(mcpAuditLog)
    .leftJoin(users, eq(users.id, mcpAuditLog.user_id))
    .orderBy(desc(mcpAuditLog.created_at))
    .limit(MAX_ROWS);

  return rows;
}
