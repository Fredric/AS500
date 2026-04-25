# AS500 Core / App Separation Refactor

## Goal

Split AS500 into two distinct layers:

- **`server/src/core/`** — The AS500 product. Auth, sessions, RBAC, CRUDTable runtime, MCP/OAuth, DSL renderer, built-in admin screens. Developers using AS500 as their backend **never modify files here**.
- **`server/src/app/`** — The application built on top of AS500. Business-specific services, CRUDTable configs, DB table definitions, and menu items. This is where developers work.

The separation is enforced by directory structure. There is no package boundary in this phase — that can be introduced later if needed.

---

## Before / After Directory Layout

### Before (current mixed structure)

```
server/src/
├── configs/          ← mixes system configs + app configs
├── crudtable/
├── db/
│   └── schema.ts     ← mixes system tables + app tables
├── dsl/
├── mcp/
├── menus/
│   └── menuTree.ts   ← mixes admin nodes + app nodes in one static tree
├── screens/
├── services/         ← mixes system services + app services
├── session/
├── types/
├── utils/
└── index.ts
```

### After (separated)

```
server/src/
├── core/                          ← AS500 product (never edited by app developers)
│   ├── bootstrap.ts               ← NEW: starts core (registers core configs + admin menu)
│   ├── configs/                   ← system-only CRUDTable configs
│   │   ├── authTokensConfig.ts
│   │   ├── mcpAuditConfig.ts
│   │   ├── oauthClientsConfig.ts
│   │   ├── roleDefaultsConfig.ts
│   │   └── userMgmtConfig.ts
│   ├── crudtable/                 ← runtime engine (unchanged)
│   ├── db/
│   │   ├── index.ts
│   │   ├── migrate.ts
│   │   ├── schema.ts              ← system tables only
│   │   └── seed.ts
│   ├── dsl/
│   ├── mcp/
│   ├── menus/
│   │   ├── menuRegistry.ts        ← NEW: runtime menu assembly + app registration API
│   │   ├── menuRuntime.ts         ← updated to call buildMenuTree() instead of static import
│   │   └── menuTree.ts            ← trimmed to admin subtree + log off only
│   ├── screens/
│   ├── services/                  ← system services only
│   │   ├── access.ts
│   │   ├── auth.ts
│   │   ├── authTokensAdminService.ts
│   │   ├── mcpAuditAdminService.ts
│   │   ├── oauthClientsAdminService.ts
│   │   ├── roleDefaults.ts
│   │   ├── roleDefaultsService.ts
│   │   ├── userMgmt.ts
│   │   └── userService.ts
│   ├── session/
│   ├── types/
│   └── utils/
│
├── app/                           ← Application layer (this project's business code)
│   ├── index.ts                   ← NEW: side-effect entry — registers configs + menu items
│   ├── configs/                   ← app-specific CRUDTable configs
│   │   ├── motorcyclesConfig.ts
│   │   ├── modsConfig.ts
│   │   ├── servicesPerformedConfig.ts
│   │   └── timeRegV2.ts
│   ├── db/
│   │   └── schema.ts              ← app-specific tables only
│   ├── menus/
│   │   └── appMenu.ts             ← NEW: calls registerMenuItems() for app nodes
│   └── services/
│       ├── jiraTasks.ts
│       ├── motorcycleService.ts
│       ├── modsService.ts
│       ├── servicesPerformedService.ts
│       ├── timeReg.ts
│       └── timeRegCrud.ts
│
└── index.ts                       ← entry point: import core bootstrap + app (unchanged shape)
```

---

## Phases

Work through each phase in order. Verify TypeScript compiles (`npm run typecheck` from project root) after each phase before moving to the next.

---

## Phase 1 — Create Directory Structure

Create these empty directories. Do not move any files yet.

```
server/src/core/
server/src/core/configs/
server/src/core/db/
server/src/core/crudtable/
server/src/core/dsl/
server/src/core/mcp/
server/src/core/menus/
server/src/core/screens/
server/src/core/services/
server/src/core/session/
server/src/core/types/
server/src/core/utils/
server/src/app/
server/src/app/configs/
server/src/app/db/
server/src/app/menus/
server/src/app/services/
```

---

