import { test, expect, Page } from '@playwright/test';

/**
 * Tests for form action tab stops (status bar buttons).
 * When editing a CRUDTable record, the form status bar shows action buttons
 * (Esc=Back and any relation hotkeys). These are Tab-stop navigable and
 * Enter-activatable, so users do not need to type a key that could land
 * in a form field.
 *
 * Prerequisite: FREDRIC user exists and has at least one motorcycle (seeded).
 * The mods and services_performed tables must exist (migration 0003).
 */

// Reusable login helper
async function loginAsFredric(page: Page) {
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
  await page.locator('text=● Connected').waitFor({ state: 'visible', timeout: 10000 });

  const usernameInput = page.locator('input[type="text"]').first();
  await usernameInput.waitFor({ state: 'visible', timeout: 10000 });
  await usernameInput.fill('FREDRIC');
  await usernameInput.press('Tab');

  const passwordInput = page.locator('input[type="password"]');
  await passwordInput.waitFor({ state: 'visible', timeout: 10000 });
  await passwordInput.fill('fredric');
  await passwordInput.press('Enter');

  await page.locator('text=MAIN MENU').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(500);
}

// Navigate from MAIN MENU → My Garage → Motorcycles → edit first row
async function openMotorcycleEditForm(page: Page) {
  const container = page.locator('.terminal-container');

  // My Garage is option 2 in the main menu — ArrowDown once then Enter
  await container.focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');

  // We should now be on the My Garage sub-menu
  await page.locator('text=MY GARAGE').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(400);

  // Motorcycles is option 1 — already focused, press Enter
  await container.focus();
  await page.keyboard.press('Enter');

  // Wait for motorcycles list
  await page.locator('text=MY MOTORCYCLES').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(400);

  // First row is focused — press Enter to open edit form
  await container.focus();
  await page.keyboard.press('Enter');

  // Wait for the edit form
  await page.locator('text=EDIT MY MOTORCYCLES').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(400);
}

test.describe('Form action tab stops', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsFredric(page);
    await openMotorcycleEditForm(page);
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('status bar shows Esc=Back, M=Mods, S=Services as action buttons', async ({ page }) => {
    const actionBtns = page.locator('.form-action-btn');
    await expect(actionBtns).toHaveCount(3);

    const labels = await actionBtns.allTextContents();
    expect(labels[0]).toBe('Esc=Back');
    expect(labels[1]).toBe('M=Mods');
    expect(labels[2]).toBe('S=Services');
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('no action is focused on initial form load', async ({ page }) => {
    const focused = page.locator('.form-action-btn--focused');
    await expect(focused).toHaveCount(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('Shift+Tab from first field focuses last action (S=Services)', async ({ page }) => {
    // brand is the first field; focus it
    const brandInput = page.locator('input[data-field="brand"]');
    await brandInput.waitFor({ state: 'visible', timeout: 5000 });
    await brandInput.focus();
    await page.waitForTimeout(100);

    // Shift+Tab should jump to the last action
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(200);

    const focused = page.locator('.form-action-btn--focused');
    await expect(focused).toHaveCount(1);
    await expect(focused).toHaveText('S=Services');
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('Tab from last field focuses first action (Esc=Back)', async ({ page }) => {
    // Tab through all fields until we reach 'notes' (last field in formBuilder)
    const firstInput = page.locator('input[data-field="brand"]');
    await firstInput.waitFor({ state: 'visible', timeout: 5000 });
    await firstInput.focus();

    // motorcycle formBuilder has 11 fields: brand, model, year, nickname, color,
    // engine_cc, odometer_km, purchase_date, sell_date, cost, notes
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(60);
    }
    // Now on notes — one more Tab should focus first action
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);

    const focused = page.locator('.form-action-btn--focused');
    await expect(focused).toHaveCount(1);
    await expect(focused).toHaveText('Esc=Back');
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('Tab cycles forward through actions then wraps to first field', async ({ page }) => {
    const brandInput = page.locator('input[data-field="brand"]');
    await brandInput.waitFor({ state: 'visible', timeout: 5000 });
    await brandInput.focus();

    // Get to last field then Tab to first action
    for (let i = 0; i < 11; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(60);
    }

    // Should be on Esc=Back now
    await expect(page.locator('.form-action-btn--focused')).toHaveText('Esc=Back');

    // Tab → M=Mods
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
    await expect(page.locator('.form-action-btn--focused')).toHaveText('M=Mods');

    // Tab → S=Services
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
    await expect(page.locator('.form-action-btn--focused')).toHaveText('S=Services');

    // Tab → wraps back to first input field, no action focused
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    await expect(page.locator('.form-action-btn--focused')).toHaveCount(0);

    // brand input should now be focused
    await expect(brandInput).toBeFocused();
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('Enter on focused Esc=Back action navigates back to motorcycle list', async ({ page }) => {
    const brandInput = page.locator('input[data-field="brand"]');
    await brandInput.waitFor({ state: 'visible', timeout: 5000 });
    await brandInput.focus();

    // Tab to last field then to Esc=Back
    for (let i = 0; i < 11; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(60);
    }
    await expect(page.locator('.form-action-btn--focused')).toHaveText('Esc=Back');

    // Enter should trigger Esc=Back (F3) → goes back to list
    await page.keyboard.press('Enter');
    await page.locator('text=MY MOTORCYCLES').waitFor({ state: 'visible', timeout: 10000 });
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('Enter on focused M=Mods action opens mods list for that motorcycle', async ({ page }) => {
    const brandInput = page.locator('input[data-field="brand"]');
    await brandInput.waitFor({ state: 'visible', timeout: 5000 });
    await brandInput.focus();

    // Tab to last field then two Tabs into M=Mods
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(60);
    }
    await expect(page.locator('.form-action-btn--focused')).toHaveText('M=Mods');

    // Enter → open mods list
    await page.keyboard.press('Enter');
    await page.locator('text=MOTORCYCLE MODS').waitFor({ state: 'visible', timeout: 10000 });

    // The mods list header should reference the motorcycle name
    const statusArea = page.locator('.terminal-screen');
    const screenText = await statusArea.textContent();
    expect(screenText).toContain('Mods:');

    // Esc from mods returns to the motorcycle edit form
    await page.keyboard.press('Escape');
    await page.locator('text=EDIT MY MOTORCYCLES').waitFor({ state: 'visible', timeout: 10000 });
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('clicking M=Mods button opens mods list', async ({ page }) => {
    const modsBtn = page.locator('.form-action-btn', { hasText: 'M=Mods' });
    await modsBtn.click();
    await page.locator('text=MOTORCYCLE MODS').waitFor({ state: 'visible', timeout: 10000 });
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('clicking S=Services button opens services list', async ({ page }) => {
    const servicesBtn = page.locator('.form-action-btn', { hasText: 'S=Services' });
    await servicesBtn.click();
    await page.locator('text=SERVICES PERFORMED').waitFor({ state: 'visible', timeout: 10000 });
  });
});
