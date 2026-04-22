// OAuthServerProvider implementation for the AS500 MCP server.
//
// The SDK's `mcpAuthRouter({ provider })` handles all of the HTTP plumbing
// (request parsing, metadata endpoints, PKCE verification, status codes).
// Our job is to implement the five state transitions:
//
//   1. `authorize(client, params, res)`       — render consent page, stash
//                                                the flow params in the URL
//                                                that the consent form
//                                                will POST back to.
//   2. `challengeForAuthorizationCode(client, code)`
//                                              — return the code's PKCE
//                                                challenge so the SDK can
//                                                verify code_verifier.
//   3. `exchangeAuthorizationCode(client, code, ...)`
//                                              — consume the code and mint
//                                                access + refresh tokens.
//   4. `exchangeRefreshToken(client, token, scopes?)`
//                                              — rotate the refresh token
//                                                and mint a new access JWT.
//   5. `verifyAccessToken(token)`              — decode JWT + check DB
//                                                revocation; return AuthInfo.
//
// Note: consent capture does NOT happen inside `authorize(...)`. That
// function only *renders* the consent page. The actual code issuance
// happens in `POST /authorize/consent`, which lives in `mcp/index.ts` and
// calls `issueAuthorizationCodeAfterConsent(...)` below directly.

import type { Response } from 'express';
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  InvalidGrantError,
  ServerError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { authTokens } from '../../db/schema.js';
import { buildClientsStore } from './clientsStore.js';
import {
  ACCESS_TOKEN_EXPIRY_SECONDS,
  issueAccessToken,
  revokeAccessTokenByJti,
  verifyAccessToken as verifyJwt,
} from './tokens.js';
import {
  consumeAuthCode,
  createAuthCode,
  createRefreshToken,
  findLiveRefresh,
  revokeRefreshToken,
} from './store.js';
import { renderConsentPage } from './consent.js';

// Path that the consent form POSTs to — mounted in `mcp/index.ts`.
const CONSENT_POST_PATH = '/authorize/consent';

// ============================================
// AS500 MCP OAuth provider
// ============================================

export interface BuildProviderOptions {
  /**
   * Human-readable list of permission keys the MCP access covers. Shown on
   * the consent page. Purely informational here; the real RBAC check runs
   * at tool-call time in `toolHandlers.ts`.
   */
  advertisedPermissions: string[];
}

