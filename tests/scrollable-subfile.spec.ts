import { test, expect } from '@playwright/test';
import pkg from 'pg';
import { setupTestData, teardownTestData, promoteToAdmin } from './testSetup.js';

const { Pool } = pkg;

interface RoleDefaultRow {
  role: string;
  permission_key: string;
}

// Fetch role defaults in the exact same order the list screen will render them.
// The `role` column is a pgEnum declared as ['user','superuser','aiagent','admin'],
// and Postgres sorts enums by declaration order — NOT alphabetically.
async function fetchRoleDefaults(): Promise<RoleDefaultRow[]> {
  const connectionString = process.env.DATABASE_URL || 'postgresql://as500:as500@localhost:5433/as500';
  const pool = new Pool({ connectionString });
  try {
    const result = await pool.query<RoleDefaultRow>(
      'SELECT role, permission_key FROM role_permissions ORDER BY role, permission_key'
    );
    return result.rows;
  } finally {
    await pool.end();
  }
}

// The permission column in the list screen is truncated to 18 chars
// (see roleDefaultsConfig.ts `permission_key.column.width = 18`).
const PERMISSION_COL_WIDTH = 18;
function displayPermissionKey(key: string): string {
  return key.length > PERMISSION_COL_WIDTH ? key.substring(0, PERMISSION_COL_WIDTH) : key;
}

// Signature used to identify a row in the rendered subfile. The role is
// uppercased in the list (see roleDefaultsConfig.ts cellRenderer), and the
// permission key is truncated to 18 chars. role+permission_key is the
// primary key of the row, so this is guaranteed unique across the table.
function rowSignature(row: RoleDefaultRow): string {
  return `${row.role.toUpperCase()} ${displayPermissionKey(row.permission_key)}`;
}

// Remove the extra whitespace runs in the rendered terminal so we can find
// row signatures (role + " " + permission_key) regardless of column padding.
function normaliseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ');
}

/**
 * Tests for subfile pagination on the Time Registration CRUDTable screen.
 * 15 test entries, page size 12: page 1 shows TASK-101..TASK-111, page 2 shows TASK-112..TASK-114.
 * Pagination is triggered by ArrowDown at the last row (advances page)
 * and ArrowUp at the first row of page 2 (goes back to page 1).
 * Day navigation uses ArrowLeft (prev day) and ArrowRight (next day).
 */

const PAGE_SIZE = 12; // LIST_PAGE_SIZE in runtime.ts

test.describe('Scrollable Subfile', () => {
  test.beforeAll(async () => {
    await setupTestData();
  });

  test.afterAll(async () => {
    await teardownTestData();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
    await page.locator('text=● Connected').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(200);

    const usernameInput = page.locator('input[type="text"]').first();
    await usernameInput.waitFor({ state: 'visible', timeout: 10000 });
    await usernameInput.fill('KALLE');
    await usernameInput.press('Tab');
    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.fill('password');
    await passwordInput.press('Enter');

    await page.locator('text=MAIN MENU').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(600);

    // Select Time Registration (first menu item, already focused)
    const container = page.locator('.terminal-container');
    await container.focus();
    await page.keyboard.press('Enter');

    await page.locator('text=TIME REGISTRATION').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(800);

    await page.locator('text=TASK-101').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('text=More...').waitFor({ state: 'visible', timeout: 15000 });

    const terminalContainer = page.locator('.terminal-container');
    await terminalContainer.waitFor({ state: 'visible', timeout: 5000 });
    await terminalContainer.focus();
    await page.waitForTimeout(200);
  });

  test('should show "More..." indicator when there are more entries than page size', async ({ page }) => {
    await expect(page.locator('text=More...')).toBeVisible();
  });

  test('should display first page entries', async ({ page }) => {
    await expect(page.locator('text=TASK-101')).toBeVisible();
    await expect(page.locator('text=Morning standup meeting')).toBeVisible();
    await expect(page.locator('text=TASK-109')).toBeVisible();
    await expect(page.locator('text=Testing new feature')).toBeVisible();
    // TASK-112 is on page 2 (entry index 12)
    await expect(page.locator('text=TASK-112')).not.toBeVisible();
  });

  test('should advance to next page when ArrowDown reaches the last row', async ({ page }) => {
    // Press ArrowDown PAGE_SIZE times to move past the last row and trigger page advance
    for (let i = 0; i < PAGE_SIZE; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(30);
    }

    await page.locator('text=TASK-114').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('text=TASK-101').waitFor({ state: 'hidden', timeout: 10000 });

    await expect(page.locator('text=TASK-114')).toBeVisible();
    await expect(page.locator('text=Final code cleanup')).toBeVisible();
    await expect(page.locator('text=More...')).not.toBeVisible();
  });

  test('should return to previous page when ArrowUp at first row of page 2', async ({ page }) => {
    // Advance to page 2
    for (let i = 0; i < PAGE_SIZE; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(30);
    }
    await page.locator('text=TASK-114').waitFor({ state: 'visible', timeout: 10000 });

    // ArrowUp at row 0 of page 2 → goes back to page 1
    await page.keyboard.press('ArrowUp');
    await page.locator('text=TASK-101').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('text=TASK-114').waitFor({ state: 'hidden', timeout: 10000 });

    await expect(page.locator('text=TASK-101')).toBeVisible();
    await expect(page.locator('text=More...')).toBeVisible();
  });

  test('should not advance beyond last page', async ({ page }) => {
    for (let i = 0; i < PAGE_SIZE; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(30);
    }
    await page.locator('text=TASK-114').waitFor({ state: 'visible', timeout: 10000 });

    // Press ArrowDown beyond last row — should not change page
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);

    await expect(page.locator('text=TASK-114')).toBeVisible();
  });

  test('should reset to first page when switching days with arrow keys', async ({ page }) => {
    // Advance to page 2
    for (let i = 0; i < PAGE_SIZE; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(30);
    }
    await page.locator('text=TASK-114').waitFor({ state: 'visible', timeout: 10000 });

    // ArrowLeft = previous day (F7 under the hood)
    await page.keyboard.press('ArrowLeft');
    let dateChanged = false;
    for (let i = 0; i < 10; i++) {
      const row = await page.locator('.terminal-screen').textContent();
      if (row && !row.includes('TASK-114')) {
        dateChanged = true;
        break;
      }
      await page.waitForTimeout(500);
    }
    expect(dateChanged).toBe(true);

    // ArrowRight = next day (F8) — back to test data day
    await page.keyboard.press('ArrowRight');
    await page.locator('text=TASK-101').waitFor({ state: 'visible', timeout: 10000 });
    await expect(page.locator('text=TASK-101')).toBeVisible();
  });

  test('status line shows navigation hints', async ({ page }) => {
    const statusLine = page.locator('.terminal-status');
    const statusText = await statusLine.textContent();
    expect(statusText).toContain('Esc=Exit');
    expect(statusText).toContain('N=New');
  });
});

