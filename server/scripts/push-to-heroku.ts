// Push local Docker PostgreSQL data to Heroku
// Run with: npm run push-to-heroku
// Or: tsx scripts/push-to-heroku.ts
//
// Prerequisites:
//   - Docker PostgreSQL running (docker-compose up)
//   - Heroku CLI logged in (heroku login)
//   - pg_dump and psql installed locally

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync, unlinkSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const backupsDir = join(__dirname, '../backups');
const tempFile = join(backupsDir, '_heroku-push-temp.sql');

// Local Docker DB settings
const LOCAL = {
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || '5433',
  user: process.env.PGUSER || 'as500',
  password: process.env.PGPASSWORD || 'as500',
  database: process.env.PGDATABASE || 'as500',
};

function getHerokuDatabaseUrl(): string {
  try {
    const url = execSync('heroku config:get DATABASE_URL', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (!url) {
      throw new Error('DATABASE_URL is empty');
    }

    return url;
  } catch (error) {
    console.error('Failed to get Heroku DATABASE_URL.');
    console.error('Make sure you are logged in (heroku login) and have a Heroku app with Postgres.');
    process.exit(1);
  }
}

function parseHerokuUrl(url: string) {
  const match = url.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)$/);
  if (!match) {
    throw new Error('Invalid Heroku DATABASE_URL format');
  }
  const [, user, password, host, port, database] = match;
  return { user, password, host, port, database };
}

async function main() {
  console.log('AS500 Push Local DB → Heroku\n');

  // Step 1: Get Heroku DB URL
  console.log('Fetching Heroku DATABASE_URL...');
  const herokuUrl = getHerokuDatabaseUrl();
  const heroku = parseHerokuUrl(herokuUrl);
  console.log(`  Heroku host: ${heroku.host}`);

  // Ensure backups dir exists
  if (!existsSync(backupsDir)) {
    mkdirSync(backupsDir, { recursive: true });
  }

  // Step 2: Dump local DB
  console.log(`\nDumping local database (${LOCAL.host}:${LOCAL.port})...`);
  process.env.PGPASSWORD = LOCAL.password;

  try {
    execSync(
      `pg_dump --host=${LOCAL.host} --port=${LOCAL.port} --username=${LOCAL.user} --dbname=${LOCAL.database} --no-owner --no-acl --clean --if-exists --format=plain --file="${tempFile}"`,
      { stdio: 'inherit', env: { ...process.env, PGPASSWORD: LOCAL.password } }
    );
  } catch {
    console.error('\nFailed to dump local database.');
    console.error('Make sure Docker PostgreSQL is running: docker-compose up');
    process.exit(1);
  }

  console.log('  Local dump created.');

  // Step 3: Warning + countdown
  console.log('\n⚠️  WARNING: This will REPLACE ALL DATA on Heroku with your local data!');
  console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');

  await new Promise(resolve => setTimeout(resolve, 5000));

  // Step 4: Restore to Heroku
  console.log('Pushing to Heroku database...');
  process.env.PGPASSWORD = heroku.password;

  try {
    execSync(
      `psql --host=${heroku.host} --port=${heroku.port} --username=${heroku.user} --dbname=${heroku.database} --file="${tempFile}"`,
      { stdio: 'inherit', env: { ...process.env, PGPASSWORD: heroku.password, PGSSLMODE: 'require' } }
    );
  } catch {
    console.error('\nFailed to restore to Heroku database.');
    console.error('The local dump is preserved at:', tempFile);
    process.exit(1);
  }

  // Step 5: Cleanup
  try {
    unlinkSync(tempFile);
  } catch {
    // Ignore cleanup errors
  }

  console.log('\n✓ Local database pushed to Heroku successfully!');
}

main();
