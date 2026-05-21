// First-party login endpoints for direct REST API access.
//
// This is NOT OAuth — it's a simple credential exchange designed for
// first-party applications where the developer owns both the client app
// and the AS500 backend. The caller supplies username + password; the
// server returns the same access + refresh token pair the OAuth flow
// would produce. Those tokens are then passed as `Authorization: Bearer`
// on every REST API call, exactly as MCP clients do.
//
// Endpoints mounted at /api/auth (by mcp/index.ts, BEFORE /api so this
// prefix wins):
//
//   POST /api/auth/token   — exchange credentials → access + refresh token
//   POST /api/auth/refresh — rotate an expired access token via refresh token
//   POST /api/auth/revoke  — logout: revoke one or both tokens
//
// Auth posture:
//   - Tokens are the same HS256 JWTs the MCP OAuth flow mints; the same
//     `bearerAuth` middleware validates them on every /api/* call.
//   - client_id is the sentinel 'as500-direct' (no row in oauth_clients).
//   - Rate limited: 10 attempts/min per IP for /token.
//   - Audit: login and revoke are NOT written to mcp_audit_log (no tool
//     context). REST API calls made with the issued tokens ARE audited normally.

import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { mcpLogin } from '../mcp/oauth/login.js';
import {
  issueAccessToken,
  ACCESS_TOKEN_EXPIRY_SECONDS,
  revokeAccessTokenByJti,
  verifyAccessToken,
} from '../mcp/oauth/tokens.js';
import {
  createRefreshToken,
  findLiveRefresh,
  revokeRefreshToken,
} from '../mcp/oauth/store.js';
import { directLoginRateLimiter } from '../utils/rateLimiter.js';
import { writeAuditEvent } from '../audit/writer.js';

// Sentinel client_id for first-party direct-login tokens.
// Distinguishable from OAuth-issued tokens in the auth_tokens table.
export const DIRECT_CLIENT_ID = 'as500-direct';

// ============================================
// Helpers
// ============================================

