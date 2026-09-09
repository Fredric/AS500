/**
 * Ingest Monitor — self-contained HTTP + WebSocket server.
 *
 * Runs on its own port (default 3005) rather than sharing 3001, because the
 * terminal's WebSocketServer is created without a `path` filter and therefore
 * claims every upgrade request on that port. A dedicated listener keeps the two
 * protocols completely independent — this whole folder can be deleted without
 * touching a line of terminal code.
 *
 * Endpoints:
 *   GET  /health              liveness
 *   GET  /api/snapshot        the same payload the WebSocket pushes (for curl)
 *   GET  /api/logs/:source    buffered lines for one source
 *   GET  /api/documents       document browser rows
 *   GET  /api/documents/:id   full inspection payload for one document
 *   GET  /api/image/:id       extracted page image (document_images)
 *   GET  /api/original/:id    the original uploaded file
 *   WS   /ws                  live snapshots + log streaming + inspection
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  IS_PRODUCTION,
  MONITOR_ENABLED,
  MONITOR_POLL_MS,
  MONITOR_PORT,
  MONITOR_TOKEN,
} from './config.js';
import { readQueue } from './db.js';
import {
  listDocuments,
  locateImage,
  locateOriginal,
  openFileStream,
  readDocument,
  searchDocuments,
  type StreamableFile,
} from './documents.js';
import { getLogBuffer, getLogSourceInfos, onLogLines, startLogHub, stopLogHub } from './logs.js';
import { probeAll, rollUp, SERVER_STARTED_AT } from './probes.js';
import type { MonitorClientMessage, MonitorServerMessage, MonitorSnapshot } from './types.js';

interface Client {
  ws: WebSocket;
  /** Log source keys this client is currently watching. */
  subscriptions: Set<string>;
}

const clients = new Set<Client>();

let pollMs = MONITOR_POLL_MS;
let pollTimer: NodeJS.Timeout | null = null;
let lastSnapshot: MonitorSnapshot | null = null;
let building = false;

async function buildSnapshot(): Promise<MonitorSnapshot> {
  const queue = await readQueue();
  const { components, gpu, warnings } = await probeAll({ queue });

  return {
    ts: new Date().toISOString(),
    serverStartedAt: SERVER_STARTED_AT.toISOString(),
    pollMs,
    overall: rollUp(components),
    components,
    queue,
    gpu,
    logSources: getLogSourceInfos(),
    warnings,
  };
}

function send(ws: WebSocket, message: MonitorServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function broadcast(message: MonitorServerMessage): void {
  for (const client of clients) send(client.ws, message);
}

async function pollOnce(): Promise<void> {
  // A slow probe must not queue up overlapping polls.
  if (building) return;
  building = true;
  try {
    lastSnapshot = await buildSnapshot();
    broadcast({ type: 'SNAPSHOT', snapshot: lastSnapshot });
  } catch (err) {
    console.error('[monitor] snapshot failed:', (err as Error).message);
    broadcast({ type: 'ERROR', message: `snapshot failed: ${(err as Error).message}` });
  } finally {
    building = false;
  }
}

function startPolling(): void {
  if (pollTimer) return;
  void pollOnce();
  pollTimer = setInterval(() => void pollOnce(), pollMs);
}

function stopPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function restartPolling(): void {
  stopPolling();
  if (clients.size > 0) startPolling();
}

/* ── HTTP ────────────────────────────────────────────────────────────────── */

function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
}

function authorized(url: URL): boolean {
  if (!MONITOR_TOKEN) return true;
  return url.searchParams.get('token') === MONITOR_TOKEN;
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
    json(res, 200, { ok: true, service: 'as500-ingest-monitor', clients: clients.size });
    return;
  }

  if (!authorized(url)) {
    json(res, 401, { error: 'monitor token required' });
    return;
  }

  if (url.pathname === '/api/snapshot') {
    json(res, 200, lastSnapshot ?? (await buildSnapshot()));
    return;
  }

  const logMatch = url.pathname.match(/^\/api\/logs\/([\w-]+)$/);
  if (logMatch) {
    json(res, 200, { source: logMatch[1], lines: getLogBuffer(logMatch[1]) });
    return;
  }

  if (url.pathname === '/api/documents') {
    json(res, 200, { documents: await listDocuments() });
    return;
  }

  const docMatch = url.pathname.match(/^\/api\/documents\/(\d+)$/);
  if (docMatch) {
    const detail = await readDocument(Number(docMatch[1]));
    if (!detail) {
      json(res, 404, { error: `no document_items row with id ${docMatch[1]}` });
      return;
    }
    json(res, 200, detail);
    return;
  }

  const imageMatch = url.pathname.match(/^\/api\/image\/(\d+)$/);
  if (imageMatch) {
    await streamFile(res, await locateImage(Number(imageMatch[1])));
    return;
  }

  const originalMatch = url.pathname.match(/^\/api\/original\/(\d+)$/);
  if (originalMatch) {
    await streamFile(res, await locateOriginal(Number(originalMatch[1])));
    return;
  }

  json(res, 404, { error: 'not found' });
}

