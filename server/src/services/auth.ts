import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
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

// Long-lived auth token expiry (30 days)
const TOKEN_EXPIRY_DAYS = 30;

export async function createAuthToken(userId: number): Promise<string> {
  const token = uuidv4();
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_DAYS * 86400 * 1000);

  await pool.query(
    'INSERT INTO auth_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [userId, token, expiresAt]
  );

  return token;
}

export async function validateAuthToken(token: string): Promise<User | null> {
  const result = await pool.query<User>(
    `SELECT u.* FROM users u
     JOIN auth_tokens t ON t.user_id = u.id
     WHERE t.token = $1 AND t.expires_at > NOW() AND u.active = TRUE`,
    [token]
  );

  return result.rows[0] ?? null;
}

export async function revokeAuthToken(token: string): Promise<void> {
  await pool.query('DELETE FROM auth_tokens WHERE token = $1', [token]);
}

export async function revokeAllUserTokens(userId: number): Promise<void> {
  await pool.query('DELETE FROM auth_tokens WHERE user_id = $1', [userId]);
}

// Periodically remove expired tokens to keep the auth_tokens table lean
setInterval(async () => {
  try {
    await pool.query('DELETE FROM auth_tokens WHERE expires_at <= NOW()');
  } catch (error) {
    console.warn('Failed to clean up expired auth tokens:', error);
  }
}, 60 * 60 * 1000); // Every hour
