# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AS500** emulates a classic AS/400 green-screen mainframe experience as a modern web app. It's a time-tracking system built on a strict **dumb terminal architecture**: the server owns all logic and renders every screen; the client is purely presentational.

> **Access control:** See [ACCESS.md](ACCESS.md) for the full RBAC reference — roles, groups, permission keys, CRUDTable integration, and how to add new permissions.

---

## Commands

Run from the **project root** unless noted:

```bash
# Development (Docker recommended)
docker-compose up                          # Start all services
docker-compose exec server npm run seed    # Seed database

# Testing (Playwright E2E)
npm test                                   # All tests, headless
npm run test:ui                            # Interactive UI
npm run test:headed                        # Watch browser
npm test -- --grep "test name"             # Single test

# Type checking (both server + client)
npm run typecheck

# Build (both server + client)
npm run build

# Inside server/ only
npm run dev         # tsx watch (hot reload)
npm run backup-db   # pg_dump backup
npm run restore-db <file>   # Restore from SQL dump
```

**Ports**: PostgreSQL `5433`, Server WebSocket `ws://localhost:3001`, Client `http://localhost:5173`  
**Default login**: `FREDRIC` / `fredric`

---

## Architecture

### Dumb Terminal Pattern

```
Client (React)  ←──WebSocket JSON──→  Server (Node.js)  ←──→  PostgreSQL
  - Display rows[]                     - All business logic
  - Capture keys                       - Screen rendering (80×24)
  - Send field values                  - Session + auth
```

The server sends `rows: string[]` (24 rows × 80 chars) and `fields: Field[]` (input overlays). The client renders them literally. No client-side validation, routing, or business logic.

### WebSocket Protocol

**Client → Server:**
```typescript
{ sessionId, screenId, cursor, input: { fieldName: "value" }, key: "ENTER"|"F3"|"F12"|... }
```

**Server → Client:**
```typescript
{ sessionId, screenId, cursor, rows: string[], fields: Field[], fieldValues?, message, messageType, statusLine, bell, navigation? }
```

Special keys: `CONNECT` (initial connection), `RESUME` (restore session from cookie).

The `navigation` field is optional and only sent by CRUDTable list screens:
```typescript
navigation: {
  type: 'list',
  list: {
    dataStartRow: number,    // Row index where data rows begin (rows[] is 0-indexed)
    dataRowCount: number,    // Visible data rows on this page
    totalRecords: number,
    pageOffset: number,
    hasMore: boolean,
    hasPrev: boolean,
    optFieldPrefix: string,  // 'opt' → fields named opt_0, opt_1, ...
    primaryAction: string,   // Option value for Enter key ('2'=edit, '9'=open, ''=none)
    shortcuts: [{ key, option, label }],
  }
}
```

The client uses `navigation` to drive row selection UI. When present, arrow keys and shortcut keys fill the relevant `opt_N` field and send ENTER — backward compatible with servers/screens that don't send navigation.

### Authentication

Uses JWT-style **access tokens + refresh tokens** stored in the DB (`auth_tokens` table). Access tokens expire in 1 hour; refresh tokens in 30 days. Token refresh is rate-limited (`server/src/core/utils/rateLimiter.ts`). The server validates `accessToken` on every WebSocket connection.

**Access control (RBAC):** Roles (`user`, `superuser`, `aiagent`, `admin`), groups, and named permission keys. Permissions are resolved at login and cached on the session as a `Set<string>`. See **[ACCESS.md](ACCESS.md)** for the full reference.

### Session Management

Sessions are in-memory (Map) and persisted to `server/data/sessions.json` in development (survives hot-reload). Sessions timeout after 15 minutes. Navigation state is stored in `session.screenStack` (array) and `session.currentScreen`.

---

## Screen System

### Three Approaches

**1. CRUDTable (preferred for list + form CRUD)**  
Write a config object (~50-80 lines). The runtime auto-generates list and form screens with pagination, F6=Create, keyboard row navigation, F3/F12 navigation.

