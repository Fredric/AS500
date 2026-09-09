/**
 * Ingest Monitor — wire protocol types.
 *
 * This file is duplicated verbatim at `client/src/monitor/types.ts`. The monitor
 * is deliberately decoupled from the AS500 terminal protocol, so the two copies
 * are kept in sync by hand rather than through a shared build artifact.
 */

export type Health = 'up' | 'degraded' | 'down' | 'unknown' | 'disabled';

export type ComponentGroup = 'as500' | 'ingest' | 'inference' | 'infra';

export interface Fact {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'bad' | 'muted';
}

export interface ContainerInfo {
  name: string;
  image: string;
  state: string;
  status: string;
  startedAt: string | null;
  restartCount: number;
}

export interface ComponentStatus {
  id: string;
  label: string;
  /** Column the card is rendered into. */
  group: ComponentGroup;
  /** Short subtitle, e.g. "FastAPI :8080". */
  subtitle: string;
  health: Health;
  /** One-line human summary of the current state. */
  detail: string;
  latencyMs: number | null;
  endpoint: string | null;
  facts: Fact[];
  error: string | null;
  container: ContainerInfo | null;
  /** Log source key to pass to SUBSCRIBE_LOGS, when logs are obtainable. */
  logSource: string | null;
  /** Remediation shown when the component is down. */
  hint: string | null;
  checkedAt: string;
}

/** Ordered ingestion pipeline stages, derived from DB side effects + worker logs. */
export type StageId =
  | 'queued'
  | 'claimed'
  | 'convert'
  | 'chunk'
  | 'embed'
  | 'persist'
  | 'summarize'
  | 'ready';

export type StageState = 'pending' | 'active' | 'done' | 'error' | 'skipped';

export interface Stage {
  id: StageId;
  label: string;
  state: StageState;
  detail: string;
}

export interface JobRow {
  id: string;
  documentItemId: number;
  userId: number;
  state: 'queued' | 'processing' | 'completed' | 'failed' | string;
  attempts: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lockedBy: string | null;
  lockedAt: string | null;
  documentName: string | null;
  fileType: string | null;
  sizeBytes: number | null;
  ingestStatus: string | null;
  folderName: string | null;
  chunkCount: number;
  embeddedCount: number;
  pageCount: number;
  imageCount: number;
  tableCount: number;
  durationSec: number | null;
  stage: StageId;
  stages: Stage[];
  progressPct: number;
  /** True when state='processing' but the worker lock is older than the timeout. */
  stalled: boolean;
}

export interface QueueSnapshot {
  available: boolean;
  error: string | null;
  counts: { queued: number; processing: number; completed: number; failed: number };
  /** document_items.ingest_status histogram. */
  itemStatus: Record<string, number>;
  totals: {
    documents: number;
    chunks: number;
    embeddedChunks: number;
    pages: number;
    images: number;
    tables: number;
  };
  throughput: {
    completedLastHour: number;
    completedLast24h: number;
    failedLast24h: number;
    avgDurationSec: number | null;
  };
  jobs: JobRow[];
}

export interface GpuConsumer {
  label: string;
  vramMb: number | null;
  detail: string;
}

