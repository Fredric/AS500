import { test, expect, Page } from '@playwright/test';
import {
  setupFormActionTabsTestData,
  teardownFormActionTabsTestData,
  FORM_ACTION_TABS_MOTORCYCLE_BRAND,
} from './testSetup.js';

/**
 * Tests for form action tab stops (status bar buttons).
 * When editing a CRUDTable record, the form status bar shows action buttons
 * (Esc=Back and any relation hotkeys). These are Tab-stop navigable and
 * Enter-activatable, so users do not need to type a key that could land
 * in a form field.
 *
 * Uses KALLE and a single motorcycle row created in DB by setupFormActionTabsTestData
 * (sentinel brand) and removed by teardownFormActionTabsTestData.
 */

async function loginAsKalle(page: Page) {
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
  await page.waitForTimeout(500);
}

/** MAIN MENU → My Garage → Motorcycles list → focus seeded row → Enter → edit form */
async function openMotorcycleEditForm(page: Page) {
  const container = page.locator('.terminal-container');

  // My Garage is option 2 — ArrowDown once then Enter
  await container.focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');

  await page.locator('text=MY GARAGE').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(400);

  await container.focus();
  await page.keyboard.press('Enter');

  await page.locator('text=MY MOTORCYCLES').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(400);

  await container.focus();
  // Select the row for our seeded motorcycle (may not be first if KALLE has other bikes)
  for (let i = 0; i < 40; i++) {
    const row = page.locator('.terminal-row--focused');
    const text = await row.textContent();
    if (text?.includes(FORM_ACTION_TABS_MOTORCYCLE_BRAND)) {
      break;
    }
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(80);
  }

  await page.keyboard.press('Enter');

  await page.locator('text=EDIT MY MOTORCYCLES').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(400);
}

test.describe('Form action tab stops', () => {
  test.beforeAll(async () => {
    await setupFormActionTabsTestData();
  });

  test.afterAll(async () => {
    await teardownFormActionTabsTestData();
  });

  test.beforeEach(async ({ page }) => {
    await loginAsKalle(page);
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
    const brandInput = page.locator('input[data-field="brand"]');
    await brandInput.waitFor({ state: 'visible', timeout: 5000 });
    await brandInput.focus();
    await page.waitForTimeout(100);

    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(200);

    const focused = page.locator('.form-action-btn--focused');
    await expect(focused).toHaveCount(1);
    await expect(focused).toHaveText('S=Services');
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('Tab from last field focuses first action (Esc=Back)', async ({ page }) => {
    const firstInput = page.locator('input[data-field="brand"]');
    await firstInput.waitFor({ state: 'visible', timeout: 5000 });
    await firstInput.focus();

    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(60);
    }
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

    for (let i = 0; i < 11; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(60);
    }

    await expect(page.locator('.form-action-btn--focused')).toHaveText('Esc=Back');

    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
    await expect(page.locator('.form-action-btn--focused')).toHaveText('M=Mods');

    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
    await expect(page.locator('.form-action-btn--focused')).toHaveText('S=Services');

    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    await expect(page.locator('.form-action-btn--focused')).toHaveCount(0);

    await expect(brandInput).toBeFocused();
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('Enter on focused Esc=Back action navigates back to motorcycle list', async ({ page }) => {
    const brandInput = page.locator('input[data-field="brand"]');
    await brandInput.waitFor({ state: 'visible', timeout: 5000 });
    await brandInput.focus();

    for (let i = 0; i < 11; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(60);
    }
    await expect(page.locator('.form-action-btn--focused')).toHaveText('Esc=Back');

    await page.keyboard.press('Enter');
    await page.locator('text=MY MOTORCYCLES').waitFor({ state: 'visible', timeout: 10000 });
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('Enter on focused M=Mods action opens mods list for that motorcycle', async ({ page }) => {
    const brandInput = page.locator('input[data-field="brand"]');
    await brandInput.waitFor({ state: 'visible', timeout: 5000 });
    await brandInput.focus();

    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(60);
    }
    await expect(page.locator('.form-action-btn--focused')).toHaveText('M=Mods');

    await page.keyboard.press('Enter');
    await page.locator('text=MOTORCYCLE MODS').waitFor({ state: 'visible', timeout: 10000 });

    const statusArea = page.locator('.terminal-screen');
    const screenText = await statusArea.textContent();
    expect(screenText).toContain('Mods:');

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