**2. Menu (for all menu screens — main menu, submenus)**  
App menu items are registered via `registerMenuItems()` in `server/src/app/menus/appMenu.ts`. Core admin nodes live in `server/src/core/menus/menuTree.ts`. The generic runtime in `server/src/core/menus/menuRuntime.ts` assembles everything at runtime and builds every menu screen. **Do not hand-roll menu screens.**

**3. Manual Screen (for login, help, wizards, fully custom flows)**  
Write DSL definition + `buildScreen()` + `handleScreen()`. Only `login.ts` and the menu delegator `mainMenu.ts` live in `server/src/core/screens/` today.

### Keyboard Navigation (CRUDTable list screens)

CRUDTable list screens automatically support keyboard and mouse row navigation:

| Input | Action |
|-------|--------|
| `ArrowDown` | Move focus to next row (auto-advances page at bottom) |
| `ArrowUp` | Move focus to previous row (auto-goes back at top) |
| `Enter` | Trigger primary action on focused row (Edit or Open) |
| `d` | Delete focused row (if delete service configured) |
| `Tab` / `Shift+Tab` | Move between data rows |
| Mouse click | Select row |
| Mouse double-click | Select row + trigger primary action |

The focused row is highlighted (inverted green/black). The status line shows `Enter=Edit  D=Delete  F3=Exit  F6=Create  F12=Cancel`.

Custom shortcuts can be added via the `navigation` config:
```typescript
navigation: {
  primaryAction: 'open',  // 'edit' (default) or 'open'
  shortcuts: [
    { key: 'r', option: '5', label: 'Reset' },
  ],
},
```

### F-Key Conventions

| Key | Purpose |
|-----|---------|
| F3 | Exit (main menu / sign off) |
| F6 | Create new record |
| F7/F8 | Previous/Next page or day |
| F12 | Cancel (go back via screenStack) |

### Navigation Stack Pattern

```typescript
// Navigate forward
session.screenStack.push('CURRENT_SCREEN');
session.currentScreen = 'NEXT_SCREEN';

// Go back (F12 / Esc)
session.currentScreen = session.screenStack.pop() || 'MAIN_MENU';
```

For menu → submenu / menu → CRUDTable transitions, the menu runtime handles the stack push for you — see the Menu System section below.

---

## Menu System

All menus (main menu, admin submenus, any future grouped navigation) are driven by a registry + one generic runtime. **Do not write custom menu screens.**

### Key files

| Purpose | Path |
|---------|------|
| **App menu items** (add items here) | `server/src/app/menus/appMenu.ts` |
| Menu registry (assembles final tree at runtime) | `server/src/core/menus/menuRegistry.ts` |
| Core admin + logoff nodes | `server/src/core/menus/menuTree.ts` |
| Generic build/handle for all menu screens | `server/src/core/menus/menuRuntime.ts` |
| Thin delegator for the main menu entry point | `server/src/core/screens/mainMenu.ts` |

### How it works

- The menu tree is assembled dynamically at request time by `buildMenuTree()` in `menuRegistry.ts`. It combines app-registered items (added via `registerMenuItems()`) with the core admin node and log-off action.
- `server/src/core/menus/menuTree.ts` exports only `adminMenuNode` (the Administration submenu) and `logOffNode`. App developers never edit this file.
- App developers call `registerMenuItems([...])` in `server/src/app/menus/appMenu.ts` to add items to the main menu.
- Each item is one of three node types:
  - `MenuNode` — a nested submenu (renders a new screen, selecting navigates into it)
  - `CrudNode` — links a menu entry directly to a registered `CRUDTableConfig` (by `configId`)
  - `ActionNode` — a built-in action (currently only `action: 'log_off'`)
- `menuRuntime.ts` handles **every** menu screen generically: permission-filters items, renders a numbered list, pushes onto `session.screenStack`, and navigates on Enter. F3/F12/Esc always pop back to the parent.
- Screen IDs: the root menu is `MAIN_MENU`; every nested menu is `MENU_{KEY_UPPERCASE}` (derived via `menuScreenId(key)` from `menuTree.ts`).
- Access control: `requirePermission` on any node hides it for users who lack the permission — enforced before render, so invisible items are never selectable.
- CRUDTable context seeding: if a `CrudNode` declares `initContext(session)`, the runtime calls it **before** handing control to the CRUD runtime.

