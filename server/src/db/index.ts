import pg from 'pg';

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

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err);
});

/**
 * Initialize the database schema
 * Must be called before the server starts accepting connections
 */
export async function initializeDatabase(): Promise<void> {
  console.log('Connecting to PostgreSQL:', getConnectionInfo());

  let client: pg.PoolClient;
  try {
    client = await pool.connect();
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

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT,
        active BOOLEAN DEFAULT TRUE,
        is_admin BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Migration: Add is_admin column if it doesn't exist (for existing databases)
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'is_admin'
        ) THEN
          ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE;
        END IF;
      END $$;

      CREATE TABLE IF NOT EXISTS days (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        workday DATE NOT NULL,
        daysum NUMERIC(5,2) DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(user_id, workday)
      );

      CREATE TABLE IF NOT EXISTS day_items (
        id SERIAL PRIMARY KEY,
        day_id INTEGER NOT NULL REFERENCES days(id) ON DELETE CASCADE,
        start_hour TEXT NOT NULL,
        end_hour TEXT NOT NULL,
        jiratask TEXT,
        description TEXT,
        rowsum NUMERIC(5,2) DEFAULT 0,
        sort_order INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS auth_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Migration: Add new columns for access/refresh token pattern and device tracking
      DO $$
      BEGIN
        -- Add access_token column
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'auth_tokens' AND column_name = 'access_token'
        ) THEN
          ALTER TABLE auth_tokens ADD COLUMN access_token TEXT UNIQUE;
          ALTER TABLE auth_tokens ADD COLUMN refresh_token TEXT UNIQUE;
          ALTER TABLE auth_tokens ADD COLUMN access_expires_at TIMESTAMP WITH TIME ZONE;
          ALTER TABLE auth_tokens ADD COLUMN refresh_expires_at TIMESTAMP WITH TIME ZONE;
          ALTER TABLE auth_tokens ADD COLUMN device_id TEXT;
          ALTER TABLE auth_tokens ADD COLUMN device_name TEXT;
          ALTER TABLE auth_tokens ADD COLUMN user_agent TEXT;
          ALTER TABLE auth_tokens ADD COLUMN ip_address INET;
          ALTER TABLE auth_tokens ADD COLUMN last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
          ALTER TABLE auth_tokens ADD COLUMN revoked_at TIMESTAMP WITH TIME ZONE;
          
          -- Migrate existing records: copy token to refresh_token, set reasonable expiry
          UPDATE auth_tokens 
          SET refresh_token = token,
              refresh_expires_at = expires_at,
              access_token = NULL,
              access_expires_at = NULL
          WHERE refresh_token IS NULL;
        END IF;
      END $$;

      CREATE INDEX IF NOT EXISTS idx_auth_tokens_token ON auth_tokens(token);
      CREATE INDEX IF NOT EXISTS idx_auth_tokens_access_token ON auth_tokens(access_token) WHERE revoked_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_auth_tokens_refresh_token ON auth_tokens(refresh_token) WHERE revoked_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_id ON auth_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires_at ON auth_tokens(expires_at);
      CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_device ON auth_tokens(user_id, device_id) WHERE revoked_at IS NULL;
    `);

    console.log('Database schema initialized');
  } finally {
    client.release();
  }
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
