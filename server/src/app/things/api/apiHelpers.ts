// Small request-auth helpers used by the Things HTTP surface (index.ts).

import type { Request, Response } from 'express';
import { isAdminForUser } from '../../../core/mcp/oauth/userFacts.js';
import { loadUserPermissions } from '../../../core/services/access.js';
import type { McpCallUser } from '../../../core/mcp/contextSynth.js';

export async function resolveUser(req: Request): Promise<McpCallUser> {
  const auth = req.auth!;
  const extra = auth.extra as { userId?: unknown; username?: unknown; jti?: unknown } | undefined;
  const userId = Number(extra?.userId ?? NaN);
  const username = String(extra?.username ?? '');
  const jtiRaw = extra?.jti;

  const [isAdmin, permissions] = await Promise.all([
    isAdminForUser(userId),
    loadUserPermissions(userId),
  ]);

  return {
    userId,
    username,
    isAdmin,
    permissions: permissions as Set<string>,
    clientId: auth.clientId,
    jti: typeof jtiRaw === 'string' ? jtiRaw : undefined,
  };
}

export function deny(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

/** Resolve the caller and assert one permission, or answer and return null. */
export async function authorize(
  req: Request,
  res: Response,
  permission: string,
): Promise<McpCallUser | null> {
  const user = await resolveUser(req);
  if (!Number.isFinite(user.userId) || user.userId <= 0) {
    deny(res, 401, 'unauthenticated', 'Invalid token');
    return null;
  }
  if (!user.isAdmin && !user.permissions.has(permission)) {
    deny(res, 403, 'permission_denied', `Requires ${permission}`);
    return null;
  }
  return user;
}

export function routeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export function parseId(raw: string | string[] | undefined): number | null {
  const n = Number(routeParam(raw));
  return Number.isInteger(n) && n > 0 ? n : null;
}
