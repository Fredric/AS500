
You are a senior software engineer operating as an autonomous development agent.

Your goal is to produce correct, maintainable, production-quality solutions — not just plausible answers.

## Core Behavior

- Think before acting. Prefer correctness over speed.
- Do NOT guess missing requirements. Instead, ask focused clarification questions.
- When requirements are ambiguous, pause and resolve them before implementing.
- Keep responses structured, precise, and actionable.
- Avoid unnecessary verbosity — but do not omit critical reasoning.



## Coding Standards

- Write clean, idiomatic, production-grade code
- Prefer explicitness over magic
- Use strong typing where possible (TypeScript, schemas, interfaces)
- Include error handling and edge cases
- Avoid unnecessary dependencies
- Keep functions small and composable

## Architecture & Design

- Favor simple, extensible designs over clever ones
- Clearly separate concerns (API, domain logic, data access)
- Design for testability
- Call out trade-offs explicitly when relevant

## Tool Usage (MCP / Functions / APIs)

- You may have access to tools (APIs, MCP servers, databases, etc.)
- Only call tools when needed — not by default
- If a tool is required to proceed, explain why before calling it
- When calling tools, provide clean, minimal, correct inputs
- After tool results, interpret them — do not just dump raw output

## Output Format

When implementing:

- Start with a short plan (if non-trivial)
- Then provide code
- Then explain key decisions briefly


## Constraints

- Do NOT hallucinate APIs, endpoints, or data structures
- Do NOT invent tool capabilities — only use what is defined
- If unsure, say so and propose a safe path forward


## Optimization Mode

- Prefer solutions that scale reasonably
- Avoid premature optimization
- Call out performance implications when relevant

## Agent & Tooling Awareness

- Assume an agent loop exists (plan → act → observe → repeat)
- Structure outputs so they are machine-consable when possible
- Prefer JSON or typed structures when interacting with systems
- When suggesting tools, describe input/output contracts

- Be aware that:
  - Context may be incomplete
  - Tools may fail
  - Multiple steps may be required

Design solutions that are robust to this.




Apply the following spec to the AS500 codebase.



# Remote MCP Server Exposing CRUDTable Functionality

Spec for a new feature in the AS500 codebase: a **remote MCP (Model Context Protocol) server** that exposes every opted-in CRUDTable's CRUD operations as MCP tools to external agents (Claude, Cursor, Copilot, etc.).

This is a design doc, not implementation. When starting work, read it end-to-end and follow the TODOs in order.

---

## 1. Background

### 1.1 AS500

AS500 emulates a classic AS/400 green-screen mainframe as a modern web app. Dumb-terminal architecture: server owns all logic, client renders. See `README.md` and `CLAUDE.md` for the full picture.

### 1.2 CRUDTable

A declarative config system that auto-generates list + create/edit/delete screens. Source:

- `server/src/crudtable/types.ts` — all config interfaces (`CRUDTableConfig`, `ServiceCall`, `FieldConfig`, `RelationConfig`, etc.)
- `server/src/crudtable/runtime.ts` — the screen build/handle engine
- `server/src/configs/*.ts` — working examples (`timeRegV2`, `userMgmtConfig`, `motorcyclesConfig`, `modsConfig`, …)
- `server/src/configs/index.ts` — registry (`registerConfig`, `getConfig`, iteration)

Background docs: `DOCS/CRUDTABLE/5. CRUDTable Concept.md`, `DOCS/CRUDTABLE/6. CRUDTable Reference.md`. Agent skills: `.claude/skills/crudtable/SKILL.md` and `.cursor/skills/crudtable/SKILL.md` (they cover authoring configs, **not** MCP exposure — this doc adds that).

### 1.3 Model Context Protocol

MCP is the standard agents use to call tools on external services. Primary references:

- Spec: https://modelcontextprotocol.io/specification (current revision `2025-06-18`)
- Architecture: https://modelcontextprotocol.io/docs/learn/architecture
- Server concepts: https://modelcontextprotocol.io/docs/learn/server-concepts
- GitHub: https://github.com/modelcontextprotocol/modelcontextprotocol
- Authorization spec (OAuth 2.1 profile): https://modelcontextprotocol.io/specification/basic/authorization
- TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk (`@modelcontextprotocol/sdk`)

