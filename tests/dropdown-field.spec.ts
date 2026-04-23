import { test, expect, type Page } from '@playwright/test';
import pkg from 'pg';

const { Pool } = pkg;
const connectionString = process.env.DATABASE_URL || 'postgresql://as500:as500@localhost:5433/as500';

let pool: InstanceType<typeof Pool>;

async function loginAsAdmin(page: Page) {
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
  await page.waitForTimeout(600);
}

async function openUserMgmt(page: Page) {
  const container = page.locator('.terminal-container');
  await container.focus();
  // Administration is option 3 (ArrowDown x2 from Time Registration)
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  // Now in Administration sub-menu
  await page.locator('text=ADMINISTRATION').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(300);
  // User Management is option 1 — already focused, press Enter
  await container.focus();
  await page.keyboard.press('Enter');
  await page.locator('text=USER MANAGEMENT').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(500);
}

async function editFirstUser(page: Page) {
  const container = page.locator('.terminal-container');
  await container.focus();
  await page.keyboard.press('Enter'); // Enter=Edit on first row
  await page.locator('text=EDIT USER MANAGEMENT').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(300);
}

/** Focus role field and open dropdown via ArrowDown */
async function openRoleDropdown(page: Page) {
  const roleField = page.locator('input[data-field="role"]');
  await roleField.focus();
  await page.waitForTimeout(100);
  await page.keyboard.press('ArrowDown');
  await page.locator('.field-dropdown').waitFor({ state: 'visible', timeout: 5000 });
}

test.describe('Dropdown Field', () => {
  test.beforeAll(async () => {
    pool = new Pool({ connectionString });
    // Ensure FREDRIC is admin
    await pool.query(
      "UPDATE users SET role = 'admin' WHERE username = $1",
      ['FREDRIC']
    );
  });

  test.afterAll(async () => {
    await pool.query('DELETE FROM auth_tokens WHERE user_id = (SELECT id FROM users WHERE username = $1)', ['FREDRIC']);
    await pool.end();
  });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await openUserMgmt(page);
    await editFirstUser(page);
  });

  test('dropdown opens on ArrowDown and shows all options', async ({ page }) => {
    const roleField = page.locator('input[data-field="role"]');
    await roleField.focus();
    await page.waitForTimeout(200);

    // Dropdown should NOT be visible on focus alone
    await expect(page.locator('.field-dropdown')).not.toBeVisible();

    // Press ArrowDown to open
    await page.keyboard.press('ArrowDown');

    const dropdown = page.locator('.field-dropdown');
    await expect(dropdown).toBeVisible();

    const items = page.locator('.field-dropdown__item');
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toContainText('USER');
    await expect(items.nth(1)).toContainText('SUPERUSER');
    await expect(items.nth(2)).toContainText('AIAGENT');
    await expect(items.nth(3)).toContainText('ADMIN');
  });

  test('typing filters dropdown options after opening', async ({ page }) => {
    await openRoleDropdown(page);

    // Type to filter (intercepted by dropdown handler)
    await page.keyboard.press('S');
    await page.keyboard.press('U');
    await page.waitForTimeout(200);

    const items = page.locator('.field-dropdown__item');
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText('SUPERUSER');
  });

  test('ArrowDown/ArrowUp navigates options', async ({ page }) => {
    await openRoleDropdown(page);

    const highlighted = page.locator('.field-dropdown__item--highlighted');

    // Move to top first so ArrowDown has room to move
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    await expect(highlighted).toContainText('USER');

    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    await expect(highlighted).toContainText('SUPERUSER');

    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    await expect(highlighted).toContainText('USER');
  });

  test('Enter selects highlighted option and fills field', async ({ page }) => {
    const roleField = page.locator('input[data-field="role"]');
    await openRoleDropdown(page);

    // Navigate to first item (USER)
    // Press ArrowUp several times to get to top
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);

    const highlighted = page.locator('.field-dropdown__item--highlighted');
    await expect(highlighted).toContainText('USER');

    // Move to SUPERUSER
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    await expect(highlighted).toContainText('SUPERUSER');

    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    // Dropdown should close
    await expect(page.locator('.field-dropdown')).not.toBeVisible();

    // Field should have the selected value
    await expect(roleField).toHaveValue('SUPERUSER');
  });

  test('Escape closes dropdown without selecting', async ({ page }) => {
    const roleField = page.locator('input[data-field="role"]');
    const originalValue = await roleField.inputValue();

    await openRoleDropdown(page);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    await expect(page.locator('.field-dropdown')).not.toBeVisible();
    // Value should be unchanged
    await expect(roleField).toHaveValue(originalValue);
  });

  test('Tab closes dropdown and moves to next field', async ({ page }) => {
    await openRoleDropdown(page);

    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);

    await expect(page.locator('.field-dropdown')).not.toBeVisible();
  });

  test('mouse click selects option', async ({ page }) => {
    const roleField = page.locator('input[data-field="role"]');
    await openRoleDropdown(page);

    const userItem = page.locator('.field-dropdown__item').first(); // USER is first
    await userItem.click();
    await page.waitForTimeout(200);

    await expect(page.locator('.field-dropdown')).not.toBeVisible();
    await expect(roleField).toHaveValue('USER');
  });

  test('dropdown disappears after F12 cancel', async ({ page }) => {
    await openRoleDropdown(page);

    await page.keyboard.press('F12');
    await page.waitForTimeout(500);

    // Should be back on list screen, no dropdown
    await expect(page.locator('.field-dropdown')).not.toBeVisible();
    await expect(page.locator('text=USER MANAGEMENT')).toBeVisible();
  });

  test('form submission works with dropdown-selected value', async ({ page }) => {
    const roleField = page.locator('input[data-field="role"]');
    const originalValue = await roleField.inputValue();

    // Open dropdown and select current value via Enter
    await openRoleDropdown(page);

    const highlighted = page.locator('.field-dropdown__item--highlighted');
    await expect(highlighted).toContainText(originalValue);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    // Dropdown closed, field has value
    await expect(page.locator('.field-dropdown')).not.toBeVisible();

    // Submit the form (Enter now goes to server since dropdown is closed)
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Should return to list with success message
    await expect(page.locator('text=Record updated')).toBeVisible();
  });
});
