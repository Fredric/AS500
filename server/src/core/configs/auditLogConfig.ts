// Unified Audit Log — read-only admin inspector for the audit_log table.
// Shows all access surfaces: terminal UI, MCP tool calls, REST API, auth,
// and WebSocket session events. Newest 500 rows, newest first.

import type { CRUDTableConfig } from '../crudtable/types.js';
import { PERMISSIONS } from '../services/access.js';
import * as auditAdminService from '../services/auditAdminService.js';

function formatTimestamp(value: unknown): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value as string);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Map event_type + action to a compact two-char category label. */
function formatCategory(row: Record<string, unknown>): string {
  const type = String(row.event_type ?? '');
  const action = String(row.action ?? '');
  switch (type) {
    case 'auth':
      if (action === 'login') return 'LI';
      if (action === 'login_failed') return 'LF';
      if (action === 'logout') return 'LO';
      if (action === 'token_refresh') return 'TR';
      return 'AU';
    case 'crud': {
      const map: Record<string, string> = { create: 'CR', update: 'UP', delete: 'DE', list: 'LS', read: 'RD' };
      return map[action] ?? 'CD';
    }
    case 'mcp': return 'MC';
    case 'api': return 'AP';
    case 'session':
      if (action === 'connect') return 'CN';
      if (action === 'disconnect') return 'DC';
      if (action === 'resume') return 'RS';
      if (action === 'expire') return 'EX';
      return 'SS';
    default: return type.substring(0, 2).toUpperCase();
  }
}

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
  },

  fieldConfigs: {
    created_at: {
      field: 'created_at',
      label: 'When',
      length: 20,
      column: {
        width: 19,
        cellRenderer: (_ctx, r) => formatTimestamp(r.created_at),
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
    },
    action: {
      field: 'action',
      label: 'Action',
      length: 16,
      column: { width: 13 },
    },
    config_id: {
      field: 'config_id',
      label: 'Config',
      length: 16,
      column: {
        width: 13,
        cellRenderer: (_ctx, r) => String(r.config_id ?? ''),
      },
    },
    ok: {
      field: 'ok',
      label: 'OK',
      length: 3,
      column: {
        width: 2,
        cellRenderer: (_ctx, r) => (r.ok ? 'Y' : 'N'),
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
  formBuilder: [],

  listHeader: () => ([
    { row: 5, col: 2, content: 'Unified audit log — all surfaces. Cat: LI=login LF=fail LO=logout TR=refresh CN/DC/RS=session CR/UP/DE=crud MC=mcp AP=api' },
  ]),
};
