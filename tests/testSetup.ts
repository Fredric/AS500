/**
 * Test data setup utilities
 * This file handles creating and cleaning up test data for Playwright tests
 */

import pkg from 'pg';

const { Pool } = pkg;

/** One row of seeded time entries for KALLE (today). Source of truth for scroll tests. */
export type ScrollSubfileTestEntry = {
  start: string;
  end: string;
  task: string;
  desc: string;
};

/** Sentinel `motorcycles.brand` for `tests/form-action-tabs.spec.ts`; owned by KALLE, created/deleted by setup/teardown only. */
export const FORM_ACTION_TABS_MOTORCYCLE_BRAND = 'E2E_FORM_TAB';

export const SCROLL_SUBFILE_TEST_ENTRIES: ScrollSubfileTestEntry[] = [
  { start: '08:00', end: '09:00', task: 'TASK-101', desc: 'Morning standup meeting' },
  { start: '09:00', end: '10:00', task: 'TASK-102', desc: 'Code review PR #123' },
  { start: '10:00', end: '11:00', task: 'TASK-103', desc: 'Feature development' },
  { start: '11:00', end: '12:00', task: 'TASK-104', desc: 'Bug fixing session' },
  { start: '12:00', end: '13:00', task: '', desc: 'Lunch break' },
  { start: '13:00', end: '14:00', task: 'TASK-105', desc: 'Documentation update' },
  { start: '14:00', end: '15:00', task: 'TASK-106', desc: 'Team collaboration' },
  { start: '15:00', end: '15:30', task: 'TASK-107', desc: 'Sprint planning' },
  { start: '15:30', end: '16:00', task: 'TASK-108', desc: 'Technical discussion' },
  { start: '16:00', end: '16:30', task: 'TASK-109', desc: 'Testing new feature' },
  { start: '16:30', end: '17:00', task: 'TASK-110', desc: 'Email and admin' },
  { start: '17:00', end: '17:30', task: 'TASK-111', desc: 'Performance optimization' },
  { start: '17:30', end: '18:00', task: 'TASK-112', desc: 'Security review' },
  { start: '18:00', end: '18:30', task: 'TASK-113', desc: 'Database migration' },
  { start: '18:30', end: '19:00', task: 'TASK-114', desc: 'Final code cleanup' },
  { start: '19:00', end: '19:30', task: 'TASK-115', desc: 'Scroll seed page 2 tail A' },
  { start: '19:30', end: '20:00', task: 'TASK-116', desc: 'Scroll seed page 2 tail B' },
  { start: '20:00', end: '20:30', task: 'TASK-117', desc: 'Scroll seed page 2 tail C' },
  { start: '20:30', end: '21:00', task: 'TASK-118', desc: 'Scroll seed page 2 tail D' },
  { start: '21:00', end: '21:30', task: 'TASK-119', desc: 'Scroll seed page 2 tail E' },
  { start: '21:30', end: '22:00', task: 'TASK-120', desc: 'Scroll seed page 2 tail F' },
  { start: '22:00', end: '22:30', task: 'TASK-121', desc: 'Scroll seed page 2 tail G' },
  { start: '22:30', end: '23:00', task: 'TASK-122', desc: 'Scroll seed page 2 tail H' },
  { start: '23:00', end: '23:15', task: 'TASK-123', desc: 'Scroll seed page 2 tail I' },
  { start: '23:15', end: '23:30', task: 'TASK-124', desc: 'Scroll seed page 3 row A' },
  { start: '23:30', end: '23:45', task: 'TASK-125', desc: 'Scroll seed page 3 row B' },
];

