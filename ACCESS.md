# ACCESS.md — Role-Based Access Control

This document covers the RBAC system: roles, groups, permissions, how they resolve, and how to wire access checks to screens and service operations.

---

## Roles

Four roles are defined as a PostgreSQL enum (`user_role`):

| Role | Description |
|------|-------------|
| `user` | Standard user — can register time |
| `superuser` | Power user — can view user list |
| `aiagent` | Programmatic access — same scope as user |
| `admin` | Full access — bypasses all permission checks |

Each user has exactly one role. Set via the `role` column on the `users` table (default: `user`).

The `admin` role also derives `is_admin = true` at login: `session.isAdmin = user.role === 'admin' || user.is_admin`.

---

## Groups

Users can belong to one or more groups (many-to-many via `user_groups`). Groups can be granted permissions. This lets you give a set of users extra access without changing their individual role.

**Tables:**
- `groups` — `id, name, description, created_at`
- `user_groups` — `(user_id, group_id)` composite PK

Group management UI is not yet built — use SQL directly for now:

```sql
INSERT INTO groups (name, description) VALUES ('Managers', 'Can view all reports');
INSERT INTO user_groups (user_id, group_id) VALUES (3, 1);
INSERT INTO group_permissions (group_id, permission_key) VALUES (1, 'user_mgmt:read');
```

---

## Permission Keys

Named string keys defined in `server/src/services/access.ts`:

```typescript
export const PERMISSIONS = {
  TIME_REG_READ:   'time_reg:read',
  TIME_REG_WRITE:  'time_reg:write',
  USER_MGMT_READ:  'user_mgmt:read',
  USER_MGMT_ADMIN: 'user_mgmt:admin',
  SYS_ADMIN:       'sys:admin',
} as const;
```

These are seeded to the `permissions` table on every server start (idempotent).

**Adding a new permission key:**
1. Add it to `PERMISSIONS` in `access.ts`
2. Add an entry to `PERMISSION_REGISTRY` (description string)
3. Add it to `ROLE_DEFAULT_PERMISSIONS` for whichever roles should get it by default
4. Restart — it seeds automatically

---

## Default Role Permissions

Defined in `ROLE_DEFAULT_PERMISSIONS` in `access.ts` and seeded to the `role_permissions` table:

| Permission | `user` | `superuser` | `aiagent` | `admin` |
|------------|--------|-------------|-----------|---------|
| `time_reg:read` | ✓ | ✓ | ✓ | ✓ |
| `time_reg:write` | ✓ | ✓ | ✓ | ✓ |
| `user_mgmt:read` | | ✓ | | ✓ |
| `user_mgmt:admin` | | | | ✓ |
| `sys:admin` | | | | ✓ |

---

## Resolution Order

Effective permissions are computed in `loadUserPermissions()`:

1. Start with role default permissions (from `role_permissions`)
2. Add group permissions (from `group_permissions` via `user_groups`)
3. Apply user-level overrides (from `user_permissions`):
   - `granted = true` → explicitly add
   - `granted = false` → explicitly remove (deny overrides group/role)
4. **Admin shortcut:** if `isAdmin`, return all permissions without any DB queries

The result is a `Set<string>` cached on `session.permissions` at login. O(1) checks for every subsequent keypress.

**User-level override example:**
```sql
-- Grant a single user an extra permission
INSERT INTO user_permissions (user_id, permission_key, granted) VALUES (5, 'user_mgmt:read', true);

-- Explicitly deny (overrides their group grant)
INSERT INTO user_permissions (user_id, permission_key, granted) VALUES (5, 'time_reg:write', false);
```

---

## Session Fields

After login (or token resume), the session has:

```typescript
session.isAdmin      // boolean — true for admin role (fast path)
session.userRole     // 'user' | 'superuser' | 'aiagent' | 'admin' | null
session.permissions  // Set<string> | null — null until loaded from DB
```

`permissions` is **not persisted to disk** (a `Set` doesn't serialize to JSON). On the first request after a disk-restore, `ensurePermissionsLoaded()` in `index.ts` reloads it from the DB automatically.

---

## Checking Permissions in Code

### `hasPermission` — read check

```typescript
import { hasPermission, PERMISSIONS } from '../services/access.js';

if (hasPermission(session, PERMISSIONS.USER_MGMT_READ)) {
  // render extra menu option
}
```

Returns `true` for admin regardless of the Set.

### `requirePermission` — guard that throws

```typescript
import { requirePermission, PERMISSIONS } from '../services/access.js';

requirePermission(session, PERMISSIONS.SYS_ADMIN);
// throws 'Access denied: missing permission sys:admin' if check fails
```

Useful inside screen handlers for early rejection before any service call.

---

## CRUDTable Integration

### Screen-level guard

```typescript
export const myConfig: CRUDTableConfig = {
  id: 'my_screen',
  requireAuth: true,
  requirePermission: 'user_mgmt:read',   // ← blocks entire screen
  // ...
};
```

Checked in `crudtable/router.ts` before the list or form is rendered. On failure: session is reset to `MAIN_MENU` and an error is shown.

### Operation-level guards

```typescript
services: {
  list:   { service: myService, method: 'getAll' },
  create: { service: myService, method: 'create', requirePermission: 'user_mgmt:admin' },
  update: { service: myService, method: 'update', requirePermission: 'user_mgmt:admin' },
  delete: { service: myService, method: 'delete', requirePermission: 'user_mgmt:admin' },
},
```

Effect:
- Users without the permission see the list screen but the option hints (`2=Edit`, `4=Delete`, `N=New`) are hidden
- If they somehow trigger the option (e.g. by typing it), an error is shown on the list screen
- The create form ENTER submit is also guarded

You can have a screen-level `requirePermission` for coarse access and operation-level ones for fine-grained write control.

---

## Existing Config Permissions

| Config | Screen | Create/Update/Delete |
|--------|--------|----------------------|
| `timereg_v2` | `time_reg:read` | `time_reg:write` |
| `user_mgmt` | `user_mgmt:read` | `user_mgmt:admin` |

---

## Database Tables

```
permissions         key (PK), description, created_at
role_permissions    role, permission_key (composite PK)
group_permissions   group_id, permission_key (composite PK)
user_permissions    user_id, permission_key, granted (composite PK)
groups              id, name, description, created_at
user_groups         user_id, group_id (composite PK)
```

All FK relationships cascade on delete. Removing a user removes their `user_groups` and `user_permissions` rows automatically.

---

## Key Files

| File | Purpose |
|------|---------|
| `server/src/services/access.ts` | `PERMISSIONS`, `loadUserPermissions`, `hasPermission`, `requirePermission`, `seedPermissions` |
| `server/src/db/schema.ts` | Drizzle table definitions for all RBAC tables |
| `server/src/crudtable/types.ts` | `requirePermission` fields on `CRUDTableConfig` and `ServiceCall` |
| `server/src/crudtable/router.ts` | Screen-level permission enforcement |
| `server/src/crudtable/runtime.ts` | Operation-level enforcement + UI hint hiding |
| `server/src/screens/login.ts` | Loads permissions into session after credential check |
| `server/src/index.ts` | `ensurePermissionsLoaded()` — lazy reload after disk-restore |
