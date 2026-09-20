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
const SPACE_KEY_2 = 'e2e_office_annex';
const CONN = process.env.DATABASE_URL || 'postgresql://as500:as500@localhost:5433/as500';

/** Root of the bookshelf test tree — E2E Books / Fiction / Sci-Fi, plus a loose file. */
const BOOKSHELF_ROOT_FOLDER = 'E2E Books Root';
const BOOKSHELF_SUBFOLDER_A = 'E2E Fiction';
const BOOKSHELF_SUBFOLDER_B = 'E2E Nonfiction';
const BOOKSHELF_NESTED_FOLDER = 'E2E Sci-Fi';
const BOOKSHELF_NESTED_FILE = 'E2E-NESTED-DOC.pdf';

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

    // A bookshelf's own folder tree: root → {Fiction, Nonfiction}, and
    // Fiction → Sci-Fi → one file, proving navigation to arbitrary depth.
    const { rows: [root] } = await pool.query(
      `INSERT INTO document_folders (user_id, name) VALUES ($1, $2) RETURNING id`,
      [user.id, BOOKSHELF_ROOT_FOLDER],
    );
    const { rows: [fiction] } = await pool.query(
      `INSERT INTO document_folders (user_id, parent_id, name) VALUES ($1, $2, $3) RETURNING id`,
      [user.id, root.id, BOOKSHELF_SUBFOLDER_A],
    );
    await pool.query(
      `INSERT INTO document_folders (user_id, parent_id, name) VALUES ($1, $2, $3)`,
      [user.id, root.id, BOOKSHELF_SUBFOLDER_B],
    );
    const { rows: [scifi] } = await pool.query(
      `INSERT INTO document_folders (user_id, parent_id, name) VALUES ($1, $2, $3) RETURNING id`,
      [user.id, fiction.id, BOOKSHELF_NESTED_FOLDER],
    );
    await pool.query(
      `INSERT INTO document_items
         (user_id, folder_id, name, file_type, storage_path, original_filename, size_bytes, ingest_status)
       VALUES ($1, $2, $3, 'pdf', 'storage/e2e/nested.pdf', 'nested.pdf', 999, 'ready')`,
      [user.id, scifi.id, BOOKSHELF_NESTED_FILE],
    );

    const { rows: [bookshelf] } = await pool.query(
      `INSERT INTO world_things (space_id, type, label, zone, owner_user_id, binding)
       VALUES ($1, 'bookshelf', 'E2E Bookshelf', 'south', $2, $3::jsonb) RETURNING id`,
      [space.id, user.id,
       JSON.stringify({ kind: 'crud', configId: 'documents', scope: { folderId: root.id } })],
    );
    // Kept for the "server refuses a non-documents bookshelf" case below.
    void bookshelf;

    // A postit — Phase 2's "objects that own data" class. Seeded with no
    // world_notes row at all, proving the empty state, not pre-written text.
    await pool.query(
      `INSERT INTO world_things (space_id, type, label, zone, owner_user_id, binding)
       VALUES ($1, 'postit', 'E2E Postit', 'south', $2, '{"kind":"none"}'::jsonb)`,
      [space.id, user.id],
    );

    // A second space, and a door in the first bound to it — Phase 5. The
    // binding caches spaceId/spaceName (composeBinding, worldService.ts) as
    // well as spaceKey, exactly as a real placement would.
    const { rows: [annex] } = await pool.query(
      `INSERT INTO world_spaces (key, name, kind, owner_user_id) VALUES ($1, 'E2E Annex', 'office', $2) RETURNING id`,
      [SPACE_KEY_2, user.id],
    );
    await pool.query(
      `INSERT INTO world_things (space_id, type, label, zone, owner_user_id, binding)
       VALUES ($1, 'desk', 'E2E Annex Desk', 'north_east', $2, '{"kind":"none"}'::jsonb)`,
      [annex.id, user.id],
    );
    await pool.query(
      `INSERT INTO world_things (space_id, type, label, zone, owner_user_id, binding)
       VALUES ($1, 'door', 'E2E Door', 'south_east', $2, $3::jsonb)`,
      [space.id, user.id, JSON.stringify({ kind: 'door', spaceKey: SPACE_KEY_2, spaceId: annex.id, spaceName: 'E2E Annex' })],
    );
  } finally {
    await pool.end();
  }
}

