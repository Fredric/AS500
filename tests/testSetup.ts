/**
 * Test data setup utilities
 * This file handles creating and cleaning up test data for Playwright tests
 */

import pkg from 'pg';

const { Pool } = pkg;

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

    // Add 15 test entries (for scrolling tests)
    const tasks = [
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
    ];

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

    console.log('✅ Test data created: 15 entries for', today);
  } catch (error) {
    console.error('❌ Test setup failed:', error);
    throw error;
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

      console.log('✅ Test data cleaned up');
    }
  } catch (error) {
    console.error('⚠️  Cleanup warning:', error);
    // Don't throw on cleanup errors
  } finally {
    await pool.end();
  }
}