### Shape of app menu registration

```typescript
// server/src/app/menus/appMenu.ts
import { registerMenuItems } from '../../core/menus/menuRegistry.js';
import { PERMISSIONS } from '../../core/services/access.js';
import { initTimeRegV2Context } from '../configs/timeRegV2.js';

registerMenuItems([
  {
    type: 'crudtable',
    key: 'time_reg',
    name: 'Time Registration',
    requirePermission: PERMISSIONS.TIME_REG_READ,
    configId: 'timereg_v2',            // must match a registered CRUDTableConfig.id
    initContext: initTimeRegV2Context, // optional — seeds session.context before navigation
  },
  {
    type: 'menu',
    key: 'my_garage',
    name: 'My Garage',
    items: [ /* nested nodes — renders screen MENU_MY_GARAGE */ ],
  },
]);
```

### Adding a menu entry

To expose a new CRUD screen or submenu, **call `registerMenuItems([...])` in `server/src/app/menus/appMenu.ts`**. No other file changes are needed — `menuRuntime.ts` picks it up automatically and the router in `server/src/index.ts` already dispatches every `MENU_*` screen to the runtime.

---

## Adding a CRUDTable Screen

**Step 1** – Create service: `server/src/app/services/myService.ts` with `getAll`, `create`, `update`, `delete` functions using the `db` instance from `../../core/db/index.js`. Add any new app tables to `server/src/app/db/schema.ts` first.

**Step 2** – Create config: `server/src/app/configs/myConfig.ts` implementing `CRUDTableConfig` (see `timeRegV2.ts` as reference).

**Step 3** – Register: add `registerConfig(myConfig)` in `server/src/app/index.ts`.

**Step 4** – Expose in the menu: call `registerMenuItems([...])` in `server/src/app/menus/appMenu.ts`. Pass `initContext` if the config needs caller context seeded into `session.context` before the list renders.

```typescript
// server/src/app/menus/appMenu.ts
registerMenuItems([
  // ...existing items...
  {
    type: 'crudtable',
    key: 'my_thing',
    name: 'My Thing',
    requirePermission: PERMISSIONS.MY_THING_READ,
    configId: 'my_thing',              // matches CRUDTableConfig.id
    initContext: initMyThingContext,   // optional
  },
]);
```

No changes to `server/src/index.ts`, `server/src/core/screens/mainMenu.ts`, or any core file needed. The menu runtime will render the entry, enforce permissions, push the stack, call `initContext`, and dispatch to `CRUD_{ID_UPPERCASE}`.

> **Full reference:** See `.claude/skills/crudtable/SKILL.md` for the complete recipe (copy-pastable service + config skeleton, patterns table, anti-patterns, verification checklist). Background docs: `DOCS/CRUDTABLE/5. CRUDTable Concept.md` (mental model) and `DOCS/CRUDTABLE/6. CRUDTable Reference.md` (field-by-field reference).

---

## Local HTTPS for MCP (Claude Code Desktop)

Claude Code Desktop requires HTTPS when consuming a remote MCP server. In local dev the MCP runs on plain HTTP (`http://localhost:3002`), so a Caddy sidecar terminates TLS at `https://localhost:3443` and proxies through.

**One-time setup (Windows host):**

```powershell
# 1. Install mkcert (skip if already installed)
winget install FiloSottile.mkcert

# 2. Install the local CA into the Windows trust store
mkcert -install

# 3. Generate certs (from the repo root)
mkcert -cert-file certs/local.pem -key-file certs/local-key.pem localhost 127.0.0.1
```

**Then start normally:**

```bash
docker-compose up
```

The `caddy-dev` service starts automatically and exposes `https://localhost:3443`.  
Configure Claude Code Desktop's MCP server URL as `https://localhost:3443/mcp`.

The cert files (`certs/*.pem`) are gitignored. The `certs/` directory is tracked via `.gitkeep`.

---

## Remote MCP Server

Any CRUDTable config can be exposed to remote AI agents as a set of MCP tools by adding an `mcp` block. The runtime at `server/src/core/mcp/` auto-generates one tool per enabled operation (`<id>.list`, `<id>.read`, `<id>.create`, `<id>.update`, `<id>.delete`), with a zod input schema derived from the same field configs as the terminal UI, and enforces the same AS500 RBAC.

