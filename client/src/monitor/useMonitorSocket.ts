/**
 * Ingest Monitor — WebSocket client.
 *
 * Connects to the standalone monitor server (default :3005), keeps the latest
 * snapshot, and maintains a per-source log buffer for whichever source the log
 * console is currently showing. Also carries the request/response traffic for
 * the document inspector (browser rows, one document's artefacts, search).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DocumentDetail,
  DocumentListRow,
  LogLine,
  MonitorClientMessage,
  MonitorServerMessage,
  MonitorSnapshot,
  SearchOutcome,
} from './types';

const MAX_CLIENT_LOG_LINES = 1500;

function monitorOrigin(): { host: string; port: string; token: string | null } {
  const port = (import.meta.env.VITE_MONITOR_PORT as string | undefined) ?? '3005';
  const token = new URLSearchParams(window.location.search).get('token');
  return { host: window.location.hostname, port, token };
}

function monitorWsUrl(): string {
  const override = import.meta.env.VITE_MONITOR_WS_URL as string | undefined;
  if (override) return override;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const { host, port, token } = monitorOrigin();
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${protocol}//${host}:${port}/ws${query}`;
}

/**
 * Extracted images and original uploads are streamed by the monitor server, not
 * by Vite, so `<img src>` needs the absolute :3005 origin.
 */
export function monitorAssetUrl(path: string | null): string | null {
  if (!path) return null;
  const { host, port, token } = monitorOrigin();
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${window.location.protocol}//${host}:${port}${path}${query}`;
}

export interface MonitorConnection {
  connected: boolean;
  snapshot: MonitorSnapshot | null;
  error: string | null;
  /** Milliseconds since the last snapshot arrived, for a staleness indicator. */
  lastUpdateAt: number | null;
  logs: LogLine[];
  logSource: string | null;
  watchLogSource: (source: string | null) => void;
  refresh: () => void;
  setPollMs: (ms: number) => void;

  documents: DocumentListRow[];
  documentsError: string | null;
  requestDocuments: () => void;

  openItemId: number | null;
  detail: DocumentDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  openDocument: (itemId: number) => void;
  closeDocument: () => void;

  search: SearchOutcome | null;
  searchBusy: boolean;
  runSearch: (query: string, userId: number, topK?: number) => void;
  clearSearch: () => void;
}

export function useMonitorSocket(): MonitorConnection {
  const [connected, setConnected] = useState(false);
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [logSource, setLogSource] = useState<string | null>(null);

  const [documents, setDocuments] = useState<DocumentListRow[]>([]);
  const [documentsError, setDocumentsError] = useState<string | null>(null);

  const [openItemId, setOpenItemId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [search, setSearch] = useState<SearchOutcome | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const logSourceRef = useRef<string | null>(null);
  const openItemRef = useRef<number | null>(null);
  const reconnectDelay = useRef(1000);

  const send = useCallback((message: MonitorClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }, []);

  useEffect(() => {
    let destroyed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (destroyed) return;

      const ws = new WebSocket(monitorWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setError(null);
        reconnectDelay.current = 1000;
        // Re-subscribe after a reconnect so the console keeps streaming and the
        // open inspector repopulates without user action.
        if (logSourceRef.current) {
          ws.send(JSON.stringify({ type: 'SUBSCRIBE_LOGS', source: logSourceRef.current }));
        }
        ws.send(JSON.stringify({ type: 'LIST_DOCUMENTS' }));
        if (openItemRef.current != null) {
          ws.send(JSON.stringify({ type: 'OPEN_DOCUMENT', itemId: openItemRef.current }));
        }
      };

      ws.onmessage = (event) => {
        let msg: MonitorServerMessage;
        try {
          msg = JSON.parse(event.data as string) as MonitorServerMessage;
        } catch {
          return;
        }

        switch (msg.type) {
          case 'SNAPSHOT':
            setSnapshot(msg.snapshot);
            setLastUpdateAt(Date.now());
            break;

          case 'LOG_BATCH':
            // Ignore batches for a source the console has already switched away from.
            if (msg.source !== logSourceRef.current) break;
            setLogs((prev) => {
              const next = msg.replace ? msg.lines : [...prev, ...msg.lines];
              return next.length > MAX_CLIENT_LOG_LINES
                ? next.slice(next.length - MAX_CLIENT_LOG_LINES)
                : next;
            });
            break;

          case 'DOCUMENT_LIST':
            setDocuments(msg.documents);
            setDocumentsError(msg.error);
            break;

          case 'DOCUMENT_DETAIL':
            // A slow reply for a document the user already closed must not reopen it.
            if (msg.itemId !== openItemRef.current) break;
            setDetail(msg.document);
            setDetailError(msg.error);
            setDetailLoading(false);
            break;

          case 'SEARCH_RESULT':
            setSearch(msg.result);
            setSearchBusy(false);
            break;

          case 'ERROR':
            setError(msg.message);
            break;

          case 'PONG':
            break;
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (destroyed) return;
        const delay = reconnectDelay.current;
        reconnectDelay.current = Math.min(delay * 2, 15000);
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        setError(`cannot reach ${monitorWsUrl()}`);
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  const watchLogSource = useCallback(
    (source: string | null) => {
      const previous = logSourceRef.current;
      if (previous === source) return;
      if (previous) send({ type: 'UNSUBSCRIBE_LOGS', source: previous });

      logSourceRef.current = source;
      setLogSource(source);
      setLogs([]);
      if (source) send({ type: 'SUBSCRIBE_LOGS', source });
    },
    [send],
  );

  const refresh = useCallback(() => send({ type: 'REFRESH' }), [send]);
  const setPollMs = useCallback((ms: number) => send({ type: 'SET_POLL', ms }), [send]);

  const requestDocuments = useCallback(() => send({ type: 'LIST_DOCUMENTS' }), [send]);

  const openDocument = useCallback(
    (itemId: number) => {
      // Keep the previous payload on screen while re-reading the same document,
      // so live artefact counts don't flash the panel empty.
      if (openItemRef.current !== itemId) {
        setDetail(null);
        setSearch(null);
      }
      openItemRef.current = itemId;
      setOpenItemId(itemId);
      setDetailError(null);
      setDetailLoading(true);
      send({ type: 'OPEN_DOCUMENT', itemId });
    },
    [send],
  );

  const closeDocument = useCallback(() => {
    openItemRef.current = null;
    setOpenItemId(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
    setSearch(null);
  }, []);

  const runSearch = useCallback(
    (query: string, userId: number, topK?: number) => {
      if (!query.trim()) return;
      setSearchBusy(true);
      send({ type: 'SEARCH', query, userId, topK });
    },
    [send],
  );

  const clearSearch = useCallback(() => setSearch(null), []);

  return {
    connected,
    snapshot,
    error,
    lastUpdateAt,
    logs,
    logSource,
    watchLogSource,
    refresh,
    setPollMs,
    documents,
    documentsError,
    requestDocuments,
    openItemId,
    detail,
    detailLoading,
    detailError,
    openDocument,
    closeDocument,
    search,
    searchBusy,
    runSearch,
    clearSearch,
  };
}
