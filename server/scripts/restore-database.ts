// Restore PostgreSQL database from backup
// Run with: npm run restore-db <backup-file>
// Or: tsx scripts/restore-database.ts <backup-file>

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync, readdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const backupsDir = join(__dirname, '../backups');
const useDatabaseUrl = Boolean(process.env.DATABASE_URL);

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

    // Set password via environment variable (psql reads PGPASSWORD)
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

// Get backup file path
function getBackupFile(input: string | undefined): string {
  if (!input) {
    console.error('Error: Backup file not specified');
    console.error('\nUsage:');
    console.error('  npm run restore-db <backup-file>');
    console.error('  tsx scripts/restore-database.ts <backup-file>');
    console.error('\nExamples:');
    console.error('  npm run restore-db backups/as500-backup-2026-01-24T15-30-45.sql');
    console.error('  npm run restore-db as500-backup-2026-01-24T15-30-45.sql');
    process.exit(1);
  }

  // If input is just a filename, check in backups directory
  let backupFile = input;
  if (!input.includes('/') && !input.includes('\\')) {
    backupFile = join(backupsDir, input);
  } else if (!input.startsWith('/') && !input.match(/^[A-Z]:/)) {
    // Relative path - resolve from backups directory or current directory
    backupFile = join(backupsDir, input);
    if (!existsSync(backupFile)) {
      // Try from current working directory
      backupFile = resolve(input);
    }
  }

  if (!existsSync(backupFile)) {
    console.error(`Error: Backup file not found: ${backupFile}`);
    console.error('\nAvailable backups:');
    try {
      const files = readdirSync(backupsDir).filter((f: string) => f.endsWith('.sql'));
      if (files.length === 0) {
        console.error('  (no backups found)');
      } else {
        files.forEach((f: string) => console.error(`  ${f}`));
      }
    } catch {
      console.error('  (could not list backups directory)');
    }
    process.exit(1);
  }

  return backupFile;
}

async function main() {
  console.log('AS500 Database Restore Tool\n');

  try {
    const backupFile = getBackupFile(process.argv[2]);
    const connectionArgs = getConnectionArgs();

    console.log(`Restoring from: ${backupFile}`);
    console.log('\n⚠️  WARNING: This will replace all existing data in the database!');
    console.log('Press Ctrl+C to cancel, or wait 3 seconds to continue...\n');

    // Wait 3 seconds
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Build psql command
    const command = `psql ${connectionArgs.join(' ')} --file="${backupFile}"`;

    console.log('Restoring database...');

    // Execute psql
    execSync(command, {
      stdio: 'inherit',
      env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD },
    });

    console.log('\n✓ Database restored successfully!');

  } catch (error) {
    console.error('\n✗ Restore failed!');

    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error('Unknown error:', error);
    }

    // Provide helpful error messages
    if (error instanceof Error && error.message.includes('psql')) {
      console.error('\nTroubleshooting:');
      console.error('• Ensure PostgreSQL client tools are installed (psql)');
      console.error('• Check database connection settings (DATABASE_URL or PG* env vars)');
      console.error('• Verify database is running and accessible');
      console.error('• For Docker: ensure container is running (docker-compose ps)');
      console.error('• Ensure backup file is a valid SQL dump');
    }

    process.exit(1);
  }
}

main();