**Transport**: Streamable HTTP on a dedicated port (default 3002). Endpoints:
- `POST /mcp` — the MCP endpoint (requires Bearer auth, rate-limited)
- `GET /mcp/health` — liveness
- `GET /.well-known/oauth-authorization-server` + `/.well-known/oauth-protected-resource/mcp` — discovery
- `POST /register` — Dynamic Client Registration (RFC 7591)
- `GET /authorize` + `POST /authorize/consent` — green-on-black consent page, dedicated `mcpLogin` (separate from AS500 session auth)
- `POST /token`, `POST /revoke` — OAuth 2.1 token lifecycle

**Auth posture**: OAuth 2.1 + PKCE + DCR. Access tokens are short-lived HS256 JWTs (1 h) with revocation via the `auth_tokens` table (`kind='mcp_access'`, keyed by `jti`). Refresh tokens (30 d) are opaque and rotated on every refresh grant. The JWT secret is `AS500_MCP_JWT_SECRET` (>=32 chars; dev auto-generates a warning-logged random secret).

**Audit**: every tool call — success, validation failure, permission_denied, internal error — writes one row to `mcp_audit_log` with `(client_id, user_id, tool_name, config_id, action, ok, error_code, duration_ms, params_hash)`. Parameter values are never logged; only a sha256 of the JSON input.

**Adding a CRUD config to the MCP surface**: add an `mcp: { name, description, operations, scope? }` block on the `CRUDTableConfig`. No code changes anywhere else. See `server/src/app/configs/timeRegV2.ts` for a working example and `.claude/skills/crudtable/SKILL.md` § "Step 5 (optional) — Expose the config over MCP" for the full recipe.

**Smoke test**: `cd server && npx tsc && node scripts/smoke-mcp.mjs` walks DCR → consent → token → tools/list → tools/call → refresh and spot-checks the audit log.

---

## REST API

Any CRUDTable config can be exposed as standard REST endpoints by adding an `api` block alongside (or instead of) the `mcp` block. The runtime at `server/src/core/api/` mounts routes on the MCP Express app at `/api/{config.id}[/{id}]` (port 3002).

**Two ways to get a Bearer token:**

| Scenario | Endpoint | Notes |
|---|---|---|
| **First-party app** (you own the client) | `POST /api/auth/token` | Submit username + password directly — no browser redirect needed |
| **Third-party / AI agent** (OAuth 2.1 flow) | `POST /register` → `GET /authorize` → `POST /token` | Full DCR + PKCE consent flow — user approves in the browser |

Both paths produce identical HS256 JWTs accepted by `Authorization: Bearer` on every `/api/*` call.

**Transport**: Routes mounted at `/api/…` on the MCP Express app (port 3002).

| Method | URL | Operation |
|--------|-----|-----------|
| `GET`  | `/api` | Discovery — list all exposed configs + enabled ops |
| `GET`  | `/api/:configId` | List (paginated via `?offset=&limit=`, max 100) |
| `GET`  | `/api/:configId/:id` | Read single record |
| `POST` | `/api/:configId` | Create |
| `PUT`  | `/api/:configId/:id` | Update |
| `DELETE` | `/api/:configId/:id` | Delete (204 no body) |

**Auth**: Same OAuth 2.1 Bearer token flow as MCP. Pass `Authorization: Bearer <token>` on every request.

**Scope params**: Configured on `api.scope`. Params with `injectFromAuth: 'userId'` are NEVER accepted from callers — injected server-side from the token. Other scope params are resolved from the **query string** for all HTTP methods (not the body). The body contains only the resource's own writable fields.

**Error response format**:
```json
{ "error": { "code": "validation_failed", "message": "…", "fields": [{ "name": "f", "message": "…" }] } }
```
HTTP status codes: 400 validation, 401 unauthenticated, 403 permission denied, 404 not found, 405 op not enabled, 429 rate limited, 500 internal.

**Adding a CRUDTable config to the REST API surface**: add an `api` block on the `CRUDTableConfig`:

