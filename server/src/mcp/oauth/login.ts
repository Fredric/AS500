// Dedicated bcrypt login for the MCP OAuth authorize flow.
//
// The spec is explicit: do NOT reuse the AS500 session login path. MCP
// authorizations happen in a browser, against a *different* security boundary
// (the VPS-level MCP tool surface), and mixing them with terminal sessions
// would widen the blast radius of either bug.
//
// What this module does:
//   1. Rate-limit login attempts per-username (in-memory sliding window).
//   2. Normalize and look up the user.
//   3. bcrypt-compare the password.
//   4. Return a sanitized "LoginUser" or a typed error.
//
// What it does NOT do:
//   - Issue any tokens. That happens in the token-exchange step once the
//     user has consented to the client.
//   - Touch `auth_tokens`. MCP tokens are issued by `oauth/provider.ts`.

import bcrypt from 'bcrypt';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';

export interface LoginUser {
  id: number;
  username: string;
  fullName: string | null;
  isAdmin: boolean;
  role: 'user' | 'superuser' | 'aiagent' | 'admin';
}

export type LoginResult =
  | { ok: true; user: LoginUser }
  | { ok: false; reason: 'invalid_credentials' | 'rate_limited' | 'inactive' };

// ============================================
// Rate limiter — per username, sliding window
// ============================================
//
// Not backed by Redis on purpose: this is one MCP server per VPS, the
// population of usernames is small, and a process restart is an acceptable
// way to clear the list.

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_ATTEMPTS = 10; // per username per window
const rateLimit = new Map<string, number[]>();

function isRateLimited(username: string): boolean {
  const now = Date.now();
  const list = (rateLimit.get(username) ?? []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  rateLimit.set(username, list);
  return list.length > MAX_ATTEMPTS;
}

// ============================================
// Login
// ============================================

/**
 * Validate username + password. Returns a typed result so callers can render
 * the appropriate message — we never leak whether the failure was "user not
 * found" vs. "wrong password" to the consent page.
 */
export async function mcpLogin(
  rawUsername: string,
  password: string
): Promise<LoginResult> {
  const username = rawUsername.trim().toUpperCase();
  if (!username || !password) {
    return { ok: false, reason: 'invalid_credentials' };
  }

  if (isRateLimited(username)) {
    return { ok: false, reason: 'rate_limited' };
  }

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      password_hash: users.password_hash,
      full_name: users.full_name,
      active: users.active,
      is_admin: users.is_admin,
      role: users.role,
    })
    .from(users)
    .where(and(eq(users.username, username)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    // Still run a fake bcrypt.compare to avoid user-enumeration via timing.
    await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid');
    return { ok: false, reason: 'invalid_credentials' };
  }

  if (!row.active) {
    return { ok: false, reason: 'inactive' };
  }

  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return { ok: false, reason: 'invalid_credentials' };

  return {
    ok: true,
    user: {
      id: row.id,
      username: row.username,
      fullName: row.full_name,
      isAdmin: row.is_admin,
      role: row.role,
    },
  };
}
