# AS500 - Modern Mainframe Terminal System

A modern client-server solution that emulates an AS400 mainframe terminal. The backend sends complete screens (not data), controls navigation, owns validation, and treats the UI as a dumb terminal.

![Terminal Screenshot](https://img.shields.io/badge/style-green%20screen-33ff33?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?style=flat-square)
![React](https://img.shields.io/badge/React-18-61dafb?style=flat-square)
![WebSocket](https://img.shields.io/badge/WebSocket-ws-yellow?style=flat-square)

## Features

- Classic green-on-black terminal aesthetic with CRT effects
- WebSocket-based real-time communication
- **CRUDTable config system** — declarative configs that auto-generate list + form screens
- **Keyboard row navigation** — Arrow keys move between rows; Enter edits; `d` deletes; no F-keys needed
- **Mouse row selection** — Click to select a row, double-click to open
- **Modern token-based authentication** — OAuth 2.0-inspired access/refresh token pattern
- **Remote MCP server** — every CRUDTable config can be opened up to AI agents as [Model Context Protocol](https://modelcontextprotocol.io) tools, gated by OAuth 2.1 + DCR and the same RBAC as the UI
- **REST API** — same CRUDTable configs also served as a conventional REST API (`GET/POST/PUT/DELETE /api/:configId`) with first-party Bearer token login (`POST /api/auth/token`) and token rotation
- **Secure session management** — 30-day auto-login with 1-hour token rotation
- **Role-based access control** — Roles (`user`, `superuser`, `aiagent`, `admin`), user groups, and named permission keys with per-operation CRUDTable enforcement
- **Device tracking** — Multi-device session management with device fingerprinting
- **Rate limiting** — Protection against brute force and token abuse
- bcrypt password hashing with PostgreSQL storage
- Full keyboard support (F-keys, Tab, Enter, Arrow keys)
- Automated backup system with scheduled backups
- Docker Compose setup for easy development environment

## Quick Start

### Option 1: Docker Compose (Recommended for Development)

Run everything in Docker containers:

```bash
# Start all services (PostgreSQL, server, and client)
docker-compose up

# Or run in detached mode
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

The application will be available at:
- **Client UI:** http://localhost:5173
- **Server WebSocket:** ws://localhost:3001
- **PostgreSQL:** localhost:5433

**Features:**
- Hot reload for both server and client code changes
- Session persistence survives server restarts during development
- Isolated `node_modules` in Docker volumes (no conflicts with host)
- Automatic dependency installation

### Option 2: Local Development

Run services directly on your machine:

```bash
# Optional: PostgreSQL via Docker (maps host 5433 → container 5432)
docker-compose up -d postgres

# Terminal 1: Start server
cd server
npm install
npm run seed    # Creates default user (first time only)
PGPORT=5433 npm run dev   # Use 5433 if using Docker Postgres (avoids local Postgres on 5432)
# Or: npm run dev         # Uses PGPORT from .env or default 5432

# Terminal 2: Start client
cd client
npm install
npm run dev     # Runs on http://localhost:5173
```

**Note:** If you run Postgres in Docker (`docker-compose up -d postgres`), set `PGPORT=5433` when starting the server (or in `server/.env`). Docker maps `5433:5432` so the app doesn’t hit a local Postgres on 5432.

### Login Credentials

Open http://localhost:5173 and login with:
- **Username:** `FREDRIC`
- **Password:** `fredric`

## Architecture

```
┌─────────────┐     WebSocket      ┌─────────────┐
│   Client    │◄──────────────────►│   Server    │
│   (React)   │   JSON messages    │  (Node.js)  │
│             │                    │             │
│  Cookies:   │                    │  Sessions + │
│  • Session  │                    │  Auth Tokens│
│  • Access   │                    │             │
│  • Refresh  │                    │             │
│  • Device   │                    │             │
└─────────────┘                    └──────┬──────┘
                                          │
┌─────────────┐     Streamable HTTP       │
│  AI agent   │◄──────────────────────────┤  :3002 /mcp
│ (MCP client)│   OAuth 2.1 + DCR         │  (tools = CRUDTable ops)
└─────────────┘                           │
                                          │
┌─────────────┐     REST HTTP             │
│  Remote app │◄──────────────────────────┤  :3002 /api
│  (1st party)│   Bearer token            │  (CRUD resources)
│             │   POST /api/auth/token    │
└─────────────┘                           │
                                   ┌──────▼──────┐
                                   │ PostgreSQL  │
                                   │  • Users    │
                                   │  • Tokens   │
                                   │  • Sessions │
                                   │  • OAuth    │
                                   │  • Audit    │
                                   └─────────────┘
```

- **Backend owns everything** - UI is a "dumb terminal"
- **Screen-based** - Server sends complete rendered screens
- **Session-based** - All state lives on the server
- **Token-based auth** - Secure access/refresh token rotation

## Tech Stack

| Component | Technology |
|-----------|------------|
| Server | Node.js, TypeScript, ws, pg (PostgreSQL), bcrypt |
| Client | React 18, TypeScript, Vite |
| Database | PostgreSQL (with SQLite support) |
| Development | Docker Compose, tsx (hot reload) |

## Project Structure

```
AS500/
├── server/
│   └── src/
│       ├── index.ts          # WebSocket server & router
│       ├── crudtable/        # CRUDTable runtime engine
│       │   ├── types.ts      # Config interfaces
│       │   ├── registry.ts   # Config store
│       │   ├── runtime.ts    # Core engine (list + form screens)
│       │   └── router.ts     # Router integration
│       ├── configs/          # CRUDTable config definitions
│       ├── menus/            # Menu tree + generic menu runtime
│       ├── mcp/              # Remote MCP server (OAuth 2.1 + tools)
│       │   ├── index.ts      # Express app (auth router + /mcp)
│       │   ├── transport.ts  # McpServer factory + tool registration
│       │   ├── toolHandlers.ts  # Per-operation handlers (RBAC enforced)
│       │   ├── audit.ts      # mcp_audit_log writer
│       │   └── oauth/        # Provider, tokens, consent, clients store
│       ├── screens/          # Hand-written screens (login, menu, help)
│       ├── services/         # Business logic
│       ├── session/          # Session management
│       └── db/               # Database
└── client/
    └── src/
        ├── components/       # React components
        ├── hooks/            # Custom hooks
        └── styles/           # CSS
```

## CRUDTable System

The recommended way to create CRUD screens. Instead of writing ~300 lines of screen handlers, write a ~60 line config:

```typescript
// server/src/configs/myItems.ts
export const myItemsConfig: CRUDTableConfig = {
  id: 'my_items',
  title: 'My Items',
  services: {
    list:   { service: myService, method: 'getAll' },
    create: { service: myService, method: 'create', params: ctx => ctx.values },
    update: { service: myService, method: 'update', params: ctx => ({ id: ctx.editRecord!.id, ...ctx.values }) },
    delete: { service: myService, method: 'remove', params: ctx => ctx.selection[0].id },
  },
  fieldConfigs: {
    name: { field: 'name', label: 'Name', length: 20, form: { required: true } },
  },
  columnBuilder: ['name'],
  formBuilder: ['name'],
};
```

The runtime auto-generates: paginated list screen, create/edit form, option handling (2=Edit, 4=Delete), F-key navigation, validation, and error handling.

See [CLAUDE.md](CLAUDE.md) for the full CRUDTable reference.

## Remote MCP Server

AS500 ships a [Model Context Protocol](https://modelcontextprotocol.io) server that makes every CRUDTable config available to remote AI agents as structured tools — **without writing a second handler**. The same config that powers the green-screen UI powers the MCP surface.

### What the agent gets

For every CRUDTable config with an `mcp` block, the server auto-generates five tools:

| Tool | Purpose |
|---|---|
| `<id>.list`   | Paginated list with `limit` / `offset` |
| `<id>.read`   | Fetch one record by id |
| `<id>.create` | Create, runs the same validators as the form |
| `<id>.update` | Partial update by id |
| `<id>.delete` | Delete by id, uses `read` to fetch the target first |

Each tool's input schema is **derived from the same field configs** as the form — field types, `required`, validators, and `form.formValue` all apply identically. Any operation can be individually disabled or gated behind its own permission.

### Transport & endpoints

Runs on its own port (default `3002`) with the MCP **Streamable HTTP** transport and a full OAuth 2.1 + Dynamic Client Registration (DCR) layer:

| Endpoint | Purpose |
|---|---|
| `POST /mcp`                                                | MCP endpoint — Bearer-authed, rate-limited, per-call audit row |
| `GET  /mcp/health`                                         | Unauthenticated liveness probe |
| `GET  /.well-known/oauth-authorization-server`             | RFC 8414 AS metadata |
| `GET  /.well-known/oauth-protected-resource/mcp`           | RFC 9728 resource metadata (advertised via `WWW-Authenticate` on 401s) |
| `POST /register`                                           | RFC 7591 Dynamic Client Registration |
| `GET  /authorize` → `POST /authorize/consent`              | Green-on-black consent page, dedicated `mcpLogin` (separate from AS500 session auth) |
| `POST /token`                                              | Authorization-code and refresh-token grants, PKCE-enforced |
| `POST /revoke`                                             | RFC 7009 token revocation |
| `GET/POST/PUT/DELETE /api/:configId[/:id]`                 | REST API — Bearer-authed, same RBAC + audit as MCP (see [REST API](#rest-api)) |
| `POST /api/auth/token`                                     | First-party login: username + password → Bearer tokens |
| `POST /api/auth/refresh`                                   | Rotate refresh token → new access + refresh pair |
| `POST /api/auth/revoke`                                    | Revoke a token (logout) |

### Auth posture

- **Access tokens**: short-lived (1 h) HS256 JWTs signed with `AS500_MCP_JWT_SECRET` (≥32 chars). Revocable per-token via the `auth_tokens` table keyed by `jti`.
- **Refresh tokens**: opaque 256-bit strings (30 d), rotated on every refresh grant — old refresh + its paired access row are both revoked.
- **Authorization codes**: opaque 256-bit strings (60 s), single-use, PKCE S256 required.
- **RBAC**: every tool call enforces `config.requirePermission`, `ServiceCall.requirePermission`, and optional per-op `mcp.operations[op].requirePermission`. Admins bypass (matching the UI).
- **Rate limiting**: 120 requests / minute per registered client in production (600 / min in dev), keyed by `clientId` with IP fallback; 429 + `Retry-After: 60` on excess.
- **Audit log**: every call writes one row to `mcp_audit_log` with `(client_id, user_id, tool_name, config_id, action, ok, error_code, duration_ms, params_hash)`. Parameter values are never persisted — only a sha256 of the JSON input.

### Adding a CRUDTable to the MCP surface

Add an `mcp` block on the existing `CRUDTableConfig`. That's it — no new routes, no new handler, no code duplication:

```typescript
export const thingsConfig: CRUDTableConfig = {
  id: 'things',
  // …columns / fields / services as usual…
  mcp: {
    name: 'things',
    description: 'Things managed by the AS500 Thing registry.',
    operations: {
      list: true,
      read: true,
      create: true,
      update: true,
      delete: { requirePermission: PERMISSIONS.THINGS_DELETE },
    },
    // Any caller-supplied context the services need
    scope: [
      { name: 'ownerId', type: 'number', required: true, description: 'Owner user id' },
    ],
  },
};
```

See `server/src/configs/timeRegV2.ts` for a working reference and `.claude/skills/crudtable/SKILL.md` § *Step 5 (optional) — Expose the config over MCP* for the full recipe.

### Configuration

| Variable | Purpose | Default |
|---|---|---|
| `AS500_MCP_JWT_SECRET` | HS256 signing key for access tokens (≥32 chars). **Required in production.** `docker-compose.yml` already pins a dev value so tokens survive `docker-compose restart`. | random (plain `npm run dev`) |
| `MCP_PORT`             | Port the MCP Express app binds. Published as `3002:3002` by `docker-compose.yml`. | `3002` |
| `MCP_ENABLED`          | Set to `false` to skip booting the MCP server alongside the WebSocket server. | `true` |

### Smoke test

Walks the full DCR → consent → token → `tools/list` → `tools/call` → refresh path and spot-checks the audit log:

```bash
cd server
npx tsc && node scripts/smoke-mcp.mjs
```

Expects Postgres up (`docker-compose up -d postgres`) and the seed already run (`KALLE` / `password` is the test account).

### Connecting from Claude Code

Claude Code (2026+) speaks MCP natively and drives the full OAuth 2.1 + DCR dance for you — you never paste a token by hand.

**1. Start the server.** `docker-compose up` boots Postgres, the WebSocket server, the MCP server, **and** the Caddy TLS sidecar in one shot. No extra step. Confirm everything is up:

```bash
curl http://localhost:3002/mcp/health
# => {"ok":true,"auth":"oauth2.1","phase":3}
```

> **Prerequisites (one-time, on the host):** Caddy terminates TLS at `https://localhost:3443` and proxies to `server:3002`, because Claude Code Desktop requires HTTPS for remote MCP servers. Before the first run you must generate a locally-trusted certificate:
> ```powershell
> winget install FiloSottile.mkcert   # skip if already installed
> mkcert -install                      # trust the local CA
> mkcert -cert-file certs/local.pem -key-file certs/local-key.pem localhost 127.0.0.1
> ```

(Using `npm run dev` in `server/` directly also works — MCP still boots in-process unless `MCP_ENABLED=false`. You'll need a separate HTTPS proxy if your MCP client requires TLS.)

**2. Register the server with Claude Code.** From the project root:

```bash
# Local dev (via Caddy TLS sidecar)
claude mcp add --transport http as500 https://localhost:3443/mcp

# Production deployment
claude mcp add --transport http as500 https://adv.entence.se/mcp
```

The first time you invoke an `as500` tool (or run `/mcp` in Claude Code), Claude Code will:

1. Hit `/.well-known/oauth-protected-resource/mcp` to discover the authorization server.
2. Dynamically register itself as an OAuth client via `POST /register` (RFC 7591).
3. Open `https://localhost:3443/authorize?...` in your browser — the green-on-black AS500 consent page.
4. Prompt you for your AS500 username + password and click **Approve**.
5. Exchange the resulting code for an access + refresh token pair (stored in Claude Code's OS keychain).
6. Auto-refresh access tokens every hour; you won't see a login prompt again for 30 days unless you revoke.

**3. Verify.** In a Claude Code session:

```
> /mcp
# Lists connected servers. You should see `as500 — connected (N tools)`.

> Use the as500 tools to list my time entries for today.
# Claude picks `timereg_v2.list`, passes { userId: <your id>, date: <today> },
# and shows the rows in its reply.
```

**4. Per-project scoping (optional).** If you only want `as500` available inside this repo, commit a project-level `.mcp.json` at the repo root instead:

```json
{
  "mcpServers": {
    "as500": {
      "type": "http",
      "url": "https://localhost:3443/mcp"
    }
  }
}
```

Claude Code picks it up automatically when you open the project and prompts for approval once.

**5. Managing the connection:**

```bash
claude mcp list                       # All registered servers
claude mcp get as500                   # Details + auth status
claude mcp remove as500                # Disconnect + revoke local tokens
```

To revoke **server-side** (e.g. a laptop is lost), an admin can nuke the client + its tokens in Postgres:

```sql
-- Revoke a single client's access + refresh tokens
UPDATE auth_tokens SET revoked_at = NOW()
  WHERE client_id = 'CLIENT_ID_FROM_oauth_clients' AND revoked_at IS NULL;

-- Or delete the client entirely (cascades consents)
DELETE FROM oauth_clients WHERE id = 'CLIENT_ID';
```

**What the agent can do** is governed entirely by your existing RBAC. The agent inherits the AS500 user's permissions at consent time — no extra grant dialog per tool, no privilege widening. Every call it makes lands in `mcp_audit_log` with the client id + user id + tool + outcome.

> **Security note:** in production, set `AS500_MCP_JWT_SECRET` to a fixed ≥32-char value and put `/mcp` behind your TLS termination. The dev default regenerates the JWT secret on each server restart, which would invalidate every agent's access token.

## REST API

Any CRUDTable config with an `api` block is also available as a conventional REST API on port 3002. Same Bearer tokens, same RBAC, same audit log as MCP — just plain HTTP instead of JSON-RPC.

### Endpoints

| Method | URL | Purpose |
|--------|-----|---------|
| `GET`    | `/api`                    | Discovery — list all exposed resources |
| `GET`    | `/api/:configId`          | List records (`?offset=&limit=`, max 100) |
| `GET`    | `/api/:configId/:id`      | Read one record |
| `POST`   | `/api/:configId`          | Create |
| `PUT`    | `/api/:configId/:id`      | Update |
| `DELETE` | `/api/:configId/:id`      | Delete (204, no body) |

Scope params with `injectFromAuth: 'userId'` are injected server-side from the token — callers never send them. All other scope params go in the **query string**; the body contains only the resource's own fields.

### Getting a Bearer token — first-party login

If you own both the client app and the AS500 backend, skip the OAuth redirect dance. Use the credential-exchange endpoints:

**1. Login — exchange credentials for tokens**
```bash
curl -X POST http://localhost:3002/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{ "username": "FREDRIC", "password": "fredric" }'
```
```json
{
  "access_token": "<JWT>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "<opaque-30d>"
}
```

**2. Call the API**
```bash
curl http://localhost:3002/api/timereg_v2?date=2026-04-23 \
  -H "Authorization: Bearer <access_token>"
```

**3. Refresh after 1 hour (tokens rotate — old pair is revoked)**
```bash
curl -X POST http://localhost:3002/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{ "refresh_token": "<opaque>" }'
```

**4. Logout**
```bash
curl -X POST http://localhost:3002/api/auth/revoke \
  -H "Content-Type: application/json" \
  -d '{ "token": "<refresh_token>", "token_type_hint": "refresh_token" }'
```

> **Third-party / AI agent?** Use the full OAuth 2.1 + DCR flow described in the Remote MCP Server section above. Both flows produce identical JWTs accepted on every `/api/*` call.

### Error format

```json
{ "error": { "code": "validation_failed", "message": "…", "fields": [{ "name": "f", "message": "…" }] } }
```

HTTP status codes: 400 validation, 401 unauthenticated, 403 permission denied, 404 not found, 405 operation not enabled, 429 rate limited, 500 internal.

### Exposing a CRUDTable config on the REST API

Add an `api` block to the `CRUDTableConfig` — no other changes needed:

```typescript
api: {
  name: 'timereg',
  description: 'Time registration entries.',
  operations: { list: true, read: true, create: true, update: true, delete: true },
  scope: [
    { name: 'userId', type: 'number', required: true, injectFromAuth: 'userId' },
    { name: 'date',   type: 'string', required: true, description: 'YYYY-MM-DD' },
  ],
}
```

See `server/src/configs/timeRegV2.ts` for a working example.

## Authentication & Security

AS500 implements a modern, secure authentication system aligned with 2026 industry standards:

### Token-Based Authentication

**Dual-Token Pattern** (inspired by OAuth 2.0):
- **Access Token** - Short-lived (1 hour), used for active authentication
- **Refresh Token** - Long-lived (30 days), used to reissue access tokens
- **Token Rotation** - Both tokens are rotated when refresh token is used (prevents replay attacks)

**User Experience:**
- Login once, stay authenticated for 30 days
- Access tokens automatically refresh in the background
- No password re-entry needed unless refresh token expires
- Seamless session restoration on browser restart

### Security Features

**Implemented (Phase 1):**
- ✅ **bcrypt password hashing** - Industry-standard password security
- ✅ **Token rotation** - Access and refresh tokens both rotate on use
- ✅ **Device tracking** - Each token pair linked to device fingerprint
- ✅ **Rate limiting** - Protection against brute force (5 login attempts/min, 10 token refreshes/hour)
- ✅ **Secure cookies** - `SameSite=Strict`, `Secure` flag for HTTPS
- ✅ **Token revocation** - Sign out, sign out all devices, or revoke specific device
- ✅ **Audit trail** - `last_used_at` tracking for all tokens
- ✅ **Auto-cleanup** - Expired and revoked tokens automatically purged

**Database Schema:**
```sql
auth_tokens (
  access_token, refresh_token,         -- Dual tokens
  access_expires_at, refresh_expires_at, -- Separate expiry
  device_id, device_name, user_agent,  -- Device tracking
  ip_address,                          -- Security context
  last_used_at, revoked_at             -- Audit trail
)
```

### Session Management

**Triple-Layer Approach:**
1. **WebSocket Session** (15 min) - Active connection state
2. **Session Cookie** (7 days) - Session ID persistence
3. **Auth Tokens** (1h + 30d) - Authentication credentials

**Flow:**
```
User logs in
  └─> Server issues: Session ID + Access Token + Refresh Token
      ├─> Client stores in cookies (auto-sent with requests)
      └─> Session expires (15 min inactivity)
          ├─> Access token still valid? → Auto-restore session
          └─> Access token expired?
              ├─> Refresh token valid? → Rotate tokens + restore session
              └─> Refresh token expired? → Require login
```

**Benefits:**
- Users stay logged in for 30 days without re-entering password
- Short access token window (1h) limits exposure if compromised
- Token rotation detects theft (old tokens invalidated)
- Device tracking enables "where you're signed in" feature

### Rate Limiting

In-memory rate limiting protects against abuse:
- **Login**: 5 attempts per minute per session
- **Token Refresh**: 10 per hour per user
- **General Requests**: 100 per minute per user

### Future Enhancements (Roadmap)

**Phase 2 - Scalability:**
- [ ] Migrate sessions to Redis for horizontal scaling
- [ ] Add comprehensive audit logging (`auth_events` table)
- [ ] Build admin security dashboard

**Phase 3 - User Experience:**
- [ ] "Active Sessions" screen - view/revoke devices
- [ ] Email notifications for new device logins
- [ ] Geolocation-based security alerts
- [ ] "Remember this device for 90 days" option

## Development Features

### Session & Token Persistence

**Development Mode** (`NODE_ENV !== 'production'`):
- **Sessions** persisted to disk (`server/data/sessions.json`)
- **Tokens** stored in PostgreSQL with full audit trail
- Sessions survive server restarts during development
- Automatic restoration of valid sessions on server start
- 15-minute session timeout still applies

**Production Mode**:
- Sessions remain in-memory only (no file persistence)
- Tokens stored in PostgreSQL (production-ready)
- Token-based auto-login keeps users authenticated for 30 days

**Authentication Testing:**
```bash
# Login once, then test persistence:
1. Login with FREDRIC / fredric
2. Close browser
3. Reopen → Should auto-login via refresh token
4. Wait 1 hour → Access token expires → Should auto-refresh
5. Restart server → Session + tokens restored
```

**Check Cookies** (Browser DevTools → Application → Cookies):
- `as500_session` - Session ID (7 days)
- `as500_access_token` - Short-lived auth (1 hour)
- `as500_refresh_token` - Long-lived auth (30 days)
- `as500_device_id` - Device fingerprint (1 year)

### Hot Reload

Both server and client support hot reload:
- **Server**: Uses `tsx watch` - automatically restarts on file changes
- **Client**: Uses Vite HMR - instant updates in the browser
- **Docker**: Volume mounts ensure code changes are reflected immediately

### Database Tools

```bash
# Access PostgreSQL in Docker
docker-compose exec postgres psql -U as500 -d as500

# Check auth tokens
SELECT user_id, device_name, last_used_at, 
       access_expires_at > NOW() as access_valid,
       refresh_expires_at > NOW() as refresh_valid
FROM auth_tokens 
WHERE revoked_at IS NULL;

# Revoke all tokens for a user (force logout)
UPDATE auth_tokens SET revoked_at = NOW() WHERE user_id = 1;
```

## Documentation

See [CLAUDE.MD](CLAUDE.MD) for detailed documentation including:
- Protocol specification
- Adding new screens
- Session management
- Troubleshooting

See [ACCESS.md](ACCESS.md) for the access control reference including:
- Roles and default permissions
- Groups and user-level overrides
- Adding permission keys
- CRUDTable `requirePermission` integration

See [BACKUP.md](BACKUP.md) for backup system documentation including:
- Automated backup configuration
- Manual backup creation
- Restoring from backups
- Backup management

See [CLAUDE.md § Remote MCP Server](CLAUDE.md#remote-mcp-server) for MCP server internals:
- OAuth 2.1 + DCR wire-up and the `oauth/` module layout
- `auth_tokens` column reuse for MCP-kind tokens
- `mcp_audit_log` schema and retention considerations
- How to expose a new CRUDTable config as MCP tools

See [CLAUDE.md § REST API](CLAUDE.md#rest-api) for the REST API reference:
- Endpoint table and error format
- First-party login flow (`POST /api/auth/token`)
- How to expose a CRUDTable config on the REST surface (`api` block)
- Scope params and `injectFromAuth`


