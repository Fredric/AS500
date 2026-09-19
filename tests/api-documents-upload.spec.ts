/**
 * Bearer-authenticated document upload on the MCP/API server (port 3002).
 *
 *   POST /api/documents/upload  — multipart field `file`
 *
 * Uses FREDRIC (admin). Rows created during the suite are deleted in afterAll.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { unlink } from 'fs/promises';
import pkg from 'pg';

const { Pool } = pkg;

const API_BASE = 'http://localhost:3002';
const DB_URL = process.env.DATABASE_URL ?? 'postgresql://as500:as500@localhost:5433/as500';
const SENTINEL = 'E2E_MOBILE_';

// 1×1 JPEG so saveUploadedFile accepts the payload as an image.
const MINI_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);

async function login(request: APIRequestContext, username: string, password: string) {
  const res = await request.post(`${API_BASE}/api/auth/token`, {
    data: { username, password },
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as {
    access_token: string;
    refresh_token: string;
  };
}

test.describe.configure({ mode: 'serial' });

test.describe('REST API — document upload', () => {
  let accessToken = '';
  let refreshToken = '';
  const uploadedIds: number[] = [];
  let pool: InstanceType<typeof Pool>;

  test.beforeAll(async ({ request }) => {
    const tokens = await login(request, 'FREDRIC', 'fredric');
    accessToken = tokens.access_token;
    refreshToken = tokens.refresh_token;
    pool = new Pool({ connectionString: DB_URL });
  });

  test.afterAll(async ({ request }) => {
    if (uploadedIds.length > 0) {
      const { rows } = await pool.query(
        'SELECT storage_path FROM document_items WHERE id = ANY($1::int[])',
        [uploadedIds],
      );
      await pool.query('DELETE FROM document_items WHERE id = ANY($1::int[])', [uploadedIds]);
      for (const row of rows) {
        const pathOnDisk = row.storage_path as string | undefined;
        if (pathOnDisk) await unlink(pathOnDisk).catch(() => {});
      }
    }
    await pool.end();
    await request.post(`${API_BASE}/api/auth/revoke`, {
      data: { token: refreshToken, token_type_hint: 'refresh_token' },
    });
  });

  test('POST /api/documents/upload without auth returns 401', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/documents/upload`, {
      multipart: {
        file: {
          name: `${SENTINEL}unauth.jpg`,
          mimeType: 'image/jpeg',
          buffer: MINI_JPEG,
        },
      },
    });
    expect(res.status()).toBe(401);
  });

  test('POST /api/documents/upload stores a JPEG in My Documents/INCOMING', async ({ request }) => {
    const filename = `${SENTINEL}${Date.now()}.jpg`;
    const res = await request.post(`${API_BASE}/api/documents/upload`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      multipart: {
        file: {
          name: filename,
          mimeType: 'image/jpeg',
          buffer: MINI_JPEG,
        },
      },
    });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      file: { id: number; name: string; fileType: string };
    };
    expect(body.ok).toBe(true);
    expect(body.file.fileType).toBe('image');
    expect(typeof body.file.id).toBe('number');
    uploadedIds.push(body.file.id);

    const { rows } = await pool.query(
      `SELECT i.id, i.name, i.file_type, i.original_filename, i.folder_id,
              f.name AS folder_name, f.parent_id AS folder_parent_id
         FROM document_items i
         JOIN document_folders f ON f.id = i.folder_id
        WHERE i.id = $1`,
      [body.file.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].file_type).toBe('image');
    expect(rows[0].original_filename).toBe(filename);
    expect(rows[0].folder_name).toBe('INCOMING');
    expect(rows[0].folder_parent_id).toBeNull();

    const filename2 = `${SENTINEL}${Date.now()}-2.jpg`;
    const res2 = await request.post(`${API_BASE}/api/documents/upload`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      multipart: {
        file: {
          name: filename2,
          mimeType: 'image/jpeg',
          buffer: MINI_JPEG,
        },
      },
    });
    expect(res2.status()).toBe(201);
    const body2 = (await res2.json()) as { file: { id: number } };
    uploadedIds.push(body2.file.id);

    const { rows: rows2 } = await pool.query(
      'SELECT folder_id FROM document_items WHERE id = $1',
      [body2.file.id],
    );
    expect(rows2[0].folder_id).toBe(rows[0].folder_id);
  });
});
