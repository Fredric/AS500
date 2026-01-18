// Manual backup script
// Run with: npm run backup

import { createBackup, listBackups, cleanupOldBackups, formatSize } from '../services/backup.js';

console.log('AS500 Database Backup Tool\n');

(async () => {
  try {
    // Create backup
    console.log('Creating backup...');
    const backupPath = await createBackup();
    console.log(`✓ Backup created: ${backupPath}\n`);

    // Cleanup old backups (keep last 10)
    const deleted = cleanupOldBackups(10);
    if (deleted > 0) {
      console.log(`✓ Cleaned up ${deleted} old backup(s)\n`);
    }

    // List all backups
    const backups = listBackups();
    console.log(`Available backups (${backups.length}):`);
    console.log('─'.repeat(80));
    
    backups.forEach((backup, index) => {
      const date = backup.timestamp.toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      console.log(`${index + 1}. ${backup.filename}`);
      console.log(`   Date: ${date}, Size: ${formatSize(backup.size)}`);
    });
    
    console.log('─'.repeat(80));
    console.log('\n✓ Backup completed successfully');
  } catch (error) {
    console.error('✗ Backup failed:', error);
    process.exit(1);
  }
})();

