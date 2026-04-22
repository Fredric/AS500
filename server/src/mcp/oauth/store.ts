// Thin DB layer for the MCP OAuth server.
//
// Keeps SQL/Drizzle calls out of `provider.ts` so the provider reads like a
// state machine. Every function here maps 1:1 to an OAuth flow step:
//
//   Client registration  → createClient / getClient
//   User consent         → recordConsent / hasLiveConsent / revokeConsent
//   Authorize            → createAuthCode / consumeAuthCode
//   Token exchange       → createRefreshToken / rotateRefreshToken
//   Token revocation     → revokeRefreshToken / revokeAllForClient
//
// **NB** on column reuse: `auth_tokens` is a single table discriminated by
// `kind`. That decision is documented on the schema. The helpers below pick
// the `kind` they need; callers should never pass `kind` themselves.

import { randomBytes, createHash } from 'node:crypto';
import { and, eq, isNull, gt } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  authTokens,
  oauthClients,
  oauthConsents,
} from '../../db/schema.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  AUTH_CODE_EXPIRY_SECONDS,
  REFRESH_TOKEN_EXPIRY_SECONDS,
  generateAuthCode,
  generateClientId,
  generateClientSecret,
  generateRefreshToken,
} from './tokens.js';
import bcrypt from 'bcrypt';

// ============================================
// Row-shape ↔ SDK-shape converters
// ============================================

interface StoredClientRow {
  id: string;
  client_secret_hash: string | null;
  client_name: string;
  redirect_uris: string; // JSON-encoded string[]
  token_endpoint_auth_method: string;
  registered_at: Date;
  metadata: string | null;
}

/**
 * Rehydrate a DB row into the SDK's `OAuthClientInformationFull` shape.
 *
 * We keep `client_secret` out of this projection: the SDK calls
 * `getClient(id)` during authorization-code flows where the *plain* secret
 * isn't needed. Token-endpoint auth uses `verifyClientSecret` below instead.
 */
function rowToClient(row: StoredClientRow): OAuthClientInformationFull {
  const redirectUris: string[] = JSON.parse(row.redirect_uris);
  const metadata = row.metadata ? JSON.parse(row.metadata) : {};
  return {
    client_id: row.id,
    client_name: row.client_name,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: row.token_endpoint_auth_method,
    client_id_issued_at: Math.floor(row.registered_at.getTime() / 1000),
    // `client_secret` is deliberately omitted — we only store the hash.
    // SDK middleware treats presence of this field as "use it for comparison";
    // callers doing client auth must go through `verifyClientSecret()`.
    ...metadata,
  };
}

// ============================================
// Clients (RFC 7591 Dynamic Client Registration)
// ============================================

export interface CreateClientInput {
  /** If omitted, a fresh id is generated. The SDK's DCR handler supplies one. */
  id?: string;
  /**
   * If omitted and `token_endpoint_auth_method !== 'none'`, a fresh secret is
   * generated. The SDK's DCR handler supplies a plaintext secret we hash.
   */
  clientSecret?: string;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
  /** Verbatim registration payload. Stored for audit. */
  rawMetadata: Record<string, unknown>;
}

export interface CreatedClient extends OAuthClientInformationFull {
  /** Plaintext secret — returned exactly once, at registration time. */
  client_secret?: string;
}

/**
 * Issue a new OAuth client. For non-public clients we generate a 48-byte
 * secret, bcrypt-hash it, and return the plaintext **only** in the response
 * (plaintext is never persisted).
 */
export async function createClient(input: CreateClientInput): Promise<CreatedClient> {
  const id = input.id ?? generateClientId();
  const isPublic = input.token_endpoint_auth_method === 'none';
  const secret = isPublic ? undefined : (input.clientSecret ?? generateClientSecret());
  const secretHash = secret ? await bcrypt.hash(secret, 10) : null;

  const row = {
    id,
    client_secret_hash: secretHash,
    client_name: input.client_name,
    redirect_uris: JSON.stringify(input.redirect_uris),
    token_endpoint_auth_method: input.token_endpoint_auth_method,
    metadata: JSON.stringify(input.rawMetadata),
  };
  await db.insert(oauthClients).values(row);

  const hydrated = rowToClient({
    ...row,
    registered_at: new Date(),
  });
  return { ...hydrated, client_secret: secret };
}

export async function getClient(
  clientId: string
): Promise<OAuthClientInformationFull | undefined> {
  const rows = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.id, clientId))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return rowToClient(row);
}

/**
 * Verify a plaintext client secret against the stored bcrypt hash.
 * Returns `false` for unknown clients or public clients (no secret on file).
 */
export async function verifyClientSecret(
  clientId: string,
  secret: string
): Promise<boolean> {
  const rows = await db
    .select({ hash: oauthClients.client_secret_hash })
    .from(oauthClients)
    .where(eq(oauthClients.id, clientId))
    .limit(1);
  const row = rows[0];
  if (!row?.hash) return false;
  return bcrypt.compare(secret, row.hash);
}

// ============================================
// Consents (user ↔ client remember-me)
// ============================================

/** Insert a live consent row for (user, client, scope). */
export async function recordConsent(
  userId: number,
  clientId: string,
  scope: string
): Promise<void> {
  await db.insert(oauthConsents).values({
    user_id: userId,
    client_id: clientId,
    scope,
  });
}

/**
 * True if the user has **any** live consent for this client/scope combo.
 * Scope comparison is string-equal on the ordered space-joined value — a
 * deliberately conservative match. If the client asks for a narrower scope
 * later, we'll treat that as a new consent, which is the safer default.
 */
