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
- Navigation menus (main menu + every submenu) are driven by a single declarative tree in `server/src/menus/menuTree.ts`, rendered generically by `server/src/menus/menuRuntime.ts`. **Do not hand-roll menu screens.** `server/src/screens/mainMenu.ts` is a thin delegator into the runtime.
- CRUD-style list/form flows go through the CRUDTable runtime in `server/src/crudtable/*`, with configs registered from `server/src/configs/index.ts` and exposed to users by adding a `CrudNode` to `server/src/menus/menuTree.ts`.
- Hand-written flows (currently only `login.ts`) live in `server/src/screens/*` and use the DSL in `server/src/dsl/*`. Use a manual screen only for login, help, wizards, and genuinely custom flows.
- CRUDTable list screens send `navigation` metadata; the client uses it for row focus, Enter primary action, delete shortcuts, and menu/list keyboard behavior.
- Sessions live in memory and persist to `server/data/sessions.json` in development. Authentication also uses DB-backed access/refresh tokens; permissions are loaded into the session on login/resume.
- Database access should go through Drizzle (`server/src/db/index.ts`, `server/src/db/schema.ts`). Migrations live in `server/src/db/migrations/` and are applied on server startup.

## Key conventions

- Keep validation and business logic on the server. The client should stay a dumb terminal: rendering, keyboard/mouse input, cookies, reconnect, and session resume only.
- Prefer CRUDTable for new CRUD screens. Use manual screens only for login, help, wizards, and genuinely custom flows — **never for menus**.
- Expose a new CRUDTable screen by adding a `CrudNode` to `server/src/menus/menuTree.ts`. The menu runtime handles permission filtering, stack push, `initContext(session)` invocation, and dispatch to `CRUD_{ID_UPPERCASE}`. Do not set `session.currentScreen` from a screen handler to reach a CRUD screen when a menu entry will do.
- Per-user context seeding for a CRUDTable list (e.g. `session.context.crud_<id>_input = {…}`) belongs in the node's `initContext(session)`, not in a screen handler.
- Navigation is stack-based: push the current screen onto `session.screenStack` before moving forward, and use the stack for cancel/back behavior. The menu runtime does this automatically for menu → submenu and menu → CRUD transitions.
- Use the Drizzle `db` instance and schema objects in services. Do not add new code that talks to PostgreSQL with raw `pool.query`.
- TypeScript uses ES modules with `.js` import extensions even inside `.ts` files.
- Screen IDs are `UPPER_CASE_SNAKE`; CRUDTable screen IDs are `CRUD_{CONFIG_ID_UPPERCASE}`.
- Screen files typically keep the DSL definition, `build...Screen()`, and `handle...()` together.
- RBAC is central to navigation and CRUD actions. Prefer permission keys and CRUDTable `requirePermission` / service-level `requirePermission` instead of scattering role checks. See `ACCESS.md` and `server/src/services/access.ts`.

## Skills and deeper references

For task-specific guidance, read the matching skill/doc before non-trivial work:

- **CRUDTable (any CRUD screen work)** → `.github/instructions/crudtable.instructions.md` (auto-applies under `server/src/configs/**`, `server/src/menus/**`, etc.), or the full skill at `.cursor/skills/crudtable/SKILL.md` / `.claude/skills/crudtable/SKILL.md`. Background: `DOCS/CRUDTABLE/5. CRUDTable Concept.md` and `DOCS/CRUDTABLE/6. CRUDTable Reference.md`.
- **Menu system** → `CLAUDE.md` § "Menu System". Ground truth: `server/src/menus/menuTree.ts` (declarations) and `server/src/menus/menuRuntime.ts` (runtime).
- **RBAC / permissions** → `ACCESS.md`.
- **Neutral agent entry point (any AI tool)** → `AGENTS.md` at repo root.
