import { test, expect, type Page } from '@playwright/test';
import pkg from 'pg';

const { Pool } = pkg;

/**
 * Terminal dropdowns (fields with `staticOptions` / a `datasource`).
 *
 * Two regressions this pins down, both invisible to a DOM-only assertion:
 *
 *  1. The list opened *behind* the terminal. It is portaled to <body> at a low
 *     z-index while the terminal lives in `.term-layer` (z-index 1000 modal /
 *     1200 login gate), so it existed in the DOM but was never on screen — and
 *     because "open" routes every keystroke into its filter, the keyboard
 *     looked dead. So the check here is what is actually on top at the list's
 *     pixels, not whether the element exists.
 *
 *  2. Clicking another field left the dropdown "open" for the field just left,
 *     which kept swallowing typing until a page reload.
 *
 * Uses the Office Layout > Spaces edit form, whose Kind field is a plain
 * `staticOptions` select. A dedicated space is seeded under a name that sorts
 * first, so the test never depends on what else is in the database.
 */

const CONN = process.env.DATABASE_URL || 'postgresql://as500:as500@localhost:5433/as500';
const SPACE_KEY = 'e2e_dropdown';
const SPACE_NAME = '000 E2E Dropdown';

async function seed(): Promise<void> {
  const pool = new Pool({ connectionString: CONN });
  try {
    const { rows: [user] } = await pool.query(`SELECT id FROM users WHERE username = 'FREDRIC'`);
    if (!user) throw new Error('FREDRIC must exist — run the seed first');
    await pool.query(`DELETE FROM world_spaces WHERE key = $1`, [SPACE_KEY]);
    await pool.query(
      `INSERT INTO world_spaces (key, name, kind, owner_user_id) VALUES ($1, $2, 'office', $3)`,
      [SPACE_KEY, SPACE_NAME, user.id],
    );
  } finally {
    await pool.end();
  }
}

async function clean(): Promise<void> {
  const pool = new Pool({ connectionString: CONN });
  try {
    await pool.query(`DELETE FROM world_spaces WHERE key = $1`, [SPACE_KEY]);
  } finally {
    await pool.end();
  }
}

/** Sign on, then get from the main menu to the seeded space's edit form. */
async function openSpaceForm(page: Page): Promise<void> {
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
  await page.locator('text=● Connected').waitFor({ state: 'visible', timeout: 15000 });

  const username = page.locator('input[type="text"]').first();
  await username.fill('FREDRIC');
  await username.press('Tab');
  const password = page.locator('input[type="password"]');
  await password.fill('fredric');
  await password.press('Enter');

  // Sign-on lands on the Virtual Office view; the terminal is one click away.
  await page.getByRole('button', { name: 'Terminal' }).click();
  await page.locator('.terminal-container').waitFor({ state: 'visible' });
  await expect(page.locator('.terminal-row--focused')).toContainText('1. Time Registration');

  // Main menu (item 4, Virtual Office) -> Spaces -> first row, which is ours.
  for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter', 'Enter', 'Enter']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(500);
  }
  await expect(page.locator('input[data-field="key"]')).toHaveValue(SPACE_KEY);
}

// Serial: with the default fullyParallel each test lands in its own worker, and
// every worker runs beforeAll/afterAll — so one finishing would delete the
// seeded space out from under the others still using it.
test.describe.configure({ mode: 'serial' });

test.describe('Terminal dropdowns', () => {
  test.beforeAll(seed);
  test.afterAll(clean);

  test('the list is actually on screen, on top of the terminal', async ({ page }) => {
    await openSpaceForm(page);

    // Key -> Name -> Kind, the select field.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.locator('input[data-field="kind"]')).toBeFocused();

    await page.keyboard.press('ArrowDown');
    const dropdown = page.locator('.field-dropdown');
    await expect(dropdown).toBeVisible();
    await expect(dropdown.locator('.field-dropdown__item')).toHaveCount(3);

    // Not merely in the DOM: whatever is on top at the list's own pixels must
    // be the list. With the old z-index this was the terminal's <input>.
    const coveredBy = await page.evaluate(() => {
      const el = document.querySelector('.field-dropdown') as HTMLElement;
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + 6);
      return el.contains(top) ? null : `${top?.tagName}.${top?.className}`;
    });
    expect(coveredBy, 'the dropdown must not be hidden behind the terminal').toBeNull();
  });

  test('select fields are marked, free-text fields are not', async ({ page }) => {
    await openSpaceForm(page);

    // Kind has options; Key and Name are plain text. Without a cue there is no
    // way to know a field has a list before pressing ↓ on it.
    await expect(page.locator('input[data-field="kind"]')).toHaveClass(/has-options/);
    await expect(page.locator('input[data-field="key"]')).not.toHaveClass(/has-options/);
    await expect(page.locator('input[data-field="name"]')).not.toHaveClass(/has-options/);
  });

  test('picking from the list sets the field', async ({ page }) => {
    await openSpaceForm(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.type('server');
    await expect(page.locator('.field-dropdown__item')).toHaveCount(1);
    await page.keyboard.press('Enter');

    await expect(page.locator('input[data-field="kind"]')).toHaveValue('server_room');
    await expect(page.locator('.field-dropdown')).toHaveCount(0);
  });

  test('a filter with no matches says so instead of vanishing', async ({ page }) => {
    await openSpaceForm(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.type('zzz');

    await expect(page.locator('.field-dropdown__empty')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.field-dropdown')).toHaveCount(0);
  });

  test('clicking another field closes the list and typing works there', async ({ page }) => {
    await openSpaceForm(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.field-dropdown')).toBeVisible();

    const name = page.locator('input[data-field="name"]');
    await name.click();
    await page.keyboard.press('End');
    await page.keyboard.type('XYZ');

    await expect(name).toHaveValue(new RegExp(`${SPACE_NAME}XYZ$`));
    await expect(page.locator('.field-dropdown')).toHaveCount(0);
  });
});
