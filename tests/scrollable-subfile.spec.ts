import { test, expect } from '@playwright/test';
import { setupTestData, teardownTestData } from './testSetup.js';

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
