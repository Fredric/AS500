/**
 * Bearer-authenticated document mutation on the MCP/API server (port 3002).
 *
 *   POST   /api/documents?folderId=            — new folder
 *   GET    /api/documents/:id?kind=folder|file  — one entry
 *   PUT    /api/documents/:id?kind=folder|file  — rename
 *   DELETE /api/documents/:id?kind=folder|file  — remove (folders recurse)
 *
 * `kind` is required for read/update/delete: the REST layer has no selected
 * row to read it from the way the terminal does, so the caller passes back
 * the `kind` the listing gave it. This is the surface the mobile app's
 * "My Documents" browser uses for New folder / Rename / Delete.
 *
 * Uses FREDRIC (admin). Everything created here is deleted in afterAll.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import pkg from 'pg';

const { Pool } = pkg;

const API_BASE = 'http://localhost:3002';
const DB_URL = process.env.DATABASE_URL ?? 'postgresql://as500:as500@localhost:5433/as500';
const SENTINEL = `E2E_WRITE_${Date.now()}`;

async function login(request: APIRequestContext, username: string, password: string) {
  const res = await request.post(`${API_BASE}/api/auth/token`, {
    data: { username, password },
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as { access_token: string; refresh_token: string };
}

test.describe.configure({ mode: 'serial' });

test.describe('REST API — document mutation', () => {
  let accessToken = '';
  let refreshToken = '';
  let pool: InstanceType<typeof Pool>;
  const createdFolderIds: number[] = [];

  function auth() {
    return { Authorization: `Bearer ${accessToken}` };
  }

  test.beforeAll(async ({ request }) => {
    const tokens = await login(request, 'FREDRIC', 'fredric');
    accessToken = tokens.access_token;
    refreshToken = tokens.refresh_token;
    pool = new Pool({ connectionString: DB_URL });
  });

  test.afterAll(async ({ request }) => {
    if (createdFolderIds.length > 0) {
      await pool.query('DELETE FROM document_folders WHERE id = ANY($1::int[])', [
        createdFolderIds,
      ]);
    }
    await pool.end();
    await request.post(`${API_BASE}/api/auth/revoke`, {
      data: { token: refreshToken, token_type_hint: 'refresh_token' },
    });
  });

  test('POST /api/documents without auth returns 401', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/documents`, { data: { name: 'nope' } });
    expect(res.status()).toBe(401);
  });

  test('POST /api/documents creates a root-level folder', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/documents`, {
      headers: auth(),
      data: { name: SENTINEL },
    });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { record: { id: number; kind: string; name: string } };
    expect(body.record.kind).toBe('folder');
    expect(body.record.name).toBe(SENTINEL);
    createdFolderIds.push(body.record.id);

    const { rows } = await pool.query(
      'SELECT name, parent_id FROM document_folders WHERE id = $1',
      [body.record.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe(SENTINEL);
    expect(rows[0].parent_id).toBeNull();
  });

  test('GET /api/documents/:id requires the kind query param', async ({ request }) => {
    const id = createdFolderIds[0]!;
    const missingKind = await request.get(`${API_BASE}/api/documents/${id}`, { headers: auth() });
    expect(missingKind.status()).toBe(400);
    const body = (await missingKind.json()) as { error: { code: string } };
    expect(body.error.code).toBe('validation_failed');

    const withKind = await request.get(`${API_BASE}/api/documents/${id}?kind=folder`, {
      headers: auth(),
    });
    expect(withKind.status()).toBe(200);
    const page = (await withKind.json()) as { record: { name: string } };
    expect(page.record.name).toBe(SENTINEL);
  });

  test('PUT /api/documents/:id?kind=folder renames it', async ({ request }) => {
    const id = createdFolderIds[0]!;
    const renamed = `${SENTINEL}_RENAMED`;
    const res = await request.put(`${API_BASE}/api/documents/${id}?kind=folder`, {
      headers: auth(),
      data: { name: renamed },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { record: { name: string } };
    expect(body.record.name).toBe(renamed);

    const { rows } = await pool.query('SELECT name FROM document_folders WHERE id = $1', [id]);
    expect(rows[0].name).toBe(renamed);
  });

  test('PUT /api/documents/:id without kind is rejected before anything is touched', async ({
    request,
  }) => {
    const id = createdFolderIds[0]!;
    const res = await request.put(`${API_BASE}/api/documents/${id}`, {
      headers: auth(),
      data: { name: 'should not apply' },
    });
    expect(res.status()).toBe(400);

    const { rows } = await pool.query('SELECT name FROM document_folders WHERE id = $1', [id]);
    expect(rows[0].name).toBe(`${SENTINEL}_RENAMED`);
  });

  test('DELETE /api/documents/:id?kind=folder removes it, recursively', async ({ request }) => {
    // A child folder, so the delete is proven to recurse rather than orphan it.
    // folderId is a scope param, resolved from the query string like every
    // other REST call here — not from the JSON body.
    const childRes = await request.post(
      `${API_BASE}/api/documents?folderId=${createdFolderIds[0]}`,
      { headers: auth(), data: { name: `${SENTINEL}_CHILD` } },
    );
    expect(childRes.status()).toBe(201);
    const child = (await childRes.json()) as { record: { id: number } };

    const { rows: nestedCheck } = await pool.query(
      'SELECT parent_id FROM document_folders WHERE id = $1',
      [child.record.id],
    );
    expect(nestedCheck[0].parent_id).toBe(createdFolderIds[0]);

    const del = await request.delete(`${API_BASE}/api/documents/${createdFolderIds[0]}?kind=folder`, {
      headers: auth(),
    });
    expect(del.status()).toBe(204);

    const { rows: parentRows } = await pool.query(
      'SELECT id FROM document_folders WHERE id = $1',
      [createdFolderIds[0]],
    );
    expect(parentRows).toHaveLength(0);

    const { rows: childRows } = await pool.query(
      'SELECT id FROM document_folders WHERE id = $1',
      [child.record.id],
    );
    expect(childRows).toHaveLength(0);

    // Deleted above; afterAll should not try to delete it again.
    createdFolderIds.length = 0;
  });

  test('DELETE /api/documents/:id without kind is rejected', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/documents`, {
      headers: auth(),
      data: { name: `${SENTINEL}_FOR_DELETE_GUARD` },
    });
    const created = (await res.json()) as { record: { id: number } };
    createdFolderIds.push(created.record.id);

    const del = await request.delete(`${API_BASE}/api/documents/${created.record.id}`, {
      headers: auth(),
    });
    expect(del.status()).toBe(400);

    const { rows } = await pool.query('SELECT id FROM document_folders WHERE id = $1', [
      created.record.id,
    ]);
    expect(rows).toHaveLength(1);
  });
});
