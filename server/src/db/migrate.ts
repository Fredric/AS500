import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { db, closeDatabase } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function runMigrations() {
  console.log('Running database migrations...');
  await migrate(db, { migrationsFolder: join(__dirname, 'migrations') });
  console.log('Migrations complete.');
  await closeDatabase();
}

runMigrations().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
