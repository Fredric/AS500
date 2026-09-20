/**
 * World runtime — self-contained HTTP + WebSocket server for the virtual office.
 *
 * Runs on its own port (default 3006) for the same reason the ingest monitor
 * does: the terminal's WebSocketServer is created without a `path` filter and
 * therefore claims every upgrade on 3001. A dedicated listener keeps the
 * protocols independent — `server/src/world/` and `client/src/world/` can be
 * deleted together without touching a line of terminal code.
 *
 * Endpoints:
 *   GET  /health              liveness (unprefixed — not browser-facing)
 *   GET  /world/api/spaces         every space (name + key), for a picker
 *   GET  /world/api/space/:key     the resolved scene — curl-testable
 *   WS   /world/ws                 live scene + presence
 *
 * Everything the browser reaches lives under /world/ so it can be proxied
 * same-origin: Vite proxies /world -> this port in dev, Caddy does the same
 * in prod. The client never talks to this port directly — see
 * client/src/world/useWorldSocket.ts. Passthrough proxying needs no prefix
 * rewrite on either side because the prefix is part of the route itself.
 *
 * Auth is the terminal's own access token, passed as `?token=`. There is no new
 * credential and no new session type.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import { IS_PRODUCTION, PRESENCE_TICK_MS, PRESENCE_TIMEOUT_MS, WORLD_ENABLED, WORLD_PORT } from './config.js';
import { validateAccessToken } from '../core/services/auth.js';
import { loadUserPermissions } from '../core/services/access.js';
import { onAuditEvent, writeAuditEvent } from '../core/audit/writer.js';
import { onSnapshot } from '../monitor/index.js';
import { PERMISSIONS } from '../core/services/access.js';
import { actorHasPermission, resolveScene, resolveThing, type WorldActor } from './resolver.js';
import { browseDocumentsFolder } from './documentsShelf.js';
import { updateNote } from './services/notesService.js';
import { startAgentPresenceTracking, sweepStaleAgents } from './agentPresence.js';
import * as presence from './presence.js';
import {
  getSpaceByKey,
  getThing,
  listAllThingsInSpace,
  listSpaces,
} from './services/worldService.js';
import type { ResolvedScene, WorldClientMessage, WorldServerMessage } from './types.js';

interface Client {
  ws: WebSocket;
  /** Identity token for the presence map — unique per connection. */
  conn: symbol;
  actor: WorldActor;
  spaceKey: string | null;
  lastSeen: number;
}

const clients = new Set<Client>();

let presenceTimer: NodeJS.Timeout | null = null;
let unsubscribeAudit: (() => void) | null = null;
let unsubscribeSnapshot: (() => void) | null = null;
let unsubscribeAgentPresence: (() => void) | null = null;

/**
 * Space keys whose scene needs rebuilding on the next tick.
 *
 * Audit events arrive at whatever rate the system is being used, and a scene
 * rebuild runs one query per bound object — so changes are coalesced into the
 * presence tick rather than rebuilding per event.
 */
const dirtySpaces = new Set<string>();

function send(ws: WebSocket, message: WorldServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function clientsInSpace(spaceKey: string): Client[] {
  return [...clients].filter((c) => c.spaceKey === spaceKey);
}

// ============================================
// Scene building
// ============================================

/**
 * Build the scene for one actor. Resolution is per-actor by necessity, not by
 * choice: two people in the same room legitimately see different contents,
 * because the binding resolver applies each one's own permissions.
 */
async function buildScene(spaceKey: string, actor: WorldActor): Promise<ResolvedScene | null> {
  const space = await getSpaceByKey(spaceKey);
  if (!space) return null;
  const rows = await listAllThingsInSpace(space.id);
  return resolveScene(space, rows, actor);
}

async function pushScene(client: Client): Promise<void> {
  if (!client.spaceKey) return;
  try {
    const scene = await buildScene(client.spaceKey, client.actor);
    if (!scene) {
      send(client.ws, { type: 'ERROR', message: `No space '${client.spaceKey}'` });
      return;
    }
    send(client.ws, { type: 'SCENE', scene });
  } catch (err) {
    send(client.ws, { type: 'ERROR', message: `scene failed: ${(err as Error).message}` });
  }
}

function broadcastPresence(spaceKey: string): void {
  const actors = presence.inSpace(spaceKey);
  for (const client of clientsInSpace(spaceKey)) {
    send(client.ws, { type: 'PRESENCE', spaceKey, actors });
  }
}

// ============================================
// Ticks
// ============================================

async function tick(): Promise<void> {
  const now = Date.now();

  // Drop connections that stopped talking, so avatars don't linger.
  for (const client of [...clients]) {
    if (now - client.lastSeen > PRESENCE_TIMEOUT_MS) {
      dropClient(client, 'timeout');
    }
  }
  // Same timeout for a synthetic agent presence — it has no socket to drop,
  // only a last-activity timestamp from the audit feed.
  sweepStaleAgents(PRESENCE_TIMEOUT_MS);

  for (const spaceKey of presence.occupiedSpaces()) {
    broadcastPresence(spaceKey);
  }

  if (dirtySpaces.size > 0) {
    const spaces = [...dirtySpaces];
    dirtySpaces.clear();
    for (const spaceKey of spaces) {
      for (const client of clientsInSpace(spaceKey)) {
        await pushScene(client);
      }
    }
  }
}

function startTicking(): void {
  if (presenceTimer) return;
  presenceTimer = setInterval(() => void tick(), PRESENCE_TICK_MS);
}

function stopTicking(): void {
  if (presenceTimer) clearInterval(presenceTimer);
  presenceTimer = null;
}

function dropClient(client: Client, _reason: string): void {
  const gone = presence.leave(client.conn);
  clients.delete(client);
  if (gone) broadcastPresence(gone.spaceKey);
  if (client.ws.readyState === client.ws.OPEN) client.ws.close();
  if (clients.size === 0) stopTicking();
}

/**
 * Mark every occupied space dirty when anything anywhere changes.
 *
 * Deliberately coarse: an audit event names a `config_id`, but which *objects*
 * are views of it depends on each thing's binding scope, so precisely matching
 * would mean resolving every binding just to decide whether to resolve it.
 * Rebuilding an occupied room is cheap; nobody is in most rooms.
 */
function onSystemChange(): void {
  for (const spaceKey of presence.occupiedSpaces()) dirtySpaces.add(spaceKey);
}

// ============================================
// Auth
// ============================================

async function actorFromToken(token: string | null): Promise<WorldActor | null> {
  if (!token) return null;
  const user = await validateAccessToken(token);
  if (!user) return null;
  return {
    userId: user.id,
    username: user.username,
    isAdmin: user.role === 'admin',
    permissions: await loadUserPermissions(user.id),
  };
}

// ============================================
// HTTP
// ============================================

function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
}

