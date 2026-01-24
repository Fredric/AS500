// Export SQLite data to JSON for PostgreSQL migration
// Run with: npm run export-data

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, '../data/as500.db');
const outputPath = join(__dirname, '../data/migration-export.json');

console.log('AS500 SQLite Export Tool\n');

if (!existsSync(dbPath)) {
  console.error(`Database not found at: ${dbPath}`);
  console.error('Make sure you have run "npm run seed" first.');
  process.exit(1);
}

const db = new Database(dbPath);

interface ExportData {
  exportedAt: string;
  tables: {
    users: unknown[];
    days: unknown[];
    day_items: unknown[];
  };
  counts: {
    users: number;
    days: number;
    day_items: number;
  };
}

try {
  console.log(`Reading from: ${dbPath}\n`);

  // Export all tables
  const users = db.prepare('SELECT * FROM users').all();
  const days = db.prepare('SELECT * FROM days').all();
  const dayItems = db.prepare('SELECT * FROM day_items').all();

  const exportData: ExportData = {
    exportedAt: new Date().toISOString(),
    tables: {
      users,
      days,
      day_items: dayItems,
    },
    counts: {
      users: users.length,
      days: days.length,
      day_items: dayItems.length,
    },
  };

  // Write to JSON file
  writeFileSync(outputPath, JSON.stringify(exportData, null, 2));

  console.log('Export Summary:');
  console.log('─'.repeat(40));
  console.log(`  Users:      ${users.length}`);
  console.log(`  Days:       ${days.length}`);
  console.log(`  Day Items:  ${dayItems.length}`);
  console.log('─'.repeat(40));
  console.log(`\nExported to: ${outputPath}`);
  console.log('\n✓ Export completed successfully!');
  console.log('\nIMPORTANT: Make a backup copy of this file before proceeding!');
  console.log('  cp data/migration-export.json ~/Desktop/as500-backup.json');

} catch (error) {
  console.error('Export failed:', error);
  process.exit(1);
} finally {
  db.close();
}
