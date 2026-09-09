import { test, expect } from '@playwright/test';
import pkg from 'pg';

const { Pool } = pkg;

/**
 * The Phase 1 acceptance property, from the browser end.
 *
 * A drawer placed in the office and bound to a CRUDTable config must resolve to
 * that config's real records — the same binding the terminal follows when you
 * press Enter on that row. The protocol-level half of this lives in
 * `server/scripts/world-loop-check.mjs`, which drives the terminal WebSocket
 * directly; this spec covers what that script cannot: the floorplan rendering
 * the same binding for a signed-in user, and RBAC refusing it for another.
 */

const SPACE_KEY = 'e2e_office';
const CONN = process.env.DATABASE_URL || 'postgresql://as500:as500@localhost:5433/as500';

async function seedOffice(): Promise<void> {
  const pool = new Pool({ connectionString: CONN });
  try {
    // Seeded under FREDRIC so the refusal test can view it as a different,
    // non-admin user. An admin bypasses every permission check by design, so
    // the owner must be the admin and the outsider the plain user.
    const { rows: [user] } = await pool.query(`SELECT id FROM users WHERE username = 'FREDRIC'`);
    if (!user) throw new Error('FREDRIC must exist — run the seed first');

    await cleanOffice(pool);

    const { rows: [folder] } = await pool.query(
      `INSERT INTO document_folders (user_id, name) VALUES ($1, 'E2E Office Folder') RETURNING id`,
      [user.id],
    );
    await pool.query(
      `INSERT INTO document_items
         (user_id, folder_id, name, file_type, storage_path, original_filename, size_bytes, ingest_status)
       VALUES ($1, $2, 'E2E-OFFICE-DOC.pdf', 'pdf', 'storage/e2e/doc.pdf', 'doc.pdf', 1234, 'ready')`,
      [user.id, folder.id],
    );

    const { rows: [space] } = await pool.query(
      `INSERT INTO world_spaces (key, name, kind, owner_user_id) VALUES ($1, 'E2E Office', 'office', $2) RETURNING id`,
      [SPACE_KEY, user.id],
    );
    const { rows: [desk] } = await pool.query(
      `INSERT INTO world_things (space_id, type, label, zone, owner_user_id, binding)
       VALUES ($1, 'desk', 'E2E Desk', 'north_east', $2, '{"kind":"none"}'::jsonb) RETURNING id`,
      [space.id, user.id],
    );
    await pool.query(
      `INSERT INTO world_things (space_id, parent_thing_id, type, label, slot, owner_user_id, binding)
       VALUES ($1, $2, 'drawer', 'E2E Drawer', 'drawer_1', $3, $4::jsonb)`,
      [space.id, desk.id, user.id,
       JSON.stringify({ kind: 'crud', configId: 'documents', scope: { folderId: folder.id } })],
    );
  } finally {
    await pool.end();
  }
}

async function cleanOffice(pool?: InstanceType<typeof Pool>): Promise<void> {
  const own = !pool;
  const p = pool ?? new Pool({ connectionString: CONN });
  try {
    // world_things cascades from world_spaces; documents cascade from the folder.
    await p.query(`DELETE FROM world_spaces WHERE key = $1`, [SPACE_KEY]);
    await p.query(`DELETE FROM document_folders WHERE name = 'E2E Office Folder'`);
  } finally {
    if (own) await p.end();
  }
}

/** Sign in to the terminal — the office reuses that session's access token. */
async function signIn(page: import('@playwright/test').Page, user: string, pass: string): Promise<void> {
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
  await page.locator('text=● Connected').waitFor({ state: 'visible', timeout: 15000 });

  const username = page.locator('input[type="text"]').first();
  await username.waitFor({ state: 'visible', timeout: 10000 });
  await username.fill(user);
  await username.press('Tab');
  const password = page.locator('input[type="password"]');
  await password.fill(pass);
  await password.press('Enter');

  await page.locator('text=MAIN MENU').waitFor({ state: 'visible', timeout: 15000 });
}

test.describe('Virtual office floorplan', () => {
  test.beforeAll(async () => { await seedOffice(); });
  test.afterAll(async () => { await cleanOffice(); });

  test('a bound drawer resolves to the real records it names', async ({ page }) => {
    await signIn(page, 'FREDRIC', 'fredric');

    await page.goto(`http://localhost:5173/office?space=${SPACE_KEY}`, { waitUntil: 'domcontentloaded' });

    // The desk is placed furniture; the drawer is inside it.
    const desk = page.locator('.thing', { hasText: 'E2E Desk' });
    await expect(desk).toBeVisible({ timeout: 15000 });
    await desk.click();

    await expect(page.locator('.panel__head h2')).toHaveText('E2E Desk');
    const child = page.locator('.children button', { hasText: 'E2E Drawer' });
    await expect(child).toBeVisible();
    await child.click();

    // The binding is shown verbatim, and it resolves to the real document.
    await expect(page.locator('.panel__head h2')).toHaveText('E2E Drawer');
    await expect(page.locator('.panel__meta dd').first()).toContainText('config "documents"');
    await expect(page.locator('.access')).toHaveText(/ok/);
    await expect(page.locator('.contents li')).toHaveText(['E2E-OFFICE-DOC.pdf']);
  });

  test('another user sees the furniture but is refused its contents', async ({ page }) => {
    await signIn(page, 'KALLE', 'password');
    await page.goto(`http://localhost:5173/office?space=${SPACE_KEY}`, { waitUntil: 'domcontentloaded' });

    const desk = page.locator('.thing', { hasText: 'E2E Desk' });
    await expect(desk).toBeVisible({ timeout: 15000 });
    await desk.click();
    await page.locator('.children button', { hasText: 'E2E Drawer' }).click();

    // Visible, named, and closed: the object is never hidden, only refused —
    // otherwise the room's furniture would change depending on who is looking.
    await expect(page.locator('.panel__head h2')).toHaveText('E2E Drawer');
    await expect(page.locator('.access')).toHaveText(/denied/);
    await expect(page.locator('.contents li')).toHaveCount(0);
  });
});
