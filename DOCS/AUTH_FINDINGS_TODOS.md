# Authentication / Token / Login Findings and TODOs

Date: 2026-04-24

This document summarizes the current authentication implementation in AS500 and proposes cleanup/security TODOs for a unified auth system that supports:

- MCP OAuth 2.1 access for external agents
- WebSocket terminal sessions
- Browser web pages
- First-party users/clients invoking the REST API

## Current auth surfaces

### 1. Classic AS500 WebSocket terminal login

Key files:

- `server/src/screens/login.ts`
- `server/src/services/auth.ts`
- `server/src/index.ts`
- `server/src/session/index.ts`
- `client/src/hooks/useTerminal.ts`

Flow:

1. Browser opens a WebSocket to the AS500 server.
2. Server renders the terminal login screen.
3. User enters username/password.
4. `handleLogin()` validates credentials via `validateCredentials()`.
5. On success, the server:
   - marks the in-memory session authenticated,
   - loads RBAC permissions,
   - creates an access/refresh token pair,
   - returns those tokens to the browser.
6. The browser stores:
   - `as500_session`
   - `as500_access_token`
   - `as500_refresh_token`
   - `as500_device_id`

Notes:

- Password validation uses bcrypt hashes from `users.password_hash`.
- Usernames are normalized with `toUpperCase().trim()`.
- Only active users can log in.
- Sessions are in-memory and also persisted to `server/data/sessions.json`.
- Session timeout is 15 minutes.
- Permissions are cached on the session as `Set<string>` and lazily reloaded after session restore.

Important detail:

- The WebSocket terminal tokens are opaque UUIDs from `uuidv4()`, not JWTs.
- Docs currently describe them as “JWT-style”, which is misleading.

### 2. MCP OAuth 2.1 auth for agents

Key files:

- `server/src/mcp/index.ts`
- `server/src/mcp/oauth/provider.ts`
- `server/src/mcp/oauth/tokens.ts`
- `server/src/mcp/oauth/store.ts`
- `server/src/mcp/oauth/login.ts`
- `server/src/mcp/oauth/consent.ts`

Flow:

- MCP server runs on port `3002` by default.
- OAuth endpoints include:
  - `POST /register`
  - `GET /authorize`
  - `POST /authorize/consent`
  - `POST /token`
  - `POST /revoke`
  - `POST /mcp`
  - OAuth discovery endpoints under `/.well-known/*`

Token model:

- Access tokens are real HS256 JWTs.
- JWT issuer is `as500-mcp`.
- JWT secret is `AS500_MCP_JWT_SECRET`.
- Access tokens expire after 1 hour.
- Refresh tokens are opaque random 256-bit base64url strings.
- Refresh tokens expire after 30 days.
- Refresh tokens rotate on every refresh grant.
- Access token JWTs include a `jti` claim.
- Every MCP access JWT is checked against `auth_tokens` by `(kind='mcp_access', jti, revoked_at IS NULL)`.

Good properties:

- Per-token revocation works.
- Refresh rotation exists.
- PKCE auth-code flow exists.
- Dynamic client registration exists.
- Client secrets are bcrypt-hashed.
- Tool/API calls resolve permissions fresh from DB, so RBAC changes apply quickly.

### 3. First-party REST API credential exchange

Key files:

- `server/src/api/auth.ts`
- `server/src/api/index.ts`
- `server/src/mcp/index.ts`

Endpoints:

- `POST /api/auth/token`
- `POST /api/auth/refresh`
- `POST /api/auth/revoke`

Flow:

- Caller submits username/password directly.
- Server uses the same dedicated MCP login helper, `mcpLogin()`.
- Server issues the same kind of JWT access token and opaque refresh token as the MCP OAuth flow.
- Tokens use sentinel client id: `as500-direct`.
- REST API calls use `Authorization: Bearer <access_token>`.

This is useful for first-party apps where AS500 owns both client and backend.

## Shared database model

Key file:

- `server/src/db/schema.ts`

All token-like records live in `auth_tokens`.

Current `kind` values:

- `as500` — classic terminal tokens
- `mcp_authcode` — OAuth authorization codes
- `mcp_access` — MCP/API JWT access-token revocation rows
- `mcp_refresh` — MCP/API opaque refresh tokens

Important columns:

- `token`
- `access_token`
- `refresh_token`
- `access_expires_at`
- `refresh_expires_at`
- `expires_at`
- `revoked_at`
- `kind`
- `client_id`
- `jti`
- `device_id`
- `device_name`
- `code_challenge`
- `code_challenge_method`
- `redirect_uri`

