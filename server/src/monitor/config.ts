/**
 * Ingest Monitor — environment resolution and the registry of moving parts.
 *
 * Everything the dashboard knows how to observe is declared here. Adding a new
 * service to the page means adding one entry to `COMPONENTS` and (if it needs a
 * bespoke probe) one branch in `probes.ts`.
 */

function env(name: string, fallback = ''): string {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : fallback;
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export const MONITOR_PORT = Number(env('MONITOR_PORT', '3005'));
export const MONITOR_ENABLED = env('MONITOR_ENABLED', 'true') !== 'false';
export const MONITOR_TOKEN = env('MONITOR_TOKEN');
export const MONITOR_POLL_MS = Math.max(1000, Number(env('MONITOR_POLL_MS', '2500')));
export const IS_PRODUCTION = process.env.NODE_ENV === 'production';

export const DATABASE_URL = env(
  'DATABASE_URL',
  'postgresql://as500:as500@localhost:5433/as500',
);

/** as500-docs FastAPI. Same value the app already uses to enqueue ingest jobs. */
export const DOCS_API_URL = stripSlash(env('DOCS_API_URL', 'http://host.docker.internal:8080'));
export const DOCS_INGEST_KEY = env('DOCS_INGEST_KEY');

/** Ollama serves embeddings for as500-docs and (currently) chat for as500-agent. */
export const OLLAMA_BASE_URL = stripSlash(env('OLLAMA_BASE_URL', 'http://host.docker.internal:11434'));
export const EMBEDDING_MODEL = env('EMBEDDING_MODEL', 'nomic-embed-text');

/** vLLM-5090 running granite-docling for the Docling VLM pipeline. */
export const VLM_API_URL = stripSlash(env('VLM_API_URL', 'http://host.docker.internal:8000/v1'));
export const VLM_MODEL = env('VLM_MODEL', 'ibm-granite/granite-docling-258M');

/** as500-agent OpenAI-compatible API. */
export const AGENT_BASE_URL = stripSlash(env('AI_AGENT_BASE_URL', 'http://host.docker.internal:8010/v1'));
export const AGENT_API_KEY = env('AI_AGENT_API_KEY');
export const AGENT_MODEL = env('AI_AGENT_MODEL', 'as500-agent');

export const DOCKER_SOCKET = env('MONITOR_DOCKER_SOCKET', '/var/run/docker.sock');

/**
 * as500-agent runs natively on the host and redirects stderr to a file, so its
 * logs are only readable when that file is bind-mounted into this container.
 */
export const AGENT_LOG_FILE = env('MONITOR_AGENT_LOG', '/host/as500-agent/agent_err.log');

/**
 * as500-docs writes extracted page images under its own `storage/` tree and
 * records them as repo-relative paths (`storage/documents/1/29/images/x.png`).
 * The inspector can only render them when that tree is bind-mounted here.
 */
export const DOCS_STORAGE_ROOT = env('MONITOR_DOCS_STORAGE', '/host/docs-storage');

/** Where the AS500 server keeps the original uploads (already local to this container). */
export const UPLOAD_ROOT = env('MONITOR_UPLOAD_ROOT', '/app/data/documents');

/** Mirrors as500-docs LOCK_TIMEOUT_SECONDS — used to flag stalled jobs. */
export const LOCK_TIMEOUT_SECONDS = Number(env('LOCK_TIMEOUT_SECONDS', '900'));

/** How many lines of history each log source keeps in memory. */
export const LOG_BUFFER_LINES = Math.max(100, Number(env('MONITOR_LOG_LINES', '600')));

export type ProbeKind =
  | 'self'
  | 'postgres'
  | 'docs-api'
  | 'docs-worker'
  | 'ollama'
  | 'vllm'
  | 'agent'
  | 'docker';

export interface ComponentDef {
  id: string;
  label: string;
  subtitle: string;
  group: 'as500' | 'ingest' | 'inference' | 'infra';
  probe: ProbeKind;
  endpoint: string | null;
  /** Key into LOG_SOURCES, or null when no logs are reachable. */
  logSource: string | null;
  hint: string | null;
}

export const COMPONENTS: ComponentDef[] = [
  {
    id: 'as500-server',
    label: 'AS500 Server',
    subtitle: `Node · ws :${process.env.PORT ?? 3001} · mcp :${process.env.MCP_PORT ?? 3002}`,
    group: 'as500',
    probe: 'self',
    endpoint: null,
    logSource: 'as500-server',
    hint: null,
  },
  {
    id: 'postgres',
    label: 'Postgres + pgvector',
    subtitle: 'as500 · :5433',
    group: 'as500',
    probe: 'postgres',
    endpoint: DATABASE_URL.replace(/:\/\/[^@]*@/, '://***@'),
    logSource: 'postgres',
    hint: 'docker compose up -d postgres',
  },
  {
    id: 'docs-api',
    label: 'as500-docs API',
    subtitle: 'FastAPI · :8080',
    group: 'ingest',
    probe: 'docs-api',
    endpoint: `${DOCS_API_URL}/healthz`,
    logSource: 'docs-api',
    hint: 'cd ../as500-docs && docker compose up -d --build api',
  },
  {
    id: 'docs-worker',
    label: 'as500-docs Worker',
    subtitle: 'Docling ingest loop',
    group: 'ingest',
    probe: 'docs-worker',
    endpoint: null,
    logSource: 'docs-worker',
    hint: 'cd ../as500-docs && docker compose up -d --build worker',
  },
  {
    id: 'vllm',
    label: 'vLLM · granite-docling',
    subtitle: 'DOCLING VLM · :8000',
    group: 'inference',
    probe: 'vllm',
    endpoint: `${VLM_API_URL}/models`,
    logSource: 'vllm',
    hint: 'cd ../vLLM-5090 && .\\run-d.bat',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    subtitle: 'embeddings + chat · :11434',
    group: 'inference',
    probe: 'ollama',
    endpoint: `${OLLAMA_BASE_URL}/api/tags`,
    logSource: null,
    hint: 'Start the Ollama app on the host, or run `ollama serve`',
  },
  {
    id: 'agent',
    label: 'as500-agent',
    subtitle: 'FastAPI · :8010',
    group: 'inference',
    probe: 'agent',
    endpoint: `${AGENT_BASE_URL}/models`,
    logSource: 'agent',
    hint: 'cd ../as500-agent && .\\start.ps1',
  },
  {
    id: 'docker',
    label: 'Docker Engine',
    subtitle: 'container + log access',
    group: 'infra',
    probe: 'docker',
    endpoint: DOCKER_SOCKET,
    logSource: null,
    hint: `Mount the socket into the server container: - ${DOCKER_SOCKET}:${DOCKER_SOCKET}`,
  },
];

export interface LogSourceDef {
  key: string;
  label: string;
  kind: 'docker' | 'file';
  /** Candidate container name fragments, matched case-insensitively in order. */
  containerMatch?: string[][];
  /** Container image fragment, used when the name is unpredictable. */
  imageMatch?: string[];
  file?: string;
}

/**
 * Container names are matched on fragments rather than hardcoded because Compose
 * derives them from the project directory (`as500-docs-worker-1`), which differs
 * between checkouts.
 */
export const LOG_SOURCES: LogSourceDef[] = [
  {
    key: 'as500-server',
    label: 'AS500 Server',
    kind: 'docker',
    containerMatch: [['as500', 'server']],
  },
  {
    key: 'postgres',
    label: 'Postgres',
    kind: 'docker',
    containerMatch: [['as500', 'postgres']],
  },
  {
    key: 'docs-api',
    label: 'as500-docs API',
    kind: 'docker',
    containerMatch: [['docs', 'api']],
  },
  {
    key: 'docs-worker',
    label: 'as500-docs Worker',
    kind: 'docker',
    containerMatch: [['docs', 'worker']],
  },
  {
    key: 'vllm',
    label: 'vLLM · granite-docling',
    kind: 'docker',
    containerMatch: [['vllm']],
    imageMatch: ['vllm'],
  },
  {
    key: 'agent',
    label: 'as500-agent (host stderr)',
    kind: 'file',
    file: AGENT_LOG_FILE,
  },
];
