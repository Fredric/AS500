import { test, expect, type Page } from '@playwright/test';
import pkg from 'pg';

const { Pool } = pkg;

/**
 * Office Layout > Objects: the Shows / Source / Filter fields.
 *
 * Each is a dropdown of real choices, so nobody has to know a config id, a
 * service key or `folderId=42` by heart. What is picked must be stored exactly
 * as typing it by hand would store it — the REST/MCP contract (bindingKind,
 * bindingTarget, bindingScope) is unchanged; only what the terminal offers is.
 */

const CONN = process.env.DATABASE_URL || 'postgresql://as500:as500@localhost:5433/as500';
const SPACE_KEY = 'e2e_pickers';
const SPACE_NAME = 'E2E Pickers';
const THING_LABEL = 'E2E Pick Thing';
const FOLDER_NAME = 'E2E Pick Folder';

test.describe.configure({ mode: 'serial' });

let folderId = 0;

async function withPool<T>(fn: (pool: InstanceType<typeof Pool>) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: CONN });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

async function clean(pool: InstanceType<typeof Pool>): Promise<void> {
  await pool.query(`DELETE FROM world_spaces WHERE key = $1`, [SPACE_KEY]);
  await pool.query(`DELETE FROM document_folders WHERE name = $1`, [FOLDER_NAME]);
}

test.beforeAll(async () => {
  await withPool(async (pool) => {
    const { rows: [user] } = await pool.query(`SELECT id FROM users WHERE username = 'FREDRIC'`);
    if (!user) throw new Error('FREDRIC must exist — run the seed first');
    await clean(pool);

    const { rows: [folder] } = await pool.query(
      `INSERT INTO document_folders (user_id, name) VALUES ($1, $2) RETURNING id`,
      [user.id, FOLDER_NAME],
    );
    folderId = folder.id;

    const { rows: [space] } = await pool.query(
      `INSERT INTO world_spaces (key, name, kind, owner_user_id) VALUES ($1, $2, 'office', $3) RETURNING id`,
      [SPACE_KEY, SPACE_NAME, user.id],
    );
    await pool.query(
      `INSERT INTO world_things (space_id, type, label, zone, owner_user_id, binding)
       VALUES ($1, 'box', $2, 'north_east', $3, '{"kind":"none"}'::jsonb)`,
      [space.id, THING_LABEL, user.id],
    );
  });
});

test.afterAll(async () => {
  await withPool(clean);
});

/** Where our space sits in the Spaces list, which is ordered by name. */
async function ourRowIndex(): Promise<number> {
  return withPool(async (pool) => {
    const { rows } = await pool.query(`SELECT name FROM world_spaces ORDER BY name`);
    return rows.findIndex((r) => r.name === SPACE_NAME);
  });
}

async function press(page: Page, keys: string[]): Promise<void> {
  for (const key of keys) {
    await page.keyboard.press(key);
    await page.waitForTimeout(450);
  }
}

/** Sign on and open the edit form of our object (in our space). */
async function openThingForm(page: Page): Promise<void> {
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
  await page.locator('text=● Connected').waitFor({ state: 'visible', timeout: 15000 });

  const username = page.locator('input[type="text"]').first();
  await username.fill('FREDRIC');
  await username.press('Tab');
  const password = page.locator('input[type="password"]');
  await password.fill('fredric');
  await password.press('Enter');

  await page.getByRole('button', { name: 'Terminal' }).click();
  await page.locator('.terminal-container').waitFor({ state: 'visible' });

  const index = await ourRowIndex();
  expect(index, 'the seeded space must be in the list').toBeGreaterThanOrEqual(0);

  // Main menu > Virtual Office > Spaces, then down to our row and open it.
  await press(page, ['ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter', 'Enter']);
  await press(page, Array(index).fill('ArrowDown'));
  await press(page, ['Enter']);
  await expect(page.locator('input[data-field="key"]')).toHaveValue(SPACE_KEY);

  // Tab past the three fields onto the "T=Objects" action, then into the list.
  await press(page, ['Tab', 'Tab', 'Tab', 'Tab', 'Enter']);
  // First (only) object, then "C=Change" to open its form.
  await press(page, ['c']);
  await expect(page.locator('input[data-field="label"]')).toHaveValue(THING_LABEL);
}

