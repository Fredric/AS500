import { test, expect } from '@playwright/test';
import { setupTestData, teardownTestData } from './testSetup.js';

/**
 * Minimal CRUD tests for TIME_REG screen
 * Tests: Create, Read, Update, Delete operations
 * Use this as a template for testing add/edit/delete on other screens
 */

test.describe('Time Registration CRUD', () => {
  test.beforeAll(async () => {
    // Setup test data before all tests
    await setupTestData();
  });

  test.afterAll(async () => {
    // Cleanup test data after all tests
    await teardownTestData();
  });
  test.beforeEach(async ({ page }) => {
    // Navigate and login
    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
    await page.locator('text=● Connected').waitFor({ state: 'visible', timeout: 10000 });

    // Login: KALLE / password
    const usernameInput = page.locator('input[type="text"]').first();
    await usernameInput.fill('KALLE');
    await usernameInput.press('Tab');
    await page.locator('input[type="password"]').fill('password');
    await page.locator('input[type="password"]').press('Enter');

    // Navigate to main menu
    await page.locator('text=MAIN MENU').waitFor({ state: 'visible', timeout: 10000 });

    // Go to Time Registration (option 6)
    const selectionInput = page.locator('input[type="text"]').last();
    await selectionInput.fill('6');
    await selectionInput.press('Enter');

    // Wait for TIME REGISTRATION screen (use unique element to avoid matching menu items)
    await page.locator('text=Day total').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(500);
  });

  test('should add a new time entry', async ({ page }) => {
    // Press F6 to add new entry
    await page.keyboard.press('F6');

    // Wait for TIME_ENTRY screen
    await page.locator('text=TIME ENTRY').waitFor({ state: 'visible', timeout: 10000 });

    // Fill in the form
    const inputs = page.locator('input[type="text"]');

    // First field: Start time
    await inputs.nth(0).fill('09:00');
    await inputs.nth(0).press('Tab');

    // Second field: End time
    await inputs.nth(1).fill('10:30');
    await inputs.nth(1).press('Tab');

    // Third field: Task
    await inputs.nth(2).fill('TEST-001');
    await inputs.nth(2).press('Tab');

    // Fourth field: Description
    await inputs.nth(3).fill('Test task');
    await inputs.nth(3).press('Tab');

    // Submit with Enter
    await page.keyboard.press('Enter');

    // Wait for return to TIME_REG screen
    await page.locator('text=Day total').waitFor({ state: 'visible', timeout: 10000 });

    // Verify the entry was added
    await expect(page.locator('text=TEST-001').first()).toBeVisible();
    await expect(page.locator('text=Test task').first()).toBeVisible();

    //verify that only one entry was added
    const entries = await page.locator('text=TEST-001').all();
    expect(entries.length).toBe(1);
  });

  test('should edit an existing time entry', async ({ page }) => {
    // Wait for entries to load
    await page.locator('text=TASK-').first().waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(300);

    // Fill the first opt field with "2" for edit
    const firstOptInput = page.locator('input[data-field="opt_0"]');
    await firstOptInput.fill('2');

    // Press Enter to submit
    await page.keyboard.press('Enter');

    // Wait for TIME_ENTRY screen
    await page.locator('text=TIME ENTRY').waitFor({ state: 'visible', timeout: 10000 });

    // Update description field (4th text input on the form)
    const inputs = page.locator('input[type="text"]');
    const descriptionField = inputs.nth(3);
    await descriptionField.clear();
    await descriptionField.fill('EDITED');

    // Submit with Enter
    await page.keyboard.press('Enter');

    // Wait for return to TIME_REG screen
    await page.locator('text=Day total').waitFor({ state: 'visible', timeout: 10000 });

    // Verify the change
    await expect(page.locator('text=EDITED').first()).toBeVisible();
  });

  test('should delete a time entry', async ({ page }) => {
    // Wait for entries to load and get first entry task name
    const firstTaskBefore = await page.locator('text=TASK-').first().textContent();
    await page.waitForTimeout(300);

    // Fill the first opt field with "4" for delete
    const firstOptInput = page.locator('input[data-field="opt_0"]');
    await firstOptInput.fill('4');

    // Press Enter to submit
    await page.keyboard.press('Enter');

    // Wait for confirmation message
    await page.locator('text=Entry deleted').waitFor({ state: 'visible', timeout: 10000 });

    // Verify the first entry changed (entry was deleted)
    const firstTaskAfter = await page.locator('text=TASK-').first().textContent();
    expect(firstTaskAfter).not.toBe(firstTaskBefore);
  });
});
