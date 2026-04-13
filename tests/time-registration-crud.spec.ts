import { test, expect } from '@playwright/test';
import { setupTestData, teardownTestData } from './testSetup.js';

/**
 * CRUD tests for Time Registration (CRUDTable V2 screen).
 * Tests: Create, Edit, Delete operations using keyboard navigation.
 */

test.describe('Time Registration CRUD', () => {
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
    await page.waitForTimeout(600);

    // Select Time Registration (first menu item, already focused)
    const container = page.locator('.terminal-container');
    await container.focus();
    await page.keyboard.press('Enter');

    await page.locator('text=Day total').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(500);
  });

  test('should add a new time entry', async ({ page }) => {
    // Press 'n' to create new entry
    const container = page.locator('.terminal-container');
    await container.focus();
    await page.keyboard.press('n');

    await page.locator('text=CREATE TIME REGISTRATION').waitFor({ state: 'visible', timeout: 10000 });

    const inputs = page.locator('input[type="text"]');

    // Start time
    await inputs.nth(0).fill('09:00');
    await inputs.nth(0).press('Tab');

    // End time
    await inputs.nth(1).fill('10:30');
    await inputs.nth(1).press('Tab');

    // Task
    await inputs.nth(2).fill('TEST-001');
    await inputs.nth(2).press('Tab');

    // Description
    await inputs.nth(3).fill('Test task');

    await page.keyboard.press('Enter');

    await page.locator('text=Day total').waitFor({ state: 'visible', timeout: 10000 });

    await expect(page.locator('text=TEST-001').first()).toBeVisible();
    await expect(page.locator('text=Test task').first()).toBeVisible();

    const entries = await page.locator('text=TEST-001').all();
    expect(entries.length).toBe(1);
  });

  test('should edit an existing time entry', async ({ page }) => {
    await page.locator('text=TASK-').first().waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(300);

    // Use opt field to trigger edit
    const firstOptInput = page.locator('input[data-field="opt_0"]');
    await firstOptInput.fill('2');
    await page.keyboard.press('Enter');

    await page.locator('text=EDIT TIME REGISTRATION').waitFor({ state: 'visible', timeout: 10000 });

    const inputs = page.locator('input[type="text"]');
    const descriptionField = inputs.last();
    await descriptionField.clear();
    await descriptionField.fill('EDITED');

    await page.keyboard.press('Enter');

    await page.locator('text=Day total').waitFor({ state: 'visible', timeout: 10000 });
    await expect(page.locator('text=EDITED').first()).toBeVisible();
  });

  test('should delete a time entry', async ({ page }) => {
    const firstTaskBefore = await page.locator('text=TASK-').first().textContent();
    await page.waitForTimeout(300);

    const firstOptInput = page.locator('input[data-field="opt_0"]');
    await firstOptInput.fill('4');
    await page.keyboard.press('Enter');

    // Wait for confirmation screen
    await page.locator('text=CONFIRM DELETE').waitFor({ state: 'visible', timeout: 10000 });

    // Fill Y in the confirm input and press Enter
    const confirmInput = page.locator('input[data-field="confirm"]');
    await confirmInput.waitFor({ state: 'visible', timeout: 5000 });
    await confirmInput.click();
    await confirmInput.fill('Y');
    await page.keyboard.press('Enter');

    await page.locator('text=Record deleted').waitFor({ state: 'visible', timeout: 10000 });

    const firstTaskAfter = await page.locator('text=TASK-').first().textContent();
    expect(firstTaskAfter).not.toBe(firstTaskBefore);
  });
});