/** Token from `?token=` or an `Authorization: Bearer` header. */
function tokenFrom(req: IncomingMessage, url: URL): string | null {
  const q = url.searchParams.get('token');
  if (q) return q;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  return null;
}

async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === '/health') {
    json(res, 200, { ok: true, service: 'as500-world', clients: clients.size, actors: presence.count() });
    return;
  }

  const actor = await actorFromToken(tokenFrom(req, url));
  if (!actor) {
    json(res, 401, { error: 'a valid AS500 access token is required (?token= or Bearer)' });
    return;
  }

  if (url.pathname === '/world/api/spaces') {
    json(res, 200, { spaces: await listSpaces() });
    return;
  }

  const spaceMatch = url.pathname.match(/^\/world\/api\/space\/([\w-]+)$/);
  if (spaceMatch) {
    const scene = await buildScene(spaceMatch[1], actor);
    if (!scene) {
      json(res, 404, { error: `no space with key '${spaceMatch[1]}'` });
      return;
    }
    json(res, 200, scene);
    return;
  }

  json(res, 404, { error: 'not found' });
}

// ============================================
// WebSocket
// ============================================

async function handleClientMessage(client: Client, raw: string): Promise<void> {
  client.lastSeen = Date.now();

  let msg: WorldClientMessage;
  try {
    msg = JSON.parse(raw) as WorldClientMessage;
  } catch {
    send(client.ws, { type: 'ERROR', message: 'malformed message' });
    return;
  }

  switch (msg.type) {
    case 'PING':
      send(client.ws, { type: 'PONG' });
      return;

    case 'ENTER_SPACE': {
      const space = await getSpaceByKey(msg.spaceKey);
      if (!space) {
        send(client.ws, { type: 'ERROR', message: `No space '${msg.spaceKey}'` });
        return;
      }

      const previous = presence.leave(client.conn);
      if (previous) broadcastPresence(previous.spaceKey);

      client.spaceKey = space.key;
      presence.enter(client.conn, {
        actorId: client.actor.userId,
        username: client.actor.username,
        kind: 'human',
        spaceKey: space.key,
        atThingId: null,
        // Middle of the default room rather than the origin: (0,0) is the
        // top-left corner, where an avatar renders half outside the floor.
        pose: { x: 12, y: 8, rot: 0 },
        activity: 'idle',
        since: new Date().toISOString(),
      });

      await pushScene(client);
      broadcastPresence(space.key);
      return;
    }

    case 'LEAVE_SPACE': {
      const gone = presence.leave(client.conn);
      client.spaceKey = null;
      if (gone) broadcastPresence(gone.spaceKey);
      return;
    }

    case 'MOVE':
      // Poses are relayed, never validated or stored — the server owns
      // containment, not position. Rebroadcast happens on the next tick.
      presence.update(client.conn, {
        pose: msg.pose,
        atThingId: msg.atThingId ?? null,
        activity: 'walking',
      });
      return;

    case 'OPEN_THING': {
      const row = await getThing(msg.thingId);
      if (!row) {
        send(client.ws, { type: 'ERROR', message: `No object ${msg.thingId}` });
        return;
      }
      presence.update(client.conn, { atThingId: row.id, activity: 'reading' });
      send(client.ws, { type: 'THING_OPENED', thing: await resolveThing(row, client.actor) });
      return;
    }

    case 'BROWSE_DOCUMENTS_FOLDER': {
      // Any exception (permission revoked mid-session, folder deleted, …)
      // is caught by drain()'s wrapper around handleClientMessage and sent
      // as a generic ERROR — no bespoke error handling needed here.
      const { breadcrumb, entries } = await browseDocumentsFolder(client.actor, msg.folderId);
      send(client.ws, { type: 'DOCUMENTS_FOLDER', folderId: msg.folderId, breadcrumb, entries });
      return;
    }

    case 'SET_NOTE': {
      // The floorplan is not CRUDTable-driven, so a postit/board's textarea
      // writes through this one message instead of the terminal's form flow.
      // It still funnels through the identical service (updateNote) the
      // world_notes CRUDTableConfig uses, and audits itself the same way the
      // CRUDTable runtime would — so the existing onAuditEvent → dirty-room
      // pipeline broadcasts the change to every other viewer with no
      // bespoke fan-out code here.
      if (!actorHasPermission(client.actor, PERMISSIONS.WORLD_WRITE)) {
        send(client.ws, { type: 'ERROR', message: `Requires ${PERMISSIONS.WORLD_WRITE}` });
        return;
      }
      const row = await getThing(msg.thingId);
      if (!row || (row.type !== 'postit' && row.type !== 'board')) {
        send(client.ws, { type: 'ERROR', message: `No postit/board ${msg.thingId}` });
        return;
      }

      await updateNote({ userId: client.actor.userId, thingId: msg.thingId, body: msg.body, color: msg.color });
      await writeAuditEvent({
        event_type: 'crud',
        action: 'update',
        source: 'world',
        user_id: client.actor.userId,
        username: client.actor.username,
        config_id: 'world_notes',
        record_id: String(msg.thingId),
        ok: true,
      });

      send(client.ws, { type: 'THING_CHANGED', thing: await resolveThing(row, client.actor) });
      return;
    }

    case 'REFRESH':
      await pushScene(client);
      return;
  }
}

