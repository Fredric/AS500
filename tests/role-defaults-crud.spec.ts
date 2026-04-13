import { test, expect, type Page } from '@playwright/test';
import pkg from 'pg';

const { Pool } = pkg;
const connectionString = process.env.DATABASE_URL || 'postgresql://as500:as500@localhost:5433/as500';

let pool: InstanceType<typeof Pool>;
let originalRole: string;
let originalIsAdmin: boolean;

async function openRoleDefaults(page: Page) {
  const container = page.locator('.terminal-container');
  await container.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.locator('text=ROLE DEFAULT PERMISSIONS').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(500);
}

test.describe('Role Default Permissions CRUD', () => {
  test.beforeAll(async () => {
    pool = new Pool({ connectionString });

    const userResult = await pool.query<{ role: string; is_admin: boolean }>(
      'SELECT role, is_admin FROM users WHERE username = $1',
      ['FREDRIC']
    );

    if (userResult.rows.length === 0) {
      throw new Error('User FREDRIC not found. Run seed first.');
    }

    originalRole = userResult.rows[0].role;
    originalIsAdmin = userResult.rows[0].is_admin;

    await pool.query(
      'UPDATE users SET role = $2, is_admin = TRUE WHERE username = $1',
      ['FREDRIC', 'admin']
    );

    await pool.query(
      'DELETE FROM role_permissions WHERE role = $1 AND permission_key IN ($2, $3)',
      ['aiagent', 'user_mgmt:read', 'time_reg:write']
    );
  });

  test.afterAll(async () => {
    await pool.query(
      'DELETE FROM role_permissions WHERE role = $1 AND permission_key IN ($2, $3)',
      ['aiagent', 'user_mgmt:read', 'time_reg:write']
    );

    await pool.query(
      'UPDATE users SET role = $2, is_admin = $3 WHERE username = $1',
      ['FREDRIC', originalRole, originalIsAdmin]
    );

    await pool.query('DELETE FROM auth_tokens WHERE user_id = (SELECT id FROM users WHERE username = $1)', ['FREDRIC']);
    await pool.end();
  });

  test.beforeEach(async ({ page }) => {
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
  });

  test('shows role defaults in the main menu', async ({ page }) => {
    await expect(page.locator('text=3. Role Defaults')).toBeVisible();
  });

  test('creates, edits, and deletes a role default', async ({ page }) => {
    await openRoleDefaults(page);

    const container = page.locator('.terminal-container');
    await container.focus();
    await page.keyboard.press('n');

    await page.locator('text=CREATE ROLE DEFAULT PERMISSIONS').waitFor({ state: 'visible', timeout: 10000 });

    const inputs = page.locator('input[type="text"]');
    await inputs.nth(0).fill('AIAGENT');
    await inputs.nth(0).press('Tab');
    await inputs.nth(1).fill('user_mgmt:read');

    await page.keyboard.press('Enter');
    await page.locator('text=Record created').waitFor({ state: 'visible', timeout: 10000 });
    await expect(page.locator('text=AIAGENT user_mgmt:read').first()).toBeVisible();

    const createdRowOpt = page.locator('input[data-field="opt_6"]');
    await createdRowOpt.fill('2');
    await page.keyboard.press('Enter');

    await page.locator('text=EDIT ROLE DEFAULT PERMISSIONS').waitFor({ state: 'visible', timeout: 10000 });
    const editInputs = page.locator('input[type="text"]');
    await editInputs.nth(1).fill('time_reg:write');

    await page.keyboard.press('Enter');
    await page.locator('text=Record updated').waitFor({ state: 'visible', timeout: 10000 });
    await expect(page.locator('text=AIAGENT time_reg:write').first()).toBeVisible();

    const updatedRowOpt = page.locator('input[data-field="opt_6"]');
    await updatedRowOpt.fill('4');
    await page.keyboard.press('Enter');

    // Wait for confirmation screen
    await page.locator('text=CONFIRM DELETE - ROLE DEFAULT PERMISSIONS').waitFor({ state: 'visible', timeout: 10000 });

    // Fill Y in the confirm input and press Enter
    const confirmInput = page.locator('input[data-field="confirm"]');
    await confirmInput.waitFor({ state: 'visible', timeout: 5000 });
    await confirmInput.click();
    await confirmInput.fill('Y');
    await page.keyboard.press('Enter');

    await page.locator('text=Record deleted').waitFor({ state: 'visible', timeout: 10000 });
    await expect(page.locator('text=AIAGENT time_reg:write')).toHaveCount(0);
  });
});
