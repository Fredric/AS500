/**
 * Ingest Monitor — read-only database access.
 *
 * Uses its own small pool rather than the app's shared one so a stuck monitor
 * query can never starve the terminal of connections, and so this folder stays
 * independently removable.
 */

import pg from 'pg';
import { DATABASE_URL, LOCK_TIMEOUT_SECONDS } from './config.js';
import type { JobRow, QueueSnapshot } from './types.js';
import { deriveStages } from './pipeline.js';

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 4_000,
  application_name: 'as500-ingest-monitor',
});

pool.on('error', (err) => {
  console.error('[monitor] idle pg client error:', err.message);
});

/** Shared with `documents.ts` so the monitor keeps exactly one pool. */
export { pool as monitorPool };

export async function pingDatabase(): Promise<{ latencyMs: number; version: string; pgvector: boolean }> {
  const started = Date.now();
  const client = await pool.connect();
  try {
    const res = await client.query<{ v: string }>(`SELECT version() AS v`);
    const ext = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM pg_extension WHERE extname = 'vector'`,
    );
    const version = (res.rows[0]?.v ?? '').split(' ').slice(0, 2).join(' ');
    return { latencyMs: Date.now() - started, version, pgvector: (ext.rows[0]?.n ?? 0) > 0 };
  } finally {
    client.release();
  }
}

export async function tableExists(name: string): Promise<boolean> {
  const res = await pool.query<{ ok: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS ok`,
    [name],
  );
  return res.rows[0]?.ok === true;
}

const EMPTY_QUEUE: QueueSnapshot = {
  available: false,
  error: null,
  counts: { queued: 0, processing: 0, completed: 0, failed: 0 },
  itemStatus: {},
  totals: { documents: 0, chunks: 0, embeddedChunks: 0, pages: 0, images: 0, tables: 0 },
  throughput: { completedLastHour: 0, completedLast24h: 0, failedLast24h: 0, avgDurationSec: null },
  jobs: [],
};

