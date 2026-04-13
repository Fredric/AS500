import { test, expect } from '@playwright/test';
import { setupTestData, teardownTestData } from './testSetup.js';

/**
 * Tests for keyboard row navigation on CRUDTable list screens.
 * Uses Time Registration (option 1 in the new main menu) which is the CRUDTable version.
 * Validates arrow key movement, Enter to edit, shortcut keys.
 */

test.describe('Keyboard Row Navigation', () => {
  test.beforeAll(async () => {
    await setupTestData();
  });

  test.afterAll(async () => {
    await teardownTestData();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
    await page.locator('text=● Connected').waitFor({ state: 'visible', timeout: 10000 });

    const usernameInput = page.locator('input[type="text"]').first();
    await usernameInput.waitFor({ state: 'visible', timeout: 10000 });
    await usernameInput.fill('KALLE');
    await usernameInput.press('Tab');
    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.waitFor({ state: 'visible', timeout: 10000 });
    await passwordInput.fill('password');
    await passwordInput.press('Enter');

    await page.locator('text=MAIN MENU').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(600); // Let React commit menu navigation state

    // Time Registration is option 1 (already focused as first item)
    const container = page.locator('.terminal-container');
    await container.focus();
    await page.keyboard.press('Enter');

    // Wait for CRUDTable list screen
    await page.locator('text=Day total').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(600); // Let React commit navigation state
  });

  test('first data row is highlighted on load', async ({ page }) => {
    await page.locator('text=TASK-').first().waitFor({ state: 'visible', timeout: 10000 });

    const focusedRows = page.locator('.terminal-row--focused');
    await expect(focusedRows).toHaveCount(1);
  });

  test('status line shows keyboard shortcut hints', async ({ page }) => {
    const statusLine = page.locator('.terminal-status');
    const statusText = await statusLine.textContent();
    expect(statusText).toContain('Enter=Edit');
    expect(statusText).toContain('D=Delete');
  });

  test('ArrowDown moves focus to next row', async ({ page }) => {
    await page.locator('text=TASK-').first().waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(200);

    const container = page.locator('.terminal-container');
    await container.focus();

    const firstText = await page.locator('.terminal-row--focused').textContent();

    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);

    const secondText = await page.locator('.terminal-row--focused').textContent();
    expect(secondText).not.toBe(firstText);
  });

  test('ArrowUp moves focus back to previous row', async ({ page }) => {
    await page.locator('text=TASK-').first().waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(200);

    const container = page.locator('.terminal-container');
    await container.focus();

    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    const afterDown = await page.locator('.terminal-row--focused').textContent();

    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    const afterUp = await page.locator('.terminal-row--focused').textContent();

    expect(afterUp).not.toBe(afterDown);
  });

  test('Enter on focused row opens edit form', async ({ page }) => {
    await page.locator('text=TASK-').first().waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(200);

    const container = page.locator('.terminal-container');
    await container.focus();

    await page.keyboard.press('Enter');

    // CRUDTable form title for edit mode
    await page.locator('text=EDIT TIME REGISTRATION').waitFor({ state: 'visible', timeout: 10000 });

    // Cancel back to list via Esc
    await page.keyboard.press('Escape');
    await page.locator('text=Day total').waitFor({ state: 'visible', timeout: 10000 });
  });

  test('D shortcut key shows delete confirmation then deletes the focused row', async ({ page }) => {
    await page.locator('text=TASK-').first().waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(200);

    const textBefore = await page.locator('.terminal-row--focused').textContent();

    const container = page.locator('.terminal-container');
    await container.focus();

    await page.keyboard.press('d');

    // Wait for confirmation screen
    await page.locator('text=CONFIRM DELETE').waitFor({ state: 'visible', timeout: 10000 });

    // Fill Y in the confirm input and press Enter
    const confirmInput = page.locator('input[data-field="confirm"]');
    await confirmInput.waitFor({ state: 'visible', timeout: 5000 });
    await confirmInput.click();
    await confirmInput.fill('Y');
    await page.keyboard.press('Enter');

    await page.locator('text=Record deleted').waitFor({ state: 'visible', timeout: 10000 });

    await page.waitForTimeout(300);
    const textAfter = await page.locator('.terminal-row--focused').textContent();
    expect(textAfter).not.toBe(textBefore);
  });

  test('Esc key navigates back to main menu', async ({ page }) => {
    await page.locator('text=TASK-').first().waitFor({ state: 'visible', timeout: 10000 });

    const container = page.locator('.terminal-container');
    await container.focus();

    await page.keyboard.press('Escape');
    await page.locator('text=MAIN MENU').waitFor({ state: 'visible', timeout: 10000 });
  });
});
