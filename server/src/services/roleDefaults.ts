import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { permissions, rolePermissions } from '../db/schema.js';
import { PERMISSION_REGISTRY, type PermissionKey } from './access.js';
import { VALID_ROLES, type UserRole } from './userMgmt.js';

export interface RoleDefaultDisplay {
  id: string;
  role: UserRole;
  permission_key: PermissionKey;
  permission_description: string;
  original_role: UserRole;
  original_permission_key: PermissionKey;
}

export const VALID_PERMISSION_KEYS = PERMISSION_REGISTRY.map((permission) => permission.key);

export function normalizeRole(role: string): UserRole {
  const normalized = role.trim().toLowerCase();
  if (!VALID_ROLES.includes(normalized as UserRole)) {
    throw new Error('Role must be USER, SUPERUSER, AIAGENT, or ADMIN');
  }

  return normalized as UserRole;
}

export function normalizePermissionKey(permissionKey: string): PermissionKey {
  const normalized = permissionKey.trim().toLowerCase();
  if (!VALID_PERMISSION_KEYS.includes(normalized as PermissionKey)) {
    throw new Error('Permission key is not valid');
  }

  return normalized as PermissionKey;
}

export function isValidPermissionKey(permissionKey: string): boolean {
  const normalized = permissionKey.trim().toLowerCase();
  return VALID_PERMISSION_KEYS.includes(normalized as PermissionKey);
}

export async function listRoleDefaults(): Promise<RoleDefaultDisplay[]> {
  const rows = await db
    .select({
      role: rolePermissions.role,
      permission_key: rolePermissions.permission_key,
      permission_description: permissions.description,
    })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.key, rolePermissions.permission_key))
    .orderBy(rolePermissions.role, rolePermissions.permission_key);

  return rows.map((row) => ({
    id: `${row.role}:${row.permission_key}`,
    role: row.role,
    permission_key: row.permission_key as PermissionKey,
    permission_description: row.permission_description,
    original_role: row.role,
    original_permission_key: row.permission_key as PermissionKey,
  }));
}

async function roleDefaultExists(role: UserRole, permissionKey: PermissionKey): Promise<boolean> {
  const rows = await db
    .select({ role: rolePermissions.role })
    .from(rolePermissions)
    .where(and(
      eq(rolePermissions.role, role),
      eq(rolePermissions.permission_key, permissionKey),
    ));

  return rows.length > 0;
}

export async function createRoleDefault(role: string, permissionKey: string): Promise<RoleDefaultDisplay> {
  const normalizedRole = normalizeRole(role);
  const normalizedPermissionKey = normalizePermissionKey(permissionKey);

  if (await roleDefaultExists(normalizedRole, normalizedPermissionKey)) {
    throw new Error('Role default already exists');
  }

  await db.insert(rolePermissions).values({
    role: normalizedRole,
    permission_key: normalizedPermissionKey,
  });

  return {
    id: `${normalizedRole}:${normalizedPermissionKey}`,
    role: normalizedRole,
    permission_key: normalizedPermissionKey,
    permission_description: PERMISSION_REGISTRY.find((permission) => permission.key === normalizedPermissionKey)?.description ?? '',
    original_role: normalizedRole,
    original_permission_key: normalizedPermissionKey,
  };
}

export async function updateRoleDefault(params: {
  originalRole: string;
  originalPermissionKey: string;
  role: string;
  permissionKey: string;
}): Promise<RoleDefaultDisplay> {
  const originalRole = normalizeRole(params.originalRole);
  const originalPermissionKey = normalizePermissionKey(params.originalPermissionKey);
  const nextRole = normalizeRole(params.role);
  const nextPermissionKey = normalizePermissionKey(params.permissionKey);

  if (originalRole === nextRole && originalPermissionKey === nextPermissionKey) {
    return {
      id: `${nextRole}:${nextPermissionKey}`,
      role: nextRole,
      permission_key: nextPermissionKey,
      permission_description: PERMISSION_REGISTRY.find((permission) => permission.key === nextPermissionKey)?.description ?? '',
      original_role: nextRole,
      original_permission_key: nextPermissionKey,
    };
  }

  if (await roleDefaultExists(nextRole, nextPermissionKey)) {
    throw new Error('Role default already exists');
  }

  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(rolePermissions)
      .where(and(
        eq(rolePermissions.role, originalRole),
        eq(rolePermissions.permission_key, originalPermissionKey),
      ))
      .returning({ role: rolePermissions.role });

    if (deleted.length === 0) {
      throw new Error('Role default not found');
    }

    await tx.insert(rolePermissions).values({
      role: nextRole,
      permission_key: nextPermissionKey,
    });
  });

  return {
    id: `${nextRole}:${nextPermissionKey}`,
    role: nextRole,
    permission_key: nextPermissionKey,
    permission_description: PERMISSION_REGISTRY.find((permission) => permission.key === nextPermissionKey)?.description ?? '',
    original_role: nextRole,
    original_permission_key: nextPermissionKey,
  };
}

export async function deleteRoleDefault(role: string, permissionKey: string): Promise<boolean> {
  const normalizedRole = normalizeRole(role);
  const normalizedPermissionKey = normalizePermissionKey(permissionKey);

  const deleted = await db
    .delete(rolePermissions)
    .where(and(
      eq(rolePermissions.role, normalizedRole),
      eq(rolePermissions.permission_key, normalizedPermissionKey),
    ))
    .returning({ role: rolePermissions.role });

  return deleted.length > 0;
}
