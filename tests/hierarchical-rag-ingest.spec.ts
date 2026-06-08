/**
 * Hierarchical RAG ingest — single test file, phased (see SPECS/Hierarchical RAG MCP TODO.md).
 *
 * Fixture: tests/fixtures/simple.pdf — minimal 1–2 page PDF (user-provided).
 *
 * Run:
 *   npm test -- --grep "Hierarchical RAG"
 *
 * Phases 2+ require vLLM + Ollama + as500-docs worker; skipped automatically when unavailable.
 */

import { test, expect } from '@playwright/test';
import { access, copyFile, mkdir, readFile } from 'fs/promises';
import path from 'path';
import pkg from 'pg';

const { Pool } = pkg;

const FIXTURE_PDF = path.join(process.cwd(), 'tests', 'fixtures', 'simple.pdf');
const DOCS_API = (process.env.DOCS_API_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const DB_URL = process.env.DATABASE_URL ?? 'postgresql://as500:as500@localhost:5433/as500';
const SENTINEL = 'E2E_RAG_';
const DOCUMENTS_ROOT = path.join(process.cwd(), 'server', 'data', 'documents');

const FREDRIC = { username: 'FREDRIC', password: 'fredric' };

let pool: InstanceType<typeof Pool>;
let userId: number;
let seededItemId: number | null = null;
let ingestStackAvailable = false;

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function assertIngestPrerequisites(): Promise<boolean> {
  try {
    const res = await fetch(`${DOCS_API}/healthz`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const body = (await res.json()) as { worker?: string; ollama?: string };
    return body.worker !== 'error' && body.ollama !== 'error';
  } catch {
    return false;
  }
}

async function getUserId(username: string): Promise<number> {
  const result = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (result.rows.length === 0) {
    throw new Error(`User ${username} not found — run seed first`);
  }
  return result.rows[0].id as number;
}

async function seedDocumentItem(ownerId: number, sourcePdfPath: string): Promise<number> {
  const userDir = path.join(DOCUMENTS_ROOT, String(ownerId));
  await mkdir(userDir, { recursive: true });

  const storedName = `${SENTINEL}simple-${Date.now()}.pdf`;
  const storagePath = path.join(userDir, storedName);
  await copyFile(sourcePdfPath, storagePath);

  const stat = await readFile(storagePath);
  const displayName = `${SENTINEL}simple.pdf`;

  const insert = await pool.query(
    `INSERT INTO document_items (
       user_id, folder_id, name, file_type, mime_type, extension,
       storage_path, original_filename, size_bytes, ingest_status
     ) VALUES ($1, NULL, $2, 'pdf', 'application/pdf', 'pdf', $3, $4, $5, 'pending')
     RETURNING id`,
    [ownerId, displayName, storagePath, displayName, stat.byteLength],
  );
  return insert.rows[0].id as number;
}

async function cleanupSentinelData(): Promise<void> {
  await pool.query(
    `DELETE FROM document_chunks WHERE document_item_id IN (
       SELECT id FROM document_items WHERE name LIKE $1 OR original_filename LIKE $1
     )`,
    [`${SENTINEL}%`],
  );
  await pool.query(`DELETE FROM document_items WHERE name LIKE $1 OR original_filename LIKE $1`, [`${SENTINEL}%`]);
  await pool.query(`DELETE FROM document_folders WHERE name LIKE $1`, [`${SENTINEL}%`]);
  // as500-docs job table — ignore if not migrated yet
  try {
    await pool.query(
      `DELETE FROM document_ingestion_jobs WHERE document_item_id IN (
         SELECT id FROM document_items WHERE name LIKE $1
       )`,
      [`${SENTINEL}%`],
    );
  } catch {
    // table may not exist until Phase 1
  }
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  pool = new Pool({ connectionString: DB_URL });
  userId = await getUserId(FREDRIC.username);
  ingestStackAvailable = await assertIngestPrerequisites();
  await cleanupSentinelData();
});

test.afterAll(async () => {
  await cleanupSentinelData();
  await pool.end();
});

// ─────────────────────────────────────────────
// Phase 0 — schema & fixture seed
// ─────────────────────────────────────────────

test.describe('Hierarchical RAG — Phase 0 — schema', () => {
  test('0.A document_items row seeds with pending status', async () => {
    const hasFixture = await fileExists(FIXTURE_PDF);
    test.skip(!hasFixture, `Missing fixture PDF at ${FIXTURE_PDF} — add a simple PDF before running`);

    seededItemId = await seedDocumentItem(userId, FIXTURE_PDF);

    const row = await pool.query(
      'SELECT id, ingest_status, storage_path FROM document_items WHERE id = $1',
      [seededItemId],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].ingest_status).toBe('pending');

    const onDisk = await fileExists(row.rows[0].storage_path as string);
    expect(onDisk).toBe(true);
  });

  test('0.B document_chunks table exists', async () => {
    const result = await pool.query('SELECT 1 FROM document_chunks LIMIT 0');
    expect(result.rows).toEqual([]);
  });
});

