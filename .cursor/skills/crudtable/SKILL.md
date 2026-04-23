---
name: crudtable
description: >-
  Build CRUD screens in the AS500 project using the CRUDTable runtime — a
  declarative config that auto-generates a paginated list, create/edit form,
  and delete-confirm screen from one TypeScript object plus plain-function
  services. Use whenever the user asks for a new admin screen, maintenance
  screen, editable listing, or CRUD for any entity (users, customers, roles,
  orders, settings, lookup tables, etc.); or when they mention "add/edit/delete",
  "CRUDTable", a subfile with options, or an AS/400-style list; or when they
  want to refactor a hand-written screen into a config. Do NOT hand-roll a new
  list/form screen in AS500 unless the feature is genuinely outside the
  CRUDTable model (e.g. login, menus, dashboards, wizards).
---

# CRUDTable

AS500's **declarative CRUD runtime**. One TypeScript config + plain-function services → a fully working list + form + delete-confirm flow with validation, pagination, access control, keyboard/mouse row navigation, and select-field dropdowns.

## When to use CRUDTable

Use CRUDTable whenever the task fits this shape:

- "Add a screen to list X with the ability to add / edit / delete."
- "I need a maintenance screen for {users, customers, products, tasks, …}."
- "Build an admin UI for this table."
- "Give each row options 2=Edit, 4=Delete, 9=Open like the other screens."
- "Refactor the hand-written time-reg screen into a CRUDTable config." (see `server/src/configs/timeRegV2.ts` as the reference)

Use a **manual screen** (DSL-only) when the task is:

- Login, signoff, main menu, help screens
- Wizards or multi-step flows that don't match list + form
- Dashboards / pure-display screens with no CRUD
- Screens that need custom layout CRUDTable can't express (e.g. two side-by-side subfiles)

When in doubt, prefer CRUDTable. It is strictly additive — existing manual screens stay as-is.

## Read these first

Before writing code for a non-trivial task, read:

- `DOCS/CRUDTABLE/5. CRUDTable Concept.md` — the mental model (10 min)
- `DOCS/CRUDTABLE/6. CRUDTable Reference.md` — every field, every screen behavior (lookup reference)

For a small change (e.g. adding one field to an existing config), skim this SKILL and look at a working config.

## Fast path: add a new CRUD screen in 4 steps

> **Wiring model (important):** CRUD screens are exposed to the user through the central **menu tree** at `server/src/menus/menuTree.ts`, not by navigating to `CRUD_*` from a hand-written screen handler. Adding a `CrudNode` to the tree is the only UI-wiring step. The generic menu runtime (`server/src/menus/menuRuntime.ts`) handles permission filtering, `initContext`, stack push, and dispatch to the CRUD runtime.

### Step 1 — Write the service

Create `server/src/services/thingService.ts`. Functions take a **single argument** (usually an object) and return arrays or records. Use Drizzle via `db` from `../db/index.js`; add any new table to `server/src/db/schema.ts` first and run `npm run db:generate` inside `server/`.

```ts
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { things } from '../db/schema.js';

export async function listThings(params?: { filter?: string }) {
  const rows = await db.select().from(things);
  return rows;
}
export async function createThing(input: { name: string; cityId: number }) {
  const [row] = await db.insert(things).values(input).returning();
  return row;
}
export async function updateThing(input: { id: number; name: string; cityId: number }) {
  const [row] = await db.update(things).set({ name: input.name, cityId: input.cityId })
                        .where(eq(things.id, input.id)).returning();
  return row;
}
export async function deleteThing(id: number) {
  await db.delete(things).where(eq(things.id, id));
}
```

### Step 2 — Write the config

Create `server/src/configs/thingsConfig.ts`.

```ts
import type { CRUDTableConfig } from '../crudtable/types.js';
import * as thingService from '../services/thingService.js';
import * as cityService from '../services/cityService.js';

export const thingsConfig: CRUDTableConfig = {
  id: 'things',
  title: 'Things',
  requireAuth: true,
  requirePermission: 'things:read',

  services: {
    list:   { service: thingService, method: 'listThings' },
    create: { service: thingService, method: 'createThing',
              requirePermission: 'things:write',
              params: ctx => ({ name: ctx.values.name, cityId: Number(ctx.values.cityId) }) },
    update: { service: thingService, method: 'updateThing',
              requirePermission: 'things:write',
              params: ctx => ({ id: ctx.editRecord!.id as number,
                                name: ctx.values.name,
                                cityId: Number(ctx.values.cityId) }) },
    delete: { service: thingService, method: 'deleteThing',
              requirePermission: 'things:write',
              params: ctx => ctx.selection[0].id as number },
  },

  fieldConfigs: {
    name: {
      field: 'name', label: 'Name', length: 20,
      form: { required: true },
      column: { width: 20 },
    },
    city: {
      field: 'cityId', label: 'City', length: 4,
      datasource: {
        service: cityService, method: 'listCities',
        valueField: 'id', displayField: 'name',
      },
      form: { required: true },
      column: {
        width: 18,
        cellRenderer: (r, ds) => ds?.find(c => c.id === r.cityId)?.name ?? '',
      },
    },
  },

  columnBuilder: ['name', 'city'],
  formBuilder:   ['name', 'city'],
};
```