## Phase 2 — Move Core Infrastructure (no logic changes)

Move these files verbatim. Only update relative imports *within* these files to reflect their new depth.

| Old path | New path |
|---|---|
| `server/src/crudtable/context.ts` | `server/src/core/crudtable/context.ts` |
| `server/src/crudtable/registry.ts` | `server/src/core/crudtable/registry.ts` |
| `server/src/crudtable/router.ts` | `server/src/core/crudtable/router.ts` |
| `server/src/crudtable/runtime.ts` | `server/src/core/crudtable/runtime.ts` |
| `server/src/crudtable/types.ts` | `server/src/core/crudtable/types.ts` |
| `server/src/db/index.ts` | `server/src/core/db/index.ts` |
| `server/src/db/migrate.ts` | `server/src/core/db/migrate.ts` |
| `server/src/db/seed.ts` | `server/src/core/db/seed.ts` |
| `server/src/dsl/index.ts` | `server/src/core/dsl/index.ts` |
| `server/src/dsl/renderer.ts` | `server/src/core/dsl/renderer.ts` |
| `server/src/dsl/types.ts` | `server/src/core/dsl/types.ts` |
| `server/src/dsl/components/` (whole dir) | `server/src/core/dsl/components/` |
| `server/src/mcp/` (whole dir) | `server/src/core/mcp/` |
| `server/src/screens/login.ts` | `server/src/core/screens/login.ts` |
| `server/src/screens/mainMenu.ts` | `server/src/core/screens/mainMenu.ts` |
| `server/src/session/index.ts` | `server/src/core/session/index.ts` |
| `server/src/types/index.ts` | `server/src/core/types/index.ts` |
| `server/src/utils/rateLimiter.ts` | `server/src/core/utils/rateLimiter.ts` |

**Import depth changes:** Files that were at `server/src/X/foo.ts` and imported `../db/index.js` are now at `server/src/core/X/foo.ts` — if `db` also moved to `core/db/`, the relative path `../db/index.js` is still correct (both are one level under `core/`). Verify case by case.

---

## Phase 3 — Move Core Services

| Old path | New path |
|---|---|
| `server/src/services/access.ts` | `server/src/core/services/access.ts` |
| `server/src/services/auth.ts` | `server/src/core/services/auth.ts` |
| `server/src/services/authTokensAdminService.ts` | `server/src/core/services/authTokensAdminService.ts` |
| `server/src/services/mcpAuditAdminService.ts` | `server/src/core/services/mcpAuditAdminService.ts` |
| `server/src/services/oauthClientsAdminService.ts` | `server/src/core/services/oauthClientsAdminService.ts` |
| `server/src/services/roleDefaults.ts` | `server/src/core/services/roleDefaults.ts` |
| `server/src/services/roleDefaultsService.ts` | `server/src/core/services/roleDefaultsService.ts` |
| `server/src/services/userMgmt.ts` | `server/src/core/services/userMgmt.ts` |
| `server/src/services/userService.ts` | `server/src/core/services/userService.ts` |

---

## Phase 4 — Move Core Configs

| Old path | New path |
|---|---|
| `server/src/configs/authTokensConfig.ts` | `server/src/core/configs/authTokensConfig.ts` |
| `server/src/configs/mcpAuditConfig.ts` | `server/src/core/configs/mcpAuditConfig.ts` |
| `server/src/configs/oauthClientsConfig.ts` | `server/src/core/configs/oauthClientsConfig.ts` |
| `server/src/configs/roleDefaultsConfig.ts` | `server/src/core/configs/roleDefaultsConfig.ts` |
| `server/src/configs/userMgmtConfig.ts` | `server/src/core/configs/userMgmtConfig.ts` |

---

## Phase 5 — Split the Schema

### 5a. Move system tables to `core/db/schema.ts`

Keep these tables in `server/src/core/db/schema.ts` (rename/move from existing `server/src/db/schema.ts`):

- `users`
- `auth_tokens`
- `groups`
- `user_groups`
- `permissions`
- `role_permissions`
- `group_permissions`
- `user_permissions`
- `oauth_clients`
- `oauth_consents`
- `mcp_audit_log`

### 5b. Create `app/db/schema.ts` with app tables

