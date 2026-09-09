/**
 * Ingest Monitor — minimal Docker Engine API client over the unix socket.
 *
 * Only three capabilities are needed: list containers, inspect one, and follow
 * its log stream. Using the Engine API directly avoids shipping the docker CLI
 * into the server image.
 *
 * When the socket is not mounted every call fails fast and the dashboard falls
 * back to HTTP-only probes.
 */

import http from 'http';
import { DOCKER_SOCKET } from './config.js';

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  /** running | exited | created | restarting | paused | dead */
  state: string;
  status: string;
  labels: Record<string, string>;
}

export interface DockerInspect {
  tty: boolean;
  startedAt: string | null;
  restartCount: number;
  state: string;
  health: string | null;
  exitCode: number | null;
  error: string | null;
}

class DockerUnavailableError extends Error {}

function request(
  path: string,
  timeoutMs: number,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: DOCKER_SOCKET, path, method: 'GET', timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('timeout', () => req.destroy(new DockerUnavailableError('docker socket timeout')));
    req.on('error', (err) => reject(err));
    req.end();
  });
}

async function getJson<T>(path: string, timeoutMs = 3000): Promise<T> {
  const { status, body } = await request(path, timeoutMs);
  if (status < 200 || status >= 300) {
    throw new DockerUnavailableError(`docker API ${status}: ${body.slice(0, 200)}`);
  }
  return JSON.parse(body) as T;
}

let availableCache: { ok: boolean; detail: string; at: number } | null = null;

/** Cheap liveness check, cached for a second so the poll loop stays quiet. */
export async function dockerAvailable(): Promise<{ ok: boolean; detail: string }> {
  if (availableCache && Date.now() - availableCache.at < 1000) {
    return { ok: availableCache.ok, detail: availableCache.detail };
  }
  let result: { ok: boolean; detail: string };
  try {
    await request('/_ping', 2000);
    result = { ok: true, detail: `socket ${DOCKER_SOCKET}` };
  } catch (err) {
    result = { ok: false, detail: (err as Error).message };
  }
  availableCache = { ...result, at: Date.now() };
  return result;
}

export async function listContainers(): Promise<DockerContainer[]> {
  const raw = await getJson<
    Array<{
      Id: string;
      Names: string[];
      Image: string;
      State: string;
      Status: string;
      Labels?: Record<string, string>;
    }>
  >('/containers/json?all=1');

  return raw.map((c) => ({
    id: c.Id,
    name: (c.Names?.[0] ?? '').replace(/^\//, ''),
    image: c.Image,
    state: c.State,
    status: c.Status,
    labels: c.Labels ?? {},
  }));
}

export async function inspectContainer(id: string): Promise<DockerInspect> {
  const raw = await getJson<{
    Config?: { Tty?: boolean };
    State?: {
      Status?: string;
      StartedAt?: string;
      Restarting?: boolean;
      ExitCode?: number;
      Error?: string;
      Health?: { Status?: string };
    };
    RestartCount?: number;
  }>(`/containers/${id}/json`);

  return {
    tty: raw.Config?.Tty === true,
    startedAt: raw.State?.StartedAt && !raw.State.StartedAt.startsWith('0001')
      ? raw.State.StartedAt
      : null,
    restartCount: raw.RestartCount ?? 0,
    state: raw.State?.Status ?? 'unknown',
    health: raw.State?.Health?.Status ?? null,
    exitCode: raw.State?.ExitCode ?? null,
    error: raw.State?.Error ? raw.State.Error : null,
  };
}

/**
 * Follow a container's stdout+stderr.
 *
 * Non-TTY containers return a multiplexed stream: each frame is an 8-byte header
 * (stream type, 3 zero bytes, big-endian payload length) followed by the payload.
 * TTY containers return the raw bytes.
 *
 * `timestamps=1` is requested so backfilled history keeps its original time —
 * without it, the initial `tail` of old lines would look like it just arrived and
 * long-dead errors would be reported as current.
 *
 * Returns a stop function; `onClose` fires when the stream ends for any reason.
 */
export function followLogs(opts: {
  containerId: string;
  tty: boolean;
  tail: number;
  onLine: (line: string, stream: 'stdout' | 'stderr') => void;
  onClose: (err?: Error) => void;
}): () => void {
  const { containerId, tty, tail, onLine, onClose } = opts;
  const path =
    `/containers/${containerId}/logs` +
    `?follow=1&stdout=1&stderr=1&tail=${tail}&timestamps=1`;

  let closed = false;
  // Annotated because `subarray()` widens the backing-buffer type.
  let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  // Text left over from a frame that ended mid-line, per stream.
  const partial: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };

  function emitText(text: string, stream: 'stdout' | 'stderr'): void {
    const combined = partial[stream] + text;
    const parts = combined.split(/\r?\n/);
    partial[stream] = parts.pop() ?? '';
    for (const line of parts) {
      if (line.trim()) onLine(line, stream);
    }
  }

  const req = http.request(
    { socketPath: DOCKER_SOCKET, path, method: 'GET' },
    (res) => {
      if ((res.statusCode ?? 0) >= 300) {
        res.resume();
        if (!closed) {
          closed = true;
          onClose(new Error(`docker logs ${res.statusCode}`));
        }
        return;
      }

      res.on('data', (chunk: Buffer) => {
        if (tty) {
          emitText(chunk.toString('utf8'), 'stdout');
          return;
        }

        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        while (pending.length >= 8) {
          const type = pending[0];
          const size = pending.readUInt32BE(4);
          // Guard against a stream that is not actually multiplexed.
          if (type > 2 || pending[1] !== 0 || pending[2] !== 0 || pending[3] !== 0) {
            emitText(pending.toString('utf8'), 'stdout');
            pending = Buffer.alloc(0);
            return;
          }
          if (pending.length < 8 + size) return;
          const payload = pending.subarray(8, 8 + size).toString('utf8');
          pending = pending.subarray(8 + size);
          emitText(payload, type === 2 ? 'stderr' : 'stdout');
        }
      });

      res.on('end', () => {
        if (!closed) {
          closed = true;
          onClose();
        }
      });
      res.on('error', (err) => {
        if (!closed) {
          closed = true;
          onClose(err);
        }
      });
    },
  );

  req.on('error', (err) => {
    if (!closed) {
      closed = true;
      onClose(err);
    }
  });
  req.end();

  return () => {
    closed = true;
    req.destroy();
  };
}

/** Case-insensitive match: every fragment in a group must appear in the name. */
export function matchContainer(
  containers: DockerContainer[],
  nameGroups: string[][] | undefined,
  imageFragments: string[] | undefined,
): DockerContainer | null {
  const running = [...containers].sort((a, b) =>
    a.state === 'running' && b.state !== 'running' ? -1 : b.state === 'running' && a.state !== 'running' ? 1 : 0,
  );

  for (const group of nameGroups ?? []) {
    const hit = running.find((c) => {
      const name = c.name.toLowerCase();
      return group.every((f) => name.includes(f.toLowerCase()));
    });
    if (hit) return hit;
  }

  for (const fragment of imageFragments ?? []) {
    const hit = running.find((c) => c.image.toLowerCase().includes(fragment.toLowerCase()));
    if (hit) return hit;
  }

  return null;
}
