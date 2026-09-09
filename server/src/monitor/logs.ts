/**
 * Ingest Monitor — log hub.
 *
 * Every declared source is tailed continuously (not only while a client is
 * watching it) for two reasons: the error/warning badges on the dashboard must be
 * accurate the moment the page loads, and the worker's log stream is what drives
 * fine-grained ingestion stage detection.
 *
 * Buffers are capped per source, so continuous tailing has a bounded memory cost.
 */

import { open, stat } from 'fs/promises';
import { LOG_BUFFER_LINES, LOG_SOURCES, type LogSourceDef } from './config.js';
import {
  dockerAvailable,
  followLogs,
  inspectContainer,
  listContainers,
  matchContainer,
  type DockerContainer,
} from './docker.js';
import { recordWorkerEvent } from './pipeline.js';
import type { LogLevel, LogLine, LogSourceInfo } from './types.js';

interface SourceState {
  def: LogSourceDef;
  lines: LogLine[];
  seq: number;
  errorCount: number;
  warnCount: number;
  lastLineAt: string | null;
  available: boolean;
  detail: string;
  /** Set while a stream/tail is attached. */
  stop: (() => void) | null;
  /** Container or file currently attached, used to detect replacement. */
  attachedTo: string | null;
  /** Epoch ms of the next allowed attach attempt. */
  retryAfter: number;
  /** File tail bookkeeping. */
  filePos: number;
}

const sources = new Map<string, SourceState>();
const listeners = new Set<(source: string, lines: LogLine[]) => void>();

for (const def of LOG_SOURCES) {
  sources.set(def.key, {
    def,
    lines: [],
    seq: 0,
    errorCount: 0,
    warnCount: 0,
    lastLineAt: null,
    available: false,
    detail: 'not attached',
    stop: null,
    attachedTo: null,
    retryAfter: 0,
    filePos: 0,
  });
}

export function onLogLines(cb: (source: string, lines: LogLine[]) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const PLAIN_ERROR = /\b(error|fatal|critical|exception|traceback|failed|panic)\b/i;
const PLAIN_WARN = /\b(warn|warning|deprecated|degraded|retry)\b/i;

/** Docker prefixes every line with an RFC3339Nano timestamp when timestamps=1. */
const DOCKER_TS = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s(.*)$/s;

function splitDockerTimestamp(raw: string): { ts: string; rest: string } {
  const match = DOCKER_TS.exec(raw);
  if (!match) return { ts: new Date().toISOString(), rest: raw };
  const parsed = new Date(match[1]);
  return {
    ts: Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString(),
    rest: match[2],
  };
}

/**
 * as500-docs and the AS500 server emit structlog/JSON; Postgres, uvicorn and vLLM
 * emit plain text. Both shapes are normalised to a level + display string.
 */
function parseLine(raw: string, stream: 'stdout' | 'stderr'): { level: LogLevel; text: string; event: string | null } {
  const trimmed = raw.trim();

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const event = typeof obj.event === 'string' ? obj.event : null;
      const rawLevel = typeof obj.level === 'string' ? obj.level.toLowerCase() : '';
      const level: LogLevel =
        rawLevel.startsWith('err') || rawLevel === 'critical' || rawLevel === 'fatal'
          ? 'error'
          : rawLevel.startsWith('warn')
            ? 'warn'
            : rawLevel === 'debug'
              ? 'debug'
              : 'info';

      const extras = Object.entries(obj)
        .filter(([k]) => !['event', 'level', 'timestamp', 'logger', 'exc_info'].includes(k))
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
        .join(' ');

      const text = [event ?? '', extras].filter(Boolean).join('  ');
      return { level, text: text || trimmed, event };
    } catch {
      // fall through to plain-text handling
    }
  }

  const level: LogLevel = PLAIN_ERROR.test(trimmed)
    ? 'error'
    : PLAIN_WARN.test(trimmed)
      ? 'warn'
      : stream === 'stderr' && /\b(traceback|caused by)\b/i.test(trimmed)
        ? 'error'
        : 'info';

  return { level, text: trimmed, event: null };
}

function push(
  state: SourceState,
  raw: string,
  stream: 'stdout' | 'stderr',
  hasDockerTimestamp: boolean,
): LogLine {
  const { ts, rest } = hasDockerTimestamp
    ? splitDockerTimestamp(raw)
    : { ts: new Date().toISOString(), rest: raw };

  const { level, text, event } = parseLine(rest, stream);
  const line: LogLine = { seq: ++state.seq, ts, level, text, event };

  state.lines.push(line);
  if (state.lines.length > LOG_BUFFER_LINES) {
    state.lines.splice(0, state.lines.length - LOG_BUFFER_LINES);
  }
  if (level === 'error') state.errorCount++;
  if (level === 'warn') state.warnCount++;
  state.lastLineAt = line.ts;

  // Stage hints are timestamped with the log's own time so that backfilled
  // history cannot resurrect a stage the worker finished hours ago.
  if (state.def.key === 'docs-worker' && event) {
    recordWorkerEvent(event, new Date(ts).getTime());
  }

  return line;
}

function emit(key: string, lines: LogLine[]): void {
  if (!lines.length) return;
  for (const cb of listeners) cb(key, lines);
}

/* ── Docker-backed sources ───────────────────────────────────────────────── */