Create `server/src/app/db/schema.ts` containing only:

- `days`
- `day_items`
- `motorcycles`
- `mods`
- `services_performed`

All imports of `pgTable`, `serial`, `text`, `integer`, `boolean`, `timestamp`, `varchar` etc. should come from `drizzle-orm/pg-core`.

### 5c. Update `core/db/index.ts` to merge both schemas

```typescript
// server/src/core/db/index.ts
import * as coreSchema from './schema.js';
import * as appSchema from '../../app/db/schema.js';

export const db = drizzle(pool, { schema: { ...coreSchema, ...appSchema } });
```

> **Note:** This is the one intentional coupling point where core imports from app. It exists because Drizzle needs a single combined schema at the pool level. Document this clearly in the file.

### 5d. Update `drizzle.config.ts`

If `drizzle.config.ts` points to a single schema file, update it to accept both:

```typescript
// server/drizzle.config.ts
export default defineConfig({
  schema: [
    './src/core/db/schema.ts',
    './src/app/db/schema.ts',
  ],
  // ... rest of config unchanged
});
```

---

## Phase 6 — Create `menuRegistry.ts` (new file)

Create `server/src/core/menus/menuRegistry.ts` with this exact content:

```typescript
import type { AppNode, MenuNode } from '../types/index.js';

const registeredAppItems: AppNode[] = [];

export function registerMenuItems(items: AppNode[]): void {
  registeredAppItems.push(...items);
}

export function buildMenuTree(coreAdminNode: MenuNode, logOffNode: AppNode): MenuNode {
  return {
    type: 'menu',
    key: 'main',
    name: 'Main Menu',
    title: 'MAIN MENU',
    items: [
      ...registeredAppItems,
      coreAdminNode,
      logOffNode,
    ],
  };
}
```

> `AppNode` and `MenuNode` types must exist in `core/types/index.ts`. If they are currently in `menus/menuTree.ts`, move the type definitions to `core/types/index.ts` and re-export from `menuTree.ts` temporarily during migration.

---

## Phase 7 — Trim `menuTree.ts` to Core Nodes Only

Edit `server/src/core/menus/menuTree.ts` to remove all app-specific items (Time Registration, My Garage). The file should only export:

1. The `adminMenuNode: MenuNode` — the Administration submenu with all system admin entries
2. The `logOffNode: AppNode` — the Log Off action

Example shape after trimming:

```typescript
// server/src/core/menus/menuTree.ts
import { PERMISSIONS } from '../services/access.js';

export const adminMenuNode: MenuNode = {
  type: 'menu',
  key: 'admin',
  name: 'Administration',
  requirePermission: PERMISSIONS.SYS_ADMIN,
  items: [
    { type: 'crudtable', key: 'user_mgmt',     name: 'User Management',  configId: 'user_mgmt' },
    { type: 'crudtable', key: 'role_defaults',  name: 'Role Defaults',    configId: 'role_defaults' },
    { type: 'crudtable', key: 'auth_tokens',    name: 'Auth Tokens',      configId: 'auth_tokens' },
    { type: 'crudtable', key: 'oauth_clients',  name: 'OAuth Clients',    configId: 'oauth_clients' },
    { type: 'crudtable', key: 'mcp_audit',      name: 'MCP Audit Log',    configId: 'mcp_audit' },
  ],
};

export const logOffNode: AppNode = {
  type: 'action',
  key: 'log_off',
  name: 'Log Off',
  action: 'log_off',
};
```

---

## Phase 8 — Update `menuRuntime.ts`

`menuRuntime.ts` currently imports `appMenuTree` as a static constant. Change it to call `buildMenuTree()` instead:

```typescript
// Before
import { appMenuTree } from './menuTree.js';
// ... uses appMenuTree

// After
import { buildMenuTree } from './menuRegistry.js';
import { adminMenuNode, logOffNode } from './menuTree.js';
// ... replace usages of appMenuTree with buildMenuTree(adminMenuNode, logOffNode)
```

If `menuRuntime.ts` calls the tree only once per request (which it should), this change is safe and adds no measurable overhead.

---

## Phase 9 — Create `app/menus/appMenu.ts`

