/**
 * Virtual office — WebSocket client.
 *
 * Connects to the standalone world server (its own process, default :3006)
 * through the page's own origin under /world/* rather than a separate
 * host:port — Vite proxies /world there in dev, Caddy does the same in prod,
 * so no extra port ever needs opening in a firewall. Keeps the current scene
 * and the list of people in the room. Auth reuses the terminal's own access
 * token from the `as500_access_token` cookie: the office is not a separate
 * credential, it is the same user in a different projection.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DocumentsBrowseEntry,
  Presence,
  ResolvedScene,
  ResolvedThing,
  WorldClientMessage,
  WorldServerMessage,
} from './types';

/** One resolved level of a bookshelf's file-explorer modal. */
export interface DocumentsBrowseLevel {
  folderId: number | null;
  breadcrumb: string;
  entries: DocumentsBrowseEntry[];
}

const ACCESS_TOKEN_COOKIE = 'as500_access_token';

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
}

/** `?token=` in the URL wins, so the page can be opened without the terminal. */
function accessToken(): string | null {
  return new URLSearchParams(window.location.search).get('token') ?? readCookie(ACCESS_TOKEN_COOKIE);
}

function worldWsUrl(): string | null {
  const token = accessToken();
  if (!token) return null;
  // WebSocket() needs a full ws(s):// URL — unlike a fetch path, a relative
  // one won't do — but "full" still means this page's own host, not a
  // separate port: the dev/prod proxy is what turns /world/ws into a
  // connection to the actual world server.
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/world/ws?token=${encodeURIComponent(token)}`;
}

/** `path` is the world server's own route, e.g. '/api/spaces' — this prefixes
 *  it with /world so it resolves same-origin through the dev/prod proxy. */
export function worldApiUrl(path: string): string | null {
  const token = accessToken();
  if (!token) return null;
  return `/world${path}?token=${encodeURIComponent(token)}`;
}

export interface WorldConnection {
  connected: boolean;
  authed: boolean;
  error: string | null;
  scene: ResolvedScene | null;
  actors: Presence[];
  opened: ResolvedThing | null;
  /** The current level of an open bookshelf modal, or null while none is open. */
  browse: DocumentsBrowseLevel | null;
  enterSpace: (spaceKey: string) => void;
  openThing: (thingId: number) => void;
  closeThing: () => void;
  /** Ask the server to resolve one folder level for the bookshelf modal. */
  browseFolder: (folderId: number | null) => void;
  /** Write a postit/board's text. Not CRUDTable-driven — see server/src/world/index.ts's SET_NOTE case. */
  setNote: (thingId: number, body: string, color?: string) => void;
  move: (pose: { x: number; y: number; rot: number }) => void;
  refresh: () => void;
}

export function useWorldSocket(initialSpaceKey: string | null, enabled = true): WorldConnection {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scene, setScene] = useState<ResolvedScene | null>(null);
  const [actors, setActors] = useState<Presence[]>([]);
  const [opened, setOpened] = useState<ResolvedThing | null>(null);
  const [browse, setBrowse] = useState<DocumentsBrowseLevel | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  // `enabled` is false while the login gate is still up: no token has been
  // issued yet, so there is nothing to connect with and no error to show.
  const authed = enabled && accessToken() != null;

  // Held in a ref so the socket's onopen can rejoin the current room after a
  // reconnect without the effect needing to tear the socket down.
  const spaceKeyRef = useRef<string | null>(initialSpaceKey);

  const send = useCallback((msg: WorldClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    if (!authed) {
      if (enabled) setError('No AS500 access token. Sign in to the terminal first, or add ?token=…');
      return;
    }

    let destroyed = false;
    let retry = 1000;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (destroyed) return;
      const url = worldWsUrl();
      if (!url) return;

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (destroyed) { ws.close(); return; }
        retry = 1000;
        setConnected(true);
        setError(null);
        if (spaceKeyRef.current) {
          ws.send(JSON.stringify({ type: 'ENTER_SPACE', spaceKey: spaceKeyRef.current }));
        }
      };

      ws.onmessage = (event) => {
        if (destroyed) return;
        let msg: WorldServerMessage;
        try {
          msg = JSON.parse(event.data) as WorldServerMessage;
        } catch {
          return;
        }

        switch (msg.type) {
          case 'SCENE':
            setScene(msg.scene);
            setError(null);
            // Keep an open panel in step with the refreshed scene, so a live
            // change (someone filing a document) updates what is on screen.
            setOpened((prev) => (prev ? findThing(msg.scene.things, prev.id) ?? prev : null));
            break;
          case 'PRESENCE':
            setActors(msg.actors);
            break;
          case 'THING_OPENED':
            setOpened(msg.thing);
            break;
          case 'THING_CHANGED':
            setOpened((prev) => (prev && prev.id === msg.thing.id ? msg.thing : prev));
            break;
          case 'DOCUMENTS_FOLDER':
            setBrowse({ folderId: msg.folderId, breadcrumb: msg.breadcrumb, entries: msg.entries });
            break;
          case 'ERROR':
            setError(msg.message);
            break;
          case 'PONG':
            break;
        }
      };

      ws.onclose = () => {
        // A socket that has already been torn down must not touch state: React
        // StrictMode mounts the effect twice in dev, and the discarded socket's
        // close would otherwise mark the live one disconnected.
        if (destroyed) return;
        setConnected(false);
        const delay = retry;
        retry = Math.min(retry * 2, 30000);
        timer = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // onclose fires next and schedules the retry.
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (timer) clearTimeout(timer);
      const ws = wsRef.current;
      if (ws && ws.readyState !== WebSocket.CONNECTING) ws.close();
    };
  }, [authed]);

  const enterSpace = useCallback((spaceKey: string) => {
    spaceKeyRef.current = spaceKey;
    setOpened(null);
    send({ type: 'ENTER_SPACE', spaceKey });
  }, [send]);

  const openThing = useCallback((thingId: number) => send({ type: 'OPEN_THING', thingId }), [send]);
  const closeThing = useCallback(() => setOpened(null), []);
  const browseFolder = useCallback(
    (folderId: number | null) => send({ type: 'BROWSE_DOCUMENTS_FOLDER', folderId }),
    [send],
  );
  const setNote = useCallback(
    (thingId: number, body: string, color?: string) => send({ type: 'SET_NOTE', thingId, body, color }),
    [send],
  );
  const move = useCallback(
    (pose: { x: number; y: number; rot: number }) => send({ type: 'MOVE', pose }),
    [send],
  );
  const refresh = useCallback(() => send({ type: 'REFRESH' }), [send]);

  return {
    connected, authed, error, scene, actors, opened, browse,
    enterSpace, openThing, closeThing, browseFolder, setNote, move, refresh,
  };
}

/** Depth-first lookup through the furniture tree. */
export function findThing(things: ResolvedThing[], id: number): ResolvedThing | null {
  for (const t of things) {
    if (t.id === id) return t;
    const found = findThing(t.children, id);
    if (found) return found;
  }
  return null;
}