interface RawJob {
  id: string;
  document_item_id: number;
  user_id: number;
  state: string;
  attempts: number;
  error: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  locked_at: Date | null;
  locked_by: string | null;
  document_name: string | null;
  file_type: string | null;
  size_bytes: number | null;
  ingest_status: string | null;
  folder_name: string | null;
  has_summary: boolean;
  chunk_count: number;
  embedded_count: number;
  page_count: number;
  image_count: number;
  table_count: number;
  duration_sec: number | null;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/**
 * The ingestion tables other than `document_items`/`document_chunks` are owned by
 * the as500-docs Alembic migrations, so they can legitimately be missing on a
 * fresh checkout. Each aggregate degrades to zero instead of failing the poll.
 */
export async function readQueue(jobLimit = 30): Promise<QueueSnapshot> {
  try {
    const hasJobs = await tableExists('document_ingestion_jobs');
    if (!hasJobs) {
      return {
        ...EMPTY_QUEUE,
        error:
          'Table document_ingestion_jobs does not exist — run the as500-docs Alembic migrations (docker compose up -d in ../as500-docs).',
      };
    }

    const [hasPages, hasImages, hasTables] = await Promise.all([
      tableExists('document_pages'),
      tableExists('document_images'),
      tableExists('document_tables'),
    ]);

    const zero = `(SELECT 0)`;
    const pageCount = hasPages
      ? `(SELECT COUNT(*)::int FROM document_pages p WHERE p.document_item_id = j.document_item_id)`
      : zero;
    const imageCount = hasImages
      ? `(SELECT COUNT(*)::int FROM document_images im WHERE im.document_item_id = j.document_item_id)`
      : zero;
    const tableCount = hasTables
      ? `(SELECT COUNT(*)::int FROM document_tables t WHERE t.document_item_id = j.document_item_id)`
      : zero;

    const [stateRes, itemRes, totalRes, throughputRes, jobsRes] = await Promise.all([
      pool.query<{ state: string; n: number }>(
        `SELECT state, COUNT(*)::int AS n FROM document_ingestion_jobs GROUP BY state`,
      ),
      pool.query<{ ingest_status: string | null; n: number }>(
        `SELECT ingest_status, COUNT(*)::int AS n FROM document_items GROUP BY ingest_status`,
      ),
      pool.query<{
        documents: number;
        chunks: number;
        embedded: number;
        pages: number;
        images: number;
        tables: number;
      }>(
        `SELECT
           (SELECT COUNT(*)::int FROM document_items) AS documents,
           (SELECT COUNT(*)::int FROM document_chunks) AS chunks,
           (SELECT COUNT(*)::int FROM document_chunks WHERE embedding IS NOT NULL) AS embedded,
           ${hasPages ? '(SELECT COUNT(*)::int FROM document_pages)' : '0'} AS pages,
           ${hasImages ? '(SELECT COUNT(*)::int FROM document_images)' : '0'} AS images,
           ${hasTables ? '(SELECT COUNT(*)::int FROM document_tables)' : '0'} AS tables`,
      ),
      pool.query<{
        last_hour: number;
        last_24h: number;
        failed_24h: number;
        avg_duration: string | null;
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE state = 'completed' AND finished_at > now() - interval '1 hour')::int AS last_hour,
           COUNT(*) FILTER (WHERE state = 'completed' AND finished_at > now() - interval '24 hours')::int AS last_24h,
           COUNT(*) FILTER (WHERE state = 'failed'    AND finished_at > now() - interval '24 hours')::int AS failed_24h,
           AVG(EXTRACT(EPOCH FROM (finished_at - started_at)))
             FILTER (WHERE state = 'completed' AND started_at IS NOT NULL AND finished_at IS NOT NULL)
             AS avg_duration
         FROM document_ingestion_jobs`,
      ),
      pool.query<RawJob>(
        `SELECT
           j.id, j.document_item_id, j.user_id, j.state, j.attempts, j.error,
           j.created_at, j.started_at, j.finished_at, j.locked_at, j.locked_by,
           i.name AS document_name, i.file_type, i.size_bytes, i.ingest_status,
           (i.ai_summary IS NOT NULL) AS has_summary,
           f.name AS folder_name,
           (SELECT COUNT(*)::int FROM document_chunks c WHERE c.document_item_id = j.document_item_id) AS chunk_count,
           (SELECT COUNT(*)::int FROM document_chunks c WHERE c.document_item_id = j.document_item_id AND c.embedding IS NOT NULL) AS embedded_count,
           ${pageCount} AS page_count,
           ${imageCount} AS image_count,
           ${tableCount} AS table_count,
           EXTRACT(EPOCH FROM (COALESCE(j.finished_at, now()) - j.started_at)) AS duration_sec
         FROM document_ingestion_jobs j
         LEFT JOIN document_items i ON i.id = j.document_item_id
         LEFT JOIN document_folders f ON f.id = i.folder_id
         ORDER BY (j.state IN ('processing', 'queued')) DESC, j.created_at DESC
         LIMIT $1`,
        [jobLimit],
      ),
    ]);

    const counts = { queued: 0, processing: 0, completed: 0, failed: 0 };
    for (const row of stateRes.rows) {
      if (row.state in counts) counts[row.state as keyof typeof counts] = row.n;
    }

    const itemStatus: Record<string, number> = {};
    for (const row of itemRes.rows) {
      itemStatus[row.ingest_status ?? 'unset'] = row.n;
    }

    const t = totalRes.rows[0];
    const tp = throughputRes.rows[0];
    const lockCutoffMs = Date.now() - LOCK_TIMEOUT_SECONDS * 1000;

    const jobs: JobRow[] = jobsRes.rows.map((r) => {
      const stalled =
        r.state === 'processing' && r.locked_at != null && r.locked_at.getTime() < lockCutoffMs;

      const base = {
        id: r.id,
        documentItemId: r.document_item_id,
        userId: r.user_id,
        state: r.state,
        attempts: r.attempts,
        error: r.error,
        createdAt: r.created_at.toISOString(),
        startedAt: iso(r.started_at),
        finishedAt: iso(r.finished_at),
        lockedAt: iso(r.locked_at),
        lockedBy: r.locked_by,
        documentName: r.document_name,
        fileType: r.file_type,
        sizeBytes: r.size_bytes,
        ingestStatus: r.ingest_status,
        folderName: r.folder_name,
        chunkCount: r.chunk_count,
        embeddedCount: r.embedded_count,
        pageCount: r.page_count,
        imageCount: r.image_count,
        tableCount: r.table_count,
        durationSec: r.duration_sec != null ? Math.round(Number(r.duration_sec)) : null,
        stalled,
      };

      const { stage, stages, progressPct } = deriveStages({
        ...base,
        hasSummary: r.has_summary,
      });

      return { ...base, stage, stages, progressPct };
    });

    return {
      available: true,
      error: null,
      counts,
      itemStatus,
      totals: {
        documents: t?.documents ?? 0,
        chunks: t?.chunks ?? 0,
        embeddedChunks: t?.embedded ?? 0,
        pages: t?.pages ?? 0,
        images: t?.images ?? 0,
        tables: t?.tables ?? 0,
      },
      throughput: {
        completedLastHour: tp?.last_hour ?? 0,
        completedLast24h: tp?.last_24h ?? 0,
        failedLast24h: tp?.failed_24h ?? 0,
        avgDurationSec: tp?.avg_duration != null ? Math.round(Number(tp.avg_duration)) : null,
      },
      jobs,
    };
  } catch (err) {
    return { ...EMPTY_QUEUE, error: (err as Error).message };
  }
}

export async function closeMonitorDb(): Promise<void> {
  await pool.end().catch(() => undefined);
}
