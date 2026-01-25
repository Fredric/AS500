// Import JSON data into PostgreSQL
// Run with: npm run import-data

import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const inputPath = join(__dirname, '../data/migration-export.json');

console.log('AS500 PostgreSQL Import Tool\n');

if (!existsSync(inputPath)) {
  console.error(`Export file not found at: ${inputPath}`);
  console.error('Run "npm run export-data" first to create the export file.');
  process.exit(1);
}

interface ExportData {
  exportedAt: string;
  tables: {
    users: Array<{
      id: number;
      username: string;
      password_hash: string;
      full_name: string | null;
      active: number;
      created_at: string;
    }>;
    days: Array<{
      id: number;
      user_id: number;
      workday: string;
      daysum: number;
      created_at: string;
    }>;
    day_items: Array<{
      id: number;
      day_id: number;
      start_hour: string;
      end_hour: string;
      jiratask: string | null;
      description: string | null;
      rowsum: number;
      sort_order: number;
    }>;
  };
  counts: {
    users: number;
    days: number;
    day_items: number;
  };
}

// PostgreSQL connection config
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('heroku') ? { rejectUnauthorized: false } : undefined,
  // Fall back to individual env vars if DATABASE_URL not set
  host: process.env.DATABASE_URL ? undefined : (process.env.PGHOST || 'localhost'),
  port: process.env.DATABASE_URL ? undefined : parseInt(process.env.PGPORT || '5433'),
  database: process.env.DATABASE_URL ? undefined : (process.env.PGDATABASE || 'as500'),
  user: process.env.DATABASE_URL ? undefined : (process.env.PGUSER || 'as500'),
  password: process.env.DATABASE_URL ? undefined : (process.env.PGPASSWORD || 'as500'),
});

async function importData() {
  const client = await pool.connect();

  try {
    console.log(`Reading from: ${inputPath}\n`);
    const data: ExportData = JSON.parse(readFileSync(inputPath, 'utf-8'));

    console.log(`Export was created at: ${data.exportedAt}`);
    console.log(`Records to import: ${data.counts.users} users, ${data.counts.days} days, ${data.counts.day_items} day_items\n`);

    await client.query('BEGIN');

    // Clear existing data (in reverse order due to foreign keys)
    console.log('Clearing existing data...');
    await client.query('DELETE FROM day_items');
    await client.query('DELETE FROM days');
    await client.query('DELETE FROM users');

    // Import users with original IDs
    console.log('Importing users...');
    for (const user of data.tables.users) {
      await client.query(
        `INSERT INTO users (id, username, password_hash, full_name, active, created_at)
         OVERRIDING SYSTEM VALUE
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [user.id, user.username, user.password_hash, user.full_name, user.active === 1, user.created_at]
      );
    }

    // Import days with original IDs
    console.log('Importing days...');
    for (const day of data.tables.days) {
      await client.query(
        `INSERT INTO days (id, user_id, workday, daysum, created_at)
         OVERRIDING SYSTEM VALUE
         VALUES ($1, $2, $3, $4, $5)`,
        [day.id, day.user_id, day.workday, day.daysum, day.created_at]
      );
    }

    // Import day_items with original IDs
    console.log('Importing day items...');
    for (const item of data.tables.day_items) {
      await client.query(
        `INSERT INTO day_items (id, day_id, start_hour, end_hour, jiratask, description, rowsum, sort_order)
         OVERRIDING SYSTEM VALUE
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [item.id, item.day_id, item.start_hour, item.end_hour, item.jiratask, item.description, item.rowsum, item.sort_order]
      );
    }

    // Reset sequences to continue from max ID + 1
    console.log('Resetting sequences...');
    const maxUserId = data.tables.users.length > 0 ? Math.max(...data.tables.users.map(u => u.id)) : 0;
    const maxDayId = data.tables.days.length > 0 ? Math.max(...data.tables.days.map(d => d.id)) : 0;
    const maxDayItemId = data.tables.day_items.length > 0 ? Math.max(...data.tables.day_items.map(i => i.id)) : 0;

    await client.query(`SELECT setval('users_id_seq', $1, true)`, [maxUserId]);
    await client.query(`SELECT setval('days_id_seq', $1, true)`, [maxDayId]);
    await client.query(`SELECT setval('day_items_id_seq', $1, true)`, [maxDayItemId]);

    await client.query('COMMIT');

    // Verify import
    console.log('\nVerifying import...');
    const userCount = await client.query('SELECT COUNT(*) FROM users');
    const dayCount = await client.query('SELECT COUNT(*) FROM days');
    const itemCount = await client.query('SELECT COUNT(*) FROM day_items');

    console.log('─'.repeat(40));
    console.log(`  Users:      ${userCount.rows[0].count} (expected: ${data.counts.users})`);
    console.log(`  Days:       ${dayCount.rows[0].count} (expected: ${data.counts.days})`);
    console.log(`  Day Items:  ${itemCount.rows[0].count} (expected: ${data.counts.day_items})`);
    console.log('─'.repeat(40));

    const allMatch =
      parseInt(userCount.rows[0].count) === data.counts.users &&
      parseInt(dayCount.rows[0].count) === data.counts.days &&
      parseInt(itemCount.rows[0].count) === data.counts.day_items;

    if (allMatch) {
      console.log('\n✓ Import completed successfully! All counts match.');
    } else {
      console.error('\n✗ Warning: Record counts do not match!');
      process.exit(1);
    }

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Import failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

importData();