/** Tab from Label to a field of the Objects form, by its data-field name. */
async function focusField(page: Page, name: string): Promise<void> {
  const order = ['label', 'type', 'zone', 'slot', 'x', 'y', 'bindingKind', 'bindingTarget', 'bindingScope'];
  for (let i = 0; i < order.indexOf(name); i++) await page.keyboard.press('Tab');
  await expect(page.locator(`input[data-field="${name}"]`)).toBeFocused();
}

async function dropdownItems(page: Page): Promise<string[]> {
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.field-dropdown')).toBeVisible();
  return page.locator('.field-dropdown__item').allTextContents();
}

test('the three binding fields carry plain-English labels and fitting hints', async ({ page }) => {
  await openThingForm(page);

  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('.terminal-row')].map((r) =>
      [...r.childNodes].map((n) => (n instanceof HTMLInputElement ? `[${n.value}]` : n.textContent)).join('')));
  const text = rows.join('\n');

  expect(text).toMatch(/Shows \. .*\(what this object is a view of\)/);
  expect(text).toMatch(/Source \. .*\(which one, see Shows\)/);
  expect(text).toMatch(/Filter \. .*\(blank = all\)/);
  // The old jargon must be gone from the screen.
  expect(text).not.toMatch(/Binds to|Target \.|Scope \./);

  // A hint that runs past column 80 is silently cut off — each must be whole.
  for (const hint of ['(what this object is a view of)', '(which one, see Shows)', '(blank = all)']) {
    expect(text).toContain(hint);
  }
});

test('Shows explains each choice in words, and keeps the stored value', async ({ page }) => {
  await openThingForm(page);
  await focusField(page, 'bindingKind');
  const items = await dropdownItems(page);

  expect(items).toEqual([
    'crud - A list of records',
    'record - One single record',
    'workstation - A workstation (a computer)',
    'service - A service and its health',
    "agent - An agent's seat",
    'door - A door to another space',
    'none - Nothing (a plain object)',
  ]);
});

test('Source offers configs, services and spaces, each tagged', async ({ page }) => {
  await openThingForm(page);
  await focusField(page, 'bindingTarget');
  const items = await dropdownItems(page);

  const has = (tag: string, id: string) =>
    items.some((i) => i.startsWith(tag) && i.trimEnd().endsWith(`(${id})`));

  expect(has('[list/record]', 'documents'), 'a config').toBe(true);
  expect(has('[service]', 'docs-api'), 'a service').toBe(true);
  expect(has('[door]', SPACE_KEY), 'our own space, as a door destination').toBe(true);
});

test('Filter offers the user\'s document folders by path', async ({ page }) => {
  await openThingForm(page);
  await focusField(page, 'bindingScope');
  const items = await dropdownItems(page);

  expect(items.some((i) => i.startsWith('[folder]') && i.trimEnd().endsWith(`/${FOLDER_NAME}`))).toBe(true);
});

test('picking all three from the dropdowns stores the same binding as typing it', async ({ page }) => {
  await openThingForm(page);

  // Shows: filter to "crud" (the list opens on the current value, not the top).
  await focusField(page, 'bindingKind');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('crud');
  await page.keyboard.press('Enter');
  await expect(page.locator('input[data-field="bindingKind"]')).toHaveValue('crud');

  // Selecting moves on to Source, then Filter.
  await expect(page.locator('input[data-field="bindingTarget"]')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('documents');
  await page.keyboard.press('Enter');
  await expect(page.locator('input[data-field="bindingTarget"]')).toHaveValue('documents');

  await expect(page.locator('input[data-field="bindingScope"]')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type(FOLDER_NAME);
  await page.keyboard.press('Enter');
  await expect(page.locator('input[data-field="bindingScope"]')).toHaveValue(`folderId=${folderId}`);

  // Save.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);

  const binding = await withPool(async (pool) => {
    const { rows } = await pool.query(
      `SELECT binding FROM world_things WHERE label = $1`,
      [THING_LABEL],
    );
    return rows[0]?.binding as { kind: string; configId: string; scope: Record<string, unknown> } | undefined;
  });

  expect(binding).toBeDefined();
  expect(binding!.kind).toBe('crud');
  expect(binding!.configId).toBe('documents');
  expect(String(binding!.scope.folderId)).toBe(String(folderId));
});
