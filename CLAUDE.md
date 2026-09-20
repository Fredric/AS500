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
docker-compose up                                 # Start all services
docker-compose exec server npm run seed           # Seed database
docker-compose exec server npm run seed:office    # Build a demo virtual office

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

**Ports**: PostgreSQL `5433`, Server WebSocket `ws://localhost:3001`, MCP/REST `http://localhost:3002`, Ingest monitor `http://localhost:3005`, Virtual office `http://localhost:3006`, Client `http://localhost:5173`  
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

## Ingest Monitor (admin dashboard)

A standalone admin page at **`http://localhost:5173/ingestmonitor`** that shows every moving part of the document-ingestion / RAG stack on one screen: what is running, what is failing, what is in the queue, and how far along the current document is.

It is deliberately **separate from the terminal app** — its own HTML entry point, its own React tree, its own WebSocket server and its own port. Deleting `server/src/monitor/` and `client/src/monitor/` removes it completely.

### What it shows

| Panel | Content |
|---|---|
| Ingestion pipeline | Animated flow: My Documents → docs API → job queue → worker → DOCLING (vLLM) → chunker → Ollama embed → pgvector → `knowledge_*`. Each node is coloured by the health of the service performing that hop; a dead service breaks the chain visibly. |
| Queue | Counts by job state, `document_items.ingest_status` histogram, chunk/page/image/table totals, 1h and 24h throughput, average duration. |
| In flight / Failures / Recent jobs | Per-job stage track with one segment per pipeline stage, live counts (pages, chunks, vectors), elapsed time, lock owner and the full error text on failure. |
| Service cards | as500-docs API + worker, vLLM, Ollama, as500-agent, AS500 server, Postgres, Docker Engine. Each shows health, latency, key facts, container state/uptime/restarts, and the **command to run when it is down**. |
| Local GPU | Resident models and VRAM. Real telemetry via `nvidia-smi` when the server runs on the GPU host; otherwise inferred from Ollama `/api/ps` and vLLM `/v1/models` (labelled as inferred). |
| Log console | Live tail of every container plus the as500-agent host log file, with per-source error/warning badges, level filter, text filter and follow mode. |
| Documents | Every `document_items` row with its folder breadcrumb, ingest status, embedded/total chunk ratio and artefact counts. Filterable, with a **Problems** filter for documents that claim to be `ready` but are missing chunks, vectors or a summary. Click a row to inspect it. |

### Document inspector

The queue panels answer *"did ingestion run?"*. Clicking any document row — or **Inspect** on a job card — opens a full-screen overlay that answers *"is the result any good?"*. This is the only place in AS500 where ingested content is visible; the terminal's My Documents screen shows file metadata only.

| Tab | Content |
|---|---|
| Summary | The generated `ai_summary`, plus `storage_path`, `content_hash`, embedding dimensions and total chunk text length. |
| Chunks | Every chunk with its full text, `node_path`, `section_title`, page range, char count and embedding state. A chunk with no vector is flagged red — it can never be retrieved. One-click copy. |
| Pages | The per-page markdown Docling emitted, as raw text. Shown unrendered on purpose: when tuning extraction you need what was stored, not a prettified view of it. |
| Images | The extracted PNGs, actually rendered, with caption, page and linked chunk. |
| Tables | Extracted table markdown. |
| Search | Runs a query through the **real** as500-docs hybrid search as the document's owner, showing per-hit `score` / `vec_score` / `kw_score` and marking which hits belong to this document. |
| Jobs | Full ingestion job history with attempts, duration, lock owner, error text and the stored Python traceback. |

The stored `error` is often useless on its own: Docling wraps every pipeline exception as `RuntimeError("Pipeline VlmPipeline failed")` and the worker persists only `str(exc)`. The `document_ingestion_jobs.traceback` column keeps the full `__cause__` chain, so the Jobs tab shows it behind a collapsible **root cause** line — Python prints causes before the exception that wrapped them, so the first exception line in the traceback is the deepest and most specific one.

Warnings are computed per document and shown above the tabs — missing embeddings, mixed embedding dimensions (the model changed between runs), empty chunk text, `ready` with zero chunks, no summary, unreadable images.

