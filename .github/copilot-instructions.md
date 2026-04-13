# GitHub Copilot Instructions for AS500

## Build and test commands

Run commands from the repository root unless noted otherwise.

```bash
# Recommended local environment
docker-compose up
docker-compose exec server npm run seed

# Type checking
npm run typecheck

# Production builds
npm run build

# Playwright E2E
npm test
npm test -- tests/time-registration-crud.spec.ts
npm test -- --grep "should add a new time entry"
npm run test:headed
npm run test:ui
```

Useful details from the existing setup:

- Local Playwright runs use `playwright.config.ts`, which starts `docker compose up` automatically through `webServer` outside CI.
- Default manual login is `FREDRIC` / `fredric`.
- If you need database migration commands, use `npm --prefix server run db:generate` and `npm --prefix server run db:migrate`.
- Read `CLAUDE.md` and `README.md` early for project context before making changes or investigating behavior.

### Playwright app navigation recipe

When asked to inspect, navigate, or capture a screen in the running app, prefer driving the real UI with Playwright instead of inferring screen state from code alone.

1. Open `http://localhost:5173` and wait for `● Connected`.
2. Log in through the visible terminal inputs: fill `input[type="text"]`, press `Tab`, fill `input[type="password"]`, then press `Enter`.
3. Wait for `MAIN MENU` before sending navigation keys.
4. Focus `.terminal-container` before using terminal keyboard navigation such as `ArrowUp`, `ArrowDown`, `Enter`, `Escape`, or single-key shortcuts.
5. Wait for stable screen text like `USER MANAGEMENT` or `Day total` before reading content or taking a screenshot.
6. Save screenshots to a deterministic path under the session workspace when possible so they can be referenced later in the conversation.

## High-level architecture

AS500 is a server-driven terminal emulator, not a REST-style SPA. The client renders a literal 80x24 screen from WebSocket responses (`rows` plus `fields`) and sends key/input events back to the server. The server owns navigation, validation, business rules, authentication, and screen rendering.

- `server/src/index.ts` is the main WebSocket router and production static-file host.
- Hand-written flows live in `server/src/screens/*` and use the DSL in `server/src/dsl/*` to build screens.
- CRUD-style list/form flows should usually go through the CRUDTable runtime in `server/src/crudtable/*`, with configs registered from `server/src/configs/index.ts`.
- CRUDTable list screens send `navigation` metadata; the client uses it for row focus, Enter primary action, delete shortcuts, and menu/list keyboard behavior.
- Sessions live in memory and persist to `server/data/sessions.json` in development. Authentication also uses DB-backed access/refresh tokens; permissions are loaded into the session on login/resume.
- Database access should go through Drizzle (`server/src/db/index.ts`, `server/src/db/schema.ts`). Migrations live in `server/src/db/migrations/` and are applied on server startup.

## Key conventions

- Keep validation and business logic on the server. The client should stay a dumb terminal: rendering, keyboard/mouse input, cookies, reconnect, and session resume only.
- Prefer CRUDTable for new CRUD screens. Use manual screens for login, menus, help, and genuinely custom flows.
- When navigating into a CRUDTable screen, initialize its context first (for example `initTimeRegV2Context()` or `initUserMgmtContext()`), then set `session.currentScreen`.
- Navigation is stack-based: push the current screen onto `session.screenStack` before moving forward, and use the stack for cancel/back behavior.
- Use the Drizzle `db` instance and schema objects in services. Do not add new code that talks to PostgreSQL with raw `pool.query`.
- TypeScript uses ES modules with `.js` import extensions even inside `.ts` files.
- Screen IDs are `UPPER_CASE_SNAKE`; CRUDTable screen IDs are `CRUD_{CONFIG_ID_UPPERCASE}`.
- Screen files typically keep the DSL definition, `build...Screen()`, and `handle...()` together.
- RBAC is central to navigation and CRUD actions. Prefer permission keys and CRUDTable `requirePermission` / service-level `requirePermission` instead of scattering role checks. See `ACCESS.md` and `server/src/services/access.ts`.
