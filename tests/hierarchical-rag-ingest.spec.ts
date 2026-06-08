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
import { access, copyFile, mkdir, readFile, readdir, unlink } from 'fs/promises';
import path from 'path';
import pkg from 'pg';

const { Pool } = pkg;

const FIXTURE_PDF = path.join(process.cwd(), 'tests', 'fixtures', 'simple.pdf');
const DOCS_API = (process.env.DOCS_API_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const MCP_API = 'http://localhost:3002';
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
  // Collect storage_path values before deleting rows so we can remove files too
  const fileRows = await pool.query(
    `SELECT storage_path FROM document_items WHERE name LIKE $1 OR original_filename LIKE $1`,
    [`${SENTINEL}%`],
  );

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

  // Delete the actual PDF files from disk
  for (const row of fileRows.rows as { storage_path: string }[]) {
    try {
      await unlink(row.storage_path);
    } catch {
      // file may already be gone or path may differ between host and container
    }
  }

  // Belt-and-suspenders: also glob the documents directory for any remaining E2E_RAG_ files
  try {
    const userDir = path.join(DOCUMENTS_ROOT, String(userId ?? ''));
    const files = await readdir(userDir);
    for (const f of files) {
      if (f.startsWith(SENTINEL)) {
        await unlink(path.join(userDir, f)).catch(() => {});
      }
    }
  } catch {
    // directory may not exist
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
    const body = (await res.json()) as { job_id: string; document_item_id: number; detail?: string };
    expect(res.ok, `POST /ingest failed: ${res.status} ${body.detail ?? JSON.stringify(body)}`).toBe(true);
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
  let phase2ItemId: number | null = null;

  test.beforeAll(async () => {
    test.skip(!ingestStackAvailable, 'vLLM/Ollama/as500-docs worker not reachable — see TODO prerequisites');
    const hasFixture = await fileExists(FIXTURE_PDF);
    test.skip(!hasFixture, `Missing fixture PDF at ${FIXTURE_PDF}`);

    // Seed a fresh item for Phase 2 (independent from Phase 1 item)
    phase2ItemId = await seedDocumentItem(userId, FIXTURE_PDF);

    // Enqueue via POST /ingest
    const res = await fetch(`${DOCS_API}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_item_id: phase2ItemId, user_id: userId }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`POST /ingest failed: ${res.status} ${body}`);
    }
  });

  test('2.A worker ingests simple PDF into document_chunks', async () => {
    test.setTimeout(180_000);

    await expect.poll(
      async () => {
        const row = await pool.query(
          'SELECT ingest_status FROM document_items WHERE id = $1',
          [phase2ItemId],
        );
        return row.rows[0]?.ingest_status as string;
      },
      { timeout: 150_000, intervals: [3000], message: 'ingest_status did not reach ready within 150s' },
    ).toBe('ready');

    const chunks = await pool.query(
      `SELECT COUNT(*)::int AS n FROM document_chunks WHERE document_item_id = $1`,
      [phase2ItemId],
    );
    expect(chunks.rows[0].n).toBeGreaterThanOrEqual(1);

    const sample = await pool.query(
      `SELECT text, embedding IS NOT NULL AS has_embedding FROM document_chunks WHERE document_item_id = $1 LIMIT 1`,
      [phase2ItemId],
    );
    expect(sample.rows[0].has_embedding).toBe(true);
    expect((sample.rows[0].text as string).length).toBeGreaterThan(0);
  });

  test('2.B document_pages populated', async () => {
    const pages = await pool.query(
      `SELECT COUNT(*)::int AS n FROM document_pages WHERE document_item_id = $1`,
      [phase2ItemId],
    );
    expect(pages.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  test('2.C ingest is idempotent by content_hash', async () => {
    test.setTimeout(180_000);

    // Reset status and re-enqueue the same file (hash unchanged → fast skip path)
    await pool.query(`UPDATE document_items SET ingest_status = 'pending' WHERE id = $1`, [phase2ItemId]);

    const res = await fetch(`${DOCS_API}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_item_id: phase2ItemId, user_id: userId }),
    });
    expect(res.ok).toBe(true);

    // Worker should reach ready again (either fast skip or full re-ingest)
    await expect.poll(
      async () => {
        const row = await pool.query(
          'SELECT ingest_status FROM document_items WHERE id = $1',
          [phase2ItemId],
        );
        return row.rows[0]?.ingest_status as string;
      },
      { timeout: 150_000, intervals: [3000] },
    ).toBe('ready');

    // Chunks must still exist after re-run
    const chunks = await pool.query(
      `SELECT COUNT(*)::int AS n FROM document_chunks WHERE document_item_id = $1`,
      [phase2ItemId],
    );
    expect(chunks.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  test('2.D failed ingest sets ingest_status failed', async () => {
    test.setTimeout(60_000);

    // Seed an item then point its storage_path to a nonexistent file
    const badItemId = await seedDocumentItem(userId, FIXTURE_PDF);
    await pool.query(
      `UPDATE document_items SET storage_path = '/nonexistent/missing.pdf', ingest_status = 'pending' WHERE id = $1`,
      [badItemId],
    );

    const res = await fetch(`${DOCS_API}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_item_id: badItemId, user_id: userId }),
    });
    expect(res.ok).toBe(true);

    await expect.poll(
      async () => {
        const row = await pool.query(
          'SELECT ingest_status FROM document_items WHERE id = $1',
          [badItemId],
        );
        return row.rows[0]?.ingest_status as string;
      },
      { timeout: 30_000, intervals: [1000] },
    ).toBe('failed');

    const job = await pool.query(
      `SELECT error FROM document_ingestion_jobs WHERE document_item_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [badItemId],
    );
    expect(job.rows[0]?.error).toBeTruthy();
  });
});