The search tab surfaces one specific trap: if every hit scores `kw 0.000`, retrieval was **vector-only**. as500-docs builds its keyword half with `plainto_tsquery`, which ANDs every query term, so a single word absent from the chunk text silences BM25 entirely. The inspector detects this (`SearchOutcome.keywordDead`) and says so rather than letting you read the zeros as a scoring quirk. Note also that hits arrive in *reranker* order while `score` is the *pre-rerank* hybrid score, so the list can legitimately look mis-sorted.

While a document is ingesting, the browser list and any open inspector re-read themselves whenever the snapshot's artefact totals change, so chunks appear as they land.

### Architecture

```
Browser /ingestmonitor  ──WS ws://localhost:3005/ws──►  server/src/monitor/
                                                          ├── probes.ts    HTTP health checks
                                                          ├── db.ts        read-only queue queries (own 3-conn pool)
                                                          ├── documents.ts read-only artefact inspection + search probe
                                                          ├── docker.ts    Docker Engine API over /var/run/docker.sock
                                                          ├── logs.ts      continuous log tailing + level parsing
                                                          └── pipeline.ts  stage derivation
```

The monitor runs on **its own port (3005)**, not on 3001. The terminal's `WebSocketServer` is created without a `path` filter, so it claims every upgrade request on 3001 — a second WS path there would break both. This mirrors how the MCP server runs on 3002.

The server pushes a **full snapshot** every poll interval (default 2.5 s, adjustable from the page) rather than diffs, so the page cannot drift out of sync. Log lines stream separately, only for the source the console is showing.

### Endpoints (port 3005)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness |
| `GET` | `/api/snapshot` | The exact payload the WebSocket pushes — handy for `curl` |
| `GET` | `/api/logs/:source` | Buffered lines for one log source |
| `GET` | `/api/documents` | Document browser rows (counts + status per document) |
| `GET` | `/api/documents/:id` | Full inspection payload: chunks, pages, images, tables, jobs, warnings |
| `GET` | `/api/image/:id` | One `document_images` PNG, confined to the mounted storage root |
| `GET` | `/api/original/:id` | The original uploaded file, confined to `MONITOR_UPLOAD_ROOT` |
| `WS` | `/ws` | Live snapshots + log streaming + `LIST_DOCUMENTS` / `OPEN_DOCUMENT` / `SEARCH` |

Helper scripts:

| Command | Purpose |
|---|---|
| `node server/scripts/monitor-snapshot.mjs` | Condensed snapshot as text |
| `node server/scripts/monitor-ws-check.mjs` | Smoke-tests snapshots + log streaming |
| `node server/scripts/monitor-inspect-check.mjs [itemId] [query]` | Smoke-tests `LIST_DOCUMENTS` → `OPEN_DOCUMENT` → `SEARCH` |
| `node server/scripts/inspect-document.mjs <id\|name> [--full] [--pages] [--search "q"]` | Same inspection straight from the CLI, no browser |

### Stage derivation

as500-docs only persists four job states (`queued` / `processing` / `completed` / `failed`), so finer progress is reconstructed from two signals:

1. **Database side effects** — `document_pages` rows appear once Docling has converted the file; `document_chunks` rows appear only after embeddings exist (the column is `NOT NULL`); `ai_summary` lands last.
2. **Worker structlog output** — each stage names itself (`Running Docling…`, `Building chunks`, `Generating embeddings`, …).

Whichever signal is further along wins, so fast stages that leave no database trace still light up. Log lines carry Docker's real timestamps, so replayed history can never be mistaken for current activity — this is also why a log error only downgrades a component's health for two minutes.

### Configuration

All optional; the defaults match the dev stack.

