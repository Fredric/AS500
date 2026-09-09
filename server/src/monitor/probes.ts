/**
 * Ingest Monitor — health probes.
 *
 * Each probe answers three questions for one moving part: is it reachable, what
 * is it currently doing, and (when it is not reachable) what should the operator
 * run to bring it back.
 */

import { execFile } from 'child_process';
import {
  AGENT_API_KEY,
  AGENT_BASE_URL,
  AGENT_MODEL,
  COMPONENTS,
  DOCS_API_URL,
  DOCKER_SOCKET,
  EMBEDDING_MODEL,
  LOG_SOURCES,
  OLLAMA_BASE_URL,
  VLM_API_URL,
  VLM_MODEL,
  type ComponentDef,
} from './config.js';
import { dockerAvailable, listContainers, inspectContainer, matchContainer, type DockerContainer } from './docker.js';
import { pingDatabase } from './db.js';
import { getRecentProblems } from './logs.js';
import type {
  ComponentStatus,
  ContainerInfo,
  Fact,
  GpuConsumer,
  GpuSnapshot,
  Health,
  QueueSnapshot,
} from './types.js';

const SERVER_STARTED_AT = new Date();

interface HttpResult<T> {
  ok: boolean;
  status: number;
  latencyMs: number;
  data: T | null;
  error: string | null;
}

async function fetchJson<T>(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<HttpResult<T>> {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: opts.headers,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 3000),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return { ok: false, status: res.status, latencyMs, data: null, error: `HTTP ${res.status}` };
    }
    const text = await res.text();
    const data = text ? (JSON.parse(text) as T) : (null as T | null);
    return { ok: true, status: res.status, latencyMs, data, error: null };
  } catch (err) {
    const message = (err as Error).message || String(err);
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - started,
      data: null,
      error: /timeout|abort/i.test(message) ? 'timed out' : message,
    };
  }
}

function toContainerInfo(
  container: DockerContainer | null,
  inspect: { startedAt: string | null; restartCount: number } | null,
): ContainerInfo | null {
  if (!container) return null;
  return {
    name: container.name,
    image: container.image,
    state: container.state,
    status: container.status,
    startedAt: inspect?.startedAt ?? null,
    restartCount: inspect?.restartCount ?? 0,
  };
}

function humanDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function mb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

/* ── Ollama ──────────────────────────────────────────────────────────────── */

interface OllamaTag {
  name: string;
  size?: number;
  details?: { parameter_size?: string; quantization_level?: string };
}
interface OllamaPsModel {
  name: string;
  model?: string;
  size?: number;
  size_vram?: number;
  expires_at?: string;
}

interface OllamaState {
  reachable: boolean;
  version: string | null;
  tags: OllamaTag[];
  loaded: OllamaPsModel[];
  latencyMs: number | null;
  error: string | null;
}

async function readOllama(): Promise<OllamaState> {
  const [version, tags, ps] = await Promise.all([
    fetchJson<{ version: string }>(`${OLLAMA_BASE_URL}/api/version`, { timeoutMs: 2500 }),
    fetchJson<{ models: OllamaTag[] }>(`${OLLAMA_BASE_URL}/api/tags`, { timeoutMs: 3000 }),
    fetchJson<{ models: OllamaPsModel[] }>(`${OLLAMA_BASE_URL}/api/ps`, { timeoutMs: 2500 }),
  ]);

  return {
    reachable: version.ok || tags.ok,
    version: version.data?.version ?? null,
    tags: tags.data?.models ?? [],
    loaded: ps.data?.models ?? [],
    latencyMs: version.ok ? version.latencyMs : tags.ok ? tags.latencyMs : null,
    error: version.ok || tags.ok ? null : (version.error ?? tags.error),
  };
}

/* ── vLLM ────────────────────────────────────────────────────────────────── */

interface VllmState {
  reachable: boolean;
  models: string[];
  latencyMs: number | null;
  error: string | null;
}

async function readVllm(): Promise<VllmState> {
  const res = await fetchJson<{ data: { id: string }[] }>(`${VLM_API_URL}/models`, { timeoutMs: 3000 });
  return {
    reachable: res.ok,
    models: (res.data?.data ?? []).map((m) => m.id),
    latencyMs: res.ok ? res.latencyMs : null,
    error: res.error,
  };
}

/* ── GPU ─────────────────────────────────────────────────────────────────── */

const NVIDIA_SMI_QUERY =
  'name,memory.used,memory.total,utilization.gpu,temperature.gpu,power.draw';

function nvidiaSmi(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      [`--query-gpu=${NVIDIA_SMI_QUERY}`, '--format=csv,noheader,nounits'],
      { timeout: 2500 },
      (err, stdout) => resolve(err ? null : stdout.trim()),
    );
  });
}