export interface GpuSnapshot {
  available: boolean;
  /** 'nvidia-smi' when real telemetry is available, 'derived' when inferred from model APIs. */
  source: 'nvidia-smi' | 'derived' | 'none';
  name: string | null;
  memoryUsedMb: number | null;
  memoryTotalMb: number | null;
  utilizationPct: number | null;
  temperatureC: number | null;
  powerWatts: number | null;
  consumers: GpuConsumer[];
  note: string | null;
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface LogLine {
  seq: number;
  ts: string;
  level: LogLevel;
  text: string;
  /** structlog `event` field when the line was JSON. */
  event: string | null;
}

export interface LogSourceInfo {
  key: string;
  label: string;
  /** How the lines are obtained. */
  kind: 'docker' | 'file' | 'none';
  available: boolean;
  detail: string;
  errorCount: number;
  warnCount: number;
  lastLineAt: string | null;
}

/* ── Document inspection ─────────────────────────────────────────────────── */

/** One row in the document browser. Artefact counts are what the pipeline produced. */
export interface DocumentListRow {
  id: number;
  name: string;
  userId: number;
  folderId: number | null;
  /** Breadcrumb rebuilt by walking document_folders.parent_id to the root. */
  folderPath: string;
  fileType: string | null;
  sizeBytes: number | null;
  ingestStatus: string;
  hasSummary: boolean;
  chunkCount: number;
  embeddedCount: number;
  pageCount: number;
  imageCount: number;
  tableCount: number;
  updatedAt: string | null;
  lastJobState: string | null;
  lastJobError: string | null;
  lastJobDurationSec: number | null;
}

export interface DocumentMeta extends DocumentListRow {
  mimeType: string | null;
  storagePath: string | null;
  contentHash: string | null;
  aiSummary: string | null;
  createdAt: string | null;
  /** Path on the monitor server that serves the original upload, when readable. */
  originalUrl: string | null;
}

export interface ChunkRow {
  id: number;
  pageNumber: number | null;
  pageEnd: number | null;
  sectionTitle: string | null;
  contentType: string | null;
  nodePath: string | null;
  charCount: number;
  hasEmbedding: boolean;
  embeddingDims: number | null;
  text: string;
}

export interface PageRow {
  pageNumber: number;
  rawTextLength: number;
  markdown: string | null;
}

export interface ImageRow {
  id: number;
  pageNumber: number | null;
  filePath: string | null;
  caption: string | null;
  linkedChunkId: number | null;
  /** Path on the monitor server that serves the extracted PNG, when readable. */
  url: string | null;
}

export interface TableRow {
  id: number;
  pageNumber: number | null;
  markdown: string | null;
  linkedChunkId: number | null;
}

export interface DocumentJobRow {
  id: string;
  state: string;
  attempts: number;
  error: string | null;
  /** Full Python traceback, including the `__cause__` chain Docling hides. */
  traceback: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lockedBy: string | null;
  durationSec: number | null;
}

export interface DocumentDetail {
  item: DocumentMeta;
  jobs: DocumentJobRow[];
  chunks: ChunkRow[];
  pages: PageRow[];
  images: ImageRow[];
  tables: TableRow[];
  /** Data-quality problems found while assembling this detail. */
  warnings: string[];
}

export interface SearchHit {
  rank: number;
  chunkId: number;
  documentItemId: number;
  documentTitle: string | null;
  pageNumber: number | null;
  sectionTitle: string | null;
  nodePath: string | null;
  score: number;
  vecScore: number;
  kwScore: number;
  text: string;
}

export interface SearchOutcome {
  query: string;
  userId: number;
  total: number;
  tookMs: number;
  hits: SearchHit[];
  error: string | null;
  /**
   * True when every hit scored 0 on the keyword half, i.e. retrieval was
   * effectively vector-only. `plainto_tsquery` ANDs all terms, so one word
   * absent from the chunk text silences BM25 entirely.
   */
  keywordDead: boolean;
}

export interface MonitorSnapshot {
  ts: string;
  serverStartedAt: string;
  pollMs: number;
  /** Overall roll-up across every non-disabled component. */
  overall: Health;
  components: ComponentStatus[];
  queue: QueueSnapshot;
  gpu: GpuSnapshot;
  logSources: LogSourceInfo[];
  /** Setup problems worth surfacing at the top of the page. */
  warnings: string[];
}

/* ── Client → Server ─────────────────────────────────────────────────────── */

export type MonitorClientMessage =
  | { type: 'SUBSCRIBE_LOGS'; source: string }
  | { type: 'UNSUBSCRIBE_LOGS'; source: string }
  | { type: 'REFRESH' }
  | { type: 'SET_POLL'; ms: number }
  | { type: 'PING' }
  | { type: 'LIST_DOCUMENTS' }
  | { type: 'OPEN_DOCUMENT'; itemId: number }
  | { type: 'SEARCH'; query: string; userId: number; topK?: number };

/* ── Server → Client ─────────────────────────────────────────────────────── */

export type MonitorServerMessage
  = { type: 'SNAPSHOT'; snapshot: MonitorSnapshot }
  | { type: 'LOG_BATCH'; source: string; lines: LogLine[]; replace: boolean }
  | { type: 'DOCUMENT_LIST'; documents: DocumentListRow[]; error: string | null }
  | { type: 'DOCUMENT_DETAIL'; itemId: number; document: DocumentDetail | null; error: string | null }
  | { type: 'SEARCH_RESULT'; result: SearchOutcome }
  | { type: 'PONG' }
  | { type: 'ERROR'; message: string };
