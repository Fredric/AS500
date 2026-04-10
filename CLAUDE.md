# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AS500** emulates a classic AS/400 green-screen mainframe experience as a modern web app. It's a time-tracking system built on a strict **dumb terminal architecture**: the server owns all logic and renders every screen; the client is purely presentational.

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

Uses JWT-style **access tokens + refresh tokens** stored in the DB (`auth_tokens` table). Access tokens expire in 1 hour; refresh tokens in 30 days. Token refresh is rate-limited (`server/src/utils/rateLimiter.ts`). The server validates `accessToken` on every WebSocket connection.

### Session Management

Sessions are in-memory (Map) and persisted to `server/data/sessions.json` in development (survives hot-reload). Sessions timeout after 15 minutes. Navigation state is stored in `session.screenStack` (array) and `session.currentScreen`.

---

## Screen System

### Two Approaches

**1. CRUDTable (preferred for list + form CRUD)**  
Write a config object (~50-80 lines). The runtime auto-generates list and form screens with pagination, F6=Create, keyboard row navigation, F3/F12 navigation.

**2. Manual Screen (for login, menus, help, custom flows)**  
Write DSL definition + `buildScreen()` + `handleScreen()` + register in `server/src/index.ts`.

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

// Go back (F12)
session.currentScreen = session.screenStack.pop() || 'MAIN_MENU';
```

---

## Adding a CRUDTable Screen

**Step 1** – Create service: `server/src/services/myService.ts` with `getAll`, `create`, `update`, `delete` functions using the `db` instance from `../db/index.js`. Add any new tables to `server/src/db/schema.ts` first.

**Step 2** – Create config: `server/src/configs/myConfig.ts` implementing `CRUDTableConfig` (see `timeRegV2.ts` as reference).

**Step 3** – Register: add `registerConfig(myConfig)` in `server/src/configs/index.ts`.

**Step 4** – Navigate: set `session.currentScreen = 'CRUD_{ID_UPPERCASE}'` from any screen handler.

No changes to `server/src/index.ts` needed.

---

## Key Files

| Purpose | Path |
|---------|------|
| WebSocket router (entry point) | `server/src/index.ts` |
| CRUDTable runtime engine | `server/src/crudtable/runtime.ts` |
| CRUDTable type definitions | `server/src/crudtable/types.ts` |
| DSL renderer (80×24 grid) | `server/src/dsl/renderer.ts` |
| DSL public API | `server/src/dsl/index.ts` |
| Session management | `server/src/session/index.ts` |
| Auth service (tokens) | `server/src/services/auth.ts` |
| DB pool + Drizzle instance | `server/src/db/index.ts` |
| Drizzle table definitions (schema) | `server/src/db/schema.ts` |
| Rate limiter utility | `server/src/utils/rateLimiter.ts` |
| Terminal hook (WebSocket) | `client/src/hooks/useTerminal.ts` |
| Terminal renderer | `client/src/components/Terminal.tsx` |
| Terminal styles | `client/src/styles/terminal.css` |
| Client types | `client/src/types/index.ts` |
| Test setup utilities | `tests/testSetup.ts` |

### Screens

`server/src/screens/`: `login`, `mainMenu`, `timeReg`, `timeEntry`, `timeRegHelp`, `userMgmt`, `userEdit`

### CRUDTable Configs

`server/src/configs/`: `timeRegV2` (time registration entries)

---

## Database Layer

The project uses **Drizzle ORM** as a typed query layer on top of a raw `pg` connection pool.

### How it works

- **`server/src/db/schema.ts`** — single source of truth for all table definitions (`users`, `days`, `day_items`, `auth_tokens`). Add new tables here.
- **`server/src/db/index.ts`** — exports both `pool` (raw pg) and `db` (Drizzle instance). Services should use `db`.
- **Migrations** — managed by **drizzle-kit**. Migration files live in `server/src/db/migrations/` and are applied automatically at server startup via `migrate()` in `db/index.ts`. Run `npm run db:generate` after editing `schema.ts` to create a new migration file.

### Writing a new service

```typescript
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { myTable } from '../db/schema.js';

// Select
const rows = await db.select().from(myTable).where(eq(myTable.id, id));

// Insert with returning
const inserted = await db.insert(myTable).values({ ... }).returning();

// Update
await db.update(myTable).set({ field: value }).where(eq(myTable.id, id));

// Delete
await db.delete(myTable).where(eq(myTable.id, id));
```

### Adding a new table

1. Define it in `server/src/db/schema.ts` using `pgTable`
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