| Variable | Default | Purpose |
|---|---|---|
| `MONITOR_ENABLED` | `true` | Set `false` to skip booting it |
| `MONITOR_PORT` | `3005` | HTTP + WebSocket port |
| `MONITOR_TOKEN` | *(unset)* | When set, required as `?token=…` on `/ws` and `/api/*` |
| `MONITOR_POLL_MS` | `2500` | Default snapshot interval |
| `MONITOR_LOG_LINES` | `600` | Ring-buffer size per log source |
| `MONITOR_DOCKER_SOCKET` | `/var/run/docker.sock` | Engine API socket |
| `MONITOR_AGENT_LOG` | `/host/as500-agent/agent_err.log` | as500-agent host log file |
| `MONITOR_DOCS_STORAGE` | `/host/docs-storage` | Mounted as500-docs `storage/` tree, for previewing extracted images |
| `MONITOR_UPLOAD_ROOT` | `/app/data/documents` | Where original uploads live; served files are confined to this root |

Probe targets reuse the existing vars: `DOCS_API_URL`, `OLLAMA_BASE_URL`, `EMBEDDING_MODEL`, `VLM_API_URL`, `VLM_MODEL`, `AI_AGENT_BASE_URL`, `AI_AGENT_API_KEY`, `LOCK_TIMEOUT_SECONDS`.

**Security:** the dashboard exposes raw service logs **and the full text of every ingested document, for every user, with no per-user authorisation**. It therefore **refuses to start when `NODE_ENV=production` unless `MONITOR_TOKEN` is set**, port 3005 is bound to `127.0.0.1` in `docker-compose.yml`, and it is not published at all in `docker-compose.prod.yml`. File-serving routes resolve every path and reject anything that escapes its configured root, so a malformed database row cannot turn the monitor into an arbitrary-file reader.

### Docker requirements

`docker-compose.yml` gives the server container three extra mounts. All are optional — the dashboard degrades gracefully and tells you what to add if they are missing.

```yaml
- /var/run/docker.sock:/var/run/docker.sock:ro   # container status + log streaming
- ../as500-agent:/host/as500-agent:ro            # as500-agent host stderr log
- ../as500-docs/storage:/host/docs-storage:ro    # extracted page images for the inspector
```

Adding or changing a mount needs `docker compose up -d server` (a plain `restart` will not apply it).

Server-side code changes need `docker compose restart server` — `tsx watch` does not receive filesystem events through Windows Docker volumes.

---

## Virtual Office (spatial projection)

A **fourth projection surface** for AS500, alongside the terminal, MCP and REST.
The same `CRUDTableConfig` that renders as an 80×24 list and as MCP tools also
becomes an object in a room: a drawer bound to `documents` **is** that folder, a
rack bound to `docs-api` **is** that service.

Runs on its own port (**3006**) with its own Vite entry point, the
same arrangement as the ingest monitor. Deleting `server/src/world/` and
`client/src/world/` removes the feature completely.

**The world is now the app's front door.** `client/index.html` loads
`client/src/world/main.tsx` (`/office` stays as an alias). There is no
standalone terminal page any more — the green-screen `Terminal` component is
mounted *inside* the world (`client/src/world/App.tsx`) in two roles:

- **Login gate** — full-screen `Terminal` at `LOGIN` until authenticated;
  once the terminal reports `authenticated` (via its new `onStatus` prop) the
  gate hides and the world socket (`useWorldSocket(space, authed)`) connects.
- **Workstation modal** — clicking a `{ kind: 'workstation' }` object
  (`App.select()`) shows the same `Terminal` as an overlay with a close strip.
  Esc minimises it *only* at `MAIN_MENU`/`LOGIN`; on deeper screens Esc falls
  through as F3. Signing off (F3 at the main menu) clears the token and drops
  back to the login gate.

The `Terminal` is mounted once and never unmounted (a stable tree across the
auth transition) so its WebSocket session survives being hidden/reshown.
`client/src/styles/terminal.css` is imported before `world.css` so the office's
own light theme wins on shared base rules.

### The binding — the one idea everything rests on

An object stores a **binding**, never a copy of the data:

```typescript
type ThingBinding =
  | { kind: 'crud';   configId: string; scope?: Record<string, unknown> }
  | { kind: 'record'; configId: string; recordId: string | number }
  | { kind: 'workstation' }
  | { kind: 'service'; serviceKey: string }   // reuses monitor/probes.ts
  | { kind: 'agent';  userId: number }
  | { kind: 'none' };                          // owns its own payload
```