## Main observations

### Strengths

- Passwords are bcrypt-hashed.
- Inactive users cannot authenticate.
- Role/permission model is reasonably complete.
- MCP/API token flow is significantly stronger than the older terminal token flow.
- MCP/API access JWTs are backed by DB revocation checks.
- Refresh-token rotation is implemented for MCP/API and classic terminal refresh.
- Login and API/MCP call rate limiters exist.
- Consent flow and PKCE are implemented for MCP agents.
- REST API supports both OAuth-issued and first-party direct-login tokens.

### Areas needing cleanup

1. There are two different token systems:
   - classic WebSocket tokens are opaque UUIDs,
   - MCP/API tokens are signed JWTs with DB-backed revocation.

2. Browser tokens are stored in JS-readable cookies.
   - They are `SameSite=Strict`.
   - They are `Secure` on HTTPS.
   - They are not `HttpOnly`, because the client sets them from JavaScript.

3. `sessionId` is itself a bearer credential for WebSocket interactions.
   - After login, normal WebSocket keypresses authenticate by `sessionId`.
   - Access token is mainly used for reconnect/resume.

4. WebSocket `RESUME` trusts an existing authenticated session before token validation.
   - If the server finds an authenticated session by `sessionId`, it resumes without checking access-token validity.

5. Terminal logoff revokes all user tokens.
   - `handleLogOff()` calls `revokeAllUserTokens(userId)`.
   - This can revoke tokens for all devices and also MCP/API tokens for that user.

6. Documentation says classic auth uses “JWT-style” tokens, but classic tokens are UUIDs.

7. Token cleanup is split and may not handle all `kind` values equally.
   - Expired OAuth auth codes may be left around unless consumed.

8. Auth boundaries are partly blurred by the shared `auth_tokens` table.
   - Sharing a table is fine, but operations need to be explicitly scoped by `kind` to avoid accidental cross-surface revocation/deletion.

## Recommended target architecture

The goal should be one coherent auth model with separate flows but consistent primitives.

### Suggested model

| Surface | Authentication mechanism | Token storage | Recommended browser storage |
|---|---|---|---|
| MCP agents | OAuth 2.1 + PKCE + DCR | JWT access + opaque refresh in `auth_tokens` | Agent-managed bearer tokens |
| REST API, third party | OAuth 2.1 bearer token | JWT access + opaque refresh | Caller-managed bearer tokens |
| REST API, first party | `/api/auth/token` direct credential exchange or session-cookie bridge | Same JWT/refresh model | Prefer HttpOnly cookies for browser apps |
| WebSocket terminal | Authenticated server session, bootstrapped by cookie/token | Session row or signed session cookie + optional refresh | HttpOnly Secure SameSite cookie |
| Browser web pages | Web session cookie, optionally CSRF-protected | Server-side session or signed cookie | HttpOnly Secure SameSite cookie |

Recommended principle:

- External agents and non-browser API clients use Bearer tokens.
- Browsers should not store long-lived refresh tokens in JavaScript-readable storage.
- WebSocket sessions should bind to a secure, server-issued browser session cookie, not a JS-readable session id if possible.

## TODOs

### P0 — security-critical cleanup

- [ ] Decide whether classic WebSocket access tokens should be migrated to the MCP/API JWT model or remain opaque session tokens.
  - If kept opaque, update documentation to stop calling them JWT-style.
  - If migrated, use the same `issueAccessToken()` / `verifyAccessToken()` style with `jti` revocation.

- [ ] Stop storing browser refresh tokens in JavaScript-readable cookies.
  - Replace client-set `as500_refresh_token` with a server-set `HttpOnly; Secure; SameSite=Strict` cookie.
  - Prefer a server endpoint that refreshes browser sessions without exposing refresh token contents to JS.

- [ ] Treat `sessionId` as a sensitive bearer credential.
  - Use a high-entropy session id only in an HttpOnly cookie where possible.
  - Avoid exposing `sessionId` to application JavaScript unless absolutely required.
  - Consider binding session to device id / user agent / IP heuristics with care.

- [ ] Change WebSocket `RESUME` behavior to validate freshness.
  - Current behavior resumes an authenticated session by `sessionId` before token validation.
  - Consider requiring either:
    - a valid session cookie issued server-side, or
    - valid access/refresh token proof when resuming after reconnect.

