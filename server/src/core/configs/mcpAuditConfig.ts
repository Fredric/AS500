// MCP Audit Log — read-only admin inspector for mcp_audit_log.
// One row per MCP tool call; append-only. Shows the 500 most-recent calls.

import type { CRUDTableConfig } from '../crudtable/types.js';
import { PERMISSIONS } from '../services/access.js';
import * as mcpAuditAdminService from '../services/mcpAuditAdminService.js';

function formatTimestamp(value: unknown): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value as string);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export const mcpAuditConfig: CRUDTableConfig = {
  id: 'mcp_audit',
  title: 'MCP Audit Log',
  requireAuth: true,
  requirePermission: PERMISSIONS.SYS_ADMIN,

  services: {
    list: {
      service: mcpAuditAdminService as unknown as Record<string, Function>,
      method: 'listMcpAudit',
    },
  },

  fieldConfigs: {
    created_at: {
      field: 'created_at',
      label: 'When',
      length: 20,
      column: {
        width: 19,
        cellRenderer: (r) => formatTimestamp(r.created_at),
      },
    },
    username: {
      field: 'username',
      label: 'User',
      length: 16,
      column: {
        width: 14,
        cellRenderer: (r) =>
          r.username ? String(r.username) : r.user_id != null ? `#${r.user_id}` : '',
      },
    },
    client_id: {
      field: 'client_id',
      label: 'Client',
      length: 16,
      column: {
        width: 14,
        cellRenderer: (r) => String(r.client_id ?? ''),
      },
    },
    tool_name: {
      field: 'tool_name',
      label: 'Tool',
      length: 24,
      column: { width: 20 },
    },
    action: {
      field: 'action',
      label: 'Action',
      length: 8,
      column: { width: 7 },
    },
    ok: {
      field: 'ok',
      label: 'OK',
      length: 3,
      column: {
        width: 3,
        cellRenderer: (r) => (r.ok ? 'Y' : 'N'),
      },
    },
    duration_ms: {
      field: 'duration_ms',
      label: 'ms',
      length: 6,
      column: {
        width: 6,
        align: 'right',
        cellRenderer: (r) => String(r.duration_ms ?? ''),
      },
    },
    error_code: {
      field: 'error_code',
      label: 'Error',
      length: 20,
      column: {
        width: 16,
        cellRenderer: (r) => String(r.error_code ?? ''),
      },
    },
    source: {
      field: 'source',
      label: 'Src',
      length: 4,
      column: {
        width: 4,
        cellRenderer: (r) => String(r.source ?? 'mcp'),
      },
    },
  },

  columnBuilder: [
    'created_at',
    'username',
    'tool_name',
    'action',
    'source',
    'ok',
    'duration_ms',
    'error_code',
  ],
  formBuilder: [],

  listHeader: () => ([
    { row: 5, col: 2, content: 'Append-only MCP tool-call audit. Most recent 500, newest first.' },
  ]),
};
