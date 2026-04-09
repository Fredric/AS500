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

// Token expiry constants
const ACCESS_TOKEN_EXPIRY_HOURS = 1; // 1 hour
const REFRESH_TOKEN_EXPIRY_DAYS = 30; // 30 days

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

export interface DeviceInfo {
  deviceId: string;
  deviceName?: string;
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Create a new access + refresh token pair for a user
 */
export async function createAuthTokens(
  userId: number,
  deviceInfo: DeviceInfo
): Promise<TokenPair> {
  const accessToken = uuidv4();
  const refreshToken = uuidv4();
  const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_EXPIRY_HOURS * 3600 * 1000);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 86400 * 1000);

  await pool.query(
    `INSERT INTO auth_tokens 
     (user_id, token, access_token, refresh_token, expires_at, access_expires_at, refresh_expires_at, 
      device_id, device_name, user_agent, ip_address, last_used_at)
     VALUES ($1, $2, $2, $3, $4, $4, $5, $6, $7, $8, $9, NOW())`,
    [
      userId,
      accessToken, // Keep token column for backward compat
      refreshToken,
      accessExpiresAt,
      refreshExpiresAt,
      deviceInfo.deviceId,
      deviceInfo.deviceName || 'Unknown Device',
      deviceInfo.userAgent,
      deviceInfo.ipAddress,
    ]
  );

  return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt };
}

/**
 * Validate an access token and return the associated user
 */
export async function validateAccessToken(accessToken: string): Promise<User | null> {
  const result = await pool.query<User>(
    `SELECT u.* FROM users u
     JOIN auth_tokens t ON t.user_id = u.id
     WHERE t.access_token = $1 
     AND t.access_expires_at > NOW() 
     AND t.revoked_at IS NULL
     AND u.active = TRUE`,
    [accessToken]
  );

  if (result.rows[0]) {
    // Update last_used_at
    await pool.query(
      'UPDATE auth_tokens SET last_used_at = NOW() WHERE access_token = $1',
      [accessToken]
    );
  }

  return result.rows[0] ?? null;
}

/**
 * Refresh tokens: validate refresh token and issue new access + refresh tokens
 * This implements token rotation for security
 */
export async function refreshAuthTokens(
  refreshToken: string,
  deviceInfo: DeviceInfo
): Promise<TokenPair | null> {
  // Validate refresh token
  const result = await pool.query(
    `SELECT * FROM auth_tokens 
     WHERE refresh_token = $1 
     AND refresh_expires_at > NOW() 
     AND revoked_at IS NULL`,
    [refreshToken]
  );

  const tokenRecord = result.rows[0];
  if (!tokenRecord) {
    return null;
  }

  // Revoke old token (consumed - prevents reuse)
  await pool.query(
    'UPDATE auth_tokens SET revoked_at = NOW() WHERE id = $1',
    [tokenRecord.id]
  );

  // Issue new token pair with same device info
  const newAccessToken = uuidv4();
  const newRefreshToken = uuidv4();
  const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_EXPIRY_HOURS * 3600 * 1000);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 86400 * 1000);

  await pool.query(
    `INSERT INTO auth_tokens 
     (user_id, token, access_token, refresh_token, expires_at, access_expires_at, refresh_expires_at,
      device_id, device_name, user_agent, ip_address, last_used_at)
     VALUES ($1, $2, $2, $3, $4, $4, $5, $6, $7, $8, $9, NOW())`,
    [
      tokenRecord.user_id,
      newAccessToken,
      newRefreshToken,
      accessExpiresAt,
      refreshExpiresAt,
      deviceInfo.deviceId || tokenRecord.device_id,
      deviceInfo.deviceName || tokenRecord.device_name,
      deviceInfo.userAgent || tokenRecord.user_agent,
      deviceInfo.ipAddress || tokenRecord.ip_address,
    ]
  );

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    accessExpiresAt,
    refreshExpiresAt,
  };
}

/**
 * Revoke a specific token (by access or refresh token)
 */
export async function revokeAuthToken(token: string): Promise<void> {
  await pool.query(
    'UPDATE auth_tokens SET revoked_at = NOW() WHERE (access_token = $1 OR refresh_token = $1) AND revoked_at IS NULL',
    [token]
  );
}

/**
 * Revoke all tokens for a user (sign out everywhere)
 */
export async function revokeAllUserTokens(userId: number): Promise<void> {
  await pool.query(
    'UPDATE auth_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId]
  );
}

/**
 * Revoke all tokens for a specific device
 */
export async function revokeDeviceTokens(userId: number, deviceId: string): Promise<void> {
  await pool.query(
    'UPDATE auth_tokens SET revoked_at = NOW() WHERE user_id = $1 AND device_id = $2 AND revoked_at IS NULL',
    [userId, deviceId]
  );
}

/**
 * Get all active devices for a user
 */
export async function getUserDevices(userId: number): Promise<
  Array<{
    deviceId: string;
    deviceName: string;
    lastUsedAt: Date;
    createdAt: Date;
  }>
> {
  const result = await pool.query(
    `SELECT DISTINCT ON (device_id)
       device_id,
       device_name,
       last_used_at,
       created_at
     FROM auth_tokens
     WHERE user_id = $1 AND revoked_at IS NULL AND refresh_expires_at > NOW()
     ORDER BY device_id, last_used_at DESC`,
    [userId]
  );

  return result.rows;
}

// Periodically remove expired and revoked tokens to keep the table lean
setInterval(async () => {
  try {
    const result = await pool.query(
      `DELETE FROM auth_tokens 
       WHERE refresh_expires_at <= NOW() 
       OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '7 days')`
    );
    if (result.rowCount && result.rowCount > 0) {
      console.log(`Cleaned up ${result.rowCount} expired/revoked auth tokens`);
    }
  } catch (error) {
    console.warn('Failed to clean up expired auth tokens:', error);
  }
}, 60 * 60 * 1000); // Every hour
