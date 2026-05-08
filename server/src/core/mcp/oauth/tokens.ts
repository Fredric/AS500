// JWT + refresh-token helpers for the MCP OAuth 2.1 server.
//
// Two token types flow through here:
//
//   - **Access token** — HS256 JWT, short-lived (default 1 h), carries the
//     resolved user id, client id, granted scopes, and a random `jti`. Every
//     `/mcp` call verifies the signature *and* checks the `auth_tokens` table
//     for a matching `(kind='mcp_access', jti)` row with `revoked_at IS NULL`.
//     This lets us revoke a single token without rotating the JWT secret.
//
//   - **Refresh token** — opaque 256-bit base64url string, long-lived
//     (default 30 d), stored as-is in `auth_tokens.refresh_token`. Rotated on
//     every refresh grant (old row gets `revoked_at = now()` and the MCP
//     access row with the same `parent_refresh_jti` is revoked too).
//
// Authorization codes are **also** persisted in `auth_tokens` (kind =
// `'mcp_authcode'`) but they're opaque single-use strings, not JWTs.
//
// The JWT secret (`AS500_MCP_JWT_SECRET`) MUST be set at boot in production.
// In development we auto-generate a random secret and log a clear warning so
// devs know sessions won't survive a server restart.

import { randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { authTokens } from '../../db/schema.js';

// ============================================
// Configuration
// ============================================

export const ACCESS_TOKEN_EXPIRY_SECONDS = 60 * 60; // 1h
export const REFRESH_TOKEN_EXPIRY_SECONDS = 60 * 60 * 24 * 30; // 30d
export const AUTH_CODE_EXPIRY_SECONDS = 60; // 60s (per MCP spec recommendation)
export const JWT_ALG = 'HS256' as const;
export const JWT_ISSUER = 'as500-mcp';

/** Resolved at boot via `initJwtSecret`. */
let jwtSecret: Uint8Array | null = null;

/**
 * Must be called once at startup. Reads `AS500_MCP_JWT_SECRET`; if unset,
 * generates a random 32-byte secret and logs a warning (dev only).
 */
export function initJwtSecret(): void {
  const envSecret = process.env.AS500_MCP_JWT_SECRET;
  if (envSecret && envSecret.length >= 32) {
    jwtSecret = new TextEncoder().encode(envSecret);
    return;
  }
  if (envSecret && envSecret.length < 32) {
    throw new Error(
      'AS500_MCP_JWT_SECRET is set but too short. Provide at least 32 chars (256 bits).'
    );
  }
  // Dev fallback: random secret, warn loudly.
  const random = randomBytes(48).toString('base64url');
  jwtSecret = new TextEncoder().encode(random);
  // eslint-disable-next-line no-console
  console.warn(
    '[MCP] AS500_MCP_JWT_SECRET is not set. Generated a random secret for this ' +
      'process — tokens will NOT survive a restart. Set AS500_MCP_JWT_SECRET ' +
      '(>=32 chars) in production.'
  );
}

function getSecret(): Uint8Array {
  if (!jwtSecret) {
    throw new Error(
      'MCP JWT secret not initialised. Call initJwtSecret() before signing or verifying.'
    );
  }
  return jwtSecret;
}

// ============================================
// Types
// ============================================

export interface McpAccessTokenClaims extends JWTPayload {
  /** Subject: numeric AS500 user id, as string (per JWT conventions). */
  sub: string;
  /** OAuth client id. */
  client_id: string;
  /** Space-separated granted scopes. */
  scope: string;
  /** JWT id; also stored as `auth_tokens.jti` for revocation. */
  jti: string;
  /** Username snapshot for ergonomic access in handlers (not authoritative). */
  username: string;
}

export interface IssueAccessTokenArgs {
  userId: number;
  username: string;
  clientId: string;
  scopes: string[];
  /** Optional: link this access token to the refresh token that produced it. */
  parentRefreshToken?: string;
}

export interface IssuedAccessToken {
  accessToken: string;
  jti: string;
  expiresAt: Date;
}

// ============================================
// Access token (JWT) — sign, verify, persist, revoke
// ============================================

/**
 * Mint a new MCP access JWT and persist its jti in `auth_tokens` so we can
 * later verify it's still live (i.e. not revoked). Returns the raw JWT.
 */
export async function issueAccessToken(args: IssueAccessTokenArgs): Promise<IssuedAccessToken> {
  const jti = randomBytes(16).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ACCESS_TOKEN_EXPIRY_SECONDS;
  const expiresAt = new Date(exp * 1000);

  const claims: McpAccessTokenClaims = {
    sub: String(args.userId),
    client_id: args.clientId,
    scope: args.scopes.join(' '),
    jti,
    username: args.username,
  };

  const jwt = await new SignJWT(claims)
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuer(JWT_ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setJti(jti)
    .setSubject(String(args.userId))
    .sign(getSecret());

  // Persist for revocation. Unique-jti check is enforced by the partial
  // unique index `idx_auth_tokens_kind_jti` on `(kind, jti) WHERE jti NOT NULL`.
  await db.insert(authTokens).values({
    user_id: args.userId,
    kind: 'mcp_access',
    token: jwt, // non-null constraint; the JWT itself is fine here
    access_token: jwt,
    access_expires_at: expiresAt,
    expires_at: expiresAt,
    jti,
    client_id: args.clientId,
    // Park the parent refresh token in `device_id` (not `refresh_token`):
    // `refresh_token` has a global UNIQUE and the paired refresh row
    // already owns that value. `device_id` is plain text, indexed by
    // `(user_id, device_id)`, and otherwise unused for MCP.
    device_id: args.parentRefreshToken ?? null,
  });

  return { accessToken: jwt, jti, expiresAt };
}

/**
 * Verify a bearer access token:
 *   1. jose.jwtVerify (signature, exp, iss, alg).
 *   2. DB lookup by (kind='mcp_access', jti) with revoked_at IS NULL.
 *
 * Returns the decoded claims on success, or `null` on any failure — callers
 * should translate `null` into a 401 with `WWW-Authenticate`. We intentionally
 * don't throw, because verification is called on every tool request and the
 * stack trace adds no diagnostic value.
 */
export async function verifyAccessToken(token: string): Promise<McpAccessTokenClaims | null> {
  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, getSecret(), {
      algorithms: [JWT_ALG],
      issuer: JWT_ISSUER,
    });
    payload = result.payload;
  } catch {
    return null;
  }

  const claims = payload as McpAccessTokenClaims;
  if (!claims.jti || !claims.client_id || !claims.sub) return null;

  // Revocation check via partial unique index → at most one row.
  const rows = await db
    .select({ id: authTokens.id })
    .from(authTokens)
    .where(
      and(
        eq(authTokens.kind, 'mcp_access'),
        eq(authTokens.jti, claims.jti),
        isNull(authTokens.revoked_at)
      )
    )
    .limit(1);

  if (rows.length === 0) return null;

  return claims;
}

/** Mark an access token as revoked (idempotent). Matches by `jti`. */
export async function revokeAccessTokenByJti(jti: string): Promise<void> {
  await db
    .update(authTokens)
    .set({ revoked_at: new Date() })
    .where(
      and(eq(authTokens.kind, 'mcp_access'), eq(authTokens.jti, jti), isNull(authTokens.revoked_at))
    );
}

// ============================================
// Refresh tokens (opaque)
// ============================================

/** Generate a fresh opaque refresh-token string (base64url, 256 bits). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

// ============================================
// Authorization codes (opaque, single-use)
// ============================================

/** Generate a fresh opaque authorization-code string (base64url, 256 bits). */
export function generateAuthCode(): string {
  return randomBytes(32).toString('base64url');
}

// ============================================
// Client secrets
// ============================================

/** Generate a fresh opaque client secret (base64url, 384 bits). */
export function generateClientSecret(): string {
  return randomBytes(48).toString('base64url');
}

/** Generate a fresh opaque client id (base64url, 96 bits). Short + URL-safe. */
export function generateClientId(): string {
  return randomBytes(12).toString('base64url');
}