### Step 3 — Register the config

Edit `server/src/configs/index.ts`:

```ts
import { thingsConfig } from './thingsConfig.js';

export function registerCRUDConfigs(): void {
  // …existing…
  registerConfig(thingsConfig);
}
```

### Step 4 — Add a node to the menu tree

Edit `server/src/menus/menuTree.ts` and drop a `CrudNode` under the appropriate parent menu (top-level for user-facing screens; under the `admin` submenu for admin-only screens):

```ts
import { PERMISSIONS } from '../services/access.js';
import { thingsConfig } from '../configs/thingsConfig.js';

{
  type: 'crudtable',
  key: 'things',
  name: 'Things',
  requirePermission: PERMISSIONS.THINGS_READ,
  configId: 'things',              // must match CRUDTableConfig.id
  // Optional — runs immediately before the CRUD list renders. Use it to seed
  // session.context.crud_things_input = {…} or other per-user context.
  // initContext: initThingsContext,
}
```

**No other files need to change.** No edits to `server/src/index.ts`, `server/src/screens/mainMenu.ts`, or any manual screen handler. The menu runtime:

1. Hides the item if the user lacks `requirePermission`.
2. Pushes the parent menu onto `session.screenStack` on selection.
3. Awaits `initContext(session)` if provided.
4. Sets `session.currentScreen = 'CRUD_THINGS'` (derived as `'CRUD_' + config.id.toUpperCase()`) and returns the list screen.

If the list needs caller-supplied filtering or defaults, put that logic in `initContext` — it is the correct and only place to seed `session.context.crud_{id}_input`.

## What the config gives you for free

- Paginated list (page size 12, `PAGEUP`/`PAGEDOWN`) with `Opt` column
- Option `2=Edit`, `4=Delete` (→ confirmation screen), `9=Open` (if `openUI`)
- Custom record actions auto-numbered from `5` (skipping `9` if openUI exists)
- `F6` / client `N` key → create flow
- `F3` / `F12` / client `Esc` → back, with stack + context cleanup
- Client-side arrow-key row focus, `Enter` = primary action, `d` = delete shortcut, mouse click/double-click
- Required-field checks, custom validator pipeline, service error surfacing
- Select dropdowns from `staticOptions` or a `datasource`
- Screen-level and per-service access-control gates
- Pre-populated edit form from the record (with optional `formValue` mapping)
- Dynamic header text via `listHeader(ctx)`, custom F-keys via `listKeys`
- Cross-config navigation via `openUI.mapContext`

## Step 5 (optional) — Expose the config over MCP

Every CRUDTable config can be opened up to remote AI agents as a set of MCP tools with **no extra handler code**. Add an `mcp` block to the config; the runtime at `server/src/mcp/` auto-generates one tool per enabled operation (`<id>.list`, `<id>.read`, `<id>.create`, `<id>.update`, `<id>.delete`), with a zod input schema derived from the same field configs, and enforces the same AS500 RBAC that gates the terminal UI.

```ts
// Inside your CRUDTableConfig
mcp: {
  name: 'things',                 // prefix for the tool names (e.g. things.list)
  description: 'Things managed by the AS500 Thing registry.',
  operations: {
    list: true,                   // enable individually; omit/false to disable
    read: true,
    create: true,
    update: true,
    delete: { requirePermission: PERMISSIONS.THINGS_DELETE },
  },
  // Declare any caller-supplied context (analog of `session.context.crud_*_input`).
  // The runtime surfaces agent-supplied params as required inputs on every tool,
  // then threads them into the synthesized `CRUDContext` before calling your services.
  //
  // SECURITY — user-scoped configs: use `injectFromAuth: 'userId'` instead of
  // exposing userId as a tool input. The runtime injects McpCallUser.userId
  // (= auth_tokens.user_id for the active OAuth session) and strips the param
  // from the Zod schema so agents can never pass a different id.
  scope: [
    {
      name: 'userId',
      type: 'number',
      required: true,
      description: 'Injected from the OAuth token — not a tool input.',
      injectFromAuth: 'userId',   // ← never appears in the tool schema
    },
  ],
}
```

What the MCP runtime gives you for free:

- JSON-schema/zod input validation derived from each field's `form.type` + `required`
- Per-tool permission enforcement: `config.requirePermission`, per-`ServiceCall.requirePermission`, and per-op override via `mcp.operations[op].requirePermission` (admins bypass all three, same as the UI)
- OAuth 2.1 + Dynamic Client Registration on `/mcp` with per-token rate limiting and an append-only row in `mcp_audit_log` for every call (ok/error, client_id, user_id, config_id, op, duration, sha256 params hash — values are never logged)
- Identical validators and services to the terminal UI: no duplication, no drift

Things you still own:
- Make sure `services.read` is implemented — `update` and `delete` use it to fetch the current row before running validators. If a CRUDTable config previously only had `list/create/update/delete`, add `read` before turning on MCP updates or deletes.
- If an operation should be visible in the UI but not to agents, mark it `false` in `mcp.operations`.
- If the UI gates a config behind a permission, grant that same permission to any agent role that needs MCP access. Don't widen for agents.

Quickest end-to-end smoke of your new MCP surface:

```bash
cd server
npx tsc && node scripts/smoke-mcp.mjs   # walks DCR → consent → token → tools/list → tools/call
```

Reference: `server/src/configs/timeRegV2.ts` has a working `mcp` block with scope params. The `MCPConfig` and `MCPOperationOverride` types in `server/src/crudtable/types.ts` are the authoritative shape; `server/src/mcp/schemaBuilder.ts` shows how each field is translated into zod.

## Patterns to reach for

| Need | Use |
|---|---|
| Field only required on create | `form.required: ctx => ctx.formMode === 'create'` |
| Field read-only when editing | `form.disabled: ctx => ctx.formMode === 'edit'` |
| Map backend boolean to `'Y'`/`'N'` in the form | `form.formValue: v => v === true ? 'Y' : 'N'`, plus a validator on submit |
| Cross-field check (e.g. password == confirm) | Validator on one field reads `ctx.values.other` |
| Resolve foreign-key id to a label in the list | `column.cellRenderer: (r, ds) => ds?.find(...)?.name` + matching `datasource` |
| Filter the list by something the caller provides | `services.list.params: ctx => ({ … ctx.input.foo })` + seed the child's `ctx.input` via a menu node's `initContext` or a parent's relation `mapInput` |
| Composite primary key (no single `id`) | Store originals in a hidden field or use `editRecord.original_*`; see `roleDefaultsConfig.ts` |
| Day / page / group stepping with F7/F8 | `listKeys.F7` + `listKeys.F8` mutating `ctx.input` and `ctx.pageOffset = 0` |
| Extra contextual text at the top of the list | `listHeader: ctx => [{ row, col, content }, …]` |
| **"From parent X's edit form, jump to list of child Y's scoped to X"** | `relations: [{ label, actionKey, targetConfigId, mapInput: rec => ({ parentId: rec.id, parentLabel: … }) }]` — see **Relations** below |

## Relations — parent → child navigation from the edit form

`config.relations?: RelationConfig[]` adds **single-key hotkeys on the edit form** (never the create form) that open another registered CRUDTable's list, scoped to the currently edited parent record.

```ts
// Parent config
relations: [
  {
    label: 'Mods',        // shown in form status bar: 'Esc=Back  M=Mods'
    actionKey: 'M',       // single key, case-insensitive
    targetConfigId: 'mods',
    mapInput: (rec) => ({
      motorcycleId: rec.id,
      motorcycleLabel: `${rec.brand} ${rec.model} ${rec.year}`,
    }),
  },
],
```

The runtime seeds `session.context['crud_mods_input'] = mapInput(editRecord)`, pushes the parent form onto `screenStack`, and navigates to the child's list. The child reads the scoping via `ctx.input`:

```ts
// Child config (e.g. modsConfig.ts)
services: {
  list: {
    service: modsService,
    method: 'listMods',
    params: (ctx) => ({ motorcycleId: ctx.input.motorcycleId as number }),
  },
  create: {
    service: modsService,
    method: 'createMod',
    params: (ctx) => ({
      motorcycleId: ctx.input.motorcycleId as number,  // echo FK on mutations
      name: ctx.values.name?.trim() || '',
      // …
    }),
  },
  // update / delete likewise echo motorcycleId
},
listHeader: (ctx) => [
  { row: 5, col: 2, content: `Mods: ${ctx.input.motorcycleLabel ?? ''}` },
],
```

**Rules of thumb.**

- `actionKey` must not collide with `Enter`, `Esc`/`F3`/`F12`, or field input handling. Uppercase letters (`M`, `S`, `L`) are safe.
- The child **must** be registered in `configs/index.ts`. An unknown `targetConfigId` silently no-ops.
- The child's list/create/update/delete `params` must all echo the scoping keys from `ctx.input` — otherwise new child rows can be created orphaned.
- Relations don't do their own permission check; the **child's** `requirePermission` gate still runs on navigation.
- Use `listHeader(ctx)` on the child to show the parent label — `mapInput` conventionally provides a `*Label` key for exactly this.
- Esc from the child list (or its own edit form) returns the user to the parent form in its previous state — the runtime handles the stack.