export async function setupTestData() {
  // Connection string for local development (Docker maps 5433 -> 5432)
  const connectionString = process.env.DATABASE_URL || 'postgresql://as500:as500@localhost:5433/as500';

  const pool = new Pool({
    connectionString,
  });

  try {
    console.log('🔧 Setting up test data...');

    // Get user ID (KALLE should exist from seed)
    const userResult = await pool.query('SELECT id FROM users WHERE username = $1', ['KALLE']);
    if (userResult.rows.length === 0) {
      throw new Error('User KALLE not found. Run seed first: docker-compose exec server npm run seed');
    }
    const userId = userResult.rows[0].id;

    // Get today's date
    const today = new Date().toISOString().split('T')[0];

    // Get or create day
    let dayResult = await pool.query('SELECT id FROM days WHERE user_id = $1 AND workday = $2', [userId, today]);
    let dayId: number;

    if (dayResult.rows.length === 0) {
      const insertResult = await pool.query(
        'INSERT INTO days (user_id, workday, daysum) VALUES ($1, $2, $3) RETURNING id',
        [userId, today, 0]
      );
      dayId = insertResult.rows[0].id;
    } else {
      dayId = dayResult.rows[0].id;
    }

    // Delete existing entries for today
    await pool.query('DELETE FROM day_items WHERE day_id = $1', [dayId]);

    // Subfile scroll tests: 26 rows → 3 pages at LIST_PAGE_SIZE 12 (12 + 12 + 2).
    // Keep in sync with assertions in tests/scrollable-subfile.spec.ts.
    const tasks = [...SCROLL_SUBFILE_TEST_ENTRIES];

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const start = new Date(`2000-01-01 ${task.start}`);
      const end = new Date(`2000-01-01 ${task.end}`);
      const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);

      await pool.query(
        'INSERT INTO day_items (day_id, start_hour, end_hour, jiratask, description, rowsum, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [dayId, task.start, task.end, task.task, task.desc, hours, i + 1]
      );
    }

    // Update day total
    const totalResult = await pool.query(
      'SELECT SUM(rowsum) as total FROM day_items WHERE day_id = $1',
      [dayId]
    );
    const total = totalResult.rows[0].total || 0;
    await pool.query('UPDATE days SET daysum = $1 WHERE id = $2', [total, dayId]);

    console.log('✅ Test data created:', tasks.length, 'entries for', today);
  } catch (error) {
    console.error('❌ Test setup failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

/**
 * Temporarily promote a user to admin so tests can access admin-only menus
 * (e.g. Administration → Role Defaults). Returns a function that restores
 * the user's previous is_admin flag.
 */
/**
 * Inserts one motorcycle row for KALLE (Playwright form-action-tabs tests).
 * Idempotent: removes any prior row with {@link FORM_ACTION_TABS_MOTORCYCLE_BRAND} first.
 */
export async function setupFormActionTabsTestData(): Promise<void> {
  const connectionString = process.env.DATABASE_URL || 'postgresql://as500:as500@localhost:5433/as500';
  const pool = new Pool({ connectionString });

  try {
    const userResult = await pool.query<{ id: number }>('SELECT id FROM users WHERE username = $1', ['KALLE']);
    if (userResult.rows.length === 0) {
      throw new Error('User KALLE not found. Run seed first: docker-compose exec server npm run seed');
    }
    const userId = userResult.rows[0].id;

    await pool.query('DELETE FROM motorcycles WHERE user_id = $1 AND brand = $2', [
      userId,
      FORM_ACTION_TABS_MOTORCYCLE_BRAND,
    ]);

    await pool.query(
      `INSERT INTO motorcycles (user_id, brand, model, year, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, FORM_ACTION_TABS_MOTORCYCLE_BRAND, 'TabStop', 2020, 'e2e form action tabs']
    );

    console.log('✅ Form action tabs test motorcycle created for KALLE');
  } catch (error) {
    console.error('❌ Form action tabs test setup failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

/** Removes the sentinel motorcycle row created by {@link setupFormActionTabsTestData} (cascades mods/services). */
export async function teardownFormActionTabsTestData(): Promise<void> {
  const connectionString = process.env.DATABASE_URL || 'postgresql://as500:as500@localhost:5433/as500';
  const pool = new Pool({ connectionString });

  try {
    const userResult = await pool.query<{ id: number }>('SELECT id FROM users WHERE username = $1', ['KALLE']);
    if (userResult.rows.length === 0) {
      return;
    }
    const userId = userResult.rows[0].id;

    await pool.query('DELETE FROM motorcycles WHERE user_id = $1 AND brand = $2', [
      userId,
      FORM_ACTION_TABS_MOTORCYCLE_BRAND,
    ]);

    console.log('✅ Form action tabs test motorcycle cleaned up');
  } catch (error) {
    console.error('⚠️  Form action tabs cleanup warning:', error);
  } finally {
    await pool.end();
  }
}

export async function promoteToAdmin(username: string): Promise<() => Promise<void>> {
  const connectionString = process.env.DATABASE_URL || 'postgresql://as500:as500@localhost:5433/as500';
  const pool = new Pool({ connectionString });

  try {
    const res = await pool.query<{ is_admin: boolean }>(
      'SELECT is_admin FROM users WHERE username = $1',
      [username]
    );
    if (res.rows.length === 0) {
      throw new Error(`User ${username} not found. Run seed first.`);
    }
    const previous = res.rows[0].is_admin;

    await pool.query('UPDATE users SET is_admin = TRUE WHERE username = $1', [username]);
    // Invalidate any cached sessions so the next login re-resolves permissions
    await pool.query('DELETE FROM auth_tokens WHERE user_id = (SELECT id FROM users WHERE username = $1)', [username]);

    return async () => {
      const restorePool = new Pool({ connectionString });
      try {
        await restorePool.query('UPDATE users SET is_admin = $1 WHERE username = $2', [previous, username]);
      } finally {
        await restorePool.end();
      }
    };
  } finally {
    await pool.end();
  }
}

export async function teardownTestData() {
  // Connection string for local development (Docker maps 5433 -> 5432)
  const connectionString = process.env.DATABASE_URL || 'postgresql://as500:as500@localhost:5433/as500';

  const pool = new Pool({
    connectionString,
  });

  try {
    // Get user ID
    const userResult = await pool.query('SELECT id FROM users WHERE username = $1', ['KALLE']);
    if (userResult.rows.length === 0) {
      return; // User doesn't exist, nothing to clean
    }
    const userId = userResult.rows[0].id;

    // Get today's date
    const today = new Date().toISOString().split('T')[0];

    // Delete test entries for today
    const dayResult = await pool.query('SELECT id FROM days WHERE user_id = $1 AND workday = $2', [userId, today]);
    if (dayResult.rows.length > 0) {
      const dayId = dayResult.rows[0].id;
      await pool.query('DELETE FROM day_items WHERE day_id = $1', [dayId]);

      // Reset day total
      await pool.query('UPDATE days SET daysum = $1 WHERE id = $2', [0, dayId]);
    }

    // Delete all auth tokens created during tests for this user
    await pool.query('DELETE FROM auth_tokens WHERE user_id = $1', [userId]);

    console.log('✅ Test data cleaned up');
  } catch (error) {
    console.error('⚠️  Cleanup warning:', error);
    // Don't throw on cleanup errors
  } finally {
    await pool.end();
  }
}
