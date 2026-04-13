// RBAC Access Control Service
// Handles permission resolution: admin bypass > user override > group > role defaults

import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  users,
  permissions,
  rolePermissions,
  groupPermissions,
  userGroups,
  userPermissions,
} from '../db/schema.js';
import type { Session } from '../types/index.js';

// ============================================
// Permission key registry
// ============================================

export const PERMISSIONS = {
  TIME_REG_READ:   'time_reg:read',
  TIME_REG_WRITE:  'time_reg:write',
  USER_MGMT_READ:  'user_mgmt:read',
  USER_MGMT_ADMIN: 'user_mgmt:admin',
  SYS_ADMIN:       'sys:admin',
} as const;

export type PermissionKey = typeof PERMISSIONS[keyof typeof PERMISSIONS];

export const PERMISSION_REGISTRY: Array<{ key: PermissionKey; description: string }> = [
  { key: PERMISSIONS.TIME_REG_READ,   description: 'View time registration entries' },
  { key: PERMISSIONS.TIME_REG_WRITE,  description: 'Create/edit/delete time entries' },
  { key: PERMISSIONS.USER_MGMT_READ,  description: 'View user list' },
  { key: PERMISSIONS.USER_MGMT_ADMIN, description: 'Create/edit/delete users' },
  { key: PERMISSIONS.SYS_ADMIN,       description: 'Full system administration' },
];

// Default permissions granted to each role
export const ROLE_DEFAULT_PERMISSIONS: Record<string, PermissionKey[]> = {
  user: [
    PERMISSIONS.TIME_REG_READ,
    PERMISSIONS.TIME_REG_WRITE,
  ],
  superuser: [
    PERMISSIONS.TIME_REG_READ,
    PERMISSIONS.TIME_REG_WRITE,
    PERMISSIONS.USER_MGMT_READ,
  ],
  aiagent: [
    PERMISSIONS.TIME_REG_READ,
    //PERMISSIONS.TIME_REG_WRITE,
  ],
  admin: [
    PERMISSIONS.TIME_REG_READ,
    PERMISSIONS.TIME_REG_WRITE,
    PERMISSIONS.USER_MGMT_READ,
    PERMISSIONS.USER_MGMT_ADMIN,
    PERMISSIONS.SYS_ADMIN,
  ],
};

// ============================================
// Permission resolution
// ============================================

/**
 * Load effective permissions for a user into a Set.
 * Admin users get all permissions without querying the DB.
 * Resolution order: role defaults + group grants, then user overrides (grant/deny).
 */
export async function loadUserPermissions(
  userId: number,
  isAdmin: boolean,
): Promise<Set<PermissionKey>> {
  if (isAdmin) {
    return new Set(Object.values(PERMISSIONS) as PermissionKey[]);
  }

  // Fetch user's role
  const [userRow] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId));

  const role = userRow?.role ?? 'user';

  // Fetch role default permissions
  const rolePerms = await db
    .select({ permission_key: rolePermissions.permission_key })
    .from(rolePermissions)
    .where(eq(rolePermissions.role, role));

  // Fetch group permissions for all groups the user belongs to
  const groupPerms = await db
    .select({ permission_key: groupPermissions.permission_key })
    .from(groupPermissions)
    .innerJoin(userGroups, eq(userGroups.group_id, groupPermissions.group_id))
    .where(eq(userGroups.user_id, userId));

  // Fetch user-level overrides (grant=true or deny=false)
  const userPerms = await db
    .select({ permission_key: userPermissions.permission_key, granted: userPermissions.granted })
    .from(userPermissions)
    .where(eq(userPermissions.user_id, userId));

  // Build effective set
  const effective = new Set<PermissionKey>();

  for (const p of rolePerms) {
    effective.add(p.permission_key as PermissionKey);
  }
  for (const p of groupPerms) {
    effective.add(p.permission_key as PermissionKey);
  }
  for (const p of userPerms) {
    if (p.granted) {
      effective.add(p.permission_key as PermissionKey);
    } else {
      effective.delete(p.permission_key as PermissionKey);
    }
  }

  return effective;
}

// ============================================
// Runtime checks
// ============================================

/** O(1) permission check against session's cached permission set. */
export function hasPermission(session: Session, key: string): boolean {
  if (session.isAdmin) return true;
  return session.permissions?.has(key) ?? false;
}

/** Throws if the session lacks the given permission. */
export function requirePermission(session: Session, key: string): void {
  if (!hasPermission(session, key)) {
    throw new Error(`Access denied: missing permission '${key}'`);
  }
}

// ============================================
// Seed — idempotent, called on server startup
// ============================================

export async function seedPermissions(): Promise<void> {
  for (const perm of PERMISSION_REGISTRY) {
    await db.insert(permissions).values(perm).onConflictDoNothing();
  }

  for (const [role, keys] of Object.entries(ROLE_DEFAULT_PERMISSIONS)) {
    for (const key of keys) {
      await db
        .insert(rolePermissions)
        .values({ role: role as any, permission_key: key })
        .onConflictDoNothing();
    }
  }
}