export async function hasLiveConsent(
  userId: number,
  clientId: string,
  scope: string
): Promise<boolean> {
  const rows = await db
    .select({ id: oauthConsents.id })
    .from(oauthConsents)
    .where(
      and(
        eq(oauthConsents.user_id, userId),
        eq(oauthConsents.client_id, clientId),
        eq(oauthConsents.scope, scope),
        isNull(oauthConsents.revoked_at)
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function revokeConsent(
  userId: number,
  clientId: string
): Promise<void> {
  await db
    .update(oauthConsents)
    .set({ revoked_at: new Date() })
    .where(
      and(
        eq(oauthConsents.user_id, userId),
        eq(oauthConsents.client_id, clientId),
        isNull(oauthConsents.revoked_at)
      )
    );
}

// ============================================
// Authorization codes (opaque, single-use)
// ============================================

export interface AuthCodeRecord {
  code: string;
  userId: number;
  clientId: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  redirectUri: string;
  expiresAt: Date;
}

export interface CreateAuthCodeInput {
  userId: number;
  clientId: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string; // 'S256' enforced upstream
  redirectUri: string;
}

export async function createAuthCode(input: CreateAuthCodeInput): Promise<string> {
  const code = generateAuthCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + AUTH_CODE_EXPIRY_SECONDS * 1000);

  await db.insert(authTokens).values({
    user_id: input.userId,
    kind: 'mcp_authcode',
    // `token` is NOT NULL — we keep the code here too for the unique
    // constraint and fast lookup without a separate index.
    token: code,
    expires_at: expiresAt,
    client_id: input.clientId,
    code_challenge: input.codeChallenge,
    code_challenge_method: input.codeChallengeMethod,
    redirect_uri: input.redirectUri,
    // Park the (possibly-empty) space-joined scope in `device_name`. That
    // column is otherwise unused for MCP tokens, and parking scope here
    // avoids colliding with the partial unique `(kind, jti) WHERE jti NOT
    // NULL` index when two concurrent refreshes share an empty scope.
    device_name: input.scope || null,
  });

  return code;
}

/**
 * Look up an authorization code and delete it in one atomic step. Throws if
 * the code is missing, expired, already-used, or belongs to a different
 * client.
 */
export async function consumeAuthCode(
  code: string,
  clientId: string
): Promise<AuthCodeRecord> {
  // `returning()` + delete = single round-trip, single-use enforcement.
  const [row] = await db
    .delete(authTokens)
    .where(
      and(
        eq(authTokens.kind, 'mcp_authcode'),
        eq(authTokens.token, code),
        eq(authTokens.client_id, clientId),
        gt(authTokens.expires_at, new Date())
      )
    )
    .returning();

  if (!row) {
    throw new Error('Authorization code is invalid, expired, or already used.');
  }

  return {
    code,
    userId: row.user_id,
    clientId: row.client_id!,
    scope: row.device_name ?? '',
    codeChallenge: row.code_challenge!,
    codeChallengeMethod: row.code_challenge_method!,
    redirectUri: row.redirect_uri!,
    expiresAt: row.expires_at,
  };
}

// ============================================
// Refresh tokens
// ============================================

export interface RefreshTokenRecord {
  refreshToken: string;
  userId: number;
  clientId: string;
  scope: string;
  expiresAt: Date;
}

export interface CreateRefreshTokenInput {
  userId: number;
  clientId: string;
  scope: string;
}

export async function createRefreshToken(
  input: CreateRefreshTokenInput
): Promise<string> {
  const refresh = generateRefreshToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_EXPIRY_SECONDS * 1000);

  await db.insert(authTokens).values({
    user_id: input.userId,
    kind: 'mcp_refresh',
    token: refresh,
    refresh_token: refresh,
    refresh_expires_at: expiresAt,
    expires_at: expiresAt,
    client_id: input.clientId,
    // scope parking — see createAuthCode.
    device_name: input.scope || null,
  });

  return refresh;
}

/**
 * Find a live (kind='mcp_refresh', not revoked, not expired) refresh row and
 * return its data for rotation. Does NOT mutate the row — callers must
 * explicitly `revokeRefreshToken` the old one after issuing a replacement so
 * the rotation is visible in the audit trail as two rows.
 */
export async function findLiveRefresh(
  refreshToken: string,
  clientId: string
): Promise<RefreshTokenRecord | null> {
  const rows = await db
    .select()
    .from(authTokens)
    .where(
      and(
        eq(authTokens.kind, 'mcp_refresh'),
        eq(authTokens.refresh_token, refreshToken),
        eq(authTokens.client_id, clientId),
        isNull(authTokens.revoked_at),
        gt(authTokens.refresh_expires_at, new Date())
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    refreshToken,
    userId: row.user_id,
    clientId: row.client_id!,
    scope: row.device_name ?? '',
    expiresAt: row.refresh_expires_at!,
  };
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  await db
    .update(authTokens)
    .set({ revoked_at: new Date() })
    .where(
      and(
        eq(authTokens.kind, 'mcp_refresh'),
        eq(authTokens.refresh_token, refreshToken),
        isNull(authTokens.revoked_at)
      )
    );
  // Also cascade-revoke the paired access-token row (if any). Access rows
  // reference their parent refresh via `device_id` — see `issueAccessToken`.
  await db
    .update(authTokens)
    .set({ revoked_at: new Date() })
    .where(
      and(
        eq(authTokens.kind, 'mcp_access'),
        eq(authTokens.device_id, refreshToken),
        isNull(authTokens.revoked_at)
      )
    );
}

// ============================================
// Utility — params hash for audit
// ============================================

/** sha256 hex of a stable JSON encoding, used as the audit `params_hash`. */
export function hashParams(params: unknown): string {
  const h = createHash('sha256');
  h.update(JSON.stringify(params ?? null));
  return h.digest('hex');
}

/** Cryptographically random state token helper for internal use. */
export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}
