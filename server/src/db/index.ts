import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as schema from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const useDatabaseUrl = Boolean(process.env.DATABASE_URL);
const ssl =
  process.env.DATABASE_URL?.includes('amazonaws.com') || process.env.DATABASE_URL?.includes('heroku')
    ? { rejectUnauthorized: false }
    : undefined;

// Connection config for logging (never log password)
function getConnectionInfo(): string {
  if (useDatabaseUrl) {
    const u = process.env.DATABASE_URL ?? '';
    const match = u.match(/^(postgres(?:ql)?:\/\/)([^:]+):([^@]+)@/);
    const safe = match ? `${match[1]}${match[2]}:****@${u.split('@')[1] ?? '...'}` : '(DATABASE_URL set, redacted)';
    return `DATABASE_URL ${safe}`;
  }
  return `host=${process.env.PGHOST ?? 'localhost'} port=${process.env.PGPORT ?? '5432'} database=${process.env.PGDATABASE ?? 'as500'} user=${process.env.PGUSER ?? 'as500'}`;
}

// PostgreSQL connection pool
// Supports DATABASE_URL (Heroku) or individual PG* env vars (local)
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl,
  host: useDatabaseUrl ? undefined : (process.env.PGHOST || 'localhost'),
  port: useDatabaseUrl ? undefined : parseInt(process.env.PGPORT || '5432', 10),
  database: useDatabaseUrl ? undefined : (process.env.PGDATABASE || 'as500'),
  user: useDatabaseUrl ? undefined : (process.env.PGUSER || 'as500'),
  password: useDatabaseUrl ? undefined : (process.env.PGPASSWORD || 'as500'),
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err);
});

export const db = drizzle(pool, { schema });

/**
 * Run all pending Drizzle migrations and verify connectivity.
 * Must be called before the server starts accepting connections.
 */
export async function initializeDatabase(): Promise<void> {
  console.log('Connecting to PostgreSQL:', getConnectionInfo());

  // Verify connectivity before running migrations
  try {
    const client = await pool.connect();
    client.release();
  } catch (err: unknown) {
    const pgErr = err as { code?: string; message?: string };
    if (pgErr?.code === '28P01') {
      console.error('PostgreSQL auth failed (28P01). Connection used:', getConnectionInfo());
      console.error(
        '• Credentials: match docker-compose (as500/as500). Stale volume? Run: docker-compose down -v && docker-compose up -d',
      );
      console.error(
        '• Port conflict: another Postgres on 5432? Use Docker port 5433: set PGPORT=5433 (see docker-compose).',
      );
    }
    throw err;
  }

  await migrate(db, { migrationsFolder: join(__dirname, 'migrations') });
  console.log('Database migrations applied');
}

/**
 * Close the database pool (for graceful shutdown)
 */
export async function closeDatabase(): Promise<void> {
  await pool.end();
  console.log('Database connection pool closed');
}

export { pool };
export default pool;
