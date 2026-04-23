---
applyTo: "server/src/configs/**,server/src/crudtable/**,server/src/services/**,server/src/menus/**,server/src/screens/mainMenu.ts,DOCS/CRUDTABLE/**"
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

- **List + create/edit/delete on some entity?** → CRUDTable config in `server/src/configs/`, then expose it via a node in `server/src/menus/menuTree.ts`.
- **Main menu, submenu, any grouped navigation?** → Add a `MenuNode` to `server/src/menus/menuTree.ts`. Never hand-roll a menu screen; `server/src/menus/menuRuntime.ts` renders every menu generically.
- **Login, help, dashboard, wizard?** → Manual DSL screen in `server/src/screens/`.

## Authoring shape (must follow)

1. **Service** in `server/src/services/<entity>Service.ts`. Each function takes a **single argument** (usually an object). Use Drizzle via `db` from `../db/index.js`; never `pool.query`. Add new tables to `server/src/db/schema.ts` and generate a migration with `npm --prefix server run db:generate`.
2. **Config** in `server/src/configs/<entity>Config.ts` implementing `CRUDTableConfig` from `../crudtable/types.js`.
3. **Register** with `registerConfig(<entity>Config)` in `server/src/configs/index.ts`.
4. **Expose in the menu tree** — add a `CrudNode` to `server/src/menus/menuTree.ts` under the appropriate parent (top-level for user-facing, under `admin` for admin-only). Set `configId` to the config's `id`, set `requirePermission`, and use `initContext(session)` when the list needs caller context seeded into `session.context.crud_<id>_input` before navigation.

Screen IDs are always `CRUD_{config.id.toUpperCase()}` (CRUD screens) or `MENU_{KEY_UPPERCASE}` / `MAIN_MENU` (menu screens). No edits to `server/src/index.ts` or `server/src/screens/mainMenu.ts` are needed — the router dispatches all `CRUD_*` and `MENU_*` IDs to the appropriate runtime.

## Must-follow rules

- Every `FieldConfig` has a `length` (required — drives form width and column-width fallback).
- `columnBuilder` and `formBuilder` reference only existing keys in `fieldConfigs`.
- Config functions (`params`, validators, `cellRenderer`, `listHeader`, `getInitialValues`, `mapContext`) are **read-only on `CRUDTableContext`**. Only services and `listKeys.handler` may mutate context.
- Gate sensitive operations with `requirePermission` at both the config (screen-level) and each `ServiceCall` (operation-level). Permission keys live in `server/src/services/access.ts`.
- TypeScript relative imports use `.js` extensions (even when the source is `.ts`).

## Working examples to pattern-match against

- `server/src/configs/timeRegV2.ts` — dynamic `listHeader`, F7/F8 `listKeys`, `input`-driven list params
- `server/src/configs/userMgmtConfig.ts` — `staticOptions` select, context-sensitive `required`/`disabled`, password + confirm validator, `formValue` mapping
- `server/src/configs/roleDefaultsConfig.ts` — composite primary key, `SYS_ADMIN` gate

Open one of these before writing a config from scratch.

## Verification before handing back

- [ ] `npm run typecheck` passes from the repo root
- [ ] Config `id` is lowercase-snake
- [ ] Every `fieldConfigs[*]` has `length`
- [ ] `requireAuth` / `requirePermission` are set as appropriate on the config
- [ ] Permissions used are declared in `access.ts` and seeded for the roles that need them
- [ ] A `CrudNode` is added to `server/src/menus/menuTree.ts` under the correct parent, with matching `configId` and the correct `requirePermission` guard
- [ ] Per-user list filtering, if any, lives in `initContext` on the menu node — not in a screen handler
