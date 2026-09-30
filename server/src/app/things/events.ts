// Live "your Things changed" channel for the phone, at ws(s)://<api>/api/events.
//
// It carries hints, never data. A `changed` message only means "refetch";
// the phone answers over the normal REST API, so RBAC and shaping stay in one
// place and a dropped message costs nothing (the phone also refetches on every
// reconnect and app resume).
//
// Protocol
//   client -> server  {type:'auth', token}   first message, within AUTH_TIMEOUT_MS
//                     {type:'ping'}          app heartbeat (RN exposes no WS pings)
//   server -> client  {type:'ready'}         auth accepted
//                     {type:'pong'}
//                     {type:'changed', topic:'things'}
//                     {type:'error', code}   followed by close(4401)
//
// The token travels in the first message, not the URL, so it never reaches a
// proxy access log. The socket is closed at the token's expiry (4401): a
// long-lived connection must not outlive the credential that opened it, and it
// makes revocation bite within one token lifetime. The phone reconnects with a
// freshly refreshed token.

import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { PERMISSIONS, loadUserPermissions } from '../../core/services/access.js';
import { isAdminForUser } from '../../core/mcp/oauth/userFacts.js';
import { verifyAccessToken } from '../../core/mcp/oauth/tokens.js';

export const EVENTS_PATH = '/api/events';
export const CLOSE_UNAUTHENTICATED = 4401;

const AUTH_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 30_000;
const COALESCE_MS = 200;
const MAX_MESSAGE_BYTES = 4096;

type Live = WebSocket & { isAlive?: boolean };

export const PHONE_STATUSES = ['browsing', 'capturing', 'uploading'] as const;
export type PhoneStatus = (typeof PHONE_STATUSES)[number];

/** Lets an optional feature (the virtual office) learn which phones are
 *  connected without this module depending on it. `conn` identifies one socket. */
export interface PhoneConnectionListener {
  connected(info: { conn: symbol; userId: number; username: string }): void;
  status(conn: symbol, status: PhoneStatus): void;
  disconnected(conn: symbol): void;
}

const phoneListeners = new Set<PhoneConnectionListener>();

export function onPhoneConnection(listener: PhoneConnectionListener): () => void {
  phoneListeners.add(listener);
  return () => {
    phoneListeners.delete(listener);
  };
}

function notifyPhones(fn: (listener: PhoneConnectionListener) => void): void {
  for (const listener of phoneListeners) {
    try {
      fn(listener);
    } catch (err) {
      console.error('[events] phone listener failed:', err);
    }
  }
}

const socketsByUser = new Map<number, Set<Live>>();
const pendingByUser = new Map<number, NodeJS.Timeout>();

function send(ws: WebSocket, message: Record<string, unknown>): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

/** Tell every open phone of `userId` that their Things changed. Bursts (a job
 *  reporting progress, a multi-select move) collapse into one message. Cheap
 *  and safe to call with no listeners. */
export function emitThingsChanged(userId: number): void {
  if (!socketsByUser.has(userId) || pendingByUser.has(userId)) return;
  const timer = setTimeout(() => {
    pendingByUser.delete(userId);
    for (const ws of socketsByUser.get(userId) ?? []) {
      send(ws, { type: 'changed', topic: 'things' });
    }
  }, COALESCE_MS);
  timer.unref();
  pendingByUser.set(userId, timer);
}

async function authenticate(
  token: unknown,
): Promise<{ userId: number; username: string; expiresAtMs: number } | null> {
  if (typeof token !== 'string' || token.length === 0) return null;
  const claims = await verifyAccessToken(token);
  if (!claims) return null;
  const userId = Number(claims.sub);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  // Same gate as GET /api/my_things: a hint about Things is a Things read.
  const [isAdmin, permissions] = await Promise.all([isAdminForUser(userId), loadUserPermissions(userId)]);
  if (!isAdmin && !(permissions as Set<string>).has(PERMISSIONS.THINGS_READ)) return null;
  const expSeconds = typeof claims.exp === 'number' ? claims.exp : null;
  return {
    userId,
    username: typeof claims.username === 'string' && claims.username ? claims.username : `user ${userId}`,
    expiresAtMs: expSeconds === null ? Date.now() + 3_600_000 : expSeconds * 1000,
  };
}

function register(userId: number, ws: Live): () => void {
  let set = socketsByUser.get(userId);
  if (!set) socketsByUser.set(userId, (set = new Set()));
  set.add(ws);
  return () => {
    set.delete(ws);
    if (set.size === 0) {
      socketsByUser.delete(userId);
      const timer = pendingByUser.get(userId);
      if (timer) clearTimeout(timer);
      pendingByUser.delete(userId);
    }
  };
}

export function attachEventsSocket(httpServer: HttpServer): { close(): void } {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== EVENTS_PATH) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (raw: WebSocket) => {
    const ws = raw as Live;
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    const conn = Symbol('phone');
    let unregister: (() => void) | null = null;
    let expiryTimer: NodeJS.Timeout | null = null;
    let authenticating = false;

    const authTimer = setTimeout(() => {
      if (!unregister) ws.close(CLOSE_UNAUTHENTICATED, 'auth timeout');
    }, AUTH_TIMEOUT_MS);

    const reject = () => {
      send(ws, { type: 'error', code: 'unauthenticated' });
      ws.close(CLOSE_UNAUTHENTICATED, 'unauthenticated');
    };

    ws.on('message', async (data) => {
      ws.isAlive = true;
      let message: { type?: unknown; token?: unknown; status?: unknown };
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (message.type === 'ping') {
        send(ws, { type: 'pong' });
        return;
      }
      if (message.type === 'status') {
        // Only meaningful once authenticated, and only known values.
        if (unregister && PHONE_STATUSES.includes(message.status as PhoneStatus)) {
          notifyPhones((l) => l.status(conn, message.status as PhoneStatus));
        }
        return;
      }
      if (message.type !== 'auth') return;
      if (unregister || authenticating) return;

      authenticating = true;
      let identity: Awaited<ReturnType<typeof authenticate>> = null;
      try {
        identity = await authenticate(message.token);
      } catch (err) {
        console.error('[events] auth check failed:', err);
      }
      authenticating = false;

      if (!identity || ws.readyState !== ws.OPEN) {
        if (ws.readyState === ws.OPEN) reject();
        return;
      }
      clearTimeout(authTimer);
      unregister = register(identity.userId, ws);
      expiryTimer = setTimeout(
        () => ws.close(CLOSE_UNAUTHENTICATED, 'token expired'),
        Math.max(1_000, identity.expiresAtMs - Date.now()),
      );
      expiryTimer.unref();
      send(ws, { type: 'ready' });
      notifyPhones((l) => l.connected({ conn, userId: identity!.userId, username: identity!.username }));
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (expiryTimer) clearTimeout(expiryTimer);
      if (unregister) notifyPhones((l) => l.disconnected(conn));
      unregister?.();
    });
    ws.on('error', () => ws.terminate());
  });

  // Protocol-level ping: reaps half-open TCP connections (a phone that lost
  // signal never sends a FIN) and keeps idle-timeout proxies from cutting a
  // quiet-but-healthy socket.
  const heartbeat = setInterval(() => {
    for (const client of wss.clients as Set<Live>) {
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    close() {
      clearInterval(heartbeat);
      wss.close();
    },
  };
}
