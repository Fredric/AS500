/**
 * Bearer-authenticated document browsing on the MCP/API server (port 3002).
 *
 *   GET /api/documents               — contents of the root folder
 *   GET /api/documents?folderId=<id> — contents of one folder
 *
 * This is the surface the mobile app's "My Documents" browser reads. Uses
 * FREDRIC (admin). Sentinel folders created during the suite are deleted in
 * afterAll so the listing stays deterministic across runs.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import pkg from 'pg';

const { Pool } = pkg;

const API_BASE = 'http://localhost:3002';
const DB_URL = process.env.DATABASE_URL ?? 'postgresql://as500:as500@localhost:5433/as500';
const SENTINEL = `E2E_LIST_${Date.now()}`;

type DocumentEntry = {
  id: number | null;
  kind: 'parent' | 'folder' | 'file';
  name: string;
  entryType: string;
  fileType: string;
  sizeBytes: number | null;
  modifiedAt: string;
  parentFolderId: number | null;
};

type DocumentPage = {
  records: DocumentEntry[];
  totalRecords: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};

async function login(request: APIRequestContext, username: string, password: string) {
  const res = await request.post(`${API_BASE}/api/auth/token`, {
    data: { username, password },
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as { access_token: string; refresh_token: string };
}

test.describe.configure({ mode: 'serial' });

test.describe('REST API — document browsing', () => {
  let accessToken = '';
  let refreshToken = '';
  let userId = 0;
  let parentFolderId = 0;
  let childFolderId = 0;
  let pool: InstanceType<typeof Pool>;

  function auth() {
    return { Authorization: `Bearer ${accessToken}` };
  }

  test.beforeAll(async ({ request }) => {
    const tokens = await login(request, 'FREDRIC', 'fredric');
    accessToken = tokens.access_token;
    refreshToken = tokens.refresh_token;
    pool = new Pool({ connectionString: DB_URL });

    const { rows: userRows } = await pool.query(
      'SELECT id FROM users WHERE UPPER(username) = $1',
      ['FREDRIC'],
    );
    expect(userRows).toHaveLength(1);
    userId = userRows[0].id as number;

    // A root-level folder with one child, so both "list the root" and
    // "descend into a folder" have something known to assert against.
    const { rows: parentRows } = await pool.query(
      'INSERT INTO document_folders (user_id, parent_id, name) VALUES ($1, NULL, $2) RETURNING id',
      [userId, SENTINEL],
    );
    parentFolderId = parentRows[0].id as number;

    const { rows: childRows } = await pool.query(
      'INSERT INTO document_folders (user_id, parent_id, name) VALUES ($1, $2, $3) RETURNING id',
      [userId, parentFolderId, `${SENTINEL}_CHILD`],
    );
    childFolderId = childRows[0].id as number;
  });

  test.afterAll(async ({ request }) => {
    await pool.query('DELETE FROM document_folders WHERE id = ANY($1::int[])', [
      [childFolderId, parentFolderId],
    ]);
    await pool.end();
    await request.post(`${API_BASE}/api/auth/revoke`, {
      data: { token: refreshToken, token_type_hint: 'refresh_token' },
    });
  });

  test('GET /api/documents without auth returns 401', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/documents`);
    expect(res.status()).toBe(401);
  });

  test('GET /api advertises documents as a listable resource', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/`, { headers: auth() });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      resources: Array<{ id: string; operations: string[]; scope: Array<{ name: string }> }>;
    };
    const documents = body.resources.find((r) => r.id === 'documents');
    expect(documents).toBeDefined();
    expect(documents!.operations).toEqual(['list']);
    // userId is injected from the token and must never be advertised as a param.
    expect(documents!.scope.map((p) => p.name)).toEqual(['folderId']);
  });

  test('GET /api/documents lists the root folder', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/documents`, { headers: auth() });
    expect(res.status()).toBe(200);
    const page = (await res.json()) as DocumentPage;

    // The root has no parent, so no ".." row is synthesised for it.
    expect(page.records.some((r) => r.kind === 'parent')).toBe(false);

    const sentinel = page.records.find((r) => r.name === SENTINEL);
    expect(sentinel).toBeDefined();
    expect(sentinel!.kind).toBe('folder');
    expect(sentinel!.id).toBe(parentFolderId);
    expect(sentinel!.entryType).toBe('Folder');
    expect(typeof page.totalRecords).toBe('number');
    expect(page.hasMore).toBe(false);
  });

  test('GET /api/documents?folderId= descends into a folder', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/documents?folderId=${parentFolderId}`, {
      headers: auth(),
    });
    expect(res.status()).toBe(200);
    const page = (await res.json()) as DocumentPage;

    // A non-root folder leads with the ".." row pointing at its parent.
    expect(page.records[0].kind).toBe('parent');
    expect(page.records[0].parentFolderId).toBeNull();

    const child = page.records.find((r) => r.name === `${SENTINEL}_CHILD`);
    expect(child).toBeDefined();
    expect(child!.id).toBe(childFolderId);
    expect(child!.parentFolderId).toBe(parentFolderId);
  });

  test('GET /api/documents pages with limit and offset', async ({ request }) => {
    const first = await request.get(`${API_BASE}/api/documents?limit=1&offset=0`, {
      headers: auth(),
    });
    expect(first.status()).toBe(200);
    const firstPage = (await first.json()) as DocumentPage;
    expect(firstPage.records).toHaveLength(1);
    expect(firstPage.limit).toBe(1);

    if (firstPage.totalRecords > 1) {
      expect(firstPage.hasMore).toBe(true);
      const second = await request.get(`${API_BASE}/api/documents?limit=1&offset=1`, {
        headers: auth(),
      });
      const secondPage = (await second.json()) as DocumentPage;
      expect(secondPage.records).toHaveLength(1);
      expect(secondPage.records[0].name).not.toBe(firstPage.records[0].name);
    }
  });

  test('GET /api/documents/:id is not exposed — browsing is read-only list', async ({
    request,
  }) => {
    const res = await request.get(`${API_BASE}/api/documents/${parentFolderId}`, {
      headers: auth(),
    });
    expect(res.status()).toBe(405);
  });

  test('writes are not exposed on the documents resource', async ({ request }) => {
    const created = await request.post(`${API_BASE}/api/documents`, {
      headers: auth(),
      data: { name: `${SENTINEL}_NOPE` },
    });
    expect(created.status()).toBe(405);

    const deleted = await request.delete(`${API_BASE}/api/documents/${parentFolderId}`, {
      headers: auth(),
    });
    expect(deleted.status()).toBe(405);
  });
});
