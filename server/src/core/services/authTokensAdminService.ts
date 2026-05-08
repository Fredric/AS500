// Read-only admin service for inspecting auth_tokens.
// Joins users so the admin screen can show who owns each token.

import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { authTokens, users } from '../db/schema.js';

export interface AuthTokenRow {
  id: number;
  user_id: number;
  username: string | null;
  kind: string;
  client_id: string | null;
  device_name: string | null;
  ip_address: string | null;
  created_at: Date;
  last_used_at: Date | null;
  expires_at: Date;
  access_expires_at: Date | null;
  revoked_at: Date | null;
  status: 'active' | 'expired' | 'revoked';
}

const MAX_ROWS = 500;

export async function listAuthTokens(_params?: Record<string, unknown>): Promise<AuthTokenRow[]> {
  const rows = await db
    .select({
      id: authTokens.id,
      user_id: authTokens.user_id,
      username: users.username,
      kind: authTokens.kind,
      client_id: authTokens.client_id,
      device_name: authTokens.device_name,
      ip_address: authTokens.ip_address,
      created_at: authTokens.created_at,
      last_used_at: authTokens.last_used_at,
      expires_at: authTokens.expires_at,
      access_expires_at: authTokens.access_expires_at,
      revoked_at: authTokens.revoked_at,
    })
    .from(authTokens)
    .leftJoin(users, eq(users.id, authTokens.user_id))
    .orderBy(desc(authTokens.created_at))
    .limit(MAX_ROWS);

  const now = Date.now();
  return rows.map((r) => {
    let status: AuthTokenRow['status'] = 'active';
    if (r.revoked_at) status = 'revoked';
    else if (r.expires_at && r.expires_at.getTime() < now) status = 'expired';
    return { ...r, status };
  });
}
