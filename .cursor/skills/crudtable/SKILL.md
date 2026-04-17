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

### Step 4 — Navigate in from a screen handler

Typically from `server/src/screens/mainMenu.ts`:

```ts
session.screenStack.push('MAIN_MENU');
session.currentScreen = 'CRUD_THINGS';   // always 'CRUD_' + config.id.toUpperCase()
// Optional: seed caller context BEFORE returning the response
// session.context.crud_things_input = { … };
```

**No other files need to change.** No edits to `server/src/index.ts`. The router's default case picks up any `CRUD_*` screen ID and dispatches to the runtime.

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

## Patterns to reach for

| Need | Use |
|---|---|
| Field only required on create | `form.required: ctx => ctx.formMode === 'create'` |
| Field read-only when editing | `form.disabled: ctx => ctx.formMode === 'edit'` |
| Map backend boolean to `'Y'`/`'N'` in the form | `form.formValue: v => v === true ? 'Y' : 'N'`, plus a validator on submit |
| Cross-field check (e.g. password == confirm) | Validator on one field reads `ctx.values.other` |
| Resolve foreign-key id to a label in the list | `column.cellRenderer: (r, ds) => ds?.find(...)?.name` + matching `datasource` |
| Filter the list by something the caller provides | `services.list.params: ctx => ({ … ctx.input.foo })` + seed `crud_{id}_input` before navigating |
| Composite primary key (no single `id`) | Store originals in a hidden field or use `editRecord.original_*`; see `roleDefaultsConfig.ts` |
| Day / page / group stepping with F7/F8 | `listKeys.F7` + `listKeys.F8` mutating `ctx.input` and `ctx.pageOffset = 0` |
| Extra contextual text at the top of the list | `listHeader: ctx => [{ row, col, content }, …]` |

## Anti-patterns (do NOT)

- **Do not hand-roll a new list/form DSL screen** when CRUDTable fits. Configs are ~50–150 lines; hand-rolled screens are ~250+.
- **Do not edit `server/src/index.ts`** to add a case for the new screen. The default case handles all `CRUD_*` IDs.
- **Do not mutate `CRUDContext` outside a service, `listKeys.handler`, or (writing to `input` only) from the navigating screen**. Config functions (`params`, validators, `cellRenderer`, `listHeader`, `getInitialValues`, `mapContext`) are read-only.
- **Do not call services from the config body (top level)**. Anything that needs runtime data goes inside a `params` / `cellRenderer` / `listKeys.handler` closure.
- **Do not use a different screen-ID convention.** It must be exactly `CRUD_{config.id.toUpperCase()}` — anything else won't route.
- **Do not forget `length`.** It's required on every `FieldConfig`; it drives form width and is the column-width fallback.
- **Do not mix config `id` casing.** Use lowercase-snake in `id` (`user_mgmt`, `timereg_v2`) — derived IDs will uppercase it.
- **Do not bypass `requirePermission`.** If a CRUD operation is sensitive, gate it per-service, not by commenting it out in the UI.

## Working examples in the repo

| File | What it demonstrates |
|---|---|
| `server/src/configs/timeRegV2.ts` | `listHeader` + `listKeys` (F7/F8 day nav) + `input`-driven filtering + init helper |
| `server/src/configs/userMgmtConfig.ts` | `staticOptions` select, context-sensitive `required`/`disabled`, password+confirm with validator, `formValue` for booleans |
| `server/src/configs/roleDefaultsConfig.ts` | Composite primary key, `SYS_ADMIN` gate, validators using a seeded registry |

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
- [ ] Navigating in from `mainMenu.ts` (or wherever) pushes the previous screen onto `session.screenStack`
- [ ] If the list needs caller context, `session.context.crud_{id}_input = {...}` is seeded **before** setting `currentScreen`

## When to go beyond the fast path

Only read `6. CRUDTable Reference.md` end-to-end when:

- You're adding a feature to the runtime itself (e.g. implementing `action.scope: 'bulk'`)
- You're porting CRUDTable to a different renderer (React, CLI)
- The config you're writing doesn't fit any of the example patterns
- You're debugging unexpected behavior and need the exact evaluation order

For most CRUD-screen tasks, this SKILL + one example config is enough.
