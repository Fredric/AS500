// OAuth Clients — read-only admin inspector for oauth_clients (dynamically
// registered MCP client apps). Each row also shows how many live MCP access
// tokens belong to that client and when it was last seen.

import type { CRUDTableConfig } from '../crudtable/types.js';
import { PERMISSIONS } from '../services/access.js';
import * as oauthClientsAdminService from '../services/oauthClientsAdminService.js';

function formatTimestamp(value: unknown): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value as string);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const oauthClientsConfig: CRUDTableConfig = {
  id: 'oauth_clients',
  title: 'OAuth Clients',
  requireAuth: true,
  requirePermission: PERMISSIONS.SYS_ADMIN,

  services: {
    list: {
      service: oauthClientsAdminService as unknown as Record<string, Function>,
      method: 'listOauthClients',
    },
  },

  fieldConfigs: {
    client_name: {
      field: 'client_name',
      label: 'Client Name',
      length: 30,
      column: { width: 22 },
    },
    id: {
      field: 'id',
      label: 'Client ID',
      length: 32,
      column: { width: 18 },
    },
    token_endpoint_auth_method: {
      field: 'token_endpoint_auth_method',
      label: 'Auth',
      length: 16,
      column: {
        width: 14,
        cellRenderer: (_ctx, r) =>
          r.is_public
            ? 'public'
            : String(r.token_endpoint_auth_method ?? ''),
      },
    },
    redirect_uri_count: {
      field: 'redirect_uri_count',
      label: 'Redirects',
      length: 4,
      column: {
        width: 5,
        align: 'right',
        cellRenderer: (_ctx, r) => String(r.redirect_uri_count ?? 0),
      },
    },
    registered_at: {
      field: 'registered_at',
      label: 'Registered',
      length: 16,
      column: {
        width: 16,
        cellRenderer: (_ctx, r) => formatTimestamp(r.registered_at),
      },
    },
    active_token_count: {
      field: 'active_token_count',
      label: 'Active Toks',
      length: 4,
      column: {
        width: 6,
        align: 'right',
        cellRenderer: (_ctx, r) => String(r.active_token_count ?? 0),
      },
    },
    last_used_at: {
      field: 'last_used_at',
      label: 'Last Used',
      length: 16,
      column: {
        width: 16,
        cellRenderer: (_ctx, r) => formatTimestamp(r.last_used_at),
      },
    },
  },

  columnBuilder: [
    'client_name',
    'token_endpoint_auth_method',
   
    'registered_at',
    'id',
    'active_token_count',
    'last_used_at',
    'redirect_uri_count',
  ],
  formBuilder: [],

  listHeader: () => ([
    { row: 5, col: 2, content: 'MCP OAuth clients registered via RFC 7591 dynamic client registration.' },
  ]),
};