// ─────────────────────────────────────────────
// Phase 1 — job queue (enable when POST /ingest exists)
// ─────────────────────────────────────────────

test.describe('Hierarchical RAG — Phase 1 — job queue', () => {
  test.beforeAll(async () => {
    const apiReachable = await assertIngestPrerequisites();
    test.skip(!apiReachable, 'as500-docs API not reachable — run: cd ../as500-docs && docker compose up -d');
    test.skip(!seededItemId, 'Requires Phase 0.A seed to have run first');
  });

  test('1.A POST /ingest enqueues job', async () => {
    const res = await fetch(`${DOCS_API}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_item_id: seededItemId, user_id: userId }),
    });
    expect(res.ok, `POST /ingest failed: ${res.status} ${await res.text().catch(() => '')}`).toBe(true);

    const body = (await res.json()) as { job_id: string; document_item_id: number };
    expect(typeof body.job_id).toBe('string');
    expect(body.document_item_id).toBe(seededItemId);

    const jobs = await pool.query(
      `SELECT state FROM document_ingestion_jobs WHERE document_item_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [seededItemId],
    );
    expect(jobs.rows[0]?.state).toBe('queued');
  });

  test('1.B worker claims queued job', async () => {
    test.setTimeout(60_000);
    await expect.poll(async () => {
      const jobs = await pool.query(
        `SELECT state FROM document_ingestion_jobs WHERE document_item_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [seededItemId],
      );
      return jobs.rows[0]?.state as string | undefined;
    }, { timeout: 30_000, intervals: [1000] }).toMatch(/completed|processing/);

    // ingest_status should have been updated by the worker
    await expect.poll(async () => {
      const row = await pool.query(
        `SELECT ingest_status FROM document_items WHERE id = $1`,
        [seededItemId],
      );
      return row.rows[0]?.ingest_status as string;
    }, { timeout: 30_000, intervals: [1000] }).toMatch(/processing|ready/);
  });
});

// ─────────────────────────────────────────────
// Phase 2 — Docling ingest via worker
// ─────────────────────────────────────────────

test.describe('Hierarchical RAG — Phase 2 — docling ingest', () => {
  test.beforeAll(() => {
    test.skip(!ingestStackAvailable, 'vLLM/Ollama/as500-docs worker not reachable — see TODO prerequisites');
    test.skip(!seededItemId, 'Requires Phase 0.A seed');
  });

  test('2.A worker ingests simple PDF into document_chunks', async () => {
    test.setTimeout(180_000);
    test.skip(true, 'Enable after as500-docs worker retargets to document_items');

    // Enqueue or rely on CLI having run — adjust when Phase 1 ships
    await expect.poll(async () => {
      const row = await pool.query('SELECT ingest_status FROM document_items WHERE id = $1', [seededItemId]);
      return row.rows[0]?.ingest_status as string;
    }, { timeout: 120_000 }).toBe('ready');

    const chunks = await pool.query(
      `SELECT COUNT(*)::int AS n FROM document_chunks WHERE document_item_id = $1`,
      [seededItemId],
    );
    expect(chunks.rows[0].n).toBeGreaterThanOrEqual(1);

    const sample = await pool.query(
      `SELECT text, embedding IS NOT NULL AS has_embedding FROM document_chunks WHERE document_item_id = $1 LIMIT 1`,
      [seededItemId],
    );
    expect(sample.rows[0].has_embedding).toBe(true);
    expect((sample.rows[0].text as string).length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────
// Phase 3+ — stubs (unskip per TODO.md)
// ─────────────────────────────────────────────

test.describe('Hierarchical RAG — Phase 3 — e2e upload', () => {
  test.skip(true, 'Enable after documentsUpload triggers enqueueIngest');
});

test.describe('Hierarchical RAG — Phase 4 — search', () => {
  test.skip(true, 'Enable after as500-docs search retargets to document_chunks');
});

test.describe('Hierarchical RAG — Phase 5 — MCP', () => {
  test.skip(true, 'Enable after knowledgeTools.ts is registered');
});
