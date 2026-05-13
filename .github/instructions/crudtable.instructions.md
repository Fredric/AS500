---
applyTo: "server/src/app/configs/**,server/src/app/services/**,server/src/app/menus/**,server/src/app/db/**,server/src/core/configs/**,server/src/core/crudtable/**,server/src/core/menus/**,server/src/core/screens/mainMenu.ts,DOCS/CRUDTABLE/**"
---

# CRUDTable guidance (auto-applied)

These instructions auto-activate when editing files that touch the CRUDTable runtime, its configs, backing services, or the menu system (which is where new CRUDTable screens are wired into the UI).

## Core rule

Before hand-rolling any list-with-add/edit/delete screen, **use the CRUDTable runtime**. One `CRUDTableConfig` object plus plain-function services is enough to generate a full paginated list + create/edit form + delete-confirm flow, with validation, access control, and keyboard/mouse row navigation.

For the full recipe (copy-pastable skeletons, patterns, anti-patterns, verification checklist), follow the skill at:

- `.cursor/skills/crudtable/SKILL.md` — same content mirrored at `.claude/skills/crudtable/SKILL.md`

For deep reference, read:

- `DOCS/CRUDTABLE/5. CRUDTable Concept.md` — mental model
- `DOCS/CRUDTABLE/6. CRUDTable Reference.md` — every field, every screen behavior

## Quick decision

- **List + create/edit/delete on some entity?** → CRUDTable config in `server/src/app/configs/`, register it in `server/src/app/index.ts`, then expose it via `registerMenuItems()` in `server/src/app/menus/appMenu.ts`.
- **Main menu, submenu, any grouped navigation?** → Call `registerMenuItems([...])` in `server/src/app/menus/appMenu.ts`. Never hand-roll a menu screen; `server/src/core/menus/menuRuntime.ts` renders every menu generically.
- **Login, help, dashboard, wizard?** → Manual DSL screen in `server/src/core/screens/`.
- **Expose data to a remote app via REST?** → Add an `api` block to the `CRUDTableConfig` (Step 6 in the SKILL). The runtime mounts `/api/<configId>` on port 3002 automatically. Use `POST /api/auth/token` for first-party Bearer token login.
- **Expose data to an AI agent via MCP?** → Add an `mcp` block to the `CRUDTableConfig` (Step 5 in the SKILL).

## Authoring shape (must follow)

1. **Service** in `server/src/app/services/<entity>Service.ts`. Each function takes a **single argument** (usually an object). Use Drizzle via `db` from `../../core/db/index.js`; never `pool.query`. Add new app tables to `server/src/app/db/schema.ts` and generate a migration with `npm --prefix server run db:generate`.
2. **Config** in `server/src/app/configs/<entity>Config.ts` implementing `CRUDTableConfig` from `../../core/crudtable/types.js`.
3. **Register** with `registerConfig(<entity>Config)` in `server/src/app/index.ts`.
4. **Expose in the app menu** — call `registerMenuItems([...])` in `server/src/app/menus/appMenu.ts`. Add a `CrudNode` under the appropriate parent (top-level for user-facing, nest under a `MenuNode` for grouped navigation). Set `configId` to the config's `id`, set `requirePermission`, and use `initContext(session)` when the list needs caller context seeded into `session.context.crud_<id>_input` before navigation.

Screen IDs are always `CRUD_{config.id.toUpperCase()}` (CRUD screens) or `MENU_{KEY_UPPERCASE}` / `MAIN_MENU` (menu screens). No edits to `server/src/index.ts` or `server/src/core/screens/mainMenu.ts` are needed — the router dispatches all `CRUD_*` and `MENU_*` IDs to the appropriate runtime.

## Must-follow rules

- Every `FieldConfig` has a `length` (required — drives form width and column-width fallback).
- `columnBuilder` and `formBuilder` reference only existing keys in `fieldConfigs`.
- Config functions (`params`, validators, `cellRenderer`, `listHeader`, `getInitialValues`, `mapContext`) are **read-only on `CRUDContext`**. Only services and `listKeys.handler` may mutate context.
- **Every config function takes `ctx: CRUDContext` as its first parameter.** `cellRenderer(ctx, record, datasource?)`, `formValue(ctx, rawValue)`, `mapInput(ctx)`, `listKeys.handler(ctx)` — no exceptions. Callers that don't need ctx use `_ctx` as the parameter name.
- Gate sensitive operations with `requirePermission` at both the config (screen-level) and each `ServiceCall` (operation-level). Permission keys live in `server/src/core/services/access.ts`.
- TypeScript relative imports use `.js` extensions (even when the source is `.ts`).
- **Never edit files under `server/src/core/`** when building app features — app code belongs under `server/src/app/`.

## Working examples to pattern-match against

- `server/src/app/configs/timeRegV2.ts` — dynamic `listHeader`, F7/F8 `listKeys`, `input`-driven list params, **`mcp` block**, **`api` block** (canonical reference for both remote surfaces)
- `server/src/core/configs/userMgmtConfig.ts` — `staticOptions` select, context-sensitive `required`/`disabled`, password + confirm validator, `formValue` mapping
- `server/src/core/configs/roleDefaultsConfig.ts` — composite primary key, `SYS_ADMIN` gate

Open one of these before writing a config from scratch.

## Verification before handing back

- [ ] `npm run typecheck` passes from the repo root
- [ ] Config `id` is lowercase-snake
- [ ] Every `fieldConfigs[*]` has `length`
- [ ] `requireAuth` / `requirePermission` are set as appropriate on the config
- [ ] Permissions used are declared in `server/src/core/services/access.ts` and seeded for the roles that need them
- [ ] A `CrudNode` is added via `registerMenuItems()` in `server/src/app/menus/appMenu.ts` under the correct parent, with matching `configId` and the correct `requirePermission` guard
- [ ] Per-user list filtering, if any, lives in `initContext` on the menu node — not in a screen handler

**If adding an `api` block:**
- [ ] `services.read` is implemented
- [ ] User-scoped params use `injectFromAuth: 'userId'` — never accept `userId` from callers
- [ ] Smoke-tested: `POST /api/auth/token` → `GET /api/<configId>`

**If adding an `mcp` block:**
- [ ] `services.read` is implemented; `mcp.description` is set
- [ ] User-scoped params use `injectFromAuth: 'userId'`