**The world server never queries app tables.** `resolver.ts` resolves
`binding.configId` through `getConfig()` and calls the config's own
`services.list.params(ctx)` — the identical path the terminal, MCP and REST
take. Therefore:

- No copied data, no drift, one source of truth.
- **RBAC is not reimplemented.** `config.requirePermission` and
  `ServiceCall.requirePermission` already gate every object.
- Every CRUDTableConfig registered in future is immediately placeable, with no
  world-side work.
- `userId` is injected from the *viewer*, never read from the binding, so a
  binding can never widen access.

A refused object is returned **visible but closed** (`access: 'denied'`), never
omitted — otherwise the room's furniture would change depending on who is
looking, which leaks the object's existence.

### Two hierarchies that must never be merged

| Tree | Column | Changed by |
|---|---|---|
| **Furniture** — desk ▸ drawer ▸ tray | `world_things.parent_thing_id` | people arranging the office |
| **Data** — folder ▸ subfolder ▸ file | `document_folders.parent_id` | people using the system |

A binding is a **mount point**, exactly like a Unix mount. Navigating deeper
into folders moves through the *data* tree while you stand still in the
*furniture* tree. This is visible from the keyboard: pressing Esc inside an
opened drawer climbs out of the data tree first, and only then returns to the room.

### Furnishing the office (terminal)

```
MAIN MENU → Virtual Office → Spaces
  F6                create a space
  Enter (opt 2)     edit it, then T = its objects
  F6                place an object
  Enter on a row    bound object  → opens the config it names, scoped
                    container     → descends into its contents, in place
  Esc               back up the furniture tree, then out
```

Or skip the typing: **`cd server && npm run seed:office`** builds a demo room
(desk, workstation, shelf, rack, and a drawer bound to a folder the user already
owns). `--user KALLE --space my_office --reset` to vary it. It goes through
`worldService`, so the objects are validated exactly as the terminal validates
them.

The binding is **three always-visible fields**, never conditionally shown:

| Field | Meaning |
|---|---|
| `Binds to` | `none` · `crud` · `record` · `service` · `workstation` · `agent` |
| `Target` | config id (crud/record) · service key (service) · user id (agent) |
| `Scope` | `folderId=42` for crud · the record id for record · else blank |

> **Do not put `form.visible` on a field whose expression reads another field's
> current value.** The terminal only re-evaluates visibility on a server round
> trip, so a field revealed by what the user is typing can never appear — the
> first version of this form hid `Config Id` behind `bindingKind === 'crud'` and
> was impossible to complete. `Target` is deliberately overloaded across kinds
> instead, the way AS/400 qualifier fields have always worked.

Both Office Layout screens are ordinary CRUDTable configs, so they also carry
`mcp` and `api` blocks: **an agent can rearrange the office**, audited like
everything else.

### Bookshelves — browsing My Documents folders as furniture

`type: 'bookshelf'` is a distinct furniture type (not the generic `'shelf'`,
which stays a plain label — see `seedOffice.ts`'s unrelated `motorcycles`-bound
"Garage Shelf") that must bind to `documents` (`BOOKSHELF_CONFIG_ID` in
`world/types.ts`) — enforced on every write path via
`validateShelfBinding()`. Its books are one per direct subfolder, **derived
live** on every resolve (`documentsShelf.ts`), never stored as separate
`world_things` — the same "no copied data" rule as everything else here.

Books render as clickable spines directly on the floorplan shape (capped, with
an overflow tab), and the side panel always lists the complete set as a
fallback. Clicking a book opens a modal (`DocumentsBrowserModal.tsx`) that can
descend to arbitrary depth via a client-side breadcrumb stack — the server is
only ever asked for folder ids the client already saw, never to go "up" past
the book it was opened from. New WS pair: `BROWSE_DOCUMENTS_FOLDER` →
`DOCUMENTS_FOLDER`.

The office's own visual language is a plain, ordinary light UI
(`client/src/world/world.css`) — not the terminal's green phosphor theme,
which stays confined to `client/src/styles/terminal.css`.

### Notes — objects that own their own text (Phase 2)

