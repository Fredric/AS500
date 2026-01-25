// User Management Service
// CRUD operations for user administration

import bcrypt from 'bcrypt';
import pool from '../db/index.js';
import type { User } from '../types/index.js';

const SALT_ROUNDS = 10;

// User without password hash for display
export interface UserDisplay {
  id: number;
  username: string;
  full_name: string | null;
  active: boolean;
  is_admin: boolean;
  created_at: Date;
}

/**
 * Get all users (without password hashes)
 */
export async function getAllUsers(): Promise<UserDisplay[]> {
  const result = await pool.query<UserDisplay>(
    `SELECT id, username, full_name, active, is_admin, created_at
     FROM users
     ORDER BY username`
  );
  return result.rows;
}

/**
 * Get a single user by ID (without password hash)
 */
export async function getUserById(id: number): Promise<UserDisplay | null> {
  const result = await pool.query<UserDisplay>(
    `SELECT id, username, full_name, active, is_admin, created_at
     FROM users
     WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Check if a username already exists
 * @param username Username to check
 * @param excludeId Optional user ID to exclude (for edit validation)
 */
export async function usernameExists(username: string, excludeId?: number): Promise<boolean> {
  const normalizedUsername = username.toUpperCase().trim();

  let query = 'SELECT id FROM users WHERE username = $1';
  const params: (string | number)[] = [normalizedUsername];

  if (excludeId !== undefined) {
    query += ' AND id != $2';
    params.push(excludeId);
  }

  const result = await pool.query(query, params);
  return result.rows.length > 0;
}

/**
 * Validate username format
 * - 3-20 characters
 * - Alphanumeric only (letters, numbers, underscore)
 */
export function isValidUsername(username: string): boolean {
  if (!username || username.length < 3 || username.length > 20) {
    return false;
  }
  return /^[A-Za-z0-9_]+$/.test(username);
}

/**
 * Validate password strength
 * - Minimum 6 characters
 */
export function isValidPassword(password: string): boolean {
  return password.length >= 6;
}

/**
 * Create a new user
 */
export async function createUser(
  username: string,
  password: string,
  fullName: string | null,
  active: boolean,
  isAdmin: boolean
): Promise<UserDisplay> {
  const normalizedUsername = username.toUpperCase().trim();
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const result = await pool.query<UserDisplay>(
    `INSERT INTO users (username, password_hash, full_name, active, is_admin)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, username, full_name, active, is_admin, created_at`,
    [normalizedUsername, passwordHash, fullName, active, isAdmin]
  );

  return result.rows[0];
}

/**
 * Update user details (not password)
 */
export async function updateUser(
  id: number,
  fullName: string | null,
  active: boolean,
  isAdmin: boolean
): Promise<UserDisplay | null> {
  const result = await pool.query<UserDisplay>(
    `UPDATE users
     SET full_name = $2, active = $3, is_admin = $4
     WHERE id = $1
     RETURNING id, username, full_name, active, is_admin, created_at`,
    [id, fullName, active, isAdmin]
  );

  return result.rows[0] || null;
}

/**
 * Reset user password
 */
export async function resetUserPassword(id: number, newPassword: string): Promise<boolean> {
  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  const result = await pool.query(
    `UPDATE users SET password_hash = $2 WHERE id = $1`,
    [id, passwordHash]
  );

  return (result.rowCount ?? 0) > 0;
}

/**
 * Format a date for display (YYYY-MM-DD)
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}
