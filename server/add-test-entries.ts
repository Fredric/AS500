// Add many time entries for testing scrolling
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://as500:as500@postgres:5432/as500',
});

async function addTestEntries() {
  console.log('Adding test entries for scrolling...');

  // Get user ID
  const userResult = await pool.query('SELECT id FROM users WHERE username = $1', ['KALLE']);
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

  // Delete existing entries
  await pool.query('DELETE FROM day_items WHERE day_id = $1', [dayId]);

  // Add 15 entries to test scrolling (more than 10)
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

  console.log(`Added ${tasks.length} test entries for today`);

  await pool.end();
}

addTestEntries().catch(console.error);