let nvidiaSmiUsable = true;

/**
 * Real GPU telemetry needs `nvidia-smi`, which is only present when the server
 * runs on the GPU host. Inside Docker it is absent, so the panel falls back to
 * what the model servers report about themselves — enough to show which models
 * are resident and roughly how much VRAM they hold.
 */
async function readGpu(ollama: OllamaState, vllm: VllmState): Promise<GpuSnapshot> {
  const consumers: GpuConsumer[] = [];

  for (const m of ollama.loaded) {
    consumers.push({
      label: `ollama · ${m.name}`,
      vramMb: m.size_vram != null ? mb(m.size_vram) : m.size != null ? mb(m.size) : null,
      detail: m.expires_at ? `unloads ${new Date(m.expires_at).toLocaleTimeString()}` : 'resident',
    });
  }
  for (const id of vllm.models) {
    consumers.push({ label: `vLLM · ${id}`, vramMb: null, detail: 'served (VRAM reserved up front)' });
  }

  if (nvidiaSmiUsable) {
    const raw = await nvidiaSmi();
    if (raw) {
      const [name, used, total, util, temp, power] = raw.split('\n')[0].split(',').map((s) => s.trim());
      return {
        available: true,
        source: 'nvidia-smi',
        name,
        memoryUsedMb: Number(used) || null,
        memoryTotalMb: Number(total) || null,
        utilizationPct: Number(util) || 0,
        temperatureC: Number(temp) || null,
        powerWatts: Number(power) || null,
        consumers,
        note: null,
      };
    }
    nvidiaSmiUsable = false;
  }

  const derivedUsed = consumers.reduce((sum, c) => sum + (c.vramMb ?? 0), 0);
  return {
    available: consumers.length > 0,
    source: consumers.length > 0 ? 'derived' : 'none',
    name: null,
    memoryUsedMb: derivedUsed > 0 ? derivedUsed : null,
    memoryTotalMb: null,
    utilizationPct: null,
    temperatureC: null,
    powerWatts: null,
    consumers,
    note:
      'nvidia-smi is not reachable from this process, so VRAM is inferred from the model servers. Run the server on the GPU host for full telemetry.',
  };
}

/* ── Component assembly ──────────────────────────────────────────────────── */

function base(def: ComponentDef): ComponentStatus {
  return {
    id: def.id,
    label: def.label,
    group: def.group,
    subtitle: def.subtitle,
    health: 'unknown',
    detail: '',
    latencyMs: null,
    endpoint: def.endpoint,
    facts: [],
    error: null,
    container: null,
    logSource: def.logSource,
    hint: def.hint,
    checkedAt: new Date().toISOString(),
  };
}

/** A log error only counts against health while it is genuinely current. */
const LOG_ERROR_WINDOW_MS = 2 * 60 * 1000;

function attachLogProblems(status: ComponentStatus): ComponentStatus {
  if (!status.logSource || status.health !== 'up') return status;

  const last = getRecentProblems(status.logSource, 1)[0];
  if (last?.level !== 'error') return status;
  if (Date.now() - new Date(last.ts).getTime() > LOG_ERROR_WINDOW_MS) return status;

  return {
    ...status,
    health: 'degraded',
    detail: `${status.detail} · error in log`,
    error: last.text.slice(0, 300),
  };
}

export interface ProbeContext {
  queue: QueueSnapshot;
}