`type: 'postit'`/`'board'` are the roadmap's second Thing class: instead of
binding to existing data, they own it. They still bind `kind: 'none'` — a
note's scope is its own thing id, which doesn't exist yet at placement time,
so no ordinary binding fits — and `validateNoteBinding()` enforces that on
every write path exactly like `validateShelfBinding()` does for bookshelves.

The payload is still a real, registered `CRUDTableConfig` (`world_notes`,
`configs/notesConfig.ts`), scoped by `thingId` the same way `documentsConfig`
is scoped by `folderId` — **not** a special-cased table only the resolver
knows about, so RBAC/MCP/REST all work unchanged. `resolver.ts` resolves it
through the identical config-registry path every other binding uses
(`notes.ts`, parallel to `documentsShelf.ts`), keyed by `thing.id` rather than
a stored scope. A never-written note resolves `access: 'ok', note: null` — an
empty post-it is a normal state, not an error.

The floorplan's own textarea (not CRUDTable-driven — the floorplan has no
form renderer) writes through one new WS message, `SET_NOTE`, replying with
the existing `THING_CHANGED` message. It audits itself
(`source: 'world'`, a new `AuditSource` variant) so the existing
`onAuditEvent()` → dirty-room → rebuild pipeline broadcasts the change to
every other viewer with no bespoke fan-out code. The terminal's own form
(reached the same way a bookshelf's books aren't — via `openUI` on the
`postit`/`board` row) stays the short, single-line version; the graphical
panel's textarea is the ceiling, same split the bookshelf modal makes for
depth the green screen can't show. Because a note already exists after
seeding/placement, `world_notes`'s `create` operation deliberately calls the
same upsert-by-`thingId` function `update` does — a strict insert there would
hit the `thing_id` unique constraint the first time a user presses F6 on a
postit that isn't blank.

### Live service health + agent presence (Phase 3)