async function streamFile(res: ServerResponse, file: StreamableFile | null): Promise<void> {
  if (!file) {
    json(res, 404, { error: 'file not readable — is the storage tree mounted?' });
    return;
  }

  cors(res);
  res.writeHead(200, {
    'Content-Type': file.contentType,
    'Content-Length': String(file.sizeBytes),
    // Admin tool on loopback; the files are inspected repeatedly while tuning.
    'Cache-Control': 'private, max-age=60',
    'Content-Disposition': `inline; filename="${file.filename.replace(/"/g, '')}"`,
  });

  const stream = openFileStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

/* ── WebSocket ───────────────────────────────────────────────────────────── */

function handleClientMessage(client: Client, raw: string): void {
  let msg: MonitorClientMessage;
  try {
    msg = JSON.parse(raw) as MonitorClientMessage;
  } catch {
    send(client.ws, { type: 'ERROR', message: 'malformed message' });
    return;
  }

  switch (msg.type) {
    case 'SUBSCRIBE_LOGS':
      client.subscriptions.add(msg.source);
      // Seed the viewer with everything buffered so far.
      send(client.ws, {
        type: 'LOG_BATCH',
        source: msg.source,
        lines: getLogBuffer(msg.source),
        replace: true,
      });
      break;

    case 'UNSUBSCRIBE_LOGS':
      client.subscriptions.delete(msg.source);
      break;

    case 'REFRESH':
      void pollOnce();
      break;

    case 'SET_POLL':
      pollMs = Math.min(30_000, Math.max(1000, Math.round(msg.ms)));
      restartPolling();
      break;

    case 'PING':
      send(client.ws, { type: 'PONG' });
      break;

    case 'LIST_DOCUMENTS':
      void listDocuments()
        .then((documents) => send(client.ws, { type: 'DOCUMENT_LIST', documents, error: null }))
        .catch((err: Error) =>
          send(client.ws, { type: 'DOCUMENT_LIST', documents: [], error: err.message }),
        );
      break;

    case 'OPEN_DOCUMENT': {
      const itemId = Number(msg.itemId);
      if (!Number.isInteger(itemId)) {
        send(client.ws, { type: 'ERROR', message: 'OPEN_DOCUMENT requires an integer itemId' });
        break;
      }
      void readDocument(itemId)
        .then((document) =>
          send(client.ws, {
            type: 'DOCUMENT_DETAIL',
            itemId,
            document,
            error: document ? null : `no document_items row with id ${itemId}`,
          }),
        )
        .catch((err: Error) =>
          send(client.ws, { type: 'DOCUMENT_DETAIL', itemId, document: null, error: err.message }),
        );
      break;
    }

    case 'SEARCH':
      void searchDocuments(String(msg.query), Number(msg.userId), msg.topK)
        .then((result) => send(client.ws, { type: 'SEARCH_RESULT', result }))
        .catch((err: Error) =>
          send(client.ws, {
            type: 'SEARCH_RESULT',
            result: {
              query: String(msg.query),
              userId: Number(msg.userId),
              total: 0,
              tookMs: 0,
              hits: [],
              error: err.message,
              keywordDead: false,
            },
          }),
        );
      break;
  }
}

export function startMonitorServer(): ReturnType<typeof createServer> | null {
  if (!MONITOR_ENABLED) {
    console.log('[monitor] disabled via MONITOR_ENABLED=false');
    return null;
  }
  if (IS_PRODUCTION && !MONITOR_TOKEN) {
    console.warn(
      '[monitor] refusing to start in production without MONITOR_TOKEN — ' +
        'the dashboard exposes raw service logs. Set MONITOR_TOKEN to enable it.',
    );
    return null;
  }

  startLogHub();

  const httpServer = createServer((req, res) => {
    void handleHttp(req, res).catch((err) => {
      json(res, 500, { error: (err as Error).message });
    });
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/ws', `http://${req.headers.host ?? 'localhost'}`);
    if (!authorized(url)) {
      send(ws, { type: 'ERROR', message: 'monitor token required' });
      ws.close(1008, 'unauthorized');
      return;
    }

    const client: Client = { ws, subscriptions: new Set() };
    clients.add(client);
    startPolling();

    if (lastSnapshot) send(ws, { type: 'SNAPSHOT', snapshot: lastSnapshot });
    else void pollOnce();

    ws.on('message', (data) => handleClientMessage(client, data.toString()));
    ws.on('close', () => {
      clients.delete(client);
      if (clients.size === 0) stopPolling();
    });
    ws.on('error', () => {
      clients.delete(client);
      if (clients.size === 0) stopPolling();
    });
  });

  const unsubscribeLogs = onLogLines((source, lines) => {
    for (const client of clients) {
      if (client.subscriptions.has(source)) {
        send(client.ws, { type: 'LOG_BATCH', source, lines, replace: false });
      }
    }
  });

  httpServer.listen(MONITOR_PORT, '0.0.0.0', () => {
    console.log(
      `AS500 ingest monitor listening on port ${MONITOR_PORT} ` +
        `(ws://localhost:${MONITOR_PORT}/ws)${MONITOR_TOKEN ? ' — token required' : ''}`,
    );
  });

  httpServer.on('close', () => {
    unsubscribeLogs();
    stopPolling();
    stopLogHub();
  });

  return httpServer;
}
