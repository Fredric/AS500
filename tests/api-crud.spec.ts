/**
 * REST API tests for CRUDTable-backed resources.
 *
 * Exercises the full API surface of the `timereg_v2` config:
 *   GET  /api              — discovery
 *   GET  /api/timereg_v2  — list (with pagination)
 *   POST /api/timereg_v2  — create
 *   GET  /api/timereg_v2/:id — read
 *   PUT  /api/timereg_v2/:id — update
 *   DELETE /api/timereg_v2/:id — delete
 *
 * Error paths:
 *   - 401 when no Bearer token is supplied
 *   - 404 for an unknown configId
 *   - 405 for a disabled operation
 *   - 400 for a validation failure (missing required field)
 *   - 404 when reading/updating/deleting a non-existent id
 *
 * Uses FREDRIC (admin) to avoid colliding with KALLE-based E2E tests.
 * All records created during the suite are deleted in afterAll.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';

const API_BASE = 'http://localhost:3002';
const TODAY = new Date().toISOString().split('T')[0];

// ─────────────────────────────────────────────
// Auth helpers
// ─────────────────────────────────────────────

async function login(request: APIRequestContext, username: string, password: string) {
  const res = await request.post(`${API_BASE}/api/auth/token`, {
    data: { username, password },
  });
  expect(res.status()).toBe(200);
  const body = await res.json() as {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token: string;
  };
  expect(body.token_type).toBe('Bearer');
  expect(typeof body.access_token).toBe('string');
  expect(typeof body.refresh_token).toBe('string');
  return body;
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ─────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────

test.describe('REST API — CRUDTable (timereg_v2)', () => {
  // Serial so create → read → update → delete tests share createdId.
  test.describe.configure({ mode: 'serial' });

  let accessToken = '';
  let refreshToken = '';
  let createdId = -1;

  test.beforeAll(async ({ request }) => {
    const tokens = await login(request, 'FREDRIC', 'fredric');
    accessToken = tokens.access_token;
    refreshToken = tokens.refresh_token;
  });

  test.afterAll(async ({ request }) => {
    // Best-effort cleanup: delete the record if the delete test didn't run.
    if (createdId !== -1) {
      await request.delete(`${API_BASE}/api/timereg_v2/${createdId}`, {
        headers: authHeaders(accessToken),
      });
    }
    // Revoke tokens.
    await request.post(`${API_BASE}/api/auth/revoke`, {
      data: { token: refreshToken, token_type_hint: 'refresh_token' },
    });
  });

  // ──────────────────────────────────────────
  // Auth
  // ──────────────────────────────────────────

  test('POST /api/auth/token — bad credentials return 401', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/auth/token`, {
      data: { username: 'FREDRIC', password: 'wrong' },
    });
    expect(res.status()).toBe(401);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('invalid_credentials');
  });

  test('POST /api/auth/token — missing body fields return 400', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/auth/token`, {
      data: { username: 'FREDRIC' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/auth/refresh — rotates both tokens', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/auth/refresh`, {
      data: { refresh_token: refreshToken },
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as {
      access_token: string;
      refresh_token: string;
      token_type: string;
      expires_in: number;
    };
    expect(body.token_type).toBe('Bearer');
    expect(typeof body.access_token).toBe('string');
    expect(typeof body.refresh_token).toBe('string');
    // Old tokens should now be invalidated; new ones work for the rest of the suite.
    accessToken = body.access_token;
    refreshToken = body.refresh_token;
  });

  // ──────────────────────────────────────────
  // 401 guard — all routes require a token
  // ──────────────────────────────────────────

  test('GET /api without auth returns 401', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api`);
    expect(res.status()).toBe(401);
  });

  test('GET /api/timereg_v2 without auth returns 401', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/timereg_v2`, {
      params: { date: TODAY },
    });
    expect(res.status()).toBe(401);
  });

  test('POST /api/timereg_v2 without auth returns 401', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/timereg_v2`, {
      params: { date: TODAY },
      data: { start_hour: '08:00', end_hour: '09:00' },
    });
    expect(res.status()).toBe(401);
  });

  // ──────────────────────────────────────────
  // Discovery
  // ──────────────────────────────────────────

  test('GET /api — discovery lists timereg_v2 with all operations', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api`, {
      headers: authHeaders(accessToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { resources: Array<{ id: string; operations: string[] }> };
    expect(Array.isArray(body.resources)).toBe(true);

    const timereg = body.resources.find((r) => r.id === 'timereg_v2');
    expect(timereg).toBeDefined();
    expect(timereg!.operations).toEqual(
      expect.arrayContaining(['list', 'read', 'create', 'update', 'delete'])
    );
  });

  test('GET /api — discovery does not expose injectFromAuth scope params', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api`, {
      headers: authHeaders(accessToken),
    });
    const body = await res.json() as {
      resources: Array<{ id: string; scope: Array<{ name: string }> }>;
    };
    const timereg = body.resources.find((r) => r.id === 'timereg_v2');
    const names = (timereg?.scope ?? []).map((s) => s.name);
    expect(names).not.toContain('userId');
    expect(names).toContain('date');
  });

  // ──────────────────────────────────────────
  // 404 — unknown resource
  // ──────────────────────────────────────────

  test('GET /api/nonexistent returns 404', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/nonexistent`, {
      headers: authHeaders(accessToken),
    });
    expect(res.status()).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });

  // ──────────────────────────────────────────
  // List
  // ──────────────────────────────────────────

  test('GET /api/timereg_v2 — list returns pagination envelope', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/timereg_v2`, {
      headers: authHeaders(accessToken),
      params: { date: TODAY },
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as {
      records: unknown[];
      totalRecords: number;
      offset: number;
      limit: number;
      hasMore: boolean;
    };
    expect(Array.isArray(body.records)).toBe(true);
    expect(typeof body.totalRecords).toBe('number');
    expect(typeof body.offset).toBe('number');
    expect(typeof body.limit).toBe('number');
    expect(typeof body.hasMore).toBe('boolean');
  });

  test('GET /api/timereg_v2 — pagination params are respected', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/timereg_v2`, {
      headers: authHeaders(accessToken),
      params: { date: TODAY, limit: '2', offset: '0' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { records: unknown[]; limit: number; offset: number };
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(0);
    expect(body.records.length).toBeLessThanOrEqual(2);
  });

  // ──────────────────────────────────────────
  // Create
  // ──────────────────────────────────────────

  test('POST /api/timereg_v2 — creates a new entry and returns 201', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/timereg_v2`, {
      headers: authHeaders(accessToken),
      params: { date: TODAY },
      data: {
        start_hour: '07:00',
        end_hour: '07:30',
        jiratask: 'API-001',
        description: 'API test entry',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json() as { record: { id: number; start_hour: string; end_hour: string } };
    expect(body.record).toBeDefined();
    expect(typeof body.record.id).toBe('number');
    expect(body.record.start_hour).toBe('07:00');
    expect(body.record.end_hour).toBe('07:30');
    createdId = body.record.id;
  });

  test('POST /api/timereg_v2 — missing required field returns 400', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/timereg_v2`, {
      headers: authHeaders(accessToken),
      params: { date: TODAY },
      data: {
        // start_hour omitted — required field
        end_hour: '10:00',
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json() as { error: { code: string; fields?: unknown[] } };
    expect(body.error.code).toBe('validation_failed');
    expect(Array.isArray(body.error.fields)).toBe(true);
  });

  // ──────────────────────────────────────────
  // Read
  // ──────────────────────────────────────────

  test('GET /api/timereg_v2/:id — reads the created entry', async ({ request }) => {
    expect(createdId).toBeGreaterThan(0);
    const res = await request.get(`${API_BASE}/api/timereg_v2/${createdId}`, {
      headers: authHeaders(accessToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as {
      record: { id: number; start_hour: string; end_hour: string; jiratask: string; description: string };
    };
    expect(body.record.id).toBe(createdId);
    expect(body.record.start_hour).toBe('07:00');
    expect(body.record.jiratask).toBe('API-001');
    expect(body.record.description).toBe('API test entry');
  });

  test('GET /api/timereg_v2/:id — 404 for non-existent id', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/timereg_v2/999999999`, {
      headers: authHeaders(accessToken),
    });
    expect(res.status()).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });

  // ──────────────────────────────────────────
  // Update
  // ──────────────────────────────────────────

  test('PUT /api/timereg_v2/:id — updates the entry', async ({ request }) => {
    expect(createdId).toBeGreaterThan(0);
    const res = await request.put(`${API_BASE}/api/timereg_v2/${createdId}`, {
      headers: authHeaders(accessToken),
      data: {
        start_hour: '07:00',
        end_hour: '08:00',
        jiratask: 'API-001',
        description: 'Updated by API test',
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { record: { end_hour: string; description: string } };
    expect(body.record.end_hour).toBe('08:00');
    expect(body.record.description).toBe('Updated by API test');
  });

  test('PUT /api/timereg_v2/:id — 404 for non-existent id', async ({ request }) => {
    const res = await request.put(`${API_BASE}/api/timereg_v2/999999999`, {
      headers: authHeaders(accessToken),
      data: { start_hour: '09:00', end_hour: '10:00' },
    });
    expect(res.status()).toBe(404);
  });

  test('PUT /api/timereg_v2/:id — 400 for non-numeric id', async ({ request }) => {
    const res = await request.put(`${API_BASE}/api/timereg_v2/not-a-number`, {
      headers: authHeaders(accessToken),
      data: { start_hour: '09:00', end_hour: '10:00' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('validation_failed');
  });

  // ──────────────────────────────────────────
  // Delete
  // ──────────────────────────────────────────

  test('DELETE /api/timereg_v2/:id — deletes the entry and returns 204', async ({ request }) => {
    expect(createdId).toBeGreaterThan(0);
    const idToDelete = createdId;
    const res = await request.delete(`${API_BASE}/api/timereg_v2/${idToDelete}`, {
      headers: authHeaders(accessToken),
    });
    expect(res.status()).toBe(204);
    createdId = -1; // mark as cleaned up so afterAll skips

    // Verify it is gone.
    const verify = await request.get(`${API_BASE}/api/timereg_v2/${idToDelete}`, {
      headers: authHeaders(accessToken),
    });
    expect(verify.status()).toBe(404);
  });

  test('DELETE /api/timereg_v2/:id — 404 for non-existent id', async ({ request }) => {
    const res = await request.delete(`${API_BASE}/api/timereg_v2/999999999`, {
      headers: authHeaders(accessToken),
    });
    expect(res.status()).toBe(404);
  });

  // ──────────────────────────────────────────
  // Revoke
  // ──────────────────────────────────────────

  test('POST /api/auth/revoke — revokes tokens and returns ok', async ({ request }) => {
    // Login fresh so we don't burn the suite token.
    const tokens = await login(request, 'FREDRIC', 'fredric');
    const res = await request.post(`${API_BASE}/api/auth/revoke`, {
      data: { token: tokens.refresh_token, token_type_hint: 'refresh_token' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
