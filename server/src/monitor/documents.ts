/**
 * Ingest Monitor — read-only inspection of what the pipeline actually produced.
 *
 * The dashboard's job cards answer "did it run?". This module answers "is the
 * result any good?" — chunk text, per-page markdown, extracted images and
 * tables, the AI summary, and a live search probe.
 *
 * Everything here is SELECT-only. The monitor never writes to the ingestion
 * tables, which are owned by the as500-docs Alembic migrations.
 */

import { createReadStream, promises as fs } from 'fs';
import { extname, join, normalize, resolve, sep } from 'path';
import { DOCS_API_URL, DOCS_STORAGE_ROOT, UPLOAD_ROOT } from './config.js';
import { monitorPool as pool, tableExists } from './db.js';
import type {
  ChunkRow,
  DocumentDetail,
  DocumentJobRow,
  DocumentListRow,
  DocumentMeta,
  ImageRow,
  PageRow,
  SearchHit,
  SearchOutcome,
  TableRow,
} from './types.js';

/** Longest chunk body sent to the browser; the full text lives in the DB. */
const MAX_CHUNK_CHARS = 20_000;
const MAX_PAGE_CHARS = 40_000;

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/**
 * `document_pages`/`images`/`tables` are created by as500-docs, so on a
 * checkout that has never run those migrations they are simply absent. Probing
 * once per call keeps the inspector usable in that state.
 */
async function artefactTables(): Promise<{ pages: boolean; images: boolean; tables: boolean }> {
  const [pages, images, tables] = await Promise.all([
    tableExists('document_pages'),
    tableExists('document_images'),
    tableExists('document_tables'),
  ]);
  return { pages, images, tables };
}

/* ── Folder breadcrumbs ──────────────────────────────────────────────────── */

interface RawFolder {
  id: number;
  parent_id: number | null;
  name: string;
}

/**
 * Resolves every folder once and walks parents in memory. Doing this per-row
 * with a recursive CTE turned the list query into N+1 round trips.
 */
async function folderPaths(): Promise<Map<number, string>> {
  const { rows } = await pool.query<RawFolder>(
    `SELECT id, parent_id, name FROM document_folders`,
  );

  const byId = new Map<number, RawFolder>(rows.map((r) => [r.id, r]));
  const cache = new Map<number, string>();

  const walk = (id: number, seen: Set<number>): string => {
    const cached = cache.get(id);
    if (cached) return cached;

    const folder = byId.get(id);
    if (!folder) return '(missing folder)';

    // A cycle would otherwise hang the poll; treat it as a broken parent link.
    if (seen.has(id)) return `(cyclic:${id})`;
    seen.add(id);

    const path =
      folder.parent_id == null
        ? `/${folder.name}`
        : `${walk(folder.parent_id, seen)}/${folder.name}`;

    cache.set(id, path);
    return path;
  };

  for (const row of rows) walk(row.id, new Set());
  return cache;
}

/* ── List ────────────────────────────────────────────────────────────────── */

interface RawListRow {
  id: number;
  name: string;
  user_id: number;
  folder_id: number | null;
  file_type: string | null;
  size_bytes: number | null;
  ingest_status: string | null;
  has_summary: boolean;
  updated_at: Date | null;
  chunk_count: number;
  embedded_count: number;
  page_count: number;
  image_count: number;
  table_count: number;
  last_job_state: string | null;
  last_job_error: string | null;
  last_job_secs: string | null;
}

function toListRow(r: RawListRow, paths: Map<number, string>): DocumentListRow {
  return {
    id: r.id,
    name: r.name,
    userId: r.user_id,
    folderId: r.folder_id,
    folderPath: r.folder_id != null ? paths.get(r.folder_id) ?? '(unknown)' : '(no folder)',
    fileType: r.file_type,
    sizeBytes: r.size_bytes,
    ingestStatus: r.ingest_status ?? 'unset',
    hasSummary: r.has_summary,
    chunkCount: r.chunk_count,
    embeddedCount: r.embedded_count,
    pageCount: r.page_count,
    imageCount: r.image_count,
    tableCount: r.table_count,
    updatedAt: iso(r.updated_at),
    lastJobState: r.last_job_state,
    lastJobError: r.last_job_error,
    lastJobDurationSec: r.last_job_secs != null ? Math.round(Number(r.last_job_secs)) : null,
  };
}

