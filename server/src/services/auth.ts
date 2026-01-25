import bcrypt from 'bcrypt';
import pool from '../db/index.js';
import type { User } from '../types/index.js';

export async function validateCredentials(
  username: string,
  password: string
): Promise<User | null> {
  // Normalize username to uppercase
  const normalizedUsername = username.toUpperCase().trim();

  // Find user
  const result = await pool.query<User>(
    'SELECT * FROM users WHERE username = $1 AND active = TRUE',
    [normalizedUsername]
  );

  const user = result.rows[0];

  if (!user) {
    return null;
  }

  // Verify password
  const valid = await bcrypt.compare(password, user.password_hash);

  if (!valid) {
    return null;
  }

  return user;
}
