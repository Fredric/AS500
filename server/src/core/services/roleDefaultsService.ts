import * as roleDefaults from './roleDefaults.js';

export { VALID_PERMISSION_KEYS, normalizePermissionKey, isValidPermissionKey } from './roleDefaults.js';
export { VALID_ROLES } from './userMgmt.js';

export function listRoleDefaults() {
  return roleDefaults.listRoleDefaults();
}

export function createRoleDefault(p: {
  role: string;
  permissionKey: string;
}) {
  return roleDefaults.createRoleDefault(p.role, p.permissionKey);
}

export function updateRoleDefault(p: {
  originalRole: string;
  originalPermissionKey: string;
  role: string;
  permissionKey: string;
}) {
  return roleDefaults.updateRoleDefault(p);
}

export function deleteRoleDefault(p: {
  role: string;
  permissionKey: string;
}) {
  return roleDefaults.deleteRoleDefault(p.role, p.permissionKey);
}

export const roleDefaultsCrudService = {
  listRoleDefaults,
  createRoleDefault,
  updateRoleDefault,
  deleteRoleDefault,
};
