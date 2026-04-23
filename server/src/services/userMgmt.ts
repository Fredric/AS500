import { eq, ne, and } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';

const SALT_ROUNDS = 10;

export type UserRole = 'user' | 'superuser' | 'aiagent' | 'admin';
export const VALID_ROLES: UserRole[] = ['user', 'superuser', 'aiagent', 'admin'];

export interface UserDisplay {
  id: number;
  username: string;
  full_name: string | null;
  active: boolean;
  role: UserRole;
  created_at: Date;
}

const SELECT_COLS = {
  id: users.id,
  username: users.username,
  full_name: users.full_name,
  active: users.active,
  role: users.role,
  created_at: users.created_at,
};

export async function getAllUsers(): Promise<UserDisplay[]> {



  return db.select(SELECT_COLS).from(users).orderBy(users.username);
}

export async function getUserById(id: number): Promise<UserDisplay | null> {
  const rows = await db.select(SELECT_COLS).from(users).where(eq(users.id, id));
  return rows[0] ?? null;
}

export async function usernameExists(username: string, excludeId?: number): Promise<boolean> {
  const normalized = username.toUpperCase().trim();
  const condition = excludeId !== undefined
    ? and(eq(users.username, normalized), ne(users.id, excludeId))
    : eq(users.username, normalized);

  const rows = await db.select({ id: users.id }).from(users).where(condition);
  return rows.length > 0;
}

export function isValidUsername(username: string): boolean {
  if (!username || username.length < 3 || username.length > 20) return false;
  return /^[A-Za-z0-9_]+$/.test(username);
}

export function isValidPassword(password: string): boolean {
  return password.length >= 6;
}

export async function createUser(
  username: string,
  password: string,
  fullName: string | null,
  active: boolean,
  role: UserRole
): Promise<UserDisplay> {
  const normalized = username.toUpperCase().trim();
  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

  const rows = await db
    .insert(users)
    .values({ username: normalized, password_hash, full_name: fullName, active, role })
    .returning(SELECT_COLS);

  return rows[0];
}

export async function updateUser(
  id: number,
  fullName: string | null,
  active: boolean,
  role: UserRole,
  password?: string | null
): Promise<UserDisplay | null> {
  if (password) {
    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
    const rows = await db
      .update(users)
      .set({ full_name: fullName, active, role, password_hash })
      .where(eq(users.id, id))
      .returning(SELECT_COLS);
    return rows[0] ?? null;
  }

  const rows = await db
    .update(users)
    .set({ full_name: fullName, active, role })
    .where(eq(users.id, id))
    .returning(SELECT_COLS);

  return rows[0] ?? null;
}

export async function deleteUser(id: number): Promise<boolean> {
  const rows = await db
    .delete(users)
    .where(eq(users.id, id))
    .returning({ id: users.id });
  return rows.length > 0;
}

export async function resetUserPassword(id: number, newPassword: string): Promise<boolean> {
  const password_hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  const rows = await db
    .update(users)
    .set({ password_hash })
    .where(eq(users.id, id))
    .returning({ id: users.id });

  return rows.length > 0;
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}
