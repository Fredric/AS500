// Read-only admin service for inspecting oauth_clients (dynamically registered
// MCP clients). Also exposes how many auth_tokens each client currently has
// and when it was last seen — so admins can spot stale/unused registrations.

import { desc, eq, isNull, and, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { oauthClients, authTokens } from '../db/schema.js';

export interface OauthClientRow {
  id: string;
  client_name: string;
  token_endpoint_auth_method: string;
  is_public: boolean;
  redirect_uri_count: number;
  registered_at: Date;
  active_token_count: number;
  last_used_at: Date | null;
}

export async function listOauthClients(_params?: Record<string, unknown>): Promise<OauthClientRow[]> {
  const clients = await db
    .select()
    .from(oauthClients)
    .orderBy(desc(oauthClients.registered_at));

  const tokenStats = await db
    .select({
      client_id: authTokens.client_id,
      active_token_count: sql<number>`count(*)::int`,
      last_used_at: sql<Date | null>`max(${authTokens.last_used_at})`,
    })
    .from(authTokens)
    .where(and(isNull(authTokens.revoked_at), eq(authTokens.kind, 'mcp_access')))
    .groupBy(authTokens.client_id);

  const statsByClient = new Map<string, { active_token_count: number; last_used_at: Date | null }>();
  for (const s of tokenStats) {
    if (s.client_id) {
      statsByClient.set(s.client_id, {
        active_token_count: Number(s.active_token_count) || 0,
        last_used_at: s.last_used_at,
      });
    }
  }

  return clients.map((c) => {
    let redirectCount = 0;
    try {
      const parsed = JSON.parse(c.redirect_uris);
      if (Array.isArray(parsed)) redirectCount = parsed.length;
    } catch {
      redirectCount = 0;
    }
    const stats = statsByClient.get(c.id);
    return {
      id: c.id,
      client_name: c.client_name,
      token_endpoint_auth_method: c.token_endpoint_auth_method,
      is_public: c.client_secret_hash === null,
      redirect_uri_count: redirectCount,
      registered_at: c.registered_at,
      active_token_count: stats?.active_token_count ?? 0,
      last_used_at: stats?.last_used_at ?? null,
    };
  });
}