export async function listDocuments(limit = 200): Promise<DocumentListRow[]> {
  const has = await artefactTables();
  const zero = '(SELECT 0)';

  const countFor = (table: string, enabled: boolean, alias: string) =>
    enabled
      ? `(SELECT COUNT(*)::int FROM ${table} x WHERE x.document_item_id = i.id) AS ${alias}`
      : `${zero} AS ${alias}`;

  const [paths, res] = await Promise.all([
    folderPaths(),
    pool.query<RawListRow>(
      `SELECT
         i.id, i.name, i.user_id, i.folder_id, i.file_type, i.size_bytes,
         i.ingest_status, i.updated_at,
         (i.ai_summary IS NOT NULL) AS has_summary,
         (SELECT COUNT(*)::int FROM document_chunks c WHERE c.document_item_id = i.id) AS chunk_count,
         (SELECT COUNT(*)::int FROM document_chunks c
           WHERE c.document_item_id = i.id AND c.embedding IS NOT NULL) AS embedded_count,
         ${countFor('document_pages', has.pages, 'page_count')},
         ${countFor('document_images', has.images, 'image_count')},
         ${countFor('document_tables', has.tables, 'table_count')},
         j.state AS last_job_state,
         j.error AS last_job_error,
         EXTRACT(EPOCH FROM (j.finished_at - j.started_at)) AS last_job_secs
       FROM document_items i
       LEFT JOIN LATERAL (
         SELECT state, error, started_at, finished_at
         FROM document_ingestion_jobs
         WHERE document_item_id = i.id
         ORDER BY created_at DESC
         LIMIT 1
       ) j ON true
       ORDER BY i.updated_at DESC NULLS LAST, i.id DESC
       LIMIT $1`,
      [limit],
    ),
  ]);

  return res.rows.map((r) => toListRow(r, paths));
}

/* ── Detail ──────────────────────────────────────────────────────────────── */

/**
 * Maps an as500-docs relative path (`storage/documents/1/29/images/x.png`) onto
 * the bind-mounted storage root, then confirms the file is readable. Returning
 * a null URL is what makes the client show "not mounted" instead of a broken
 * image.
 */
async function imageUrl(filePath: string | null, imageId: number): Promise<string | null> {
  if (!filePath) return null;
  const abs = resolveStoragePath(filePath);
  if (!abs) return null;
  try {
    await fs.access(abs);
    return `/api/image/${imageId}`;
  } catch {
    return null;
  }
}

/**
 * Confines a recorded path to DOCS_STORAGE_ROOT. Paths come from the database
 * rather than the client, but the resulting file is streamed to a browser, so
 * traversal is rejected rather than trusted.
 */