async function attachDocker(state: SourceState, containers: DockerContainer[]): Promise<void> {
  const container = matchContainer(containers, state.def.containerMatch, state.def.imageMatch);

  if (!container) {
    if (state.stop) {
      state.stop();
      state.stop = null;
      state.attachedTo = null;
    }
    state.available = false;
    state.detail = 'container not found';
    return;
  }

  if (container.state !== 'running') {
    if (state.stop) {
      state.stop();
      state.stop = null;
    }
    state.attachedTo = null;
    state.available = false;
    state.detail = `${container.name} · ${container.state}`;
    return;
  }

  // Already following this exact container.
  if (state.stop && state.attachedTo === container.id) {
    state.available = true;
    state.detail = container.name;
    return;
  }

  if (state.stop) {
    state.stop();
    state.stop = null;
  }
  if (Date.now() < state.retryAfter) return;

  let tty = false;
  try {
    tty = (await inspectContainer(container.id)).tty;
  } catch {
    // Assume multiplexed (the compose default) when inspect fails.
  }

  state.attachedTo = container.id;
  state.available = true;
  state.detail = container.name;

  // Batch lines within a tick so a burst of output becomes one broadcast.
  let batch: LogLine[] = [];
  let flushTimer: NodeJS.Timeout | null = null;
  const flush = () => {
    flushTimer = null;
    const out = batch;
    batch = [];
    emit(state.def.key, out);
  };

  state.stop = followLogs({
    containerId: container.id,
    tty,
    tail: Math.min(LOG_BUFFER_LINES, 300),
    onLine: (raw, stream) => {
      batch.push(push(state, raw, stream, true));
      if (!flushTimer) flushTimer = setTimeout(flush, 150);
    },
    onClose: (err) => {
      state.stop = null;
      state.attachedTo = null;
      state.available = false;
      state.detail = err ? `stream closed: ${err.message}` : 'stream closed';
      // Back off briefly so a crash-looping container cannot spin the hub.
      state.retryAfter = Date.now() + 3000;
    },
  });
}

/* ── File-backed sources ─────────────────────────────────────────────────── */

const MAX_FILE_READ_BYTES = 512 * 1024;
const INITIAL_FILE_TAIL_BYTES = 64 * 1024;

async function readFileDelta(state: SourceState): Promise<void> {
  const path = state.def.file!;
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    state.available = false;
    state.detail = `not mounted: ${path}`;
    return;
  }

  state.available = true;
  state.detail = path;

  // First read: seed the buffer from the tail of the file only.
  if (state.filePos === 0) {
    state.filePos = Math.max(0, size - INITIAL_FILE_TAIL_BYTES);
  }
  // Truncated or rotated.
  if (size < state.filePos) state.filePos = 0;
  if (size === state.filePos) return;

  const handle = await open(path, 'r');
  try {
    const length = Math.min(size - state.filePos, MAX_FILE_READ_BYTES);
    const buf = Buffer.alloc(length);
    await handle.read(buf, 0, length, state.filePos);
    state.filePos += length;

    const chunk = buf.toString('utf8');
    const lines = chunk.split(/\r?\n/);

    // A partial trailing line is re-read next tick by rewinding the cursor. If the
    // whole read contained no newline the cursor would rewind fully and the tail
    // would spin re-reading the same bytes, so an oversized line is flushed as-is.
    if (lines.length > 1 || length < MAX_FILE_READ_BYTES) {
      const trailing = lines.pop() ?? '';
      state.filePos -= Buffer.byteLength(trailing, 'utf8');
    }

    const emitted = lines
      .filter((l) => l.trim())
      .map((l) => push(state, l, 'stderr', false));
    emit(state.def.key, emitted);
  } finally {
    await handle.close();
  }
}

/* ── Hub loop ────────────────────────────────────────────────────────────── */

let timer: NodeJS.Timeout | null = null;

async function tick(): Promise<void> {
  const docker = await dockerAvailable();
  let containers: DockerContainer[] = [];
  if (docker.ok) {
    try {
      containers = await listContainers();
    } catch {
      containers = [];
    }
  }

  for (const state of sources.values()) {
    try {
      if (state.def.kind === 'docker') {
        if (!docker.ok) {
          state.available = false;
          state.detail = 'docker socket not available';
          continue;
        }
        await attachDocker(state, containers);
      } else {
        await readFileDelta(state);
      }
    } catch (err) {
      state.available = false;
      state.detail = (err as Error).message;
    }
  }
}

export function startLogHub(): void {
  if (timer) return;
  void tick();
  timer = setInterval(() => void tick(), 3000);
}

export function stopLogHub(): void {
  if (timer) clearInterval(timer);
  timer = null;
  for (const state of sources.values()) {
    state.stop?.();
    state.stop = null;
  }
}

export function getLogBuffer(key: string): LogLine[] {
  return sources.get(key)?.lines ?? [];
}

export function getLogSourceInfos(): LogSourceInfo[] {
  return [...sources.values()].map((s) => ({
    key: s.def.key,
    label: s.def.label,
    kind: s.def.kind,
    available: s.available,
    detail: s.detail,
    errorCount: s.errorCount,
    warnCount: s.warnCount,
    lastLineAt: s.lastLineAt,
  }));
}

/** Recent error/warning lines for a source, newest last. */
export function getRecentProblems(key: string, limit = 5): LogLine[] {
  const lines = sources.get(key)?.lines ?? [];
  return lines.filter((l) => l.level === 'error' || l.level === 'warn').slice(-limit);
}
