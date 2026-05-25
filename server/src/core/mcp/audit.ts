// Append-only audit log for MCP tool calls.
//
// Every invocation via the `/mcp` endpoint — whether it succeeds, fails
// validation, is rejected for permissions, or crashes — produces exactly one
// row in `mcp_audit_log`. The row captures *who* called *what* for *which
// config*, plus outcome + timing. Parameter values are never stored; only a
// sha256 hash of the serialized input, so identical calls can be grouped
// without leaking PII or secrets to diagnostic readers.
//
// Writes are best-effort: a DB hiccup here must never fail the agent's call,
// so errors are swallowed and logged to stderr.
//
// Also forwards every event to the unified `audit_log` table via writeAuditEvent
// so all access surfaces are visible in one place.

import { db } from '../db/index.js';
import { mcpAuditLog } from '../db/schema.js';
import type { McpCallUser } from './contextSynth.js';
import type { McpOp } from './schemaBuilder.js';
import type { McpCallToolResult } from './errors.js';
import { hashParams } from './oauth/store.js';
import { writeAuditEvent } from '../audit/writer.js';

export interface AuditCallArgs {
  configId: string;
  toolName: string;
  /** CRUD op for standard tools; `'action'` for custom actions and standalone tools. */
  op: McpOp | 'action';
  user: McpCallUser;
  input: unknown;
  result: McpCallToolResult;
  startedAtMs: number;
  /** Identifies the access path for this call. Defaults to 'mcp'. */
  source?: 'mcp' | 'api';
  /** Client IP address (available on REST API calls). */
  ip_address?: string | null;
}

/**
 * Extract the stable error code from a tool result's structured payload.
 * Returns null for successful results. Unknown shapes fall back to
 * `'internal_error'` so the audit row always carries something useful.
 */
function extractErrorCode(result: McpCallToolResult): string | null {
  if (!result.isError) return null;
  const sc = result.structuredContent as
    | { error?: { code?: string } }
    | undefined;
  return sc?.error?.code ?? 'internal_error';
}

export async function writeAuditRow(args: AuditCallArgs): Promise<void> {
  const { configId, toolName, op, user, input, result, startedAtMs, source, ip_address } = args;
  const durationMs = Math.max(0, Date.now() - startedAtMs);
  const errorCode = extractErrorCode(result);
  const paramsHash = hashParams(input);
  const resolvedSource = source ?? 'mcp';

  // Write to legacy mcp_audit_log (backward compat — mcpAuditConfig screen reads this).
  try {
    await db.insert(mcpAuditLog).values({
      client_id: user.clientId ?? null,
      user_id: user.userId > 0 ? user.userId : null,
      tool_name: toolName,
      config_id: configId,
      action: op,
      params_hash: paramsHash,
      ok: !result.isError,
      error_code: errorCode,
      duration_ms: durationMs,
      source: resolvedSource,
    });
  } catch (err) {
    console.error('[mcp-audit] failed to write mcp_audit_log row:', err);
  }

  // Also forward to the unified audit_log.
  void writeAuditEvent({
    event_type: resolvedSource === 'api' ? 'api' : 'mcp',
    action: op,
    source: resolvedSource,
    user_id: user.userId > 0 ? user.userId : null,
    username: user.username || null,
    client_id: user.clientId ?? null,
    config_id: configId,
    ok: !result.isError,
    error_code: errorCode,
    duration_ms: durationMs,
    ip_address: ip_address ?? null,
    params_hash: paramsHash,
  });
}
