// Unified audit log writer.
//
// Dual-writes every event to:
//   1. PostgreSQL `audit_log` table  — queryable, shown in the in-app viewer
//   2. NDJSON log file on disk       — readable by lnav, pinorama, or any
//                                      line-oriented log tool
//
// All writes are best-effort: a failure here MUST NEVER bubble up to or
// block the caller. Errors are swallowed and written to stderr.
//
// File location (override via AUDIT_LOG_DIR env var):
//   server/logs/audit-YYYY-MM-DD.ndjson  (one file per UTC day)

import { appendFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { db } from '../db/index.js';
import { auditLog } from '../db/schema.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AuditEventType = 'auth' | 'crud' | 'mcp' | 'api' | 'session';
export type AuditSource = 'terminal' | 'mcp' | 'api';

export interface AuditEventArgs {
  event_type: AuditEventType;
  /** Fine-grained action label, e.g. 'login', 'login_failed', 'create', 'connect' */
  action: string;
  source: AuditSource;
  user_id?: number | null;
  username?: string | null;
  client_id?: string | null;
  config_id?: string | null;
  /** Stringified primary key of the affected record (CRUD ops). */
  record_id?: string | null;
  ok: boolean;
  error_code?: string | null;
  duration_ms?: number;
  ip_address?: string | null;
  user_agent?: string | null;
  /** Record snapshot BEFORE the change (terminal CRUD update/delete only). */
  before_data?: Record<string, unknown> | null;
  /** Record snapshot AFTER the change (terminal CRUD create/update only). */
  after_data?: Record<string, unknown> | null;
  /** SHA-256 hex of serialised input params (MCP/API calls — avoids PII). */
  params_hash?: string | null;
}

// ---------------------------------------------------------------------------
// Log-file helpers
// ---------------------------------------------------------------------------

const __auditDir = dirname(fileURLToPath(import.meta.url));
// Resolve server root regardless of whether we are running from src/ or dist/.
// src/core/audit  → ../../.. = server/
// dist/core/audit → ../../.. = server/
const SERVER_ROOT = join(__auditDir, '..', '..', '..');
const LOG_DIR = process.env.AUDIT_LOG_DIR ?? join(SERVER_ROOT, 'logs');

let logDirReady = false;

async function ensureLogDir(): Promise<void> {
  if (logDirReady) return;
  await mkdir(LOG_DIR, { recursive: true });
  logDirReady = true;
}

function todayLogFile(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return join(LOG_DIR, `audit-${y}-${m}-${d}.ndjson`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Write one audit event to the database and the rotating NDJSON log file.
 * Never throws — errors go to stderr.
 */
export async function writeAuditEvent(args: AuditEventArgs): Promise<void> {
  // 1. Database write
  try {
    await db.insert(auditLog).values({
      event_type: args.event_type,
      action: args.action,
      source: args.source,
      user_id: args.user_id ?? null,
      username: args.username ?? null,
      client_id: args.client_id ?? null,
      config_id: args.config_id ?? null,
      record_id: args.record_id ?? null,
      ok: args.ok,
      error_code: args.error_code ?? null,
      duration_ms: args.duration_ms ?? 0,
      ip_address: args.ip_address ?? null,
      user_agent: args.user_agent ?? null,
      before_data: args.before_data ?? null,
      after_data: args.after_data ?? null,
      params_hash: args.params_hash ?? null,
    });
  } catch (err) {
    console.error('[audit] db write failed:', err);
  }

  // 2. NDJSON file write (daily rotation via file-name scheme)
  try {
    await ensureLogDir();
    const line = JSON.stringify({
      time: new Date().toISOString(),
      event_type: args.event_type,
      action: args.action,
      source: args.source,
      user_id: args.user_id ?? null,
      username: args.username ?? null,
      client_id: args.client_id ?? null,
      config_id: args.config_id ?? null,
      record_id: args.record_id ?? null,
      ok: args.ok,
      error_code: args.error_code ?? null,
      duration_ms: args.duration_ms ?? 0,
      ip_address: args.ip_address ?? null,
    }) + '\n';
    await appendFile(todayLogFile(), line, 'utf8');
  } catch (err) {
    console.error('[audit] file write failed:', err);
  }
}
