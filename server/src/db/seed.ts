import bcrypt from 'bcrypt';
import pool, { initializeDatabase } from './index.js';

const SALT_ROUNDS = 10;

async function seed() {
  console.log('Seeding database...');

  // Initialize database schema
  await initializeDatabase();

  // Check if user already exists
  const existingUser = await pool.query<{ id: number }>(
    'SELECT id FROM users WHERE username = $1',
    ['FREDRIC']
  );

  let userId: number;

  if (existingUser.rows.length === 0) {
    // Hash the password
    const passwordHash = await bcrypt.hash('fredric', SALT_ROUNDS);

    // Insert the user
    const result = await pool.query<{ id: number }>(
      `INSERT INTO users (username, password_hash, full_name, active)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      ['FREDRIC', passwordHash, 'Fredric User', true]
    );

    userId = result.rows[0].id;
    console.log('Created user: FREDRIC (password: fredric)');
  } else {
    userId = existingUser.rows[0].id;
    console.log('User FREDRIC already exists.');
  }

  // Seed sample time entries
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  // Check if we already have time data
  const existingDay = await pool.query<{ id: number }>(
    'SELECT id FROM days WHERE user_id = $1 AND workday = $2',
    [userId, today]
  );

  if (existingDay.rows.length === 0) {
    console.log('Adding sample time entries...');

    // Insert today
    const todayResult = await pool.query<{ id: number }>(
      'INSERT INTO days (user_id, workday, daysum) VALUES ($1, $2, $3) RETURNING id',
      [userId, today, 7.5]
    );
    const todayId = todayResult.rows[0].id;

    // Insert yesterday
    const yesterdayResult = await pool.query<{ id: number }>(
      'INSERT INTO days (user_id, workday, daysum) VALUES ($1, $2, $3) RETURNING id',
      [userId, yesterday, 8.0]
    );
    const yesterdayId = yesterdayResult.rows[0].id;

    // Insert time entries for today
    await pool.query(
      `INSERT INTO day_items (day_id, start_hour, end_hour, jiratask, description, rowsum, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [todayId, '08:00', '10:30', 'STEAKT-2987', 'Morning standup and dev', 2.5, 1]
    );
    await pool.query(
      `INSERT INTO day_items (day_id, start_hour, end_hour, jiratask, description, rowsum, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [todayId, '10:45', '12:00', 'STEAKT-2988', 'Code review', 1.25, 2]
    );
    await pool.query(
      `INSERT INTO day_items (day_id, start_hour, end_hour, jiratask, description, rowsum, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [todayId, '13:00', '16:45', 'STEAKT-2987', 'Feature implementation', 3.75, 3]
    );

    // Insert time entries for yesterday
    await pool.query(
      `INSERT INTO day_items (day_id, start_hour, end_hour, jiratask, description, rowsum, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [yesterdayId, '08:00', '12:00', 'STEAKT-2985', 'Sprint planning', 4.0, 1]
    );
    await pool.query(
      `INSERT INTO day_items (day_id, start_hour, end_hour, jiratask, description, rowsum, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [yesterdayId, '13:00', '17:00', 'STEAKT-2986', 'Bug fixes', 4.0, 2]
    );

    console.log('Sample time entries created.');
  } else {
    console.log('Time entries already exist.');
  }

  console.log('Database seeded successfully!');

  // Close the pool
  await pool.end();
}

seed().catch((error) => {
  console.error('Seeding failed:', error);
  process.exit(1);
});