```typescript
api: {
  name: 'timereg',         // display name (discovery only); URL path is always config.id
  description: '...',
  operations: { list: true, read: true, create: true, update: true, delete: true },
  scope: [
    {
      name: 'userId', type: 'number', required: true,
      description: 'Injected from token.', injectFromAuth: 'userId',
    },
    {
      name: 'date', type: 'string', required: true,
      description: 'Workday YYYY-MM-DD — pass as ?date=…',
    },
  ],
}
```

No code changes anywhere else. The registry validates the block at startup. See `server/src/app/configs/timeRegV2.ts` for the canonical example.

**Audit**: every API call writes a row to `mcp_audit_log` with `source='api'` (same table as MCP, distinguishable by the `source` column). The audit admin screen shows both MCP and REST calls.

**Key files**:
| Purpose | Path |
|---------|------|
| REST router (Express, mounted at `/api`) | `server/src/core/api/index.ts` |
| Per-op REST handlers | `server/src/core/api/handlers.ts` |
| First-party auth router | `server/src/core/api/auth.ts` |

### First-party login (for apps you own and control)

If you own both the client app and the AS500 backend, skip the OAuth redirect dance entirely. Use the credential-exchange endpoints at `/api/auth` to get Bearer tokens directly.

**Login:**
```http
POST http://localhost:3002/api/auth/token
Content-Type: application/json

{ "username": "FREDRIC", "password": "fredric" }
```
```json
{ "access_token": "<JWT>", "token_type": "Bearer", "expires_in": 3600, "refresh_token": "<opaque>" }
```

**Use the token on every REST call:**
```http
GET http://localhost:3002/api/timereg_v2?date=2026-04-23
Authorization: Bearer <access_token>
```

**Refresh before/after the 1-hour expiry:**
```http
POST http://localhost:3002/api/auth/refresh
Content-Type: application/json

{ "refresh_token": "<opaque>" }
```
Returns a new `access_token` + new `refresh_token`. The old pair is immediately revoked (rotation).

**Logout:**
```http
POST http://localhost:3002/api/auth/revoke
Content-Type: application/json

{ "token": "<refresh_token_or_access_token>", "token_type_hint": "refresh_token" }
```
Always returns `{ "ok": true }`. Omit `token_type_hint` to try both types. Pass `"access_token"` or `"refresh_token"` as a hint.

Tokens issued this way carry sentinel `client_id = 'as500-direct'` and are otherwise identical to OAuth-issued tokens — same JWT format, same RBAC enforcement on every REST call, same audit logging.

---

## AI Agent Integration

AS500 ships an in-terminal AI chat panel backed by a local Python AI agent (`as500-agent` repo). The user opens the panel with the star button (✦) in the top-right corner; the server streams responses token-by-token over the existing WebSocket.

### Architecture

```
Browser (React)
  ⇅  WebSocket  (AI_CHAT_SEND / AI_CHAT_DELTA / AI_CHAT_DONE / AI_CHAT_ERROR)
AS500 Node server  (:3001)
  ⇅  OpenAI-compatible HTTP + SSE  (:8010)
as500-agent FastAPI server  (Python, local GPU machine)
  ├── ⇅  vLLM  (:8000)  — local LLM inference
  └── ⇅  AS500 MCP server  (:3002)  — tool calls run under the real user's RBAC
```

The agent is a black box from AS500's perspective: AS500 only calls two endpoints — `GET /v1/models` and `POST /v1/chat/completions` — on the agent over the internal network. The agent handles LLM inference, MCP tool dispatch, and context management.

### Required environment variables (`server/.env.local`)

| Variable | Required | Description |
|---|---|---|
| `AI_AGENT_BASE_URL` | yes | Base URL of the agent HTTP API, e.g. `http://host.docker.internal:8010/v1` (Docker) or `http://127.0.0.1:8010/v1` (local) |
| `AI_AGENT_API_KEY` | yes | Shared secret; agent rejects requests without it. Must match `AGENT_API_KEY` in the `as500-agent` `.env`. Min 32 chars. |
| `AI_AGENT_MODEL` | no | Model id to pass in `POST /v1/chat/completions`. Defaults to `as500-agent`. |

