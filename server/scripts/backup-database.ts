// Backup PostgreSQL database
// Run with: npm run backup-db
// Or: tsx scripts/backup-database.ts

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync, statSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const backupsDir = join(__dirname, '../backups');
const useDatabaseUrl = Boolean(process.env.DATABASE_URL);

// Ensure backups directory exists
if (!existsSync(backupsDir)) {
  mkdirSync(backupsDir, { recursive: true });
}

// Parse connection info
function getConnectionArgs(): string[] {
  const args: string[] = [];

  if (useDatabaseUrl) {
    // Parse DATABASE_URL: postgresql://user:password@host:port/database
    const url = process.env.DATABASE_URL!;
    const match = url.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)$/);

    if (!match) {
      throw new Error('Invalid DATABASE_URL format. Expected: postgresql://user:password@host:port/database');
    }

    const [, user, password, host, port, database] = match;

    args.push(`--host=${host}`);
    args.push(`--port=${port}`);
    args.push(`--username=${user}`);
    args.push(`--dbname=${database}`);

    // Set password via environment variable (pg_dump reads PGPASSWORD)
    process.env.PGPASSWORD = password;
  } else {
    // Use individual PG* environment variables
    const host = process.env.PGHOST || 'localhost';
    const port = process.env.PGPORT || '5433';
    const user = process.env.PGUSER || 'as500';
    const database = process.env.PGDATABASE || 'as500';
    const password = process.env.PGPASSWORD || 'as500';

    args.push(`--host=${host}`);
    args.push(`--port=${port}`);
    args.push(`--username=${user}`);
    args.push(`--dbname=${database}`);

    if (password) {
      process.env.PGPASSWORD = password;
    }
  }

  return args;
}

// Generate backup filename with timestamp
function getBackupFilename(): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5); // Format: 2026-01-24T15-30-45
  return `as500-backup-${timestamp}.sql`;
}

function main() {
  console.log('AS500 Database Backup Tool\n');

  try {
    const connectionArgs = getConnectionArgs();
    const backupFile = join(backupsDir, getBackupFilename());

    // Build pg_dump command
    const command = `pg_dump ${connectionArgs.join(' ')} --no-owner --no-acl --clean --if-exists --format=plain --file="${backupFile}"`;

    console.log('Creating backup...');
    console.log(`Output file: ${backupFile}`);

    // Execute pg_dump
    execSync(command, {
      stdio: 'inherit',
      env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD },
    });

    console.log('\n✓ Backup created successfully!');
    console.log(`  File: ${backupFile}`);

    // Get file size
    const stats = statSync(backupFile);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`  Size: ${sizeMB} MB`);

  } catch (error) {
    console.error('\n✗ Backup failed!');

    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error('Unknown error:', error);
    }

    // Provide helpful error messages
    if (error instanceof Error && error.message.includes('pg_dump')) {
      console.error('\nTroubleshooting:');
      console.error('• Ensure PostgreSQL client tools are installed (pg_dump)');
      console.error('• Check database connection settings (DATABASE_URL or PG* env vars)');
      console.error('• Verify database is running and accessible');
      console.error('• For Docker: ensure container is running (docker-compose ps)');
    }

    process.exit(1);
  }
}

main();
