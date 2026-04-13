import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { eq, or, and, isNull, isNotNull, gt, lt, getTableColumns, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, authTokens } from '../db/schema.js';
import type { User } from '../types/index.js';

export const DEFAULT_DEVICE_NAME = 'Web Browser';

export async function validateCredentials(
  username: string,
  password: string
): Promise<User | null> {
  const normalizedUsername = username.toUpperCase().trim();

  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.username, normalizedUsername), eq(users.active, true)));

  const user = rows[0];
  if (!user) return null;

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return null;

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
  await db.insert(authTokens).values({
    user_id: userId,
    token: accessToken,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: accessExpiresAt,
    access_expires_at: accessExpiresAt,
    refresh_expires_at: refreshExpiresAt,
    device_id: deviceInfo.deviceId,
    device_name: deviceInfo.deviceName || 'Unknown Device',
    user_agent: deviceInfo.userAgent ?? null,
    ip_address: deviceInfo.ipAddress ?? null,
    last_used_at: sql`NOW()`,
  });
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
  const rows = await db
    .select({ ...getTableColumns(users) })
    .from(users)
    .innerJoin(authTokens, eq(authTokens.user_id, users.id))
    .where(and(
      eq(authTokens.access_token, accessToken),
      gt(authTokens.access_expires_at, sql`NOW()`),
      isNull(authTokens.revoked_at),
      eq(users.active, true)
    ));

  if (rows[0]) {
    await db
      .update(authTokens)
      .set({ last_used_at: sql`NOW()` })
      .where(eq(authTokens.access_token, accessToken));
  }

  return rows[0] ?? null;
}

export async function refreshAuthTokens(
  refreshToken: string,
  deviceInfo: DeviceInfo
): Promise<TokenPairWithUser | null> {
  const rows = await db
    .select({
      tokenId: authTokens.id,
      tokenUserId: authTokens.user_id,
      tokenDeviceId: authTokens.device_id,
      tokenDeviceName: authTokens.device_name,
      tokenUserAgent: authTokens.user_agent,
      tokenIpAddress: authTokens.ip_address,
      ...getTableColumns(users),
    })
    .from(authTokens)
    .innerJoin(users, eq(users.id, authTokens.user_id))
    .where(and(
      eq(authTokens.refresh_token, refreshToken),
      gt(authTokens.refresh_expires_at, sql`NOW()`),
      isNull(authTokens.revoked_at),
      eq(users.active, true)
    ));

  const row = rows[0];
  if (!row) return null;

  const user: User = {
    id: row.id,
    username: row.username,
    password_hash: row.password_hash,
    full_name: row.full_name,
    active: row.active,
    is_admin: row.is_admin,
    role: row.role,
    created_at: row.created_at,
  };

  await db
    .update(authTokens)
    .set({ revoked_at: sql`NOW()` })
    .where(eq(authTokens.id, row.tokenId));

  const newAccessToken = uuidv4();
  const newRefreshToken = uuidv4();
  const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_EXPIRY_HOURS * 3600 * 1000);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 86400 * 1000);

  await insertTokenRow(
    row.tokenUserId,
    newAccessToken,
    newRefreshToken,
    accessExpiresAt,
    refreshExpiresAt,
    {
      deviceId: deviceInfo.deviceId || row.tokenDeviceId || 'unknown',
      deviceName: deviceInfo.deviceName || row.tokenDeviceName || DEFAULT_DEVICE_NAME,
      userAgent: deviceInfo.userAgent || row.tokenUserAgent || undefined,
      ipAddress: deviceInfo.ipAddress || row.tokenIpAddress || undefined,
    }
  );

  return { accessToken: newAccessToken, refreshToken: newRefreshToken, accessExpiresAt, refreshExpiresAt, user };
}

export async function revokeAuthToken(token: string): Promise<void> {
  await db
    .update(authTokens)
    .set({ revoked_at: sql`NOW()` })
    .where(and(
      or(eq(authTokens.access_token, token), eq(authTokens.refresh_token, token)),
      isNull(authTokens.revoked_at)
    ));
}

export async function revokeAllUserTokens(userId: number): Promise<void> {
  await db
    .update(authTokens)
    .set({ revoked_at: sql`NOW()` })
    .where(and(eq(authTokens.user_id, userId), isNull(authTokens.revoked_at)));
}

export async function revokeDeviceTokens(userId: number, deviceId: string): Promise<void> {
  await db
    .update(authTokens)
    .set({ revoked_at: sql`NOW()` })
    .where(and(
      eq(authTokens.user_id, userId),
      eq(authTokens.device_id, deviceId),
      isNull(authTokens.revoked_at)
    ));
}

export async function getUserDevices(userId: number): Promise<
  Array<{ deviceId: string; deviceName: string; lastUsedAt: Date; createdAt: Date }>
> {
  const rows = await db
    .selectDistinctOn([authTokens.device_id], {
      deviceId: authTokens.device_id,
      deviceName: authTokens.device_name,
      lastUsedAt: authTokens.last_used_at,
      createdAt: authTokens.created_at,
    })
    .from(authTokens)
    .where(and(
      eq(authTokens.user_id, userId),
      isNull(authTokens.revoked_at),
      gt(authTokens.refresh_expires_at, sql`NOW()`)
    ))
    .orderBy(authTokens.device_id, sql`${authTokens.last_used_at} DESC`);

  return rows.map(r => ({
    deviceId: r.deviceId ?? '',
    deviceName: r.deviceName ?? '',
    lastUsedAt: r.lastUsedAt ?? new Date(),
    createdAt: r.createdAt,
  }));
}

setInterval(async () => {
  try {
    const result = await db
      .delete(authTokens)
      .where(or(
        lt(authTokens.refresh_expires_at, sql`NOW()`),
        and(
          isNotNull(authTokens.revoked_at),
          lt(authTokens.revoked_at, sql`NOW() - INTERVAL '7 days'`)
        )
      ));
    if (result.rowCount && result.rowCount > 0) {
      console.log(`Cleaned up ${result.rowCount} expired/revoked auth tokens`);
    }
  } catch (error) {
    console.warn('Failed to clean up expired auth tokens:', error);
  }
}, 60 * 60 * 1000);