export function resolveStoragePath(filePath: string): string | null {
  const relative = filePath
    .replace(/^\/app\//, '')
    .replace(/^storage[/\\]/, '')
    .replace(/^[/\\]+/, '');

  if (!relative) return null;

  const root = resolve(DOCS_STORAGE_ROOT);
  const abs = resolve(join(root, normalize(relative)));
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  return abs;
}

/**
 * `document_items.storage_path` is an absolute container path written by the
 * upload handler. It is confined to UPLOAD_ROOT anyway, so a bad row can never
 * turn the monitor into an arbitrary-file reader.
 */
function resolveUploadPath(storagePath: string): string | null {
  const root = resolve(UPLOAD_ROOT);
  const abs = resolve(normalize(storagePath));
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  return abs;
}

async function readableOriginal(storagePath: string | null, itemId: number): Promise<string | null> {
  if (!storagePath) return null;
  const abs = resolveUploadPath(storagePath);
  if (!abs) return null;
  try {
    await fs.access(abs);
    return `/api/original/${itemId}`;
  } catch {
    return null;
  }
}

export async function readDocument(itemId: number): Promise<DocumentDetail | null> {
  const has = await artefactTables();

  const itemRes = await pool.query<{
    id: number;
    name: string;
    user_id: number;
    folder_id: number | null;
    file_type: string | null;
    mime_type: string | null;
    size_bytes: number | null;
    ingest_status: string | null;
    storage_path: string | null;
    content_hash: string | null;
    ai_summary: string | null;
    created_at: Date | null;
    updated_at: Date | null;
  }>(
    `SELECT id, name, user_id, folder_id, file_type, mime_type, size_bytes,
            ingest_status, storage_path, content_hash, ai_summary, created_at, updated_at
     FROM document_items WHERE id = $1`,
    [itemId],
  );

  const item = itemRes.rows[0];
  if (!item) return null;

  const [paths, jobsRes, chunksRes, pagesRes, imagesRes, tablesRes] = await Promise.all([
    folderPaths(),

    pool.query<{
      id: string;
      state: string;
      attempts: number;
      error: string | null;
      traceback: string | null;
      created_at: Date;
      started_at: Date | null;
      finished_at: Date | null;
      locked_by: string | null;
      secs: string | null;
    }>(
      `SELECT id, state, attempts, error, traceback, created_at, started_at, finished_at, locked_by,
              EXTRACT(EPOCH FROM (finished_at - started_at)) AS secs
       FROM document_ingestion_jobs WHERE document_item_id = $1 ORDER BY created_at DESC`,
      [itemId],
    ),

    pool.query<{
      id: number;
      page_number: number | null;
      page_end: number | null;
      section_title: string | null;
      content_type: string | null;
      node_path: string | null;
      char_count: number;
      has_vec: boolean;
      dims: number | null;
      text: string | null;
    }>(
      `SELECT id, page_number, page_end, section_title, content_type, node_path,
              COALESCE(LENGTH(text), 0)::int AS char_count,
              (embedding IS NOT NULL) AS has_vec,
              CASE WHEN embedding IS NOT NULL THEN vector_dims(embedding) ELSE NULL END AS dims,
              LEFT(text, $2) AS text
       FROM document_chunks WHERE document_item_id = $1
       ORDER BY page_number NULLS FIRST, id`,
      [itemId, MAX_CHUNK_CHARS],
    ),

    has.pages
      ? pool.query<{ page_number: number; raw_len: number; markdown: string | null }>(
          `SELECT page_number, COALESCE(LENGTH(raw_text), 0)::int AS raw_len,
                  LEFT(markdown, $2) AS markdown
           FROM document_pages WHERE document_item_id = $1 ORDER BY page_number`,
          [itemId, MAX_PAGE_CHARS],
        )
      : Promise.resolve({ rows: [] as { page_number: number; raw_len: number; markdown: string | null }[] }),

    has.images
      ? pool.query<{
          id: number;
          page_number: number | null;
          file_path: string | null;
          caption: string | null;
          linked_chunk_id: number | null;
        }>(
          `SELECT id, page_number, file_path, caption, linked_chunk_id
           FROM document_images WHERE document_item_id = $1 ORDER BY page_number NULLS LAST, id`,
          [itemId],
        )
      : Promise.resolve({
          rows: [] as {
            id: number;
            page_number: number | null;
            file_path: string | null;
            caption: string | null;
            linked_chunk_id: number | null;
          }[],
        }),

    has.tables
      ? pool.query<{
          id: number;
          page_number: number | null;
          table_markdown: string | null;
          linked_chunk_id: number | null;
        }>(
          `SELECT id, page_number, table_markdown, linked_chunk_id
           FROM document_tables WHERE document_item_id = $1 ORDER BY page_number NULLS LAST, id`,
          [itemId],
        )
      : Promise.resolve({
          rows: [] as {
            id: number;
            page_number: number | null;
            table_markdown: string | null;
            linked_chunk_id: number | null;
          }[],
        }),
  ]);

  const chunks: ChunkRow[] = chunksRes.rows.map((r) => ({
    id: r.id,
    pageNumber: r.page_number,
    pageEnd: r.page_end,
    sectionTitle: r.section_title,
    contentType: r.content_type,
    nodePath: r.node_path,
    charCount: r.char_count,
    hasEmbedding: r.has_vec,
    embeddingDims: r.dims != null ? Number(r.dims) : null,
    text: r.text ?? '',
  }));

  const pages: PageRow[] = pagesRes.rows.map((r) => ({
    pageNumber: r.page_number,
    rawTextLength: r.raw_len,
    markdown: r.markdown,
  }));

  const images: ImageRow[] = await Promise.all(
    imagesRes.rows.map(async (r) => ({
      id: r.id,
      pageNumber: r.page_number,
      filePath: r.file_path,
      caption: r.caption,
      linkedChunkId: r.linked_chunk_id,
      url: await imageUrl(r.file_path, r.id),
    })),
  );

  const tables: TableRow[] = tablesRes.rows.map((r) => ({
    id: r.id,
    pageNumber: r.page_number,
    markdown: r.table_markdown,
    linkedChunkId: r.linked_chunk_id,
  }));

  const jobs: DocumentJobRow[] = jobsRes.rows.map((r) => ({
    id: r.id,
    state: r.state,
    attempts: r.attempts,
    error: r.error,
    traceback: r.traceback,
    createdAt: r.created_at.toISOString(),
    startedAt: iso(r.started_at),
    finishedAt: iso(r.finished_at),
    lockedBy: r.locked_by,
    durationSec: r.secs != null ? Math.round(Number(r.secs)) : null,
  }));

  const meta: DocumentMeta = {
    id: item.id,
    name: item.name,
    userId: item.user_id,
    folderId: item.folder_id,
    folderPath: item.folder_id != null ? paths.get(item.folder_id) ?? '(unknown)' : '(no folder)',
    fileType: item.file_type,
    mimeType: item.mime_type,
    sizeBytes: item.size_bytes,
    ingestStatus: item.ingest_status ?? 'unset',
    hasSummary: item.ai_summary != null,
    chunkCount: chunks.length,
    embeddedCount: chunks.filter((c) => c.hasEmbedding).length,
    pageCount: pages.length,
    imageCount: images.length,
    tableCount: tables.length,
    updatedAt: iso(item.updated_at),
    createdAt: iso(item.created_at),
    lastJobState: jobs[0]?.state ?? null,
    lastJobError: jobs[0]?.error ?? null,
    lastJobDurationSec: jobs[0]?.durationSec ?? null,
    storagePath: item.storage_path,
    contentHash: item.content_hash,
    aiSummary: item.ai_summary,
    originalUrl: await readableOriginal(item.storage_path, item.id),
  };

  return { item: meta, jobs, chunks, pages, images, tables, warnings: warn(meta, chunks, images, has) };
}

function warn(
  meta: DocumentMeta,
  chunks: ChunkRow[],
  images: ImageRow[],
  has: { pages: boolean; images: boolean; tables: boolean },
): string[] {
  const out: string[] = [];

  if (meta.ingestStatus === 'ready' && chunks.length === 0) {
    out.push('Marked ready but produced no chunks — this document can never be retrieved.');
  }

  const missing = chunks.length - meta.embeddedCount;
  if (missing > 0) {
    out.push(`${missing} of ${chunks.length} chunks have no embedding and are invisible to vector search.`);
  }

  const dims = new Set(chunks.map((c) => c.embeddingDims).filter((d): d is number => d != null));
  if (dims.size > 1) {
    out.push(`Mixed embedding dimensions (${[...dims].join(', ')}) — the model changed between runs.`);
  }

  const empty = chunks.filter((c) => c.charCount === 0).length;
  if (empty > 0) out.push(`${empty} chunk(s) have empty text.`);

  if (!meta.aiSummary && meta.ingestStatus === 'ready') {
    out.push(
      'No AI summary was generated — retrieval is unaffected, but knowledge_get_document has ' +
        'nothing to describe this document with. Usually means Ollama was down at step 13.',
    );
  }

  const unmounted = images.filter((i) => i.url == null).length;
  if (unmounted > 0) {
    out.push(
      `${unmounted} extracted image(s) could not be read. Mount the as500-docs storage tree ` +
        'into the server container to preview them.',
    );
  }

  if (!has.pages) out.push('Table document_pages is missing — run the as500-docs Alembic migrations.');

  return out;
}

/* ── Image + original file streaming ─────────────────────────────────────── */

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

export interface StreamableFile {
  absolutePath: string;
  contentType: string;
  sizeBytes: number;
  filename: string;
}

export async function locateImage(imageId: number): Promise<StreamableFile | null> {
  const { rows } = await pool.query<{ file_path: string | null }>(
    `SELECT file_path FROM document_images WHERE id = $1`,
    [imageId],
  );
  const filePath = rows[0]?.file_path;
  if (!filePath) return null;

  const abs = resolveStoragePath(filePath);
  if (!abs) return null;

  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) return null;
    return {
      absolutePath: abs,
      contentType: contentTypeFor(abs),
      sizeBytes: stat.size,
      filename: filePath.split(/[/\\]/).pop() ?? `image-${imageId}`,
    };
  } catch {
    return null;
  }
}

