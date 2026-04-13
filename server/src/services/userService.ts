// userService.ts — object-param adapter over userMgmt for CRUDTable
import * as userMgmt from './userMgmt.js';
export type { UserDisplay } from './userMgmt.js';
export { isValidUsername, isValidPassword, usernameExists } from './userMgmt.js';

export function listUsers() {
  return userMgmt.getAllUsers();
}

export async function createUser(p: {
  username: string;
  password: string;
  fullName: string | null;
  active: boolean;
  isAdmin: boolean;
}) {
  if (!userMgmt.isValidUsername(p.username)) {
    throw new Error('Username must be 3-20 alphanumeric characters');
  }
  if (!userMgmt.isValidPassword(p.password)) {
    throw new Error('Password must be at least 6 characters');
  }
  if (await userMgmt.usernameExists(p.username)) {
    throw new Error('Username already exists');
  }
  return userMgmt.createUser(p.username, p.password, p.fullName, p.active, p.isAdmin);
}

export async function updateUser(p: {
  id: number;
  fullName: string | null;
  active: boolean;
  isAdmin: boolean;
  password?: string | null;
}) {
  if (p.password && !userMgmt.isValidPassword(p.password)) {
    throw new Error('Password must be at least 6 characters');
  }
  return userMgmt.updateUser(p.id, p.fullName, p.active, p.isAdmin, p.password);
}

export function deleteUser(id: number) {
  return userMgmt.deleteUser(id);
}