async function cleanOffice(pool?: InstanceType<typeof Pool>): Promise<void> {
  const own = !pool;
  const p = pool ?? new Pool({ connectionString: CONN });
  try {
    // world_things cascades from world_spaces; document_items cascade from
    // their folder via FK. document_folders.parent_id is a plain column with
    // no FK (documentService walks it recursively at the app layer instead —
    // see deleteFolderRecursive), so every folder level must be named here.
    await p.query(`DELETE FROM world_spaces WHERE key = ANY($1::text[])`, [[SPACE_KEY, SPACE_KEY_2]]);
    await p.query(
      `DELETE FROM document_folders WHERE name = ANY($1::text[])`,
      [['E2E Office Folder', BOOKSHELF_ROOT_FOLDER, BOOKSHELF_SUBFOLDER_A, BOOKSHELF_SUBFOLDER_B, BOOKSHELF_NESTED_FOLDER]],
    );
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

test.describe('Bookshelf — browsing subfolders as books', () => {
  test.beforeAll(async () => { await seedOffice(); });
  test.afterAll(async () => { await cleanOffice(); });

  test('books render as clickable spines and the modal browses to arbitrary depth', async ({ page }) => {
    await signIn(page, 'FREDRIC', 'fredric');
    await page.goto(`http://localhost:5173/office?space=${SPACE_KEY}`, { waitUntil: 'domcontentloaded' });

    const shelf = page.locator('.thing', { hasText: 'E2E Bookshelf' });
    await expect(shelf).toBeVisible({ timeout: 15000 });

    // Two subfolders (Fiction, Nonfiction) → two spines, drawn directly on
    // the shape, each with the folder name as its tooltip.
    const spines = shelf.locator('.book-spine:not(.book-spine--overflow)');
    await expect(spines).toHaveCount(2);
    await expect(spines.nth(0).locator('title')).toHaveText([BOOKSHELF_SUBFOLDER_A, BOOKSHELF_SUBFOLDER_B].sort()[0]);

    // Clicking a spine opens the modal directly — no side-panel step.
    await expect(page.locator('.panel')).toHaveCount(0);
    await spines.first().click();
    await expect(page.locator('.modal')).toBeVisible();
    await expect(page.locator('.modal__breadcrumb')).toHaveText(/E2E Fiction|E2E Nonfiction/);

    // Whichever subfolder that spine was, descend to the nested folder and
    // then check the file inside it — proves depth beyond one level.
    const folderRow = page.locator('.modal__row--folder');
    if (await folderRow.count() > 0) {
      await folderRow.first().click();
      await expect(page.locator('.modal__breadcrumb')).toContainText(BOOKSHELF_NESTED_FOLDER);
      await expect(page.locator('.modal__row--file')).toContainText(BOOKSHELF_NESTED_FILE);

      // The root crumb returns to the top level, not the shelf or My Documents.
      await page.locator('.modal__crumb').first().click();
      await expect(page.locator('.modal__row--folder')).toHaveCount(1);
    }

    await page.keyboard.press('Escape');
    await expect(page.locator('.modal')).toHaveCount(0);
  });

  test('the side panel lists the same books as a complete fallback', async ({ page }) => {
    await signIn(page, 'FREDRIC', 'fredric');
    await page.goto(`http://localhost:5173/office?space=${SPACE_KEY}`, { waitUntil: 'domcontentloaded' });

    const shelf = page.locator('.thing', { hasText: 'E2E Bookshelf' });
    await expect(shelf).toBeVisible({ timeout: 15000 });
    // Click the shape itself, not a spine, to reach the ordinary side panel.
    await shelf.locator('rect').first().click({ position: { x: 5, y: 5 } });

    await expect(page.locator('.panel__head h2')).toHaveText('E2E Bookshelf');
    const bookRows = page.locator('.panel__section .children .children__label');
    await expect(bookRows).toHaveCount(2);
    await expect(bookRows).toContainText([BOOKSHELF_SUBFOLDER_A, BOOKSHELF_SUBFOLDER_B]);

    // A panel book row opens the identical modal as a spine click does.
    await page.locator('.panel .children button', { hasText: BOOKSHELF_SUBFOLDER_A }).click();
    await expect(page.locator('.modal__breadcrumb')).toHaveText(BOOKSHELF_SUBFOLDER_A);
  });

  test('the server refuses a bookshelf bound to anything but documents', async () => {
    const tokenRes = await fetch('http://localhost:3002/api/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'FREDRIC', password: 'fredric' }),
    });
    const { access_token: token } = await tokenRes.json();

    const spacesRes = await fetch(`http://localhost:3006/world/api/spaces?token=${token}`);
    const { spaces } = await spacesRes.json();
    const space = spaces.find((s: { key: string }) => s.key === SPACE_KEY);

    const createRes = await fetch(`http://localhost:3002/api/world_things?spaceId=${space.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: 'E2E Bad Bookshelf', type: 'bookshelf', zone: 'south',
        bindingKind: 'crud', bindingTarget: 'motorcycles',
      }),
    });

    expect(createRes.status).toBe(400);
    const body = await createRes.json();
    expect(body.error.fields[0].message).toContain("must bind to 'documents'");
  });
});

test.describe('Notes — postits/boards own their own text', () => {
  test.beforeAll(async () => { await seedOffice(); });
  test.afterAll(async () => { await cleanOffice(); });

  test('starts empty, is editable from the panel, and persists across a reload', async ({ page }) => {
    await signIn(page, 'FREDRIC', 'fredric');
    await page.goto(`http://localhost:5173/office?space=${SPACE_KEY}`, { waitUntil: 'domcontentloaded' });

    const postit = page.locator('.thing', { hasText: 'E2E Postit' });
    await expect(postit).toBeVisible({ timeout: 15000 });
    // Never written yet — the resolver returns access:'ok', note:null, not an
    // error — so the tile still renders a (truncated, room-unit-sized) label
    // rather than a blank or broken shape.
    await expect(postit.locator('.thing__note-body')).toBeVisible();

    await postit.locator('rect').first().click({ position: { x: 5, y: 5 } });
    await expect(page.locator('.panel__head h2')).toHaveText('E2E Postit');
    // The exact, untruncated state — the floorplan tile's text is fit() to a
    // 1x1 room unit and not meant to be asserted on character-for-character.
    await expect(page.locator('.note-editor__body')).toHaveValue('');

    const body = page.locator('.note-editor__body');
    await body.fill('Hello from Playwright');
    await page.locator('.note-editor__row button', { hasText: 'Save' }).click();

    // The write's own THING_CHANGED reply updates the panel immediately.
    await expect(body).toHaveValue('Hello from Playwright');

    // Reload and reopen the panel — proves the note round-tripped through
    // Postgres, not just local component state.
    await page.reload({ waitUntil: 'domcontentloaded' });
    const reopened = page.locator('.thing', { hasText: 'E2E Postit' });
    await expect(reopened).toBeVisible({ timeout: 15000 });
    await reopened.locator('rect').first().click({ position: { x: 5, y: 5 } });
    await expect(page.locator('.note-editor__body')).toHaveValue('Hello from Playwright', { timeout: 10000 });
  });
});

test.describe('Doors — walking between spaces', () => {
  test.beforeAll(async () => { await seedOffice(); });
  test.afterAll(async () => { await cleanOffice(); });

  test('clicking a door switches spaces and shows the target\'s own objects', async ({ page }) => {
    await signIn(page, 'FREDRIC', 'fredric');
    await page.goto(`http://localhost:5173/office?space=${SPACE_KEY}`, { waitUntil: 'domcontentloaded' });

    const door = page.locator('.thing', { hasText: 'E2E Door' });
    await expect(door).toBeVisible({ timeout: 15000 });
    await expect(door).toHaveClass(/thing--door/);

    // The primary interaction is walking through directly — no panel step,
    // same "primary interaction lives on the shape" pattern as book spines.
    await expect(page.locator('.panel')).toHaveCount(0);
    await door.locator('rect').first().click({ position: { x: 5, y: 5 } });

    // Landed in the target space, showing ITS objects (the annex desk),
    // not the room the door was standing in.
    await expect(page.locator('.topbar__space select')).toHaveValue(SPACE_KEY_2, { timeout: 15000 });
    await expect(page.locator('.thing', { hasText: 'E2E Annex Desk' })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.thing', { hasText: 'E2E Door' })).toHaveCount(0);
  });
});
