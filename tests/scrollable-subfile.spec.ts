import { test, expect } from '@playwright/test';

/**
 * Test for scrollable subfile functionality in TIME_REG screen
 * 
 * This test verifies that:
 * 1. The subfile shows "More..." when there are more than 10 entries
 * 2. PageDown scrolls to the next page
 * 3. PageUp scrolls back to the previous page
 * 4. The correct entries are displayed on each page
 */

test.describe('Scrollable Subfile', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the application
    await page.goto('http://localhost:5173');

    // Wait for connection
    await page.locator('text=● Connected').waitFor({ state: 'visible', timeout: 10000 });

    // Login
    await page.locator('input[type="text"]').fill('KALLE');
    await page.locator('input[type="text"]').press('Tab');
    await page.locator('input[type="password"]').fill('password');
    await page.locator('input[type="password"]').press('Enter');

    // Wait for main menu to appear
    await page.locator('text=MAIN MENU').waitFor({ state: 'visible', timeout: 10000 });

    // Navigate to Time Registration (option 6)
    const selectionInput = page.locator('input[type="text"]').last();
    await selectionInput.focus();
    await selectionInput.fill('6');
    await selectionInput.press('Enter');

    // Wait for TIME REGISTRATION screen
    await page.locator('text=TIME REGISTRATION').waitFor({ state: 'visible', timeout: 10000 });

    // Wait for the first entry to appear (sign the page loaded)
    await page.locator('text=TASK-101').waitFor({ state: 'visible', timeout: 10000 });

    // Wait for More indicator to appear (confirms data is loaded)
    await page.locator('text=More...').waitFor({ state: 'visible', timeout: 10000 });

    // Click on the terminal area to ensure keyboard focus
    await page.locator('.terminal-container').click();
    // Give it a moment to focus
    await page.waitForTimeout(100);
  });

  test('should show "More..." indicator when there are more entries than page size', async ({ page }) => {
    // Verify that "More..." is displayed
    await expect(page.locator('text=More...')).toBeVisible();
  });

  test('should display first 10 entries on the first page', async ({ page }) => {
    // Check that the first entry is visible
    await expect(page.locator('text=TASK-101')).toBeVisible();
    await expect(page.locator('text=Morning standup meeting')).toBeVisible();

    // Check that the 10th entry is visible
    await expect(page.locator('text=TASK-109')).toBeVisible();
    await expect(page.locator('text=Testing new feature')).toBeVisible();

    // Check that entries beyond the 10th are not visible
    await expect(page.locator('text=TASK-110')).not.toBeVisible();
    await expect(page.locator('text=Email and admin')).not.toBeVisible();
  });

  test('should scroll to next page when PageDown is pressed', async ({ page }) => {
    // Press PageDown
    await page.keyboard.press('PageDown');

    // Wait for the screen to update - wait for new entries to appear AND old ones to disappear
    await page.locator('text=TASK-114').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('text=TASK-101').waitFor({ state: 'hidden', timeout: 10000 });

    // Verify that we're now on the second page
    await expect(page.locator('text=TASK-101')).not.toBeVisible();
    await expect(page.locator('text=Morning standup meeting')).not.toBeVisible();

    // The last entries should now be visible
    await expect(page.locator('text=TASK-114')).toBeVisible();
    await expect(page.locator('text=Final code cleanup')).toBeVisible();

    // "More..." should not be visible on the last page
    await expect(page.locator('text=More...')).not.toBeVisible();
  });

  test('should scroll back to previous page when PageUp is pressed', async ({ page }) => {
    // First, scroll down to page 2
    await page.keyboard.press('PageDown');
    await page.locator('text=TASK-114').waitFor({ state: 'visible', timeout: 10000 });

    // Press PageUp to go back to page 1
    await page.keyboard.press('PageUp');
    await page.locator('text=TASK-101').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('text=TASK-114').waitFor({ state: 'hidden', timeout: 10000 });

    // Verify we're back on page 1
    await expect(page.locator('text=TASK-101')).toBeVisible();
    await expect(page.locator('text=Morning standup meeting')).toBeVisible();
    await expect(page.locator('text=TASK-109')).toBeVisible();

    // The last entry should not be visible
    await expect(page.locator('text=TASK-114')).not.toBeVisible();

    // "More..." should be visible again
    await expect(page.locator('text=More...')).toBeVisible();
  });

  test('should not scroll beyond the first page when PageUp is pressed on page 1', async ({ page }) => {
    // Ensure we start on page 1
    await page.locator('text=TASK-101').waitFor({ state: 'visible', timeout: 10000 });

    // Press PageUp (should stay on page 1)
    await page.keyboard.press('PageUp');

    // Page shouldn't change - TASK-101 should still be visible
    await page.locator('text=TASK-101').waitFor({ state: 'visible', timeout: 10000 });

    // Verify we're still on page 1
    await expect(page.locator('text=TASK-101')).toBeVisible();

    // "More..." should still be visible
    await expect(page.locator('text=More...')).toBeVisible();
  });

  test('should not scroll beyond the last page when PageDown is pressed on last page', async ({ page }) => {
    // Scroll to last page
    await page.keyboard.press('PageDown');
    await page.locator('text=TASK-114').waitFor({ state: 'visible', timeout: 10000 });

    // Press PageDown again (should stay on last page)
    await page.keyboard.press('PageDown');

    // Page shouldn't change - TASK-114 should still be visible
    await page.locator('text=TASK-114').waitFor({ state: 'visible', timeout: 10000 });

    // Verify we're still on the last page
    await expect(page.locator('text=TASK-114')).toBeVisible();
  });

  test('should show updated status line with PageUp/PageDn hint', async ({ page }) => {
    // Verify the status line includes the PageUp/PageDn hint
    await expect(page.locator('text=PageUp/PageDn=Scroll')).toBeVisible();
  });

  test('should reset to first page when switching days', async ({ page }) => {
    // Get the initial date
    const initialDateMatch = await page.locator('text=Date:').textContent();

    // Scroll to page 2
    await page.keyboard.press('PageDown');
    await page.locator('text=TASK-114').waitFor({ state: 'visible', timeout: 10000 });

    // Switch to previous day (F7)
    await page.keyboard.press('F7');
    // Wait for the date to change (previous day)
    let dateChanged = false;
    for (let i = 0; i < 10; i++) {
      const currentDate = await page.locator('text=Date:').textContent();
      if (currentDate !== initialDateMatch) {
        dateChanged = true;
        break;
      }
      await page.waitForTimeout(500);
    }
    expect(dateChanged).toBe(true);

    // Switch back to current day (F8)
    await page.keyboard.press('F8');
    // Wait for the date to change back and data to reload
    await page.locator('text=TASK-101').waitFor({ state: 'visible', timeout: 10000 });

    // Verify we're back on page 1
    await expect(page.locator('text=TASK-101')).toBeVisible();
    await expect(page.locator('text=Morning standup meeting')).toBeVisible();
  });
});
