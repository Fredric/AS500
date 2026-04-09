import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db/index.js';
import type { User } from '../types/index.js';

export const DEFAULT_DEVICE_NAME = 'Web Browser';

export async function validateCredentials(
  username: string,
  password: string
): Promise<User | null> {
  const normalizedUsername = username.toUpperCase().trim();

  const result = await pool.query<User>(
    'SELECT * FROM users WHERE username = $1 AND active = TRUE',
    [normalizedUsername]
  );

  const user = result.rows[0];

  if (!user) {
    return null;
  }

  const valid = await bcrypt.compare(password, user.password_hash);

  if (!valid) {
    return null;
  }

  return user;
}

// Token expiry constants (source of truth — client uses server-provided timestamps)
export const ACCESS_TOKEN_EXPIRY_HOURS = 1;
export const REFRESH_TOKEN_EXPIRY_DAYS = 30;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

export interface TokenPairWithUser extends TokenPair {
  user: User;
}

export interface DeviceInfo {
  deviceId: string;
  deviceName?: string;
  userAgent?: string;
  ipAddress?: string;
}

async function insertTokenRow(
  userId: number,
  accessToken: string,
  refreshToken: string,
  accessExpiresAt: Date,
  refreshExpiresAt: Date,
  deviceInfo: DeviceInfo
): Promise<void> {
  await pool.query(
    `INSERT INTO auth_tokens
     (user_id, token, access_token, refresh_token, expires_at, access_expires_at, refresh_expires_at,
      device_id, device_name, user_agent, ip_address, last_used_at)
     VALUES ($1, $2, $2, $3, $4, $4, $5, $6, $7, $8, $9, NOW())`,
    [
      userId,
      accessToken,
      refreshToken,
      accessExpiresAt,
      refreshExpiresAt,
      deviceInfo.deviceId,
      deviceInfo.deviceName || 'Unknown Device',
      deviceInfo.userAgent,
      deviceInfo.ipAddress,
    ]
  );
}

export async function createAuthTokens(
  userId: number,
  deviceInfo: DeviceInfo
): Promise<TokenPair> {
  const accessToken = uuidv4();
  const refreshToken = uuidv4();
  const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_EXPIRY_HOURS * 3600 * 1000);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 86400 * 1000);

  await insertTokenRow(userId, accessToken, refreshToken, accessExpiresAt, refreshExpiresAt, deviceInfo);

  return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt };
}

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
    await pool.query(
      'UPDATE auth_tokens SET last_used_at = NOW() WHERE access_token = $1',
      [accessToken]
    );
  }

  return result.rows[0] ?? null;
}

interface TokenRecord {
  id: number;
  user_id: number;
  device_id: string;
  device_name: string;
  user_agent: string | null;
  ip_address: string | null;
}

/**
 * Validate refresh token, revoke it, issue new token pair, and return the authenticated user.
 * Implements token rotation — old token is consumed and cannot be reused.
 */
export async function refreshAuthTokens(
  refreshToken: string,
  deviceInfo: DeviceInfo
): Promise<TokenPairWithUser | null> {
  // Validate refresh token and fetch user in one query
  const result = await pool.query<TokenRecord & {
    u_id: number; username: string; password_hash: string; full_name: string | null;
    active: boolean; is_admin: boolean; u_created_at: Date;
  }>(
    `SELECT t.id, t.user_id, t.device_id, t.device_name, t.user_agent, t.ip_address,
            u.id as u_id, u.username, u.password_hash, u.full_name, u.active, u.is_admin,
            u.created_at as u_created_at
     FROM auth_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.refresh_token = $1
     AND t.refresh_expires_at > NOW()
     AND t.revoked_at IS NULL
     AND u.active = TRUE`,
    [refreshToken]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const user: User = {
    id: row.u_id,
    username: row.username,
    password_hash: row.password_hash,
    full_name: row.full_name,
    active: row.active,
    is_admin: row.is_admin,
    created_at: row.u_created_at,
  };

  await pool.query(
    'UPDATE auth_tokens SET revoked_at = NOW() WHERE id = $1',
    [row.id]
  );

  const newAccessToken = uuidv4();
  const newRefreshToken = uuidv4();
  const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_EXPIRY_HOURS * 3600 * 1000);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 86400 * 1000);

  await insertTokenRow(
    row.user_id,
    newAccessToken,
    newRefreshToken,
    accessExpiresAt,
    refreshExpiresAt,
    {
      deviceId: deviceInfo.deviceId || row.device_id,
      deviceName: deviceInfo.deviceName || row.device_name,
      userAgent: deviceInfo.userAgent || row.user_agent || undefined,
      ipAddress: deviceInfo.ipAddress || row.ip_address || undefined,
    }
  );

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    accessExpiresAt,
    refreshExpiresAt,
    user,
  };
}

export async function revokeAuthToken(token: string): Promise<void> {
  await pool.query(
    'UPDATE auth_tokens SET revoked_at = NOW() WHERE (access_token = $1 OR refresh_token = $1) AND revoked_at IS NULL',
    [token]
  );
}

export async function revokeAllUserTokens(userId: number): Promise<void> {
  await pool.query(
    'UPDATE auth_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId]
  );
}

export async function revokeDeviceTokens(userId: number, deviceId: string): Promise<void> {
  await pool.query(
    'UPDATE auth_tokens SET revoked_at = NOW() WHERE user_id = $1 AND device_id = $2 AND revoked_at IS NULL',
    [userId, deviceId]
  );
}

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