export async function locateOriginal(itemId: number): Promise<StreamableFile | null> {
  const { rows } = await pool.query<{ storage_path: string | null; name: string; file_type: string | null }>(
    `SELECT storage_path, name, file_type FROM document_items WHERE id = $1`,
    [itemId],
  );
  const row = rows[0];
  if (!row?.storage_path) return null;

  const abs = resolveUploadPath(row.storage_path);
  if (!abs) return null;

  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) return null;
    return {
      absolutePath: abs,
      contentType: contentTypeFor(abs),
      sizeBytes: stat.size,
      filename: `${row.name}${row.file_type ? `.${row.file_type}` : ''}`,
    };
  } catch {
    return null;
  }
}

export function openFileStream(file: StreamableFile) {
  return createReadStream(file.absolutePath);
}

/* ── Search probe ────────────────────────────────────────────────────────── */

interface RawSearchResult {
  chunk_id: number;
  document_item_id: number;
  document_title: string | null;
  page_number: number | null;
  section_title: string | null;
  node_path: string | null;
  score: number;
  vec_score: number;
  kw_score: number;
  text: string;
}

/**
 * Runs a query through the real as500-docs hybrid search so the inspector shows
 * retrieval as the AI agent sees it, not a reimplementation of it.
 */
export async function searchDocuments(
  query: string,
  userId: number,
  topK = 8,
): Promise<SearchOutcome> {
  const started = Date.now();
  const base: SearchOutcome = {
    query,
    userId,
    total: 0,
    tookMs: 0,
    hits: [],
    error: null,
    keywordDead: false,
  };

  if (!query.trim()) return { ...base, error: 'empty query' };

  try {
    const res = await fetch(`${DOCS_API_URL}/search/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, user_id: userId, top_k: topK }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      return { ...base, tookMs: Date.now() - started, error: `HTTP ${res.status} from as500-docs` };
    }

    const data = (await res.json()) as { total?: number; results?: RawSearchResult[] };
    const results = data.results ?? [];

    const hits: SearchHit[] = results.map((r, i) => ({
      rank: i + 1,
      chunkId: r.chunk_id,
      documentItemId: r.document_item_id,
      documentTitle: r.document_title,
      pageNumber: r.page_number,
      sectionTitle: r.section_title,
      nodePath: r.node_path,
      score: Number(r.score ?? 0),
      vecScore: Number(r.vec_score ?? 0),
      kwScore: Number(r.kw_score ?? 0),
      text: r.text ?? '',
    }));

    return {
      ...base,
      total: data.total ?? hits.length,
      tookMs: Date.now() - started,
      hits,
      keywordDead: hits.length > 0 && hits.every((h) => h.kwScore === 0),
    };
  } catch (err) {
    return { ...base, tookMs: Date.now() - started, error: (err as Error).message };
  }
}
