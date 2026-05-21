// Unified Audit Log — read-only admin inspector for the audit_log table.
// List: most-recent 500 rows across all surfaces.
// Detail (Enter on a row): full-page view showing every field including
// before_data / after_data JSONB snapshots.

import type { CRUDTableConfig, CRUDContext } from '../crudtable/types.js';
import { PERMISSIONS } from '../services/access.js';
import * as auditAdminService from '../services/auditAdminService.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(value: unknown): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value as string);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Map event_type + action to a compact 2-char code shown in the list. */
function formatCategory(row: Record<string, unknown>): string {
  const type = String(row.event_type ?? '');
  const action = String(row.action ?? '');
  switch (type) {
    case 'auth': {
      const m: Record<string, string> = { login: 'LI', login_failed: 'LF', logout: 'LO', token_refresh: 'TR' };
      return m[action] ?? 'AU';
    }
    case 'crud': {
      const m: Record<string, string> = { create: 'CR', update: 'UP', delete: 'DE', list: 'LS', read: 'RD' };
      return m[action] ?? 'CD';
    }
    case 'mcp': return 'MC';
    case 'api': return 'AP';
    case 'session': {
      const m: Record<string, string> = { connect: 'CN', disconnect: 'DC', resume: 'RS', expire: 'EX' };
      return m[action] ?? 'SS';
    }
    default: return type.substring(0, 2).toUpperCase();
  }
}

/** Stringify a JSONB value for display, capped at maxLen chars. */
function jsonPreview(value: unknown, maxLen: number): string {
  if (value === null || value === undefined) return '';
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value);
    return s.length > maxLen ? s.substring(0, maxLen - 1) + '…' : s;
  } catch {
    return String(value).substring(0, maxLen);
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const auditLogConfig: CRUDTableConfig = {
  id: 'audit_log',
  title: 'Audit Log',
  requireAuth: true,
  requirePermission: PERMISSIONS.SYS_ADMIN,

  services: {
    list: {
      service: auditAdminService as unknown as Record<string, Function>,
      method: 'listAudit',
    },
    read: {
      service: auditAdminService as unknown as Record<string, Function>,
      method: 'getAuditById',
      params: (ctx: CRUDContext) => ctx.editRecord?.id as number,
    },
  },

  fieldConfigs: {
    // ---- list-only fields ----
    created_at: {
      field: 'created_at',
      label: 'When',
      length: 20,
      column: {
        width: 19,
        cellRenderer: (_ctx, r) => formatTimestamp(r.created_at),
      },
      form: {
        disabled: true,
        formValue: (_ctx, v) => formatTimestamp(v),
      },
    },
    cat: {
      field: 'event_type',
      label: 'Cat',
      length: 4,
      column: {
        width: 2,
        cellRenderer: (_ctx, r) => formatCategory(r),
      },
    },
    source: {
      field: 'source',
      label: 'Via',
      length: 8,
      column: {
        width: 8,
        cellRenderer: (_ctx, r) => String(r.source ?? '').substring(0, 8),
      },
      form: { disabled: true },
    },
    username: {
      field: 'username',
      label: 'User',
      length: 16,
      column: {
        width: 12,
        cellRenderer: (_ctx, r) =>
          r.username ? String(r.username) : r.user_id != null ? `#${r.user_id}` : '',
      },
      form: {
        disabled: true,
        formValue: (_ctx, v) =>
          v ? String(v) : '',
      },
    },
    action: {
      field: 'action',
      label: 'Action',
      length: 32,
      column: { width: 13 },
      form: { disabled: true },
    },
    config_id: {
      field: 'config_id',
      label: 'Config',
      length: 32,
      column: {
        width: 13,
        cellRenderer: (_ctx, r) => String(r.config_id ?? ''),
      },
      form: { disabled: true },
    },
    ok: {
      field: 'ok',
      label: 'OK',
      length: 3,
      column: {
        width: 2,
        cellRenderer: (_ctx, r) => (r.ok ? 'Y' : 'N'),
      },
      form: {
        disabled: true,
        formValue: (_ctx, v) => (v ? 'Y' : 'N'),
      },
    },
    error_code: {
      field: 'error_code',
      label: 'Error',
      length: 24,
      column: {
        width: 18,
        cellRenderer: (_ctx, r) => String(r.error_code ?? ''),
      },
      form: { disabled: true },
    },

    // ---- detail-only fields (shown only on the form) ----
    id: {
      field: 'id',
      label: 'ID',
      length: 10,
      form: {
        disabled: true,
        formValue: (_ctx, v) => String(v ?? ''),
      },
    },
    event_type: {
      field: 'event_type',
      label: 'Event type',
      length: 16,
      form: { disabled: true },
    },
    user_id: {
      field: 'user_id',
      label: 'User ID',
      length: 10,
      form: {
        disabled: true,
        formValue: (_ctx, v) => (v != null ? String(v) : ''),
      },
    },
    client_id: {
      field: 'client_id',
      label: 'Client ID',
      length: 48,
      form: { disabled: true },
    },
    record_id: {
      field: 'record_id',
      label: 'Record ID',
      length: 48,
      form: { disabled: true },
    },
    duration_ms: {
      field: 'duration_ms',
      label: 'Duration ms',
      length: 10,
      form: {
        disabled: true,
        formValue: (_ctx, v) => (v != null ? `${v} ms` : ''),
      },
    },
    ip_address: {
      field: 'ip_address',
      label: 'IP address',
      length: 45,
      form: { disabled: true },
    },
    user_agent: {
      field: 'user_agent',
      label: 'User agent',
      length: 48,
      form: {
        disabled: true,
        formValue: (_ctx, v) => v ? String(v).substring(0, 48) : '',
      },
    },
    before_data: {
      field: 'before_data',
      label: 'Before',
      length: 48,
      form: {
        disabled: true,
        formValue: (_ctx, v) => jsonPreview(v, 48),
      },
    },
    after_data: {
      field: 'after_data',
      label: 'After',
      length: 48,
      form: {
        disabled: true,
        formValue: (_ctx, v) => jsonPreview(v, 48),
      },
    },
    params_hash: {
      field: 'params_hash',
      label: 'Params hash',
      length: 48,
      form: { disabled: true },
    },
  },

  columnBuilder: [
    'created_at',
    'cat',
    'source',
    'username',
    'action',
    'config_id',
    'ok',
    'error_code',
  ],

  formBuilder: [
    'id',
    'created_at',
    'event_type',
    'action',
    'source',
    'username',
    'user_id',
    'client_id',
    'config_id',
    'record_id',
    'ok',
    'error_code',
    'duration_ms',
    'ip_address',
    'user_agent',
    'before_data',
    'after_data',
    'params_hash',
  ],

  navigation: {
    primaryAction: 'edit',
  },

  listHeader: () => ([
    { row: 5, col: 2, content: 'Unified audit log. Cat: LI=login LF=fail LO=logout TR=refresh CN/DC/RS=session CR/UP/DE=crud MC=mcp AP=api. Enter=Detail' },
  ]),
};