- [ ] Scope logout/revocation by token kind and device/session.
  - Replace terminal logoff’s `revokeAllUserTokens(userId)` with a current-session/current-device revoke.
  - Add separate “log out all devices” admin/user action if desired.
  - Do not revoke MCP/API tokens from a terminal signoff unless explicitly requested.

### P1 — unify token lifecycle

- [ ] Introduce a single token service boundary.
  - Today classic tokens live in `server/src/services/auth.ts` while MCP/API tokens live in `server/src/mcp/oauth/*`.
  - Create a clearer module such as `server/src/auth/` with submodules:
    - `passwords.ts`
    - `sessions.ts`
    - `tokens.ts`
    - `oauth.ts`
    - `browserCookies.ts`
    - `revocation.ts`

- [ ] Make every `auth_tokens` operation filter by `kind` unless intentionally cross-kind.
  - Examples:
    - `revokeAuthToken()` should probably target `kind='as500'`.
    - `revokeAllUserTokens()` should either be renamed to `revokeAllUserTokensAcrossAllSurfaces()` or accept `kind`/surface filters.

- [ ] Add a token cleanup job aware of all token kinds.
  - Delete expired `mcp_authcode` rows.
  - Delete expired/revoked `mcp_access` rows after a retention window.
  - Delete expired/revoked `mcp_refresh` rows after a retention window.
  - Delete expired/revoked `as500` rows after a retention window.

- [ ] Standardize expiry constants.
  - Classic tokens use constants in `server/src/services/auth.ts`.
  - MCP/API tokens use constants in `server/src/mcp/oauth/tokens.ts`.
  - Move these to one config module or env-driven settings.

- [ ] Add explicit token audience/resource claims for JWTs.
  - Current JWTs have issuer and client id.
  - Consider adding `aud` for `/mcp` and `/api` resources, or a controlled shared audience if both should accept the same tokens.

### P1 — browser/webpage and REST support

- [ ] Define browser auth modes clearly:
  - Terminal WebSocket UI
  - REST API from browser-owned pages
  - REST API from external clients

- [ ] For browser web pages invoking REST API, prefer one of these patterns:
  1. Backend-for-frontend session cookie:
     - Browser holds `HttpOnly` session cookie.
     - Server injects/uses token internally when calling REST handlers.
  2. HttpOnly access/refresh cookies:
     - `/api/auth/token` sets cookies server-side.
     - API reads token from cookies in addition to `Authorization` header.
     - Add CSRF protection if using cookies for unsafe methods.

- [ ] Add CSRF strategy if REST accepts cookie auth.
  - `SameSite=Strict` helps but should not be the only defense if cookies authorize mutations.
  - Use CSRF token header for `POST`, `PUT`, `DELETE`.

- [ ] Keep Authorization Bearer support for non-browser REST/API clients.
  - Agents, scripts, and server-side apps should continue using bearer tokens.

- [ ] Add a clear `POST /api/auth/logout` browser-friendly endpoint.
  - Should clear HttpOnly cookies server-side.
  - Should revoke only the current browser session/refresh token by default.

### P1 — MCP OAuth 2.1 hardening

- [ ] Ensure production refuses to boot without `AS500_MCP_JWT_SECRET`.
  - Current code generates a random secret in dev.
  - Verify this cannot happen in production or add an explicit production check.

- [ ] Review OAuth client registration policy.
  - Dynamic Client Registration is convenient for agents.
  - Consider limits, allowlists, or admin visibility/approval for production if needed.

- [ ] Add admin screens/actions for OAuth clients and consents.
  - There is already an OAuth clients inspector config.
  - Add revoke client / revoke consent operations if missing.

- [ ] Validate redirect URI rules strictly.
  - Existing code checks registered redirect URIs during consent.
  - Also verify registration policy rejects dangerous redirect patterns if not already handled by SDK/client store.

- [ ] Add scope strategy.
  - Current `scopesSupported: []` and RBAC is enforced by AS500 permissions.
  - Decide whether OAuth scopes should map to AS500 permissions or remain informational.
  - If scopes remain informational, document that RBAC is authoritative.

### P2 — session lifecycle and UX

- [ ] Make session timeout behavior explicit in UI.
  - Current server session timeout is 15 minutes.
  - Client heartbeat pings every 60 seconds, which keeps sessions alive.
  - Decide intended idle timeout semantics.

- [ ] Add current-device session tracking.
  - Use `device_id` consistently for browser sessions.
  - Allow “log out this device” vs “log out all devices”.

- [ ] Avoid persisting authenticated sessions to disk in production.
  - `PERSIST_SESSIONS` is currently hardcoded `true`.
  - Make it environment-dependent.
  - Consider no session persistence in production, or use a proper session store.