export function buildAs500OAuthProvider(
  opts: BuildProviderOptions
): OAuthServerProvider {
  const clientsStore = buildClientsStore();

  return {
    get clientsStore() {
      return clientsStore;
    },

    /**
     * Stage 1 of the authorize flow: render our consent page. Browser is
     * currently on `GET /authorize?...`; we reply with an HTML form that
     * POSTs to `/authorize/consent` with every original parameter preserved
     * as a hidden field plus username/password/decision.
     */
    async authorize(
      client: OAuthClientInformationFull,
      params: AuthorizationParams,
      res: Response
    ): Promise<void> {
      const html = renderConsentPage({
        clientName: client.client_name ?? client.client_id,
        clientId: client.client_id,
        scope: (params.scopes ?? []).join(' '),
        state: params.state,
        redirectUri: params.redirectUri,
        responseType: 'code',
        codeChallenge: params.codeChallenge,
        codeChallengeMethod: 'S256',
        permissions: opts.advertisedPermissions,
        formAction: CONSENT_POST_PATH,
      });

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).send(html);
    },

    /**
     * Stage 2 of the authorize flow (called at token time): the SDK hands
     * us a code and asks for its PKCE challenge so it can verify the
     * `code_verifier` submitted by the client. We look up without deleting
     * — deletion happens in `exchangeAuthorizationCode` below.
     */
    async challengeForAuthorizationCode(
      client: OAuthClientInformationFull,
      authorizationCode: string
    ): Promise<string> {
      const rows = await db
        .select({
          code_challenge: authTokens.code_challenge,
          client_id: authTokens.client_id,
          expires_at: authTokens.expires_at,
        })
        .from(authTokens)
        .where(
          and(
            eq(authTokens.kind, 'mcp_authcode'),
            eq(authTokens.token, authorizationCode)
          )
        )
        .limit(1);

      const row = rows[0];
      if (!row) {
        throw new InvalidGrantError('Authorization code not found.');
      }
      if (row.client_id !== client.client_id) {
        throw new InvalidGrantError('Authorization code was issued to a different client.');
      }
      if (row.expires_at.getTime() < Date.now()) {
        throw new InvalidGrantError('Authorization code has expired.');
      }
      if (!row.code_challenge) {
        throw new ServerError('Authorization code is missing PKCE challenge.');
      }
      return row.code_challenge;
    },

    /**
     * Stage 3 of the authorize flow: consume the code and issue the token
     * pair. SDK has already verified the PKCE code_verifier at this point
     * (by calling challengeForAuthorizationCode above).
     */
    async exchangeAuthorizationCode(
      client: OAuthClientInformationFull,
      authorizationCode: string,
      _codeVerifier?: string,
      redirectUri?: string
      // `resource` intentionally ignored — we don't partition the MCP
      // server into sub-resources yet.
    ): Promise<OAuthTokens> {
      try {
        // Atomic delete + read-back. Throws if already-consumed / expired / wrong client.
        const codeRec = await consumeAuthCode(authorizationCode, client.client_id);

        if (redirectUri && redirectUri !== codeRec.redirectUri) {
          throw new InvalidGrantError(
            'redirect_uri does not match the one used at /authorize.'
          );
        }

        const scopes = codeRec.scope ? codeRec.scope.split(' ').filter(Boolean) : [];

        const refreshToken = await createRefreshToken({
          userId: codeRec.userId,
          clientId: client.client_id,
          scope: codeRec.scope,
        });

        const username = await usernameForUserId(codeRec.userId);

        const issued = await issueAccessToken({
          userId: codeRec.userId,
          username,
          clientId: client.client_id,
          scopes,
          parentRefreshToken: refreshToken,
        });

        return {
          access_token: issued.accessToken,
          token_type: 'Bearer',
          expires_in: ACCESS_TOKEN_EXPIRY_SECONDS,
          refresh_token: refreshToken,
          scope: codeRec.scope || undefined,
        };
      } catch (err) {
        if (err instanceof InvalidGrantError) throw err;
        // eslint-disable-next-line no-console
        console.error('[MCP] exchangeAuthorizationCode failed:', err);
        throw err;
      }
    },

    /**
     * Rotate a refresh token. Old refresh is revoked (along with any access
     * token paired via `parentRefreshToken`), new refresh + new access JWT
     * are issued. Scope narrowing is allowed but scope widening is refused
     * per RFC 6749 §6.
     */
    async exchangeRefreshToken(
      client: OAuthClientInformationFull,
      refreshToken: string,
      requestedScopes?: string[]
    ): Promise<OAuthTokens> {
      const live = await findLiveRefresh(refreshToken, client.client_id);
      if (!live) {
        throw new InvalidGrantError('Refresh token is invalid, revoked, or expired.');
      }

      const currentScopes = live.scope ? live.scope.split(' ').filter(Boolean) : [];
      let newScopes = currentScopes;
      if (requestedScopes && requestedScopes.length > 0) {
        // Narrowing allowed — widening refused.
        for (const s of requestedScopes) {
          if (!currentScopes.includes(s)) {
            throw new InvalidGrantError(
              `Refresh request asked for scope '${s}' that was not granted originally.`
            );
          }
        }
        newScopes = requestedScopes;
      }

      // Rotate: revoke old refresh (which also cascades access revocation
      // for the paired access row), then issue fresh pair.
      await revokeRefreshToken(refreshToken);

      const newRefresh = await createRefreshToken({
        userId: live.userId,
        clientId: client.client_id,
        scope: newScopes.join(' '),
      });

      const username = await usernameForUserId(live.userId);

      const issued = await issueAccessToken({
        userId: live.userId,
        username,
        clientId: client.client_id,
        scopes: newScopes,
        parentRefreshToken: newRefresh,
      });

      return {
        access_token: issued.accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_EXPIRY_SECONDS,
        refresh_token: newRefresh,
        scope: newScopes.join(' ') || undefined,
      };
    },

    /**
     * Verify an access token and translate it into the SDK's `AuthInfo`
     * shape. Called by `requireBearerAuth` on every `/mcp` request.
     */
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const claims = await verifyJwt(token);
      if (!claims) {
        // The SDK expects a thrown OAuthError (not null). `InvalidTokenError`
        // triggers a 401 with a proper `WWW-Authenticate` header.
        throw new (await import('@modelcontextprotocol/sdk/server/auth/errors.js'))
          .InvalidTokenError('Access token is invalid, expired, or revoked.');
      }

      const scopes = claims.scope ? claims.scope.split(' ').filter(Boolean) : [];

      return {
        token,
        clientId: claims.client_id,
        scopes,
        expiresAt: typeof claims.exp === 'number' ? claims.exp : undefined,
        extra: {
          // Pass through claim data so downstream handlers can build a
          // `McpCallUser` without re-decoding the JWT.
          userId: Number(claims.sub),
          username: claims.username,
          jti: claims.jti,
        },
      };
    },

    /**
     * RFC 7009 token revocation. Supports both access and refresh tokens.
     * Silently no-ops for tokens we don't recognise (per the RFC).
     */
    async revokeToken(
      _client: OAuthClientInformationFull,
      request: OAuthTokenRevocationRequest
    ): Promise<void> {
      const token = request.token;
      const hint = request.token_type_hint;

      if (hint === 'refresh_token' || !hint) {
        await revokeRefreshToken(token);
      }
      if (hint === 'access_token' || !hint) {
        // Access tokens are JWTs; revoke by jti if we can decode them.
        const claims = await verifyJwt(token);
        if (claims?.jti) {
          await revokeAccessTokenByJti(claims.jti);
        }
      }
    },
  };
}

// ============================================
// Helper consumed by the POST /authorize/consent route
// ============================================

export interface IssueAuthCodeAfterConsentArgs {
  userId: number;
  clientId: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  redirectUri: string;
}

/**
 * Called from `/authorize/consent` (in `mcp/index.ts`) after we've verified
 * the user's credentials and recorded their consent. Creates the auth code
 * and returns it — the caller is responsible for building the redirect URL.
 */
export async function issueAuthorizationCodeAfterConsent(
  args: IssueAuthCodeAfterConsentArgs
): Promise<string> {
  return createAuthCode({
    userId: args.userId,
    clientId: args.clientId,
    scope: args.scope,
    codeChallenge: args.codeChallenge,
    codeChallengeMethod: args.codeChallengeMethod,
    redirectUri: args.redirectUri,
  });
}

// ============================================
// Internal
// ============================================

async function usernameForUserId(userId: number): Promise<string> {
  const { users } = await import('../../db/schema.js');
  const rows = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.username ?? `user-${userId}`;
}