Create `server/src/app/menus/appMenu.ts`. This is where the application declares its menu items:

```typescript
import { registerMenuItems } from '../../core/menus/menuRegistry.js';
import { initTimeRegV2Context } from '../configs/timeRegV2.js';
import { PERMISSIONS } from '../../core/services/access.js';

registerMenuItems([
  {
    type: 'crudtable',
    key: 'time_reg',
    name: 'Time Registration',
    requirePermission: PERMISSIONS.TIME_REG_READ,
    configId: 'timereg_v2',
    initContext: initTimeRegV2Context,
  },
  {
    type: 'menu',
    key: 'my_garage',
    name: 'My Garage',
    items: [
      {
        type: 'crudtable',
        key: 'motorcycles',
        name: 'Motorcycles',
        configId: 'motorcycles',
      },
    ],
  },
]);
```

> Copy the exact menu items from the old `menuTree.ts` `items` array, excluding the Admin submenu and Log Off entries.

---

## Phase 10 — Move App Services and Configs

### App services

| Old path | New path |
|---|---|
| `server/src/services/jiraTasks.ts` | `server/src/app/services/jiraTasks.ts` |
| `server/src/services/motorcycleService.ts` | `server/src/app/services/motorcycleService.ts` |
| `server/src/services/modsService.ts` | `server/src/app/services/modsService.ts` |
| `server/src/services/servicesPerformedService.ts` | `server/src/app/services/servicesPerformedService.ts` |
| `server/src/services/timeReg.ts` | `server/src/app/services/timeReg.ts` |
| `server/src/services/timeRegCrud.ts` | `server/src/app/services/timeRegCrud.ts` |

### App configs

| Old path | New path |
|---|---|
| `server/src/configs/motorcyclesConfig.ts` | `server/src/app/configs/motorcyclesConfig.ts` |
| `server/src/configs/modsConfig.ts` | `server/src/app/configs/modsConfig.ts` |
| `server/src/configs/servicesPerformedConfig.ts` | `server/src/app/configs/servicesPerformedConfig.ts` |
| `server/src/configs/timeRegV2.ts` | `server/src/app/configs/timeRegV2.ts` |

---

## Phase 11 — Create `app/index.ts`

Create `server/src/app/index.ts`. This is the app's self-registration entry point — it uses side effects only:

```typescript
// Import order matters: configs must be registered before menu items are registered,
// and both must be registered before the server starts handling requests.
import { registerConfig } from '../core/crudtable/registry.js';

import { timeRegV2Config } from './configs/timeRegV2.js';
import { motorcyclesConfig } from './configs/motorcyclesConfig.js';
import { modsConfig } from './configs/modsConfig.js';
import { servicesPerformedConfig } from './configs/servicesPerformedConfig.js';

registerConfig(timeRegV2Config);
registerConfig(motorcyclesConfig);
registerConfig(modsConfig);
registerConfig(servicesPerformedConfig);

// Menu items — must come after config registration (initContext references config objects)
import './menus/appMenu.js';
```

---

## Phase 12 — Create `core/bootstrap.ts`

Create `server/src/core/bootstrap.ts`. This registers all system-level configs and is called once at server startup:

```typescript
import { registerConfig } from './crudtable/registry.js';
import { userMgmtConfig } from './configs/userMgmtConfig.js';
import { roleDefaultsConfig } from './configs/roleDefaultsConfig.js';
import { authTokensConfig } from './configs/authTokensConfig.js';
import { oauthClientsConfig } from './configs/oauthClientsConfig.js';
import { mcpAuditConfig } from './configs/mcpAuditConfig.js';

export function bootstrapCore(): void {
  registerConfig(userMgmtConfig);
  registerConfig(roleDefaultsConfig);
  registerConfig(authTokensConfig);
  registerConfig(oauthClientsConfig);
  registerConfig(mcpAuditConfig);
}
```

---

## Phase 13 — Update `server/src/index.ts`

The top-level entry point must:

1. Import `app/index.ts` (triggers all app-side registrations as side effects)
2. Call `bootstrapCore()` (registers all system configs)
3. Continue with server startup exactly as before

