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
    await page.waitForSelector('text=● Connected', { timeout: 10000 });
    
    // Login
    await page.locator('input[type="text"]').fill('FREDRIC');
    await page.locator('input[type="password"]').fill('fredric');
    await page.locator('input[type="password"]').press('Enter');
    
    // Wait for main menu
    await page.waitForSelector('text=MAIN MENU', { timeout: 5000 });
    
    // Navigate to Time Registration (option 6)
    await page.getByRole('textbox').fill('6');
    await page.getByRole('textbox').press('Enter');
    
    // Wait for TIME REGISTRATION screen
    await page.waitForSelector('text=TIME REGISTRATION', { timeout: 5000 });
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
    
    // Wait for the screen to update
    await page.waitForTimeout(500);
    
    // Verify that we're now on the second page
    // The first entry should no longer be visible
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
    await page.waitForTimeout(500);
    
    // Verify we're on page 2
    await expect(page.locator('text=TASK-114')).toBeVisible();
    
    // Press PageUp to go back to page 1
    await page.keyboard.press('PageUp');
    await page.waitForTimeout(500);
    
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
    // We start on page 1
    const firstEntryBefore = await page.locator('text=TASK-101').isVisible();
    
    // Press PageUp (should stay on page 1)
    await page.keyboard.press('PageUp');
    await page.waitForTimeout(500);
    
    // Verify we're still on page 1
    const firstEntryAfter = await page.locator('text=TASK-101').isVisible();
    expect(firstEntryBefore).toBe(firstEntryAfter);
    expect(firstEntryAfter).toBe(true);
    
    // "More..." should still be visible
    await expect(page.locator('text=More...')).toBeVisible();
  });

  test('should not scroll beyond the last page when PageDown is pressed on last page', async ({ page }) => {
    // Scroll to last page
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(500);
    
    // Verify we're on the last page
    const lastEntryBefore = await page.locator('text=TASK-114').isVisible();
    
    // Press PageDown again (should stay on last page)
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(500);
    
    // Verify we're still on the last page
    const lastEntryAfter = await page.locator('text=TASK-114').isVisible();
    expect(lastEntryBefore).toBe(lastEntryAfter);
    expect(lastEntryAfter).toBe(true);
  });

  test('should show updated status line with PageUp/PageDn hint', async ({ page }) => {
    // Verify the status line includes the PageUp/PageDn hint
    await expect(page.locator('text=PageUp/PageDn=Scroll')).toBeVisible();
  });

  test('should reset to first page when switching days', async ({ page }) => {
    // Scroll to page 2
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(500);
    
    // Verify we're on page 2
    await expect(page.locator('text=TASK-114')).toBeVisible();
    
    // Switch to previous day (F7)
    await page.keyboard.press('F7');
    await page.waitForTimeout(500);
    
    // Switch back to current day (F8)
    await page.keyboard.press('F8');
    await page.waitForTimeout(500);
    
    // Verify we're back on page 1
    await expect(page.locator('text=TASK-101')).toBeVisible();
    await expect(page.locator('text=Morning standup meeting')).toBeVisible();
  });
});