**Service racks.** `{ kind: 'service' }` bindings resolved *identity* only
through Phase 2 — `serviceStatus.ts` said probing per object/per resolve/per
client was too heavy, and that the fix was subscribing to the ingest
monitor's own snapshot rather than probing again. That subscription is
`server/src/monitor/index.ts`'s `getLastSnapshot()`/`onSnapshot()`, mirroring
`core/audit/writer.ts`'s `onAuditEvent` pub/sub exactly. One wrinkle: the
monitor's own polling is normally **lazy** — it only runs while a dashboard
WebSocket client is connected, so nobody pays for probes when no one is
watching (`server/src/monitor/index.ts`'s `clients.size` gate). A subscriber
wants live data for as long as it's subscribed regardless of whether the
dashboard happens to be open, so `onSnapshot()` starts polling immediately
and `stopIfIdle()` only stops it once *both* the dashboard clients and the
in-process subscribers are gone — the world subscribing at boot keeps
component health flowing for its whole lifetime, dashboard or not. No
snapshot yet (`MONITOR_ENABLED=false`, or the world booted before the first
poll) degrades to exactly the old identity-only response, since the two
`_ENABLED` flags are independent.

**Agents as occupants.** `{ kind: 'agent' }` bindings resolved to `access:
'ok'` and nothing else through Phase 2 — the agent never actually appeared
in the room. `agentPresence.ts` derives an avatar purely from the audit
feed, with **no new connection type**: `presence.ts`'s `byConnection` map is
keyed by an opaque `symbol`, not a real WebSocket, so a synthetic per-agent
symbol behaves exactly like a real connection's, and the existing tick loop
already rebroadcasts every occupied space's presence list every 250ms
regardless of why it changed — nothing needs to actively push an update.
Every audit event is checked for `client_id === AI_AGENT_CLIENT_ID`
(`core/mcp/mintSessionToken.ts` — the same constant every agent-driven MCP
call already carries) before `findAgentThings(userId)`
(`worldService.ts`) looks up where to seat it; a local last-activity map is
swept from `world/index.ts`'s existing `tick()` using the same
`PRESENCE_TIMEOUT_MS` real connections already expire on — one new line, not
a second timer.

Verified against a real MCP tool call made with a JWT minted the identical
way `chatService.ts` mints one for a live agent turn — not a simulated audit
row — confirming the whole path from a genuine `as500-ai` tool call through
to an amber avatar in the room, and its disappearance after the timeout.

### First-person 3D (Phase 4)

`client/src/world/three/` is a second renderer for the *same* state
`Floorplan.tsx` already consumes (`scene`, `actors`, `opened`, `browse`) —
zero changes to the server, the WS protocol, or `resolver.ts`, per the
roadmap's own framing of Phase 4 as a renderer swap. A topbar toggle in
`App.tsx` (`view: '2d' | '3d'`) switches which one renders; **2D stays the
default** for now — zero regression risk to the working view.

**No protocol change was needed for movement.** `Presence.pose` was already
`{x, y, rot}`; 3D reinterprets the same ground-plane pair as `(x, z)` with
`y` as height computed client-side and never sent, and reuses `rot` as yaw
directly. `layout.ts`'s `layoutThings()`/`FOOTPRINT` are reused verbatim for
both 3D placement and collision boxes — `PlayerController.tsx` does simple
per-axis AABB sliding collision, sub-stepped (`MAX_STEP`) so a frame hitch
can never let a single step tunnel through a thin object.

**Assets are primitives for now** (boxes, `MeshStandardMaterial`, no GLTF
pipeline) — `heights.ts`'s `MODEL_FOR_TYPE` lookup returns `null` for every
type today, read but unused, so a future model swap touches one table, not
`ThingMesh.tsx`'s structure.

**Interaction**: `InteractionHUD.tsx` raycasts forward from camera center
each frame (not the mouse pointer, which is locked/hidden) and E triggers
the *same* `onSelect`/`onOpenBook` callbacks `Floorplan.tsx`'s click handler
already uses — a new input trigger for an existing interaction, not a new
one. One real bug worth remembering if this file is touched again: a
thing's `<lineSegments>` edge overlay is a *child* of the tagged `<mesh>`
and is very often the nearer of the two raycast hits, but isn't itself
tagged — the hit-resolution loop must fall back to `object.parent.userData`,
not just `object.userData`, or every raycast against an edge silently
misses.

**Pointer lock lifecycle**: opening `ThingPanel`/`DocumentsBrowserModal`
must release pointer lock so normal DOM interaction works, and re-acquire on
close — `Scene3D.tsx`'s `overlayOpen` prop (`Boolean(selected) ||
Boolean(openBook)` in `App.tsx`) is the only place the two render trees need
to know about each other's state, for this one reason.

Verified against the real server: walking into a bound object shows "Press
E", E opens the identical `ThingPanel` the 2D view opens, and pointer lock
correctly releases for it — confirmed with a temporary REST-placed object at
a known position (pointer lock itself cannot be driven from an automated
headless browser; mouselook needs a manual check in a real tab).

### Doors between spaces (Phase 5)

`type: 'door'` is bound `{ kind: 'door', spaceKey, spaceId, spaceName }` to
another `world_spaces` row, and walking into it (2D click, 3D "Press E", or
Enter in the terminal) moves you there via `enterSpace()` — which already
existed and needed **no changes at all**: `ENTER_SPACE` already resets the
avatar to the same default entry pose every space entry uses.

**The one binding kind that caches a DB lookup.** Every other kind resolves
its target through `getConfig()` — synchronous, in-memory — so the
terminal's `openUI.mapContext` (`thingsConfig.ts`), which is itself
synchronous (`OpenUIMapResult`, not a `Promise`, per
`core/crudtable/types.ts`), can navigate in one step. A door's target is a
**space**, which only exists in Postgres. Fix: `composeBinding`
(`worldService.ts`) is `async` for the `door` case only, resolves the target
once at write time via the existing `getSpaceByKey()`, and caches its
immutable numeric `id` (plus `name`, for display) on the binding — catching
a typo'd target space **immediately at create time** as a proper
`McpToolError('validation_failed', …)`, not a bare 500 (the only case where
this distinction actually matters: every other kind's Target check already
runs as a synchronous field validator before the service is ever called,
so their equivalent thrown-`Error` fallback is normally unreachable — a
door's space-existence check is the *only* enforcement point, since it
can't be a field validator). The graphical surfaces (`resolver.ts`) always
re-resolve `spaceKey` live, never the cached `id`, so a later-renamed target
space degrades to `access: 'error'`, same as any other dangling binding.

**Esc from inside a doored-into room** — `onListBack` (`thingsConfig.ts`)
already climbed the furniture tree (`parentThingId`) one level at a time; a
`spaceStack` in `ctx.input`, pushed alongside the spaceId swap in
`openUI.mapContext`, extends the exact same nesting one level higher: pop
the furniture tree first, and only once it's exhausted, pop one space level
instead of leaving the screen.

### Spatial model

The server owns **containment** (`parent_thing_id`, `slot`, `zone`), not
physics. Avatar poses are relayed between clients but never validated and never
persisted — no tick loop, no collision, no reconciliation. `transform` is a
renderer *hint*; objects without one are auto-placed by `zone`, so placing
furniture is a one-field operation.

### Live updates

`writeAuditEvent()` already fires on every mutation from every surface, so
`onAuditEvent()` (added alongside its two writes) gives the world a complete
change feed for free. Occupied rooms are marked dirty and rebuilt on the next
presence tick — filing a document in the green screen updates the drawer in
everyone's browser.

### Endpoints (port 3006)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness |
| `GET` | `/api/spaces` | Every space, for a picker |
| `GET` | `/api/space/:key` | The resolved scene — curl-testable |
| `WS` | `/ws` | `ENTER_SPACE` / `MOVE` / `OPEN_THING` → `SCENE` / `PRESENCE` / `THING_OPENED` |

Auth is the terminal's own access token (`?token=` or `Bearer`) — no new
credential, no new session type.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `WORLD_ENABLED` | `true` | `false` skips booting it and hides the menu entry |
| `WORLD_PORT` | `3006` | HTTP + WebSocket port |
| `WORLD_PRESENCE_MS` | `250` | Presence broadcast / dirty-scene tick |
| `WORLD_PRESENCE_TIMEOUT_MS` | `30000` | Drop an actor whose socket went quiet |

### Key files

| Purpose | Path |
|---|---|
| **Binding resolver** | `server/src/world/resolver.ts` |
| World runtime (:3006) | `server/src/world/index.ts` |
| World types (incl. `ThingBinding`) | `server/src/world/types.ts` |
| Spatial tables | `server/src/world/db/schema.ts` |
| Placement service | `server/src/world/services/worldService.ts` |
| Office Layout configs | `server/src/world/configs/` |
| Registration (configs + menu) | `server/src/world/bootstrap.ts` |
| Demo room seeder (`npm run seed:office`) | `server/src/world/seedOffice.ts` |
| Bookshelf books + browse | `server/src/world/documentsShelf.ts` |
| Note payload service + config | `server/src/world/services/notesService.ts`, `configs/notesConfig.ts` |
| Note resolution (`resolver.ts` support) | `server/src/world/notes.ts` |
| Agent presence from the audit feed | `server/src/world/agentPresence.ts` |
| Live service health subscription | `server/src/monitor/index.ts` (`getLastSnapshot`/`onSnapshot`), `server/src/world/serviceStatus.ts` |
| 2D floorplan client | `client/src/world/`, `client/office.html` |
| First-person 3D client | `client/src/world/three/` |
| File-explorer modal | `client/src/world/components/DocumentsBrowserModal.tsx` |
| Audit change feed | `server/src/core/audit/writer.ts` (`onAuditEvent`) |

### Verification

```bash
node server/scripts/world-loop-check.mjs   # terminal + HTTP + WS, one binding
npx playwright test tests/world-office.spec.ts
```

`world-loop-check.mjs` drives the real terminal WebSocket and asserts that the
green screen, `curl :3006`, and the resolved scene all agree on one binding. If
they ever disagree, the model is wrong — that script is what says so.

> 3D is a later phase: it swaps `client/src/world/`'s renderer against this same
> protocol. The 2D floorplan then stays on as the world's debug tool, the way the
> ingest monitor is for the RAG stack.

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
- `tests/world-office.spec.ts` – Virtual office floorplan: a bound object resolves to real records, and is refused for another user

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
