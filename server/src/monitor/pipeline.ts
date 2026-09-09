/**
 * Ingest Monitor — ingestion stage derivation.
 *
 * as500-docs does not persist per-stage progress: a job is only ever `queued`,
 * `processing`, `completed` or `failed`. Finer progress is reconstructed from two
 * observable signals:
 *
 *   1. Side effects in the database — `document_pages` rows appear once Docling
 *      has converted the file, `document_chunks` rows appear only after the
 *      embeddings exist (the column is NOT NULL), `ai_summary` lands last.
 *   2. The worker's structlog output, which names each stage as it starts.
 *
 * The log signal is more precise but only available while the worker container is
 * being tailed, so it refines the database signal rather than replacing it.
 */

import type { Stage, StageId, StageState } from './types.js';

const ORDER: { id: StageId; label: string; weight: number }[] = [
  { id: 'queued', label: 'Queued', weight: 3 },
  { id: 'claimed', label: 'Claimed', weight: 8 },
  { id: 'convert', label: 'Docling / VLM', weight: 55 },
  { id: 'chunk', label: 'Chunking', weight: 68 },
  { id: 'embed', label: 'Embedding', weight: 84 },
  { id: 'persist', label: 'Persist chunks', weight: 91 },
  { id: 'summarize', label: 'AI summary', weight: 97 },
  { id: 'ready', label: 'Ready', weight: 100 },
];

const INDEX: Record<StageId, number> = ORDER.reduce(
  (acc, s, i) => ({ ...acc, [s.id]: i }),
  {} as Record<StageId, number>,
);

/** Worker log `event` strings, in the order the pipeline emits them. */
const EVENT_STAGES: { match: RegExp; stage: StageId }[] = [
  { match: /^Claimed document job/i, stage: 'claimed' },
  { match: /^Processing document job/i, stage: 'claimed' },
  { match: /^Starting document ingestion/i, stage: 'claimed' },
  { match: /^Running Docling/i, stage: 'convert' },
  { match: /^Starting Docling conversion/i, stage: 'convert' },
  { match: /^Using (VLM|standard) pipeline/i, stage: 'convert' },
  { match: /^Docling conversion complete/i, stage: 'chunk' },
  { match: /^Building chunks/i, stage: 'chunk' },
  { match: /^Translating chunks/i, stage: 'chunk' },
  { match: /^Generating embeddings/i, stage: 'embed' },
  { match: /^Generating AI summary/i, stage: 'summarize' },
  { match: /^Content unchanged/i, stage: 'ready' },
  { match: /^Document ingestion complete/i, stage: 'ready' },
  { match: /^Document job completed/i, stage: 'ready' },
];

interface WorkerHint {
  stage: StageId;
  event: string;
  at: number;
}

let workerHint: WorkerHint | null = null;

/**
 * Called by the log hub for every worker log line that carries an `event`.
 * `atMs` is the log line's own timestamp, so replayed history cannot overwrite a
 * newer hint.
 */
export function recordWorkerEvent(event: string, atMs: number): void {
  const hit = EVENT_STAGES.find((e) => e.match.test(event));
  if (!hit) return;
  if (workerHint && workerHint.at > atMs) return;
  workerHint = { stage: hit.stage, event, at: atMs };
}

/** The hint expires so a stale stage never sticks after the worker goes quiet. */
function activeWorkerHint(): WorkerHint | null {
  if (!workerHint) return null;
  return Date.now() - workerHint.at < 10 * 60 * 1000 ? workerHint : null;
}

export interface StageInput {
  state: string;
  ingestStatus: string | null;
  pageCount: number;
  chunkCount: number;
  embeddedCount: number;
  hasSummary: boolean;
  error: string | null;
  stalled: boolean;
}

export interface StageResult {
  stage: StageId;
  stages: Stage[];
  progressPct: number;
}

/** Furthest stage the database evidence proves has been reached. */
function stageFromDatabase(job: StageInput): StageId {
  if (job.state === 'queued') return 'queued';
  if (job.state === 'completed' || job.ingestStatus === 'ready') return 'ready';

  if (job.chunkCount > 0) {
    return job.hasSummary ? 'ready' : 'summarize';
  }
  if (job.pageCount > 0) return 'chunk';
  return 'convert';
}

const DETAILS: Record<StageId, (job: StageInput) => string> = {
  queued: () => 'waiting for a worker to claim the job',
  claimed: () => 'worker locked the job',
  convert: (j) => (j.pageCount > 0 ? `${j.pageCount} pages extracted` : 'rendering pages through granite-docling'),
  chunk: (j) => (j.chunkCount > 0 ? `${j.chunkCount} chunks built` : 'splitting document into chunks'),
  embed: (j) => (j.embeddedCount > 0 ? `${j.embeddedCount} vectors written` : 'nomic-embed-text · 768-dim'),
  persist: (j) => `${j.chunkCount} chunks in pgvector`,
  summarize: (j) => (j.hasSummary ? 'summary stored' : 'generating ai_summary'),
  ready: () => 'searchable',
};

export function deriveStages(job: StageInput): StageResult {
  const dbStage = stageFromDatabase(job);
  const hint = activeWorkerHint();

  // Trust whichever signal is further along, so a fast stage that leaves no
  // database trace (embed, persist) still lights up while it runs.
  let current = dbStage;
  if (job.state === 'processing' && hint && INDEX[hint.stage] > INDEX[dbStage]) {
    current = hint.stage;
  }

  const failed = job.state === 'failed';
  const done = job.state === 'completed';
  const currentIdx = INDEX[current];

  const stages: Stage[] = ORDER.map((s, i) => {
    let state: StageState;
    if (done) {
      state = 'done';
    } else if (failed) {
      state = i < currentIdx ? 'done' : i === currentIdx ? 'error' : 'skipped';
    } else if (i < currentIdx) {
      state = 'done';
    } else if (i === currentIdx) {
      state = job.state === 'processing' || job.state === 'queued' ? 'active' : 'done';
    } else {
      state = 'pending';
    }

    const detail =
      failed && i === currentIdx
        ? (job.error ?? 'failed').split('\n')[0].slice(0, 160)
        : DETAILS[s.id](job);

    return { id: s.id, label: s.label, state, detail };
  });

  return {
    stage: done ? 'ready' : current,
    stages,
    progressPct: done ? 100 : ORDER[currentIdx].weight,
  };
}
