import { test, expect } from '@playwright/test';
import {
  setupTestData,
  teardownTestData,
  SCROLL_SUBFILE_TEST_ENTRIES,
  type ScrollSubfileTestEntry,
} from './testSetup.js';

/**
 * Subfile pagination on Time Registration (CRUDTable). All rows come from
 * `SCROLL_SUBFILE_TEST_ENTRIES` via setupTestData / teardownTestData (user KALLE, today).
 * 26 rows, page size 12: page 1 (0–11), page 2 (12–23), page 3 (24–25).
 * Pagination: ArrowDown at last visible row sends PAGEDOWN; ArrowUp at first row sends PAGEUP.
 * Day navigation: ArrowLeft / ArrowRight (F7 / F8).
 */

const PAGE_SIZE = 12; // LIST_PAGE_SIZE in runtime.ts

function normaliseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ');
}

/** Match list row text: task id, or description when task is empty (e.g. lunch). */
function rowScreenMarker(row: ScrollSubfileTestEntry): string {
  const t = row.task.trim();
  return t.length > 0 ? t : row.desc;
}

function sliceSeedPage(pageIndex: number): ScrollSubfileTestEntry[] {
  return SCROLL_SUBFILE_TEST_ENTRIES.slice(
    pageIndex * PAGE_SIZE,
    (pageIndex + 1) * PAGE_SIZE
  );
}

async function waitForSeedPage(
  page: import('@playwright/test').Page,
  rows: ScrollSubfileTestEntry[],
  timeoutMs = 10_000
): Promise<void> {
  const markers = rows.map(rowScreenMarker);
  await expect
    .poll(
      async () => {
        const raw = (await page.locator('.terminal-screen').textContent()) ?? '';
        const text = normaliseWhitespace(raw);
        return markers.every((m) => text.includes(m));
      },
      {
        timeout: timeoutMs,
        message: `expected terminal to render rows: ${markers.join(', ')}`,
      }
    )
    .toBe(true);
}

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

  test.describe('Time Registration — basic pagination', () => {
    test('should show "More..." indicator when there are more entries than page size', async ({
      page,
    }) => {
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
      for (let i = 0; i < PAGE_SIZE; i++) {
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(30);
      }

      await page.locator('text=TASK-101').waitFor({ state: 'hidden', timeout: 10000 });
      await page.locator('text=TASK-114').waitFor({ state: 'visible', timeout: 10000 });
      await page.locator('text=TASK-123').waitFor({ state: 'visible', timeout: 10000 });

      await expect(page.locator('text=TASK-114')).toBeVisible();
      await expect(page.locator('text=Final code cleanup')).toBeVisible();
      await expect(page.locator('text=More...')).toBeVisible();
    });

    test('should return to previous page when ArrowUp at first row of page 2', async ({ page }) => {
      for (let i = 0; i < PAGE_SIZE; i++) {
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(30);
      }
      await page.locator('text=TASK-123').waitFor({ state: 'visible', timeout: 10000 });

      await page.keyboard.press('ArrowUp');
      await page.locator('text=TASK-101').waitFor({ state: 'visible', timeout: 10000 });
      await page.locator('text=TASK-123').waitFor({ state: 'hidden', timeout: 10000 });

      await expect(page.locator('text=TASK-101')).toBeVisible();
      await expect(page.locator('text=More...')).toBeVisible();
    });

    test('should not advance beyond last page', async ({ page }) => {
      // Page 1 → 2 → 3 (24 row moves from focus row 0 across page boundaries)
      for (let i = 0; i < PAGE_SIZE * 2; i++) {
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(30);
      }
      await page.locator('text=TASK-125').waitFor({ state: 'visible', timeout: 10000 });

      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(300);

      await expect(page.locator('text=TASK-125')).toBeVisible();
    });

    test('should reset to first page when switching days with arrow keys', async ({ page }) => {
      for (let i = 0; i < PAGE_SIZE; i++) {
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(30);
      }
      await page.locator('text=TASK-123').waitFor({ state: 'visible', timeout: 10000 });

      await page.keyboard.press('ArrowLeft');
      let dateChanged = false;
      for (let i = 0; i < 10; i++) {
        const row = await page.locator('.terminal-screen').textContent();
        if (row && !row.includes('TASK-123')) {
          dateChanged = true;
          break;
        }
        await page.waitForTimeout(500);
      }
      expect(dateChanged).toBe(true);

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
   * Regression: ArrowDown at last row must send PAGEDOWN only once (StrictMode-safe).
   * Previously a double-invoke skipped from page 1 to page 3. Uses the same seeded list
   * as basic pagination — no dependency on global role_permissions rows.
   */
  test.describe('Time Registration — multi-page advance regression', () => {
    test('ArrowDown to end of page 1 advances to page 2 (not page 3)', async ({ page }) => {
      const page2Rows = sliceSeedPage(1);
      const page3Rows = sliceSeedPage(2);

      for (let i = 0; i < PAGE_SIZE; i++) {
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(40);
      }

      await waitForSeedPage(page, page2Rows);

      const screenText = normaliseWhitespace(
        (await page.locator('.terminal-screen').textContent()) ?? ''
      );

      for (const row of page2Rows) {
        const marker = rowScreenMarker(row);
        expect(screenText, `page 2 should contain "${marker}"`).toContain(marker);
      }

      const page2Markers = new Set(page2Rows.map(rowScreenMarker));
      for (const row of page3Rows) {
        const m = rowScreenMarker(row);
        if (!page2Markers.has(m)) {
          expect(screenText, `page 3-only "${m}" must not appear on page 2`).not.toContain(m);
        }
      }

      if (SCROLL_SUBFILE_TEST_ENTRIES.length > 2 * PAGE_SIZE) {
        await expect(page.locator('text=More...')).toBeVisible();
      }
    });

    test('ArrowDown through two pages advances exactly to page 3', async ({ page }) => {
      const page2Rows = sliceSeedPage(1);
      const page3Rows = sliceSeedPage(2);

      for (let i = 0; i < PAGE_SIZE; i++) {
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(40);
      }
      await waitForSeedPage(page, page2Rows);

      for (let i = 0; i < PAGE_SIZE; i++) {
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(40);
      }
      await waitForSeedPage(page, page3Rows);

      const screenText = normaliseWhitespace(
        (await page.locator('.terminal-screen').textContent()) ?? ''
      );

      for (const row of page3Rows) {
        const marker = rowScreenMarker(row);
        expect(screenText, `page 3 should contain "${marker}"`).toContain(marker);
      }

      // Last page still renders a full subfile window, so rows from the end of page 2
      // can remain visible above the final records. Assert we left page 1 instead.
      expect(screenText, 'first-page anchor should be off-screen').not.toContain('TASK-101');
    });

    test('ArrowUp from top of page 2 returns to page 1', async ({ page }) => {
      const page1Rows = sliceSeedPage(0);
      const page2Rows = sliceSeedPage(1);

      for (let i = 0; i < PAGE_SIZE; i++) {
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(40);
      }
      await waitForSeedPage(page, page2Rows);

      await page.keyboard.press('ArrowUp');
      await waitForSeedPage(page, page1Rows);

      const screenText = normaliseWhitespace(
        (await page.locator('.terminal-screen').textContent()) ?? ''
      );
      for (const row of page1Rows) {
        const marker = rowScreenMarker(row);
        expect(screenText, `page 1 should contain "${marker}"`).toContain(marker);
      }
      await expect(page.locator('text=More...')).toBeVisible();
    });
  });
});