If `AI_AGENT_BASE_URL` or `AI_AGENT_API_KEY` are unset the agent client throws at startup. The chat panel still renders but every message returns an error.

### WebSocket protocol (AI chat messages)

**Browser → Server:**

```typescript
// Sent when the user submits a message
{
  sessionId: string,
  screenId: string,
  cursor: { row: 0, col: 0 },
  key: 'AI_CHAT_SEND',
  input: {
    chatId: string,   // stable UUID per browser session (sessionStorage)
    message: string,  // user's text
  }
}
```

**Server → Browser (streamed):**

```typescript
{ type: 'AI_CHAT_DELTA'; delta: string; chatId: string; sessionId: string }
{ type: 'AI_CHAT_DONE';  chatId: string; sessionId: string }
{ type: 'AI_CHAT_ERROR'; error: string; chatId?: string; sessionId: string }
```

`AI_CHAT_*` messages are routed by `useTerminal` to the registered `useAiChat` handler and never treated as screen updates. The terminal state is untouched during a chat turn.

### MCP token delegation (trusted-subsystem pattern)

The agent needs a valid MCP Bearer token to call AS500 tools on behalf of the user. AS500 mints one per request using `mintMcpAccessTokenForUser(userId, username)` in `server/src/core/mcp/mintSessionToken.ts`. The token:

- Is a standard HS256 JWT, identical to tokens issued by `POST /api/auth/token`
- Uses `client_id: 'as500-ai'` — distinguishable in `mcp_audit_log`
- Expires in 1 hour; revocable via `jti` in `auth_tokens`
- Is passed to the agent in `metadata.mcpAccessToken` on every `POST /v1/chat/completions` call
- Is **never** stored in the session, returned to the browser, or written to disk by the agent

The agent opens a per-request MCP session with this token as a static Bearer. No OAuth browser flow, no DCR, no token caching on the agent side.

Security invariant: `mintMcpAccessTokenForUser` is only called after asserting `session.authenticated === true` and `session.viserId != null`.

### Chat history persistence

Each conversation is stored in two Postgres tables (auto-migrated at server startup):

```sql
ai_chats    (id text PK, user_id int, created_at)
ai_messages (id serial PK, chat_id text, role text, content text, created_at)
```

The `chatId` is a UUID generated in the browser (`sessionStorage`) and passed with every `AI_CHAT_SEND`. History is loaded and appended in `chatService.ts` before and after every turn.

### Key files

| Purpose | Path |
|---|---|
| Agent HTTP client (OpenAI-compatible) | `server/src/core/ai/agentClient.ts` |
| Chat service (history + streaming orchestration) | `server/src/core/ai/chatService.ts` |
| MCP token mint helper | `server/src/core/mcp/mintSessionToken.ts` |
| WebSocket bridge (`AI_CHAT_SEND` handler) | `server/src/index.ts` |
| React chat hook | `client/src/hooks/useAiChat.ts` |
| Chat panel component | `client/src/components/AiChatPanel.tsx` |
| AI chat types (WebSocket events + messages) | `client/src/types/aiChat.ts` |
| Chat panel styles | `client/src/styles/ai-chat.css` |

### Setting up the agent side

The Python agent lives in the separate `as500-agent` repo. See its `README.md` for full setup. Summary:

1. Install Python dependencies and the agent CLI (`pip install -e .` inside `agent/`)
2. Copy `.env.example` → `.env` and set at minimum `AGENT_API_KEY` (≥32 chars, must match `AI_AGENT_API_KEY` in AS500), `LOCAL_LLM_MODEL`, and `AS500_MCP_BASE_URL`
3. Start the vLLM server: `.\scripts\start-vllm.ps1`
4. Start the agent HTTP server: `as500-agent serve` (binds on `:8010`)
5. Verify connectivity: `GET http://localhost:8010/health` should return `{ "status": "ok" }`

**Docker note:** when AS500 runs in Docker and the agent runs on the host, use `http://host.docker.internal:8010/v1` as `AI_AGENT_BASE_URL`.

### Disabling the chat panel