**Remote**, not stdio. Exposed at `https://<host>/mcp`. Must be callable by Claude Desktop, Cursor, and Copilot with no special integration on their side — i.e. fully spec-compliant including Dynamic Client Registration.

---

## 2. Design decisions (locked)

| Area | Decision |
|---|---|
| Tool granularity | **One tool per (config × operation)**. Tool names: `<configId>.list`, `<configId>.read`, `<configId>.create`, `<configId>.update`, `<configId>.delete`. |
| Opt-in | **Per-operation opt-in** on each config via a new `mcp` block. Default = not exposed. |
| Authz model | **Reuse existing AS500 RBAC.** The MCP access token is bound to an AS500 user; `config.requirePermission` and `ServiceCall.requirePermission` are re-checked on every tool call. |
| OAuth flow | **Full MCP spec compliance**: OAuth 2.1, Authorization Code + PKCE, **Dynamic Client Registration (RFC 7591)**, `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource` metadata. |
| User identity | **End-user binding.** The agent acts on behalf of the AS500 user who authorized it during the OAuth flow. Token → `users.id`. |
| Deployment | **Same Node process** as the AS500 server. A second Express app (same-process, separate router) listens on port **3002**. Shares the db pool, services, and config registry directly. |
| DB tables | **Extend existing `auth_tokens`** with a `kind` column (`'as500'` default, `'mcp_access'`, `'mcp_refresh'`, `'mcp_authcode'`). Add new tables only for things `auth_tokens` can't represent: `oauth_clients`, `oauth_consents`, `mcp_audit_log`. |
| Read-one | Add **optional `services.read: ServiceCall`** to `CRUDTableConfig`. Required for a config to opt into `<configId>.read`. |
| Parent-scoped configs | Scoping keys (e.g. `motorcycleId` for `mods`) become **required MCP tool parameters**. Each config declares them via `mcp.scope` so the runtime can inject them into the synthesized `ctx.input`. |
| Datasources | `staticOptions` → JSON Schema `enum`. **Datasource-backed fields are free-text** in v1; agents do their own lookups. (Revisit if it's painful.) |
| Transport | **Streamable HTTP only** (`POST /mcp`, optional SSE upgrade for streaming). No legacy SSE fallback. |
| Routing (prod) | Caddy reverse-proxies `https://adv.entence.se/mcp/*` → `127.0.0.1:3002`. Everything else continues to `3001`. |
| Consent UI | **Minimal standalone HTML** login + consent page served by the MCP Express app. Green-on-black styled to match the AS500 aesthetic. No React dependency. |
| Agent-friendly metadata | New `mcp.description` (required when exposed) and optional `mcp.name` on `CRUDTableConfig`. Per-field `mcp.description` on `FieldConfig`. Fall back to existing `title`/`label` only when absent. |
| Validators | **Synthesize a minimal `CRUDContext`** per MCP call (`formMode`, `values`, `editRecord` for update, `input` seeded from `mcp.scope` params), run all validators, return structured tool errors listing offending fields. |
| List shape | Accept `{ limit, offset, filter? }`; return `{ records, totalRecords, hasMore, offset }`. Defaults: `limit=50`, `offset=0`. Hard cap `limit ≤ 500`. |
| Primitives | **Tools only** in v1. (No Resources or Prompts. Revisit.) |
| Audit | New `mcp_audit_log` table. One row per tool call: `{ id, client_id, user_id, tool_name, config_id, action, params_hash, ok, error_code, duration_ms, created_at }`. Params themselves are NOT persisted (hash only) to avoid leaking secrets/PII. |
| Rate limiting | Reuse `server/src/utils/rateLimiter.ts`, keyed by access-token. Defaults: **60 req/min reads** (`list`/`read`), **20 req/min writes** (`create`/`update`/`delete`). Overridable per-config via `mcp.rateLimit`. |
| OAuth library | **`@modelcontextprotocol/sdk` built-in auth helpers** (`mcpAuthRouter` / `ProxyOAuthServerProvider`). Purpose-built for the MCP OAuth profile; expect to read the SDK source since docs are thin. No general-purpose OAuth framework is pulled in. |
| Token format | **Signed JWT + DB revocation check.** Access tokens are short-lived JWTs (HS256 via a server secret from env, `AS500_MCP_JWT_SECRET`) carrying `{ sub, client_id, scope, jti, exp }`. Every `/mcp` request: verify signature + `exp`, then single-row DB lookup on `auth_tokens.jti` to confirm not revoked. Refresh tokens are opaque (random) and always DB-backed. |
| Login backing (consent page) | **Dedicated login path** in `server/src/mcp/oauth/` that hits the `users` table directly (bcrypt + rate-limiter) but is independent of `server/src/services/auth.ts`. Keeps AS500 terminal login and MCP OAuth login isolated — neither can break the other. |
| Docs | Update the three crudtable skill mirrors (`.claude/skills/crudtable/SKILL.md`, `.cursor/skills/crudtable/SKILL.md`, `.github/instructions/crudtable.instructions.md`) + `CLAUDE.md` + `AGENTS.md`. |

---

## 3. TODOs

### 3.1 Extend `CRUDTableConfig` with an `mcp` block

Add new types to `server/src/crudtable/types.ts`:

```ts
export interface ServiceCall {
  // existing fields...
  service: Record<string, Function>;
  method: string;
  params?: (context: CRUDContext) => unknown;
  requirePermission?: string;
}

// NEW: per-config MCP exposure
export interface MCPConfig {
  /** Agent-facing short name. Defaults to config.id if absent. */
  name?: string;
  /** REQUIRED when any operation is exposed. Free-form description the agent sees. */
  description: string;

  /** Per-operation opt-in. Default = false (not exposed). */
  operations: {
    list?:   boolean | MCPOperationOverride;
    read?:   boolean | MCPOperationOverride; // requires services.read
    create?: boolean | MCPOperationOverride;
    update?: boolean | MCPOperationOverride;
    delete?: boolean | MCPOperationOverride;
  };

  /**
   * Scoping keys the caller must provide as MCP tool parameters.
   * These are injected into the synthesized ctx.input before validators
   * and service params run. Mirrors the keys RelationConfig.mapInput emits.
   * Example for modsConfig: [{ name: 'motorcycleId', type: 'number', required: true, description: '...' }]
   */
  scope?: MCPScopeParam[];

  /** Optional per-config rate-limit override. */
  rateLimit?: { readsPerMin?: number; writesPerMin?: number };
}

export interface MCPOperationOverride {
  /** Per-op description override; otherwise derived from MCPConfig.description. */
  description?: string;
  /** Per-op permission override (in addition to ServiceCall.requirePermission). */
  requirePermission?: string;
}

export interface MCPScopeParam {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  description: string;
}

export interface FieldConfig {
  // existing fields...
  mcp?: {
    /** Agent-facing description; falls back to label if absent. */
    description?: string;
    /** Set true to hide this field from MCP schemas entirely (e.g. internal IDs). */
    exclude?: boolean;
  };
}

export interface CRUDTableConfig {
  // existing fields...
  services: {
    list: ServiceCall;
    read?: ServiceCall;   // NEW — required for mcp.operations.read
    create?: ServiceCall;
    update?: ServiceCall;
    delete?: ServiceCall;
  };
  mcp?: MCPConfig;        // NEW — absent = not exposed at all
}
```

**`services.read` contract:** takes `{ id: <record id> }` and returns the single record object (or `null`). Add a concrete example to `timeRegV2Config` when implementing (this is the canonical reference config).

**Validation at registry load:** `registerConfig` (in `server/src/configs/index.ts`) must reject configs where:

- `mcp.operations.read = true` but `services.read` is missing.
- `mcp` is present but `mcp.description` is missing.
- Any referenced `ServiceCall` in an exposed operation is missing.

Write clear startup errors; this is the only place to catch misconfigurations before they confuse agents.

### 3.2 Build the MCP server

New directory: `server/src/mcp/`.

```
server/src/mcp/
  index.ts              # Express app factory, mounts all routers, called from server/src/index.ts
  transport.ts          # Streamable HTTP transport wiring (@modelcontextprotocol/sdk)
  schemaBuilder.ts      # Turns a CRUDTableConfig into JSON-Schema for each exposed operation
  toolHandlers.ts       # Per-operation handlers: list/read/create/update/delete
  contextSynth.ts       # Synthesize a minimal CRUDContext from MCP tool params
  oauth/
    provider.ts         # MCP SDK OAuth provider implementation (OAuthServerProvider interface)
                        #   — wires /authorize, /token, /register, /revoke via mcpAuthRouter
    consent.ts          # Minimal HTML login+consent page (GET+POST for /authorize flow)
    login.ts            # Dedicated bcrypt-based login against users table (NOT services/auth.ts)
    tokens.ts           # JWT sign/verify (HS256 via AS500_MCP_JWT_SECRET) + refresh-token issuance
    store.ts            # DB access for oauth_clients, oauth_consents, auth_tokens (MCP kinds)
  audit.ts              # Insert rows into mcp_audit_log
  rateLimit.ts          # Thin wrapper over utils/rateLimiter keyed by access token (by jti)
  errors.ts             # MCP-spec error mapping (invalid_grant, tool_execution_error, etc.)
```

**Library integration.** Install `@modelcontextprotocol/sdk` (latest stable). Use its `mcpAuthRouter` helper fed by our own `OAuthServerProvider` implementation in `oauth/provider.ts` — the provider is a thin adapter that delegates persistence to `store.ts`, token issuance to `tokens.ts`, and user auth to `login.ts`. **Do not** pull in `node-oidc-provider`, `oauth2-server`, or `oauth2orize` — the MCP SDK owns the protocol surface here.

#### 3.2.1 Express app & routing

- Create a second Express app bound to **`0.0.0.0:3002`**, started from `server/src/index.ts` after the WebSocket server is up (both share the process, the db pool, and the config registry).
- In dev, the client talks to it at `http://localhost:3002/mcp`. In prod, Caddy proxies `https://adv.entence.se/mcp/*` → `127.0.0.1:3002`.
- Caddyfile update (document but **do not** run on the VPS from this task — leave as a manual deploy step in the PR description).

#### 3.2.2 OAuth 2.1 + DCR

Endpoints (all under the MCP Express app):

| Path | Purpose |
|---|---|
| `GET /.well-known/oauth-authorization-server` | RFC 8414 metadata |
| `GET /.well-known/oauth-protected-resource` | MCP resource metadata (points at `/mcp`) |
| `POST /register` | RFC 7591 Dynamic Client Registration |
| `GET /authorize` | Browser consent page (login form + approve/deny) |
| `POST /authorize` | Consent submission — issues auth code, 302s to `redirect_uri` |
| `POST /token` | Exchange code → access+refresh tokens; refresh token rotation |
| `POST /revoke` | RFC 7009 revocation |

Flow:

1. Agent hits `/mcp` unauthenticated → 401 with `WWW-Authenticate: Bearer resource_metadata="https://host/.well-known/oauth-protected-resource"`.
2. Agent reads resource metadata, discovers authorization server, hits `/register` to self-register (DCR), then kicks off Authorization Code + PKCE.
3. User is redirected to `/authorize` in their browser → green-on-black HTML form:
   - Username + password, validated by `oauth/login.ts` — a **dedicated** login path that reads the `users` table, runs bcrypt, and reuses `utils/rateLimiter.ts`. Deliberately **independent** of `services/auth.ts` so terminal login and MCP login cannot regress each other.
   - Consent checkbox: "Allow **\<client_name\>** to act on behalf of \<username\> with scope `crudtable`?" (showing a snapshot of the user's effective permissions underneath).
   - Consent decisions persisted in `oauth_consents` keyed by `(user_id, client_id)` so repeat authorizations skip the checkbox.
4. Auth code issued (short-lived, one-time, stored in `auth_tokens` with `kind='mcp_authcode'`).
5. Agent exchanges code at `/token`:
   - **Access token**: signed JWT (HS256 via `AS500_MCP_JWT_SECRET` from env), 1h TTL, claims `{ sub: users.id, client_id, scope: 'crudtable', jti, exp, iat }`. The `jti` is also inserted into `auth_tokens` with `kind='mcp_access'` so we can revoke.
   - **Refresh token**: opaque random string, 30d TTL, stored in `auth_tokens` with `kind='mcp_refresh'`. Rotation on every `/token` refresh grant (old refresh row marked revoked).
6. Every `/mcp` request:
   1. Verify JWT signature + `exp`.
   2. Single-row DB lookup on `auth_tokens(jti)` — if missing or `revoked_at IS NOT NULL`, reject.
   3. Load bound user, resolve permissions via `services/access.ts` (cached on the request).

**Scopes in v1**: a single scope `crudtable` is advertised. All authorization/permission granularity comes from the bound user's AS500 RBAC. (If we ever need to narrow, introduce scopes like `crudtable:read` / `crudtable:write` later.)

#### 3.2.3 DB schema changes

Edit `server/src/db/schema.ts`, then `npm run db:generate` inside `server/`.

```ts
// 1. Extend auth_tokens
export const authTokens = pgTable('auth_tokens', {
  // existing columns...
  kind: varchar('kind', { length: 20 }).notNull().default('as500'),
  clientId: varchar('client_id', { length: 64 }), // NULL for 'as500'; FK to oauth_clients for mcp_*
  jti: varchar('jti', { length: 64 }),            // NULL for 'as500'; set for mcp_access (= JWT jti)
  codeChallenge: varchar('code_challenge', { length: 128 }), // PKCE, only for mcp_authcode
  codeChallengeMethod: varchar('code_challenge_method', { length: 8 }),
  redirectUri: text('redirect_uri'),              // only for mcp_authcode (must match on /token)
  revokedAt: timestamp('revoked_at'),             // soft-revocation for mcp_access/mcp_refresh
  // …other existing fields remain
});
// Add a unique index on (kind, jti) to make the per-request revocation check a single lookup.

// 2. NEW: oauth_clients
export const oauthClients = pgTable('oauth_clients', {
  id: varchar('id', { length: 64 }).primaryKey(), // random id issued at /register
  clientSecretHash: varchar('client_secret_hash', { length: 128 }), // nullable for public clients
  clientName: varchar('client_name', { length: 255 }).notNull(),
  redirectUris: text('redirect_uris').notNull(), // JSON array
  tokenEndpointAuthMethod: varchar('token_endpoint_auth_method', { length: 32 }).notNull(),
  registeredAt: timestamp('registered_at').defaultNow().notNull(),
  metadata: text('metadata'), // raw DCR registration for audit
});

// 3. NEW: oauth_consents
export const oauthConsents = pgTable('oauth_consents', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  clientId: varchar('client_id', { length: 64 }).notNull().references(() => oauthClients.id),
  scope: varchar('scope', { length: 255 }).notNull(),
  grantedAt: timestamp('granted_at').defaultNow().notNull(),
  revokedAt: timestamp('revoked_at'),
});

// 4. NEW: mcp_audit_log
export const mcpAuditLog = pgTable('mcp_audit_log', {
  id: serial('id').primaryKey(),
  clientId: varchar('client_id', { length: 64 }),
  userId: integer('user_id'),
  toolName: varchar('tool_name', { length: 128 }).notNull(),
  configId: varchar('config_id', { length: 64 }).notNull(),
  action: varchar('action', { length: 16 }).notNull(), // list|read|create|update|delete
  paramsHash: varchar('params_hash', { length: 64 }).notNull(), // sha256 hex
  ok: boolean('ok').notNull(),
  errorCode: varchar('error_code', { length: 64 }),
  durationMs: integer('duration_ms').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

#### 3.2.4 Tool generation pipeline

On server startup, iterate the config registry and for every config with `config.mcp` present:

1. Build the **common record JSON Schema** from `fieldConfigs` + `columnBuilder`/`formBuilder`:
   - `staticOptions` → `enum`.
   - `length` → `maxLength` for strings.
   - `type` → `string`/`number`/`boolean`.
   - Required fields derived from form config + validators.
   - `mcp.exclude: true` fields are dropped.
   - `mcp.description` (field-level) → schema `description`.
2. For each enabled op in `config.mcp.operations`, register an MCP tool with name `<configId>.<op>` and description merged from `mcp.description` + op override + permission hints.
3. Prepend `config.mcp.scope` params as required top-level inputs on every tool.
4. Per-op input shape:
   - `list`   → `{ ...scopeParams, limit?, offset?, filter? }`
   - `read`   → `{ ...scopeParams, id }`
   - `create` → `{ ...scopeParams, ...fields }`
   - `update` → `{ ...scopeParams, id, ...fields }`
   - `delete` → `{ ...scopeParams, id }`

#### 3.2.5 Tool call execution (per call)

```
1. Authenticate Bearer token   → user, clientId
2. Rate-limit (per-token, read|write bucket)
3. Resolve config + op from tool name
4. Permission check:
     - config.requirePermission (if set)
     - services.<op>.requirePermission (if set)
     - mcp.operations.<op>.requirePermission (if set)
5. Synthesize CRUDContext (contextSynth.ts):
     formMode: op === 'create' ? 'create' : op === 'update' ? 'edit' : null
     input:    { ...scopeParams }
     values:   { ...field params as strings }
     editRecord: op==='update' ? await services.read(id) : null
     selection:  op==='delete' ? [await services.read(id)] : []
     user, records: [], pageOffset: 0, datasources: {}
6. Run validators from fieldConfigs.*.form.validators; if any → tool error {
     code: 'validation_failed',
     fields: [{ name, message }],
   }
7. Call services.<op>.method(services.<op>.params(ctx))
8. Audit row, response
```

Map all errors via `errors.ts` to clean MCP tool errors. Never leak stack traces to the agent in prod.

### 3.3 Tests

Add a new Playwright spec `tests/mcp-server.spec.ts` (note: runs alongside existing E2E tests). Coverage:

- `/.well-known/*` endpoints return valid metadata.
- DCR via `/register` issues a client.
- End-to-end OAuth: script the consent form (Playwright can drive `/authorize`), exchange code for token.
- `POST /mcp` with a valid token lists available tools, matches the registered configs.
- Each CRUD op for `timereg_v2` (as the golden path): create → list → read → update → delete.
- Permission denial: log in as a user without `time_reg:write`, confirm `create` fails with `permission_denied`.
- Rate-limit: 21st write within a minute returns `rate_limited`.
- Scope params: `mods.list` without `motorcycleId` returns a schema-validation error; with a wrong `motorcycleId` returns an empty list (not an error).
- Audit row inserted for every call.

Use the same `setupTestData()` / `teardownTestData()` from `tests/testSetup.ts`. Run serially (`--workers=1`).

### 3.4 Docs

Update in this order (three skill files are byte-identical mirrors — edit one, copy to the others):

1. `.claude/skills/crudtable/SKILL.md` — add a new section "Exposing a CRUDTable via MCP" covering:
   - The `mcp` block on `CRUDTableConfig` (with a minimal example).
   - `services.read` contract.
   - `mcp.scope` for parent-scoped configs (reference `modsConfig`).
   - `mcp.description` and field-level `mcp.description`.
   - Anti-patterns (exposing configs with unpersisted virtual fields, secrets in field values, etc.).
2. `.cursor/skills/crudtable/SKILL.md` — mirror.
3. `.github/instructions/crudtable.instructions.md` — trimmed mirror.
4. `CLAUDE.md` — new top-level section "MCP Server" pointing at this spec (or the resulting `DOCS/MCP/` doc), plus ports table update (`ws://localhost:3001`, `http://localhost:3002/mcp`).
5. `AGENTS.md` — add an "MCP Server" entry to the skills/background docs tables and a bullet in the decision guide: *"User asks to expose data to external AI agents?" → See MCP doc*.
6. `DOCS/MCP/` — new folder with this draft promoted to `1. MCP Server Spec.md` once the feature ships (move, don't duplicate).

---

## 4. Open questions to revisit after v1 ships

- Expose Resources (per-record URIs) so agents can `@`-reference individual records.
- Expose Prompts for common workflows (e.g. "register today's hours").
- Datasource-backed fields as separate lookup tools (currently free-text).
- Per-scope OAuth (currently single scope `crudtable`).
- Cursor-based pagination for `list`.
