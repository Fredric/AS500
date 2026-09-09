import type { IncomingMessage, ServerResponse } from 'http';
import { validateAccessToken } from '../../core/services/auth.js';
import { getSession } from '../../core/session/index.js';

const ACCESS_TOKEN_COOKIE = 'as500_access_token';

function readCookie(req: IncomingMessage, name: string): string | null {
  const cookie = req.headers.cookie;
  if (!cookie) return null;
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function readQueryParam(req: IncomingMessage, name: string): string | null {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const value = url.searchParams.get(name);
    return value?.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export async function resolveDocsUserId(req: IncomingMessage): Promise<number | null> {
  const sid = readQueryParam(req, 'sid');
  if (sid) {
    const session = getSession(sid);
    if (session?.authenticated && session.viserId != null) return session.viserId;
  }

  const accessToken = readCookie(req, ACCESS_TOKEN_COOKIE);
  if (accessToken) {
    const user = await validateAccessToken(accessToken);
    if (user) return user.id;
  }

  const sessionId = readCookie(req, 'as500_session');
  if (sessionId) {
    const session = getSession(sessionId);
    if (session?.authenticated && session.viserId != null) return session.viserId;
  }

  const header = req.headers['x-as500-session'];
  if (typeof header === 'string' && header.trim()) {
    const session = getSession(header.trim());
    if (session?.authenticated && session.viserId != null) return session.viserId;
  }

  return null;
}

export function unauthorized(res: ServerResponse): void {
  res.writeHead(401, { 'Content-Type': 'text/plain' });
  res.end('Unauthorized');
}

export function badGateway(res: ServerResponse, message = 'Docs service unreachable'): void {
  res.writeHead(502, { 'Content-Type': 'text/plain' });
  res.end(message);
}
