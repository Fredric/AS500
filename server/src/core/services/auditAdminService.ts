// Read-only query service for the unified audit_log table.
// Used exclusively by auditLogConfig (admin viewer).

import { desc, eq, and, gte, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { auditLog, users } from '../db/schema.js';

export interface AuditLogRow {
  id: number;
  event_type: string;
  action: string;
  source: string;
  user_id: number | null;
  username: string | null;
  config_id: string | null;
  record_id: string | null;
  ok: boolean;
  error_code: string | null;
  duration_ms: number;
  ip_address: string | null;
  created_at: Date;
}

export interface ListAuditOptions {
  limit?: number;
  /** Filter to a single user_id */
  userId?: number;
  /** Filter to a single event_type ('auth', 'crud', 'mcp', 'api', 'session') */
  eventType?: string;
  /** Filter to a single source ('terminal', 'mcp', 'api') */
  source?: string;
  /** Only return events since this ISO timestamp */
  since?: string;
}

export async function listAudit(opts: ListAuditOptions = {}): Promise<AuditLogRow[]> {
  const limit = Math.min(opts.limit ?? 500, 1000);
  const conditions: SQL[] = [];

  if (opts.userId != null) conditions.push(eq(auditLog.user_id, opts.userId));
  if (opts.eventType) conditions.push(eq(auditLog.event_type, opts.eventType));
  if (opts.source) conditions.push(eq(auditLog.source, opts.source));
  if (opts.since) conditions.push(gte(auditLog.created_at, new Date(opts.since)));

  const rows = await db
    .select({
      id: auditLog.id,
      event_type: auditLog.event_type,
      action: auditLog.action,
      source: auditLog.source,
      user_id: auditLog.user_id,
      username: auditLog.username,
      config_id: auditLog.config_id,
      record_id: auditLog.record_id,
      ok: auditLog.ok,
      error_code: auditLog.error_code,
      duration_ms: auditLog.duration_ms,
      ip_address: auditLog.ip_address,
      created_at: auditLog.created_at,
    })
    .from(auditLog)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLog.created_at))
    .limit(limit);

  return rows as AuditLogRow[];
}