- [ ] Store less sensitive session context on disk.
  - Review `session.context` contents.
  - Ensure no passwords/tokens/secrets are ever placed in persisted context.

- [ ] Add session rotation after login.
  - If an unauthenticated session id exists before login, rotate it upon successful login to reduce fixation risk.

### P2 — password/account security

- [ ] Centralize password validation and hashing.
  - `userMgmt.ts` validates minimum 6 chars.
  - Login modules perform bcrypt compare separately.
  - Keep all password policy/hash settings in one place.

- [ ] Consider stronger password policy for non-test users.
  - Minimum length higher than 6.
  - Optional breached-password checks if exposed publicly.

- [ ] Ensure seeded/default passwords are not deployed to production.
  - `FREDRIC / fredric` and `KALLE / password` exist in seed.
  - Production should require explicit admin bootstrap via `ADMIN_PASSWORD` or a one-time setup path.

- [ ] Add account lockout or alerting for repeated failed login attempts.
  - Current rate limit is in-memory and resets on process restart.
  - For production, consider DB-backed lockout/audit trail.

### P2 — auditing and observability

- [ ] Audit login success/failure events.
  - Current MCP/API calls are audited, but login/revoke are not written to `mcp_audit_log`.
  - Add a separate `auth_audit_log` or extend audit source values.

- [ ] Audit token refresh and revoke events.
  - Include user id, client id, token kind, device id, IP, user agent.
  - Do not log token values.

- [ ] Add admin screen for active sessions/tokens.
  - There is an auth tokens admin service.
  - Ensure it hides token values and only shows metadata.

- [ ] Add metrics/logging for auth failures and rate-limit events.

## Suggested implementation phases

### Phase 1 — safe cleanup without breaking clients

1. Update docs to distinguish classic opaque tokens from MCP/API JWTs.
2. Add `kind` filters to revoke/delete paths.
3. Change terminal signoff to revoke only current AS500 token/device/session.
4. Add full token cleanup by `kind`.
5. Make session persistence environment-controlled.

### Phase 2 — browser hardening

1. Move browser refresh token to HttpOnly server-set cookie.
2. Move session id to HttpOnly server-set cookie or a signed session cookie.
3. Add CSRF protection for cookie-auth REST mutations.
4. Rotate session id on login.
5. Add browser logout endpoint that clears cookies and revokes only current session/device.

### Phase 3 — unification

1. Extract a shared `server/src/auth/` module.
2. Standardize token expiry/config.
3. Decide whether WebSocket terminal should use JWT access tokens or pure server-side sessions.
4. Add clear interfaces:
   - `authenticatePassword()`
   - `issueBrowserSession()`
   - `issueApiTokenPair()`
   - `refreshTokenPair()`
   - `revokeCurrentSession()`
   - `revokeTokenFamily()`
   - `resolveBearerUser()`

### Phase 4 — production hardening

1. Require production JWT secret.
2. Review DCR policy.
3. Add auth audit trail.
4. Add admin revocation tools for OAuth clients, consents, sessions, and devices.
5. Add tests for token rotation, revocation scoping, WebSocket resume, API bearer auth, and browser cookie auth.

## Test cases to add

- WebSocket login returns session and token metadata.
- WebSocket resume with valid session succeeds.
- WebSocket resume with expired session and valid access token succeeds.
- WebSocket resume with expired access token and valid refresh token rotates tokens.
- WebSocket resume with invalid tokens clears client tokens.
- Terminal logoff revokes only current AS500 token/device, not MCP/API tokens.
- REST `/api/auth/token` returns JWT access token and refresh token.
- REST refresh rotates refresh tokens and revokes old access token.
- Old refresh token cannot be reused.
- Revoked JWT is rejected even before expiry.
- MCP OAuth auth code is single-use.
- MCP refresh token rotation revokes paired access token.
- Permission changes are reflected on MCP/API calls without issuing a new token.
- Browser cookie auth, if added, rejects unsafe methods without CSRF token.

## Bottom line

The current system is functional and reasonably advanced, especially for MCP/API OAuth. The main cleanup need is to make the auth boundary explicit:

- Agents and external API clients should use OAuth/Bearer tokens.
- Browsers should use HttpOnly cookies and server-managed sessions/refresh.
- WebSocket sessions should stop relying on JS-readable `sessionId`/refresh token as long-lived credentials.
- Token revocation must be scoped carefully by surface, token kind, device, and session.
