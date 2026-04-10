import { test, expect } from '@playwright/test';
import { setupTestData, teardownTestData } from './testSetup.js';

/**
 * Tests for keyboard/mouse row navigation on CRUDTable list screens.
 * Uses option 7 (Time Registration V2) which is the CRUDTable version.
 * Validates arrow key movement, Enter to edit, shortcut keys, and mouse click.
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

    // Option 7 = Time Registration V2 (CRUDTable screen with navigation metadata)
    const selectionInput = page.locator('input[type="text"]').last();
    await selectionInput.fill('7');
    await selectionInput.press('Enter');

    // Wait for CRUDTable list screen - it shows "Day total" in the listHeader
    await page.locator('text=Day total').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(600); // Let React commit navigation state
  });

  test('first data row is highlighted on load', async ({ page }) => {
    await page.locator('text=TASK-').first().waitFor({ state: 'visible', timeout: 10000 });

    // The first data row should have the focused class
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

    // Enter triggers primary action (edit) on focused row
    await page.keyboard.press('Enter');

    // CRUDTable form title is "EDIT TIME REGISTRATION"
    await page.locator('text=EDIT TIME REGISTRATION').waitFor({ state: 'visible', timeout: 10000 });

    // Cancel back to list
    await page.keyboard.press('F12');
    await page.locator('text=Day total').waitFor({ state: 'visible', timeout: 10000 });
  });

  test('D shortcut key deletes the focused row', async ({ page }) => {
    await page.locator('text=TASK-').first().waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(200);

    const textBefore = await page.locator('.terminal-row--focused').textContent();

    const container = page.locator('.terminal-container');
    await container.focus();

    await page.keyboard.press('d');

    // CRUDTable delete success message is "Record deleted"
    await page.locator('text=Record deleted').waitFor({ state: 'visible', timeout: 10000 });

    // After deletion the first focused row should show different content
    await page.waitForTimeout(300);
    const textAfter = await page.locator('.terminal-row--focused').textContent();
    expect(textAfter).not.toBe(textBefore);
  });

  test('mouse click selects a row', async ({ page }) => {
    await page.locator('text=TASK-').first().waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(200);

    // Click the second selectable data row
    const selectableRows = page.locator('.terminal-row--selectable');
    const secondRowText = await selectableRows.nth(1).textContent();
    await selectableRows.nth(1).click();
    await page.waitForTimeout(100);

    const focusedText = await page.locator('.terminal-row--focused').textContent();
    expect(focusedText).toBe(secondRowText);
  });
});