/**
 * Regression tests for page-skipping on ArrowDown/ArrowUp on a list that
 * spans multiple pages.
 *
 * Uses the Role Default Permissions screen (`CRUD_ROLE_DEFAULTS`), which
 * has enough seeded rows to require at least three pages with the default
 * 12-row page size. Rows are sorted by `role` (pg enum declaration order:
 * user → superuser → aiagent → admin) then by `permission_key`.
 *
 * The bug guarded against: pressing ArrowDown at the last row of a page
 * used to send PAGEDOWN twice, because the updater function for
 * `setFocusedDataRowIndex` called `sendKey('PAGEDOWN')` as a side effect,
 * and React StrictMode double-invokes updaters in development. This caused
 * the client to skip straight from page 1 to page 3.
 */
test.describe('Scrollable Subfile - page advance (Role Defaults)', () => {
  const PAGE_SIZE = 12;
  let restoreAdmin: (() => Promise<void>) | null = null;
  let allRows: RoleDefaultRow[] = [];

  function sliceForPage(n: number): RoleDefaultRow[] {
    return allRows.slice(n * PAGE_SIZE, (n + 1) * PAGE_SIZE);
  }

  test.beforeAll(async () => {
    restoreAdmin = await promoteToAdmin('KALLE');
    allRows = await fetchRoleDefaults();
    if (allRows.length < 2 * PAGE_SIZE + 1) {
      throw new Error(
        `Expected at least ${2 * PAGE_SIZE + 1} role_permissions rows for a 3-page scroll test; ` +
          `found ${allRows.length}. Ensure the server has seeded role defaults (it does so at startup).`
      );
    }
  });

  test.afterAll(async () => {
    if (restoreAdmin) await restoreAdmin();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
    await page.locator('text=● Connected').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(200);

    const usernameInput = page.locator('input[type="text"]').first();
    await usernameInput.waitFor({ state: 'visible', timeout: 10000 });
    await usernameInput.fill('KALLE');
    await usernameInput.press('Tab');
    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.fill('password');
    await passwordInput.press('Enter');

    await page.locator('text=MAIN MENU').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(600);

    const container = page.locator('.terminal-container');
    await container.focus();

    // Navigate to Administration (3rd visible item for an admin)
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await page.locator('text=ADMINISTRATION').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(400);

    // Role Defaults is the 2nd item
    await container.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await page.locator('text=ROLE DEFAULT PERMISSIONS').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(600);

    // Sanity: page 1 of the subfile shows exactly the first PAGE_SIZE
    // records. Verify by checking each row's role+permission_key signature
    // appears in the rendered screen text.
    const page1Rows = sliceForPage(0);
    const raw = (await page.locator('.terminal-screen').textContent()) ?? '';
    const screenText = normaliseWhitespace(raw);
    for (const row of page1Rows) {
      expect(
        screenText,
        `page 1 should contain row "${rowSignature(row)}"`
      ).toContain(rowSignature(row));
    }
    await expect(page.locator('text=More...')).toBeVisible();

    await container.focus();
  });

  // Wait until the rendered terminal contains every row of the target page.
  // Rows are identified by their role+permission_key signature, which is the
  // primary key of role_permissions and therefore unique across the dataset.
  async function waitForPage(
    page: import('@playwright/test').Page,
    targetRows: RoleDefaultRow[],
    timeoutMs = 10_000
  ): Promise<void> {
    const expectedSignatures = targetRows.map(rowSignature);
    await expect
      .poll(
        async () => {
          const raw = (await page.locator('.terminal-screen').textContent()) ?? '';
          const text = normaliseWhitespace(raw);
          return expectedSignatures.every((sig) => text.includes(sig));
        },
        {
          timeout: timeoutMs,
          message: `expected terminal to render rows: ${expectedSignatures.join(', ')}`,
        }
      )
      .toBe(true);
  }

  test('ArrowDown to end of page 1 advances to page 2 (not page 3)', async ({ page }) => {
    const page2Rows = sliceForPage(1);
    const page3Rows = sliceForPage(2);

    // 12 ArrowDown presses: 11 within-page moves + 1 to trigger PAGEDOWN.
    for (let i = 0; i < PAGE_SIZE; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(40);
    }

    // Wait until all of page 2's rows are rendered.
    await waitForPage(page, page2Rows);

    const screenText = normaliseWhitespace(
      (await page.locator('.terminal-screen').textContent()) ?? ''
    );

    // Every row on page 2 must appear on screen by full role+key signature.
    for (const row of page2Rows) {
      expect(
        screenText,
        `page 2 should contain row "${rowSignature(row)}"`
      ).toContain(rowSignature(row));
    }

    // If the page-skip bug were present, we would have jumped straight to
    // page 3. Rows whose role+key signature is unique to page 3 must NOT
    // be visible on page 2.
    const page2Signatures = new Set(page2Rows.map(rowSignature));
    for (const row of page3Rows) {
      const sig = rowSignature(row);
      if (!page2Signatures.has(sig)) {
        expect(
          screenText,
          `page 3-only row "${sig}" must not be visible on page 2`
        ).not.toContain(sig);
      }
    }

    // Page 2 still has more pages after it, so 'More...' should still show.
    if (allRows.length > 2 * PAGE_SIZE) {
      await expect(page.locator('text=More...')).toBeVisible();
    }
  });

  test('ArrowDown through two pages advances exactly to page 3', async ({ page }) => {
    const page2Rows = sliceForPage(1);
    const page3Rows = sliceForPage(2);

    // Advance to page 2.
    for (let i = 0; i < PAGE_SIZE; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(40);
    }
    await waitForPage(page, page2Rows);

    // Advance to page 3.
    for (let i = 0; i < PAGE_SIZE; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(40);
    }
    await waitForPage(page, page3Rows);

    const screenText = normaliseWhitespace(
      (await page.locator('.terminal-screen').textContent()) ?? ''
    );

    for (const row of page3Rows) {
      expect(
        screenText,
        `page 3 should contain row "${rowSignature(row)}"`
      ).toContain(rowSignature(row));
    }

    // Rows whose role+key signature is unique to page 2 must NOT appear.
    const page3Signatures = new Set(page3Rows.map(rowSignature));
    for (const row of page2Rows) {
      const sig = rowSignature(row);
      if (!page3Signatures.has(sig)) {
        expect(
          screenText,
          `page 2-only row "${sig}" must not be visible on page 3`
        ).not.toContain(sig);
      }
    }
  });

  test('ArrowUp from top of page 2 returns to page 1', async ({ page }) => {
    const page1Rows = sliceForPage(0);
    const page2Rows = sliceForPage(1);

    // Advance to page 2.
    for (let i = 0; i < PAGE_SIZE; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(40);
    }
    await waitForPage(page, page2Rows);

    // ArrowUp at row 0 of page 2 should return to page 1.
    await page.keyboard.press('ArrowUp');
    await waitForPage(page, page1Rows);

    const screenText = normaliseWhitespace(
      (await page.locator('.terminal-screen').textContent()) ?? ''
    );
    for (const row of page1Rows) {
      expect(
        screenText,
        `page 1 should contain row "${rowSignature(row)}"`
      ).toContain(rowSignature(row));
    }
    await expect(page.locator('text=More...')).toBeVisible();
  });
});