// ============================================
// Boot
// ============================================

export function startWorldServer(): ReturnType<typeof createServer> | null {
  if (!WORLD_ENABLED) {
    console.log('[world] disabled via WORLD_ENABLED=false');
    return null;
  }

  const httpServer = createServer((req, res) => {
    void handleHttp(req, res).catch((err) => {
      json(res, 500, { error: (err as Error).message });
    });
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/world/ws' });

  wss.on('connection', (ws, req) => {
    // Authenticating a connection is async, but clients send ENTER_SPACE the
    // instant the socket opens. The message listener is therefore attached
    // synchronously and frames are queued: attaching it after the await would
    // silently drop everything sent before authentication resolved.
    const queue: string[] = [];
    let client: Client | null = null;
    let draining = false;

    async function drain(): Promise<void> {
      if (draining) return;
      draining = true;
      try {
        // Frames arriving mid-drain join the same queue, so ordering holds.
        while (client && queue.length > 0) {
          const raw = queue.shift()!;
          try {
            await handleClientMessage(client, raw);
          } catch (err) {
            send(ws, { type: 'ERROR', message: (err as Error).message });
          }
        }
      } finally {
        draining = false;
      }
    }

    ws.on('message', (data) => {
      queue.push(data.toString());
      void drain();
    });

    void (async () => {
      const url = new URL(req.url ?? '/world/ws', `http://${req.headers.host ?? 'localhost'}`);
      const actor = await actorFromToken(tokenFrom(req, url));
      if (!actor) {
        send(ws, { type: 'ERROR', message: 'a valid AS500 access token is required' });
        ws.close(1008, 'unauthorized');
        return;
      }

      client = {
        ws,
        conn: Symbol(`world:${actor.userId}`),
        actor,
        spaceKey: null,
        lastSeen: Date.now(),
      };
      clients.add(client);
      startTicking();

      ws.on('close', () => client && dropClient(client, 'close'));
      ws.on('error', () => client && dropClient(client, 'error'));

      void drain();
    })();
  });

  unsubscribeAudit = onAuditEvent(onSystemChange);
  // Real component health for `{ kind: 'service' }` bindings — same coarse
  // "mark every occupied room dirty" handler the audit feed already uses,
  // for the same reason: resolving precisely would mean resolving every
  // binding just to decide whether it needs to.
  unsubscribeSnapshot = onSnapshot(onSystemChange);
  // Agents appear as occupants purely from their own MCP tool-call activity —
  // no new connection type, see agentPresence.ts.
  unsubscribeAgentPresence = startAgentPresenceTracking();

  httpServer.listen(WORLD_PORT, IS_PRODUCTION ? '127.0.0.1' : '0.0.0.0', () => {
    console.log(`AS500 world listening on port ${WORLD_PORT} (ws://localhost:${WORLD_PORT}/ws)`);
  });

  httpServer.on('close', () => {
    unsubscribeAudit?.();
    unsubscribeAudit = null;
    unsubscribeSnapshot?.();
    unsubscribeSnapshot = null;
    unsubscribeAgentPresence?.();
    unsubscribeAgentPresence = null;
    stopTicking();
  });

  return httpServer;
}
