// Read-only query service for the unified audit_log table.
// Used exclusively by auditLogConfig (admin viewer).

import { desc, eq, and, gte, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { auditLog } from '../db/schema.js';

export interface AuditLogRow {
  id: number;
  event_type: string;
  action: string;
  source: string;
  user_id: number | null;
  username: string | null;
  client_id: string | null;
  config_id: string | null;
  record_id: string | null;
  ok: boolean;
  error_code: string | null;
  duration_ms: number;
  ip_address: string | null;
  user_agent: string | null;
  before_data: unknown | null;
  after_data: unknown | null;
  params_hash: string | null;
  created_at: Date;
}

export interface ListAuditOptions {
  limit?: number;
  userId?: number;
  eventType?: string;
  source?: string;
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
    .select()
    .from(auditLog)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLog.created_at))
    .limit(limit);

  return rows as AuditLogRow[];
}

export async function getAuditById(id: number): Promise<AuditLogRow | null> {
  const rows = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.id, id))
    .limit(1);
  return (rows[0] as AuditLogRow) ?? null;
}