The toggle button and `AiChatPanel` only render when the user is authenticated (`connected && sessionId && screenId !== 'LOGIN'`). There is no server-side feature flag — to disable, unset `AI_AGENT_BASE_URL` (the button still renders but sends will return errors) or remove the `useAiChat` / `AiChatPanel` wiring in `Terminal.tsx`.

---

## Key Files

### Core infrastructure (`server/src/core/`) — never edited by app developers

| Purpose | Path |
|---------|------|
| WebSocket router (entry point) | `server/src/index.ts` |
| Core bootstrap (registers system configs) | `server/src/core/bootstrap.ts` |
| **App menu items** (add items here for app CRUD screens) | `server/src/app/menus/appMenu.ts` |
| **Menu registry** (assembles full tree at runtime) | `server/src/core/menus/menuRegistry.ts` |
| **Core menu nodes** (admin subtree + logoff only) | `server/src/core/menus/menuTree.ts` |
| **Menu runtime (generic build/handle)** | `server/src/core/menus/menuRuntime.ts` |
| CRUDTable runtime engine | `server/src/core/crudtable/runtime.ts` |
| CRUDTable type definitions | `server/src/core/crudtable/types.ts` |
| DSL renderer (80×24 grid) | `server/src/core/dsl/renderer.ts` |
| DSL public API | `server/src/core/dsl/index.ts` |
| Session management | `server/src/core/session/index.ts` |
| Auth service (tokens) | `server/src/core/services/auth.ts` |
| **RBAC access service** | `server/src/core/services/access.ts` — see [ACCESS.md](ACCESS.md) |
| DB pool + Drizzle instance | `server/src/core/db/index.ts` |
| System table definitions (schema) | `server/src/core/db/schema.ts` |
| Rate limiter utility | `server/src/core/utils/rateLimiter.ts` |
| **MCP Express app (OAuth + /mcp)** | `server/src/core/mcp/index.ts` |
| **MCP tool handlers (per-op)** | `server/src/core/mcp/toolHandlers.ts` |
| **MCP OAuth provider** | `server/src/core/mcp/oauth/provider.ts` |
| **MCP audit log writer** | `server/src/core/mcp/audit.ts` |
| **REST API router** | `server/src/core/api/index.ts` |
| **REST API handlers** | `server/src/core/api/handlers.ts` |
| **First-party auth router** | `server/src/core/api/auth.ts` |
| Terminal hook (WebSocket) | `client/src/hooks/useTerminal.ts` |
| Terminal renderer | `client/src/components/Terminal.tsx` |
| Terminal styles | `client/src/styles/terminal.css` |
| Client types | `client/src/types/index.ts` |
| **AI chat hook** | `client/src/hooks/useAiChat.ts` |
| **AI chat panel component** | `client/src/components/AiChatPanel.tsx` |
| **AI chat WebSocket event types** | `client/src/types/aiChat.ts` |
| **AI chat panel styles** | `client/src/styles/ai-chat.css` |
| **Agent HTTP client** | `server/src/core/ai/agentClient.ts` |
| **Chat service (history + streaming)** | `server/src/core/ai/chatService.ts` |
| **MCP token mint helper** | `server/src/core/mcp/mintSessionToken.ts` |
| Test setup utilities | `tests/testSetup.ts` |

### App layer (`server/src/app/`) — where application developers work

| Purpose | Path |
|---------|------|
| App self-registration entry point | `server/src/app/index.ts` |
| **App table definitions** (add app tables here) | `server/src/app/db/schema.ts` |
| **App menu items** | `server/src/app/menus/appMenu.ts` |
| App CRUDTable configs | `server/src/app/configs/` (`timeRegV2`, `motorcyclesConfig`, `modsConfig`, `servicesPerformedConfig`) |
| App services | `server/src/app/services/` (`timeReg`, `timeRegCrud`, `motorcycleService`, `modsService`, etc.) |

### Screens

`server/src/core/screens/`: `login`, `mainMenu` (thin delegator to the menu runtime). All other former hand-written screens (time-reg, user management, etc.) are now CRUDTable configs; all app menus are registered via `appMenu.ts`.

### CRUDTable Configs

**Core configs** (`server/src/core/configs/`): `userMgmtConfig`, `roleDefaultsConfig`, `authTokensConfig`, `oauthClientsConfig`, `mcpAuditConfig`. Registered in `server/src/core/bootstrap.ts`.