function ipKey(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

async function usernameForId(userId: number): Promise<string> {
  const rows = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.username ?? `user-${userId}`;
}

// ============================================
// Router
// ============================================

export function buildAuthRouter(): Router {
  const router = Router();

  // -------- POST /api/auth/token --------
  // Body: { username: string, password: string }
  // Response: { access_token, token_type, expires_in, refresh_token }
  router.post('/token', async (req: Request, res: Response) => {
    if (!directLoginRateLimiter.check(`login:${ipKey(req)}`)) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({
        error: { code: 'rate_limited', message: 'Too many login attempts. Try again in a minute.' },
      });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawUsername = typeof body.username === 'string' ? body.username : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!rawUsername || !password) {
      res.status(400).json({
        error: { code: 'invalid_request', message: 'username and password are required.' },
      });
      return;
    }

    const loginStart = Date.now();
    const result = await mcpLogin(rawUsername, password);
    if (!result.ok) {
      const message =
        result.reason === 'rate_limited'
          ? 'Too many login attempts. Try again in a minute.'
          : result.reason === 'inactive'
            ? 'Account is inactive.'
            : 'Invalid username or password.';
      void writeAuditEvent({
        event_type: 'auth',
        action: 'login_failed',
        source: 'api',
        username: rawUsername.toUpperCase().trim() || null,
        ok: false,
        error_code: result.reason ?? 'invalid_credentials',
        duration_ms: Date.now() - loginStart,
        ip_address: ipKey(req) !== 'unknown' ? ipKey(req) : null,
        user_agent: req.headers['user-agent'] ?? null,
      });
      res.status(401).json({ error: { code: 'invalid_credentials', message } });
      return;
    }

    const { user } = result;
    try {
      const refreshToken = await createRefreshToken({
        userId: user.id,
        clientId: DIRECT_CLIENT_ID,
        scope: '',
      });

      const issued = await issueAccessToken({
        userId: user.id,
        username: user.username,
        clientId: DIRECT_CLIENT_ID,
        scopes: [],
        parentRefreshToken: refreshToken,
      });

      void writeAuditEvent({
        event_type: 'auth',
        action: 'login',
        source: 'api',
        user_id: user.id,
        username: user.username,
        client_id: DIRECT_CLIENT_ID,
        ok: true,
        duration_ms: Date.now() - loginStart,
        ip_address: ipKey(req) !== 'unknown' ? ipKey(req) : null,
        user_agent: req.headers['user-agent'] ?? null,
      });

      res.json({
        access_token: issued.accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_EXPIRY_SECONDS,
        refresh_token: refreshToken,
      });
    } catch (err) {
      console.error('[api/auth] token issuance failed:', err);
      res.status(500).json({ error: { code: 'server_error', message: 'Failed to issue tokens.' } });
    }
  });

  // -------- POST /api/auth/refresh --------
  // Body: { refresh_token: string }
  // Response: { access_token, token_type, expires_in, refresh_token }
  router.post('/refresh', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const tokenValue = typeof body.refresh_token === 'string' ? body.refresh_token : '';

    if (!tokenValue) {
      res.status(400).json({
        error: { code: 'invalid_request', message: 'refresh_token is required.' },
      });
      return;
    }

    const refreshStart = Date.now();
    const live = await findLiveRefresh(tokenValue, DIRECT_CLIENT_ID);
    if (!live) {
      void writeAuditEvent({
        event_type: 'auth',
        action: 'token_refresh',
        source: 'api',
        ok: false,
        error_code: 'invalid_token',
        duration_ms: Date.now() - refreshStart,
        ip_address: ipKey(req) !== 'unknown' ? ipKey(req) : null,
      });
      res.status(401).json({
        error: { code: 'invalid_token', message: 'Refresh token is invalid, expired, or already used.' },
      });
      return;
    }

    try {
      // Rotate: revoke old pair, issue new pair.
      await revokeRefreshToken(tokenValue);

      const newRefresh = await createRefreshToken({
        userId: live.userId,
        clientId: DIRECT_CLIENT_ID,
        scope: live.scope ?? '',
      });

      const username = await usernameForId(live.userId);

      const issued = await issueAccessToken({
        userId: live.userId,
        username,
        clientId: DIRECT_CLIENT_ID,
        scopes: live.scope ? live.scope.split(' ').filter(Boolean) : [],
        parentRefreshToken: newRefresh,
      });

      void writeAuditEvent({
        event_type: 'auth',
        action: 'token_refresh',
        source: 'api',
        user_id: live.userId,
        username,
        client_id: DIRECT_CLIENT_ID,
        ok: true,
        duration_ms: Date.now() - refreshStart,
        ip_address: ipKey(req) !== 'unknown' ? ipKey(req) : null,
      });

      res.json({
        access_token: issued.accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_EXPIRY_SECONDS,
        refresh_token: newRefresh,
      });
    } catch (err) {
      console.error('[api/auth] refresh failed:', err);
      res.status(500).json({ error: { code: 'server_error', message: 'Failed to rotate tokens.' } });
    }
  });

  // -------- POST /api/auth/revoke --------
  // Body: { token: string, token_type_hint?: 'access_token' | 'refresh_token' }
  // Response: { ok: true }  (always 200, per convention — never reveal whether token existed)
  router.post('/revoke', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const token = typeof body.token === 'string' ? body.token : '';
    const hint = typeof body.token_type_hint === 'string' ? body.token_type_hint : '';

    if (!token) {
      res.status(400).json({ error: { code: 'invalid_request', message: 'token is required.' } });
      return;
    }

    let revokedUserId: number | undefined;
    try {
      if (hint === 'refresh_token' || !hint) {
        const liveRefresh = await findLiveRefresh(token, DIRECT_CLIENT_ID);
        if (liveRefresh) revokedUserId = liveRefresh.userId;
        await revokeRefreshToken(token);
      }
      if (hint === 'access_token' || !hint) {
        const claims = await verifyAccessToken(token);
        if (claims?.jti) {
          if (claims.sub && !revokedUserId) revokedUserId = Number(claims.sub);
          await revokeAccessTokenByJti(claims.jti);
        }
      }
    } catch {
      // Silently swallow — revocation always returns 200.
    }

    void writeAuditEvent({
      event_type: 'auth',
      action: 'logout',
      source: 'api',
      user_id: revokedUserId ?? null,
      client_id: DIRECT_CLIENT_ID,
      ok: true,
      ip_address: ipKey(req) !== 'unknown' ? ipKey(req) : null,
    });

    res.json({ ok: true });
  });

  return router;
}