```typescript
// server/src/index.ts — startup sequence (top of file, before server creation)
import { bootstrapCore } from './core/bootstrap.js';
import './app/index.js';   // side-effect: registers app configs + menu items

bootstrapCore();
// ... rest of server startup unchanged
```

> The old `server/src/configs/index.ts` file that registered everything together can be deleted once the above is in place.

---

## Phase 14 — Fix All Broken Imports

After moving files, TypeScript will report import errors. Fix them systematically:

### Pattern: core files importing core siblings

Files in `server/src/core/X/` importing from `../db/index.js` → unchanged if `db` is also in `core/`.

### Pattern: app files importing core

```typescript
// Old (from server/src/services/timeReg.ts)
import { db } from '../db/index.js';
import { days } from '../db/schema.js';

// New (from server/src/app/services/timeReg.ts)
import { db } from '../../core/db/index.js';
import { days } from '../db/schema.js';  // app schema — same level
```

```typescript
// Old (from server/src/configs/timeRegV2.ts)
import type { CRUDTableConfig } from '../crudtable/types.js';

// New (from server/src/app/configs/timeRegV2.ts)
import type { CRUDTableConfig } from '../../core/crudtable/types.js';
```

### Pattern: core files importing core at same depth

Files that moved from `server/src/configs/userMgmtConfig.ts` to `server/src/core/configs/userMgmtConfig.ts` and previously imported `../services/userService.js` → now `../services/userService.js` (unchanged, both are in `core/`).

### Pattern: top-level `index.ts` imports

`server/src/index.ts` imports screens, session, menus etc. All of these shift from `./screens/login.js` to `./core/screens/login.js`.

---

## Phase 15 — Delete Old Empty Directories

Once all files are moved and imports fixed, delete the now-empty source directories:

```
server/src/configs/    (after moving all files out)
server/src/crudtable/  (after moving all files out)
server/src/db/         (after moving all files out)
server/src/dsl/        (after moving all files out)
server/src/mcp/        (after moving all files out)
server/src/menus/      (after moving all files out)
server/src/screens/    (after moving all files out)
server/src/services/   (after moving all files out)
server/src/session/    (after moving all files out)
server/src/types/      (after moving all files out)
server/src/utils/      (after moving all files out)
```

---

## Phase 16 — JIRA Config Cleanup (bonus)

`server/src/app/services/jiraTasks.ts` currently has two hardcoded values that belong in environment variables:

```typescript
// Current (hardcoded — wrong)
const baseUrl = 'https://stepwise-as.atlassian.net';
const userEmail = 'fb@stepwise.no';

// After cleanup (env-driven)
const baseUrl = process.env.JIRA_BASE_URL ?? '';
const userEmail = process.env.JIRA_USER_EMAIL ?? '';
const apiToken = process.env.JIRA_API_TOKEN ?? '';
```

Add `JIRA_BASE_URL` and `JIRA_USER_EMAIL` to `.env.example` and `DOCS/PRODUCTION_SETUP.md`.

---

## Verification Checklist

Run these after completing all phases:

```bash
# From project root
npm run typecheck              # must pass with 0 errors

# From server/
npm run db:generate            # must detect no schema drift (or only expected new migration)

# From project root
npm test                       # Playwright E2E — all tests must pass

# Manual smoke test
docker-compose up
# Log in as FREDRIC / fredric
# Verify: Time Registration visible in main menu
# Verify: My Garage visible in main menu
# Verify: Administration submenu visible
# Verify: All CRUD operations work in each screen

# MCP smoke test (from server/)
node scripts/smoke-mcp.mjs
```

---

## Notes for a New AS500 Application Developer

After this refactor, the workflow for a developer building a new app on AS500 is:

1. **Define tables** in `server/src/app/db/schema.ts`
2. **Write services** in `server/src/app/services/myService.ts` using `db` from `../../core/db/index.js`
3. **Write a config** in `server/src/app/configs/myConfig.ts` implementing `CRUDTableConfig`
4. **Register the config** in `server/src/app/index.ts` via `registerConfig(myConfig)`
5. **Add a menu item** in `server/src/app/menus/appMenu.ts` via `registerMenuItems([...])`
6. Run `npm run db:generate` to create a migration

No files outside `server/src/app/` need to be touched.