**App configs** (`server/src/app/configs/`): `timeRegV2`, `motorcyclesConfig`, `modsConfig`, `servicesPerformedConfig`. Register new configs in `server/src/app/index.ts` and expose them via `server/src/app/menus/appMenu.ts`.

---

## Database Layer

The project uses **Drizzle ORM** as a typed query layer on top of a raw `pg` connection pool.

### How it works

The schema is split into two files by layer:

- **`server/src/core/db/schema.ts`** — system tables (`users`, `auth_tokens`, `groups`, `oauth_clients`, `mcp_audit_log`, etc.). Owned by core; app developers do not edit this.
- **`server/src/app/db/schema.ts`** — application tables (`days`, `day_items`, `motorcycles`, `mods`, `services_performed`). Add new app tables here.
- **`server/src/core/db/index.ts`** — merges both schemas into a single Drizzle instance and exports `db` and `pool`. Services should use `db`.
- **Migrations** — managed by **drizzle-kit**. Migration files live in `server/src/core/db/migrations/` and are applied automatically at server startup via `migrate()` in `core/db/index.ts`. Run `npm run db:generate` after editing either schema file to create a new migration file.

### Writing a new app service

```typescript
import { eq } from 'drizzle-orm';
import { db } from '../../core/db/index.js';  // core db — always this path from app/services/
import { myTable } from '../db/schema.js';     // app schema

// Select
const rows = await db.select().from(myTable).where(eq(myTable.id, id));

// Insert with returning
const inserted = await db.insert(myTable).values({ ... }).returning();

// Update
await db.update(myTable).set({ field: value }).where(eq(myTable.id, id));

// Delete
await db.delete(myTable).where(eq(myTable.id, id));
```

### Adding a new app table

1. Define it in `server/src/app/db/schema.ts` using `pgTable`
2. Run `npm run db:generate` inside `server/` to generate a migration file
3. The migration is applied automatically on next server start (or run `npm run db:migrate` explicitly)
4. Import the table object in your service file

---

## Testing

Tests are Playwright E2E. They use `setupTestData()` / `teardownTestData()` from `tests/testSetup.ts` for isolated DB state (creates TASK-101 through TASK-115). Tests connect to PostgreSQL at `localhost:5433`.

Run serially (`--workers=1`) for database consistency.

Test files:
- `tests/scrollable-subfile.spec.ts` – Subfile pagination
- `tests/time-registration-crud.spec.ts` – Add/edit/delete (uses opt-field workflow, option 6)
- `tests/keyboard-navigation.spec.ts` – Arrow key nav, Enter, shortcut keys, mouse click (option 7, CRUDTable)

---

## Naming Conventions

- **Screen IDs**: `UPPER_CASE_SNAKE` (e.g., `MAIN_MENU`, `TIME_REG`)
- **CRUDTable screen IDs**: `CRUD_{CONFIG_ID_UPPERCASE}` auto-derived from config `id`
- **Screen constants**: `MY_SCREEN_SCREEN = defineScreen('MY_SCREEN', ...)`
- **Handlers**: `handleLogin()`, builders: `buildLoginScreen()`
- **ES module imports**: use `.js` extension (e.g., `import { x } from './module.js'`)

---

## Production

Deployed on a **Hetzner VPS** at `https://adv.entence.se`.

**Stack**: Caddy (HTTPS + reverse proxy) → Docker `as500-app` (Node.js, port 3001) → Docker `as500-postgres`

- Config: `docker-compose.prod.yml`, `Dockerfile.prod`
- In production, the server serves the compiled React SPA as static files
- `DATABASE_URL` env var is used (falls back to `PG*` vars for local dev)
- Caddy config at `/etc/caddy/Caddyfile` on the VPS; auto-renews TLS via Let's Encrypt

**Deploy a code update** (run on VPS at `/var/www/AS500`):
```bash
git pull
docker compose -f docker-compose.prod.yml build app
docker compose -f docker-compose.prod.yml up -d app
```

See `Prod_hetzner.md` for full operational runbook (logs, backup, restore, troubleshooting).