Canonical example: `server/src/configs/motorcyclesConfig.ts` (parent with two relations) + `modsConfig.ts` / `servicesPerformedConfig.ts` (scoped children).

## Anti-patterns (do NOT)

- **Do not hand-roll a new list/form DSL screen** when CRUDTable fits. Configs are ~50–150 lines; hand-rolled screens are ~250+.
- **Do not hand-roll a new menu screen.** All menu navigation is declared in `server/src/menus/menuTree.ts` and rendered by `server/src/menus/menuRuntime.ts`. New screens are exposed by adding a node there, not by writing a DSL menu.
- **Do not edit `server/src/index.ts`** to add a case for the new screen. The default case handles all `CRUD_*` and `MENU_*` IDs.
- **Do not edit `server/src/screens/mainMenu.ts`.** It is a thin delegator to `menuRuntime.ts`; the main-menu contents are in `menuTree.ts`.
- **Do not navigate into a CRUD screen from a manual screen handler** when a menu entry will do. Put the entry in the tree (`type: 'crudtable'`) and let the runtime dispatch; use `initContext` for any pre-navigation seeding.
- **Do not mutate `CRUDContext` outside a service, `listKeys.handler`, or `initContext` on the menu node**. Config functions (`params`, validators, `cellRenderer`, `listHeader`, `getInitialValues`, `mapContext`) are read-only.
- **Do not call services from the config body (top level)**. Anything that needs runtime data goes inside a `params` / `cellRenderer` / `listKeys.handler` closure.
- **Do not use a different screen-ID convention.** It must be exactly `CRUD_{config.id.toUpperCase()}` — anything else won't route.
- **Do not forget `length`.** It's required on every `FieldConfig`; it drives form width and is the column-width fallback.
- **Do not mix config `id` casing.** Use lowercase-snake in `id` (`user_mgmt`, `timereg_v2`) — derived IDs will uppercase it.
- **Do not bypass `requirePermission`.** If a CRUD operation is sensitive, gate it per-service, not by commenting it out in the UI. Set `requirePermission` on the menu node too, so the entry is hidden for users without access.

## Working examples in the repo

| File | What it demonstrates |
|---|---|
| `server/src/configs/timeRegV2.ts` | `listHeader` + `listKeys` (F7/F8 day nav) + `input`-driven filtering + init helper |
| `server/src/configs/userMgmtConfig.ts` | `staticOptions` select, context-sensitive `required`/`disabled`, password+confirm with validator, `formValue` for booleans |
| `server/src/configs/roleDefaultsConfig.ts` | Composite primary key, `SYS_ADMIN` gate, validators using a seeded registry |
| `server/src/configs/motorcyclesConfig.ts` | **`relations`** — two edit-form hotkeys (`M=Mods`, `S=Services`) jumping to scoped child lists via `mapInput` |
| `server/src/configs/modsConfig.ts` / `servicesPerformedConfig.ts` | Child side of a relation: `ctx.input.motorcycleId` scoping on list + all mutations, parent label in `listHeader` |

Open one of these before writing a config from scratch — pattern-matching will save time.

## Verification checklist

After implementing a new CRUD screen:

- [ ] `npm run typecheck` passes from the repo root
- [ ] Service file lives under `server/src/services/`; each function takes a single argument
- [ ] Any new DB table is in `server/src/db/schema.ts` and a migration was generated with `npm run db:generate`
- [ ] Config file lives under `server/src/configs/` and is imported + registered in `configs/index.ts`
- [ ] The config `id` is lowercase-snake; screens route on `CRUD_{ID_UPPERCASE}`
- [ ] Every `fieldConfigs[*]` has `length`
- [ ] `columnBuilder` and `formBuilder` reference only existing `fieldConfigs` keys
- [ ] Permissions exist in `server/src/services/access.ts` (add them if new) and are seeded for the relevant roles
- [ ] A `CrudNode` for the config is added to `server/src/menus/menuTree.ts` with the right parent menu, `requirePermission`, and `configId` matching the config's `id`
- [ ] If the list needs caller context, it is seeded inside `initContext(session)` on the menu node — not from a screen handler and not in the config body

## When to go beyond the fast path

Only read `6. CRUDTable Reference.md` end-to-end when:

- You're adding a feature to the runtime itself (e.g. implementing `action.scope: 'bulk'`)
- You're porting CRUDTable to a different renderer (React, CLI)
- The config you're writing doesn't fit any of the example patterns
- You're debugging unexpected behavior and need the exact evaluation order

For most CRUD-screen tasks, this SKILL + one example config is enough.
