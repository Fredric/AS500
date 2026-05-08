// Auth Tokens — read-only admin inspector for the auth_tokens table.
// Shows both classic AS500 session tokens and MCP OAuth tokens.

import type { CRUDTableConfig } from '../crudtable/types.js';
import { PERMISSIONS } from '../services/access.js';
import * as authTokensAdminService from '../services/authTokensAdminService.js';

function formatTimestamp(value: unknown): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value as string);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const authTokensConfig: CRUDTableConfig = {
  id: 'auth_tokens',
  title: 'Auth Tokens',
  requireAuth: true,
  requirePermission: PERMISSIONS.SYS_ADMIN,

  services: {
    list: {
      service: authTokensAdminService as unknown as Record<string, Function>,
      method: 'listAuthTokens',
    },
  },

  fieldConfigs: {
    kind: {
      field: 'kind',
      label: 'Kind',
      length: 14,
      column: { width: 14 },
    },
    username: {
      field: 'username',
      label: 'User',
      length: 20,
      column: {
        width: 16,
        cellRenderer: (r) => String(r.username ?? `#${r.user_id}`),
      },
    },
    device_name: {
      field: 'device_name',
      label: 'Device / Client',
      length: 30,
      column: {
        width: 22,
        cellRenderer: (r) => String(r.device_name ?? r.client_id ?? ''),
      },
    },
    ip_address: {
      field: 'ip_address',
      label: 'IP',
      length: 20,
      column: {
        width: 15,
        cellRenderer: (r) => String(r.ip_address ?? ''),
      },
    },
    created_at: {
      field: 'created_at',
      label: 'Created',
      length: 16,
      column: {
        width: 16,
        cellRenderer: (r) => formatTimestamp(r.created_at),
      },
    },
    last_used_at: {
      field: 'last_used_at',
      label: 'Last Used',
      length: 16,
      column: {
        width: 16,
        cellRenderer: (r) => formatTimestamp(r.last_used_at),
      },
    },
    expires_at: {
      field: 'expires_at',
      label: 'Expires',
      length: 16,
      column: {
        width: 16,
        cellRenderer: (r) => formatTimestamp(r.expires_at),
      },
    },
    status: {
      field: 'status',
      label: 'Status',
      length: 8,
      column: {
        width: 8,
        cellRenderer: (r) => String(r.status ?? '').toUpperCase(),
      },
    },
  },

  columnBuilder: [
    'kind',
    'username',
    'status',
    'last_used_at',
    'device_name',
    'ip_address',
    'created_at',
    
    'expires_at',
    
  ],
  formBuilder: [],

  listHeader: () => ([
    { row: 5, col: 2, content: 'AS500 session + MCP OAuth tokens. Most recent 500, newest first.' },
  ]),
};