// ─────────────────────────────────────────────
// Phase 3 — e2e: folder + upload → worker → chunks
// ─────────────────────────────────────────────

test.describe('Hierarchical RAG — Phase 3 — e2e upload', () => {
  let phase3FolderId: number | null = null;
  let phase3ItemId: number | null = null;

  test.beforeAll(async () => {
    test.skip(!ingestStackAvailable, 'vLLM/Ollama/as500-docs worker not reachable — see TODO prerequisites');
    const hasFixture = await fileExists(FIXTURE_PDF);
    test.skip(!hasFixture, `Missing fixture PDF at ${FIXTURE_PDF}`);

    // Create a sentinel folder so node_path can be verified
    const folderRow = await pool.query(
      `INSERT INTO document_folders (user_id, parent_id, name, description)
       VALUES ($1, NULL, $2, NULL) RETURNING id`,
      [userId, `${SENTINEL}TestFolder`],
    );
    phase3FolderId = folderRow.rows[0].id as number;

    // Seed item inside that folder
    const userDir = path.join(DOCUMENTS_ROOT, String(userId));
    await mkdir(userDir, { recursive: true });
    const storedName = `${SENTINEL}phase3-${Date.now()}.pdf`;
    const storagePath = path.join(userDir, storedName);
    await copyFile(FIXTURE_PDF, storagePath);
    const stat = await readFile(storagePath);

    const insert = await pool.query(
      `INSERT INTO document_items (
         user_id, folder_id, name, file_type, mime_type, extension,
         storage_path, original_filename, size_bytes, ingest_status
       ) VALUES ($1, $2, $3, 'pdf', 'application/pdf', 'pdf', $4, $5, $6, 'pending')
       RETURNING id`,
      [userId, phase3FolderId, `${SENTINEL}phase3.pdf`, storagePath, `${SENTINEL}phase3.pdf`, stat.byteLength],
    );
    phase3ItemId = insert.rows[0].id as number;

    // Enqueue via as500-docs HTTP API (same path as saveUploadedFile → enqueueIngest)
    const res = await fetch(`${DOCS_API}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_item_id: phase3ItemId, user_id: userId }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`POST /ingest failed: ${res.status} ${body}`);
    }
  });

  test('3.A upload triggers ingest and produces chunks', async () => {
    test.setTimeout(180_000);

    await expect.poll(
      async () => {
        const row = await pool.query(
          'SELECT ingest_status FROM document_items WHERE id = $1',
          [phase3ItemId],
        );
        return row.rows[0]?.ingest_status as string;
      },
      { timeout: 150_000, intervals: [3000], message: 'ingest_status did not reach ready within 150s' },
    ).toBe('ready');

    const chunks = await pool.query(
      `SELECT COUNT(*)::int AS n FROM document_chunks WHERE document_item_id = $1`,
      [phase3ItemId],
    );
    expect(chunks.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  test('3.B chunk node_path reflects folder breadcrumb', async () => {
    const chunks = await pool.query(
      `SELECT DISTINCT node_path FROM document_chunks WHERE document_item_id = $1`,
      [phase3ItemId],
    );
    expect(chunks.rows.length).toBeGreaterThanOrEqual(1);
    const nodePath = chunks.rows[0].node_path as string;
    expect(nodePath).toContain(`${SENTINEL}TestFolder`);
  });
});

// ─────────────────────────────────────────────
// Phase 4 — search
// ─────────────────────────────────────────────

test.describe('Hierarchical RAG — Phase 4 — search', () => {
  test.beforeAll(async () => {
    test.skip(!ingestStackAvailable, 'vLLM/Ollama/as500-docs worker not reachable — see TODO prerequisites');
  });

  test('4.A search returns chunk from ingested fixture', async () => {
    // Use a term that should appear in the fixture PDF (Hetzner invoice content)
    const res = await fetch(`${DOCS_API}/search/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'invoice', user_id: userId, top_k: 5 }),
    });
    expect(res.ok, `POST /search/documents failed: ${res.status}`).toBe(true);

    const body = (await res.json()) as {
      total: number;
      results: { chunk_id: number; document_title: string; text: string; score: number }[];
    };
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.results[0].score).toBeGreaterThan(0);
    expect(body.results[0].document_title).toBeTruthy();
    expect(body.results[0].text.length).toBeGreaterThan(0);
  });

  test('4.B search scoped to user_id excludes other users chunks', async () => {
    // user_id = 999999 does not exist — should return zero results
    const res = await fetch(`${DOCS_API}/search/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'invoice', user_id: 999999, top_k: 5 }),
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { total: number };
    expect(body.total).toBe(0);
  });

  test('4.C find_nodes returns the sentinel folder after ingest', async () => {
    const res = await fetch(`${DOCS_API}/search/nodes?query=invoice&user_id=${userId}&top_k=5`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { total: number; nodes: { folder_id: number; name: string; score: number }[] };
    // Phase 7: folder embedding is populated after ingest — sentinel folder should appear
    expect(body.total).toBeGreaterThan(0);
    const names = body.nodes.map((n) => n.name);
    expect(names.some((n) => n.includes('RAG'))).toBe(true);
  });
});

// ─────────────────────────────────────────────
// Phase 5 — MCP knowledge tools
// ─────────────────────────────────────────────

test.describe('Hierarchical RAG — Phase 5 — MCP', () => {
  let mcpToken: string | null = null;

  test.beforeAll(async () => {
    test.skip(!ingestStackAvailable, 'vLLM/Ollama/as500-docs worker not reachable — see TODO prerequisites');

    // Get a first-party Bearer token for FREDRIC via the REST auth endpoint
    const res = await fetch(`${MCP_API}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: FREDRIC.username, password: FREDRIC.password }),
    });
    if (!res.ok) {
      throw new Error(`/api/auth/token failed: ${res.status}`);
    }
    const body = (await res.json()) as { access_token: string };
    mcpToken = body.access_token;
  });

  async function mcpCall(method: string, params: unknown, id = 1) {
    const res = await fetch(`${MCP_API}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${mcpToken}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method, id, params }),
    });
    const text = await res.text();
    // MCP may respond as SSE (text/event-stream) or plain JSON — parse accordingly
    if (res.headers.get('content-type')?.includes('text/event-stream')) {
      const dataLine = text.split('\n').find((l) => l.startsWith('data: '));
      return JSON.parse(dataLine?.slice(6) ?? '{}') as { result?: unknown; error?: { code: number; message: string } };
    }
    return JSON.parse(text) as { result?: unknown; error?: { code: number; message: string } };
  }

  test('5.A knowledge_search in tools/list', async () => {
    const resp = await mcpCall('tools/list', {});
    expect(resp.error).toBeUndefined();
    const tools = (resp.result as { tools: { name: string }[] }).tools;
    const names = tools.map((t) => t.name);
    expect(names).toContain('knowledge_search');
    expect(names).toContain('knowledge_find_nodes');
    expect(names).toContain('knowledge_describe_node');
    expect(names).toContain('knowledge_get_document');
    expect(names).toContain('knowledge_get_chunk');
  });

  test('5.B knowledge_search returns ingested chunk', async () => {
    const resp = await mcpCall('tools/call', {
      name: 'knowledge_search',
      arguments: { query: 'invoice', top_k: 3 },
    });
    expect(resp.error).toBeUndefined();
    const result = resp.result as {
      structuredContent?: { total: number; results: { document_title: string; text: string }[] };
      content: { text: string }[];
    };
    // Prefer structuredContent (already parsed); fall back to extracting JSON from text
    const parsed = result.structuredContent ?? JSON.parse(result.content[0].text.slice(result.content[0].text.indexOf('{')));
    expect(parsed.total).toBeGreaterThanOrEqual(1);
    expect(parsed.results[0].document_title).toBeTruthy();
    expect(parsed.results[0].text.length).toBeGreaterThan(0);
  });

  test('5.C knowledge_get_document shows ready status', async () => {
    // Find an E2E_RAG_ item that is ready
    const itemRow = await pool.query(
      `SELECT id FROM document_items WHERE name LIKE $1 AND ingest_status = 'ready' LIMIT 1`,
      [`${SENTINEL}%`],
    );
    test.skip(!itemRow.rows[0], 'No ready E2E_RAG_ item found — run Phase 2+ first');

    const itemId = itemRow.rows[0].id as number;
    const resp = await mcpCall('tools/call', {
      name: 'knowledge_get_document',
      arguments: { document_item_id: itemId },
    });
    expect(resp.error).toBeUndefined();
    const result2 = resp.result as {
      structuredContent?: { document: { ingest_status: string } };
      content: { text: string }[];
    };
    const parsed2 = result2.structuredContent ?? JSON.parse(result2.content[0].text.slice(result2.content[0].text.indexOf('{')));
    expect(parsed2.document.ingest_status).toBe('ready');
  });
});