export async function probeAll(ctx: ProbeContext): Promise<{
  components: ComponentStatus[];
  gpu: GpuSnapshot;
  warnings: string[];
}> {
  const warnings: string[] = [];

  const docker = await dockerAvailable();
  let containers: DockerContainer[] = [];
  if (docker.ok) {
    try {
      containers = await listContainers();
    } catch (err) {
      warnings.push(`Docker socket reachable but listing containers failed: ${(err as Error).message}`);
    }
  } else {
    warnings.push(
      `Docker socket ${DOCKER_SOCKET} is not available, so container status and logs are hidden. ` +
        `Add "- ${DOCKER_SOCKET}:${DOCKER_SOCKET}" to the server service volumes in docker-compose.yml and restart.`,
    );
  }

  async function containerFor(logSourceKey: string | null): Promise<{
    container: DockerContainer | null;
    info: ContainerInfo | null;
  }> {
    if (!logSourceKey || !docker.ok) return { container: null, info: null };
    const def = LOG_SOURCES.find((s) => s.key === logSourceKey);
    if (!def || def.kind !== 'docker') return { container: null, info: null };
    const container = matchContainer(containers, def.containerMatch, def.imageMatch);
    if (!container) return { container: null, info: null };
    let inspect: Awaited<ReturnType<typeof inspectContainer>> | null = null;
    try {
      inspect = await inspectContainer(container.id);
    } catch {
      inspect = null;
    }
    return { container, info: toContainerInfo(container, inspect) };
  }

  const [ollama, vllm] = await Promise.all([readOllama(), readVllm()]);
  const gpu = await readGpu(ollama, vllm);

  const results = await Promise.all(
    COMPONENTS.map(async (def): Promise<ComponentStatus> => {
      const status = base(def);
      const { container, info } = await containerFor(def.logSource);
      status.container = info;

      switch (def.probe) {
        case 'self': {
          const uptime = Date.now() - SERVER_STARTED_AT.getTime();
          status.health = 'up';
          status.detail = `up ${humanDuration(uptime)}`;
          status.facts = [
            { label: 'node', value: process.version },
            { label: 'pid', value: String(process.pid) },
            { label: 'rss', value: `${mb(process.memoryUsage().rss)} MB` },
            { label: 'env', value: process.env.NODE_ENV ?? 'development' },
          ];
          break;
        }

        case 'postgres': {
          try {
            const ping = await pingDatabase();
            status.health = ping.pgvector ? 'up' : 'degraded';
            status.latencyMs = ping.latencyMs;
            status.detail = ping.pgvector
              ? `${ping.version} · pgvector ready`
              : `${ping.version} · pgvector extension missing`;
            status.facts = [
              { label: 'chunks', value: ctx.queue.totals.chunks.toLocaleString() },
              { label: 'vectors', value: ctx.queue.totals.embeddedChunks.toLocaleString() },
              { label: 'documents', value: ctx.queue.totals.documents.toLocaleString() },
              { label: 'pgvector', value: ping.pgvector ? 'yes' : 'no', tone: ping.pgvector ? 'ok' : 'bad' },
            ];
          } catch (err) {
            status.health = 'down';
            status.detail = 'unreachable';
            status.error = (err as Error).message;
          }
          break;
        }

        case 'docs-api': {
          const res = await fetchJson<{
            status: string;
            database: string;
            vlm_server: string;
            ollama: string;
            worker: string;
            version: string;
          }>(`${DOCS_API_URL}/healthz`, { timeoutMs: 4000 });

          status.latencyMs = res.ok ? res.latencyMs : null;
          if (!res.ok) {
            status.health = container?.state === 'running' ? 'degraded' : 'down';
            status.detail = container?.state === 'running' ? 'container up, /healthz not answering' : 'unreachable';
            status.error = res.error;
          } else {
            const d = res.data!;
            status.health = d.status === 'ok' ? 'up' : 'degraded';
            status.detail = `self-report: ${d.status}`;
            const tone = (v: string): Fact['tone'] => (v === 'ok' ? 'ok' : 'bad');
            status.facts = [
              { label: 'version', value: d.version },
              { label: 'db', value: d.database, tone: tone(d.database) },
              { label: 'vlm', value: d.vlm_server, tone: tone(d.vlm_server) },
              { label: 'ollama', value: d.ollama, tone: tone(d.ollama) },
              { label: 'worker', value: d.worker, tone: tone(d.worker) },
            ];
          }
          break;
        }

        case 'docs-worker': {
          const { processing, queued } = ctx.queue.counts;
          const stalled = ctx.queue.jobs.filter((j) => j.stalled).length;

          if (container?.state === 'running') {
            status.health = stalled > 0 ? 'degraded' : 'up';
            status.detail = stalled > 0
              ? `${stalled} job(s) past the lock timeout`
              : processing > 0
                ? `ingesting ${processing} document(s)`
                : 'idle, polling every 2s';
          } else if (container) {
            status.health = 'down';
            status.detail = `container ${container.state}`;
          } else if (!docker.ok) {
            // Without container visibility, a recently touched lock is the only
            // evidence that a worker process exists at all.
            const recentLock = ctx.queue.jobs.some(
              (j) => j.lockedAt && Date.now() - new Date(j.lockedAt).getTime() < 60_000,
            );
            status.health = recentLock ? 'up' : 'unknown';
            status.detail = recentLock ? 'active (inferred from job locks)' : 'no container visibility';
          } else {
            status.health = 'down';
            status.detail = 'container not found';
          }

          status.facts = [
            { label: 'queued', value: String(queued), tone: queued > 0 ? 'warn' : 'muted' },
            { label: 'processing', value: String(processing), tone: processing > 0 ? 'ok' : 'muted' },
            { label: 'failed 24h', value: String(ctx.queue.throughput.failedLast24h), tone: ctx.queue.throughput.failedLast24h > 0 ? 'bad' : 'muted' },
            { label: 'lock owner', value: ctx.queue.jobs.find((j) => j.lockedBy)?.lockedBy ?? '—' },
          ];
          break;
        }

        case 'vllm': {
          status.latencyMs = vllm.latencyMs;
          if (!vllm.reachable) {
            status.health = 'down';
            status.detail = 'not serving — Docling VLM ingest will fail';
            status.error = vllm.error;
            status.facts = [{ label: 'expects', value: VLM_MODEL }];
          } else {
            const hasExpected = vllm.models.some((m) => m === VLM_MODEL || m.includes('granite-docling'));
            status.health = hasExpected ? 'up' : 'degraded';
            status.detail = hasExpected
              ? `serving ${vllm.models[0]}`
              : `serving ${vllm.models.join(', ') || 'nothing'} — expected ${VLM_MODEL}`;
            status.facts = [
              { label: 'model', value: vllm.models[0] ?? '—', tone: hasExpected ? 'ok' : 'warn' },
              { label: 'expects', value: VLM_MODEL },
            ];
          }
          break;
        }

        case 'ollama': {
          status.latencyMs = ollama.latencyMs;
          if (!ollama.reachable) {
            status.health = 'down';
            status.detail = 'not serving — embeddings will fail';
            status.error = ollama.error;
            break;
          }
          const hasEmbed = ollama.tags.some((t) => t.name.startsWith(EMBEDDING_MODEL));
          status.health = hasEmbed ? 'up' : 'degraded';
          status.detail = hasEmbed
            ? ollama.loaded.length > 0
              ? `${ollama.loaded.length} model(s) loaded in VRAM`
              : 'ready, no model resident'
            : `embedding model ${EMBEDDING_MODEL} not pulled`;
          status.facts = [
            { label: 'version', value: ollama.version ?? '—' },
            { label: 'models', value: String(ollama.tags.length) },
            { label: EMBEDDING_MODEL, value: hasEmbed ? 'pulled' : 'missing', tone: hasEmbed ? 'ok' : 'bad' },
            {
              label: 'resident',
              value: ollama.loaded.length ? ollama.loaded.map((m) => m.name).join(', ') : 'none',
              tone: ollama.loaded.length ? 'ok' : 'muted',
            },
          ];
          if (!hasEmbed) status.hint = `ollama pull ${EMBEDDING_MODEL}`;
          break;
        }

        case 'agent': {
          const headers = AGENT_API_KEY ? { Authorization: `Bearer ${AGENT_API_KEY}` } : undefined;
          const res = await fetchJson<{ data: { id: string }[] }>(`${AGENT_BASE_URL}/models`, {
            timeoutMs: 3000,
            headers,
          });
          status.latencyMs = res.ok ? res.latencyMs : null;
          if (!AGENT_API_KEY) {
            status.health = 'degraded';
            status.detail = 'AI_AGENT_API_KEY not set — chat will fail';
            status.hint = 'Set AI_AGENT_API_KEY in server/.env.local to match AGENT_API_KEY in as500-agent';
          } else if (!res.ok) {
            status.health = 'down';
            status.detail = res.status === 401 ? 'reachable but rejected the API key' : 'unreachable';
            status.error = res.error;
          } else {
            status.health = 'up';
            status.detail = `serving ${res.data?.data?.[0]?.id ?? AGENT_MODEL}`;
          }
          status.facts = [
            { label: 'model id', value: res.data?.data?.[0]?.id ?? AGENT_MODEL },
            { label: 'api key', value: AGENT_API_KEY ? 'configured' : 'missing', tone: AGENT_API_KEY ? 'ok' : 'bad' },
            { label: 'base url', value: AGENT_BASE_URL },
          ];
          break;
        }

        case 'docker': {
          status.health = docker.ok ? 'up' : 'down';
          status.detail = docker.ok
            ? `${containers.filter((c) => c.state === 'running').length} running / ${containers.length} total`
            : 'socket not mounted — container status and logs unavailable';
          status.error = docker.ok ? null : docker.detail;
          status.facts = docker.ok
            ? [{ label: 'socket', value: DOCKER_SOCKET, tone: 'ok' }]
            : [{ label: 'socket', value: DOCKER_SOCKET, tone: 'bad' }];
          break;
        }
      }

      return attachLogProblems(status);
    }),
  );

  if (!DOCS_API_URL) {
    warnings.push('DOCS_API_URL is not set, so ingest cannot be enqueued at all.');
  }
  if (ctx.queue.error) warnings.push(ctx.queue.error);

  return { components: results, gpu, warnings };
}

export function rollUp(components: ComponentStatus[]): Health {
  const relevant = components.filter((c) => c.health !== 'disabled');
  if (relevant.some((c) => c.health === 'down')) return 'down';
  if (relevant.some((c) => c.health === 'degraded')) return 'degraded';
  if (relevant.every((c) => c.health === 'up')) return 'up';
  return 'unknown';
}

export { SERVER_STARTED_AT };
