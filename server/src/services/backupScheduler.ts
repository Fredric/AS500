// Backup Scheduler
// Handles automatic scheduled backups

import { createBackup, cleanupOldBackups } from './backup.js';

export interface BackupConfig {
  enabled: boolean;
  intervalMinutes: number;
  keepCount: number;
}

let schedulerInterval: NodeJS.Timeout | null = null;

/**
 * Start the backup scheduler
 * @param config - Backup configuration
 */
export function startBackupScheduler(config: BackupConfig): void {
  if (!config.enabled) {
    console.log('Backup scheduler is disabled');
    return;
  }

  // Stop existing scheduler if running
  stopBackupScheduler();

  const intervalMs = config.intervalMinutes * 60 * 1000;
  
  console.log(`Starting backup scheduler: every ${config.intervalMinutes} minutes, keeping ${config.keepCount} backups`);

  // Run initial backup
  try {
    createBackup();
    cleanupOldBackups(config.keepCount);
  } catch (error) {
    console.error('Initial backup failed:', error);
  }

  // Schedule periodic backups
  schedulerInterval = setInterval(() => {
    try {
      console.log('Running scheduled backup...');
      createBackup();
      cleanupOldBackups(config.keepCount);
    } catch (error) {
      console.error('Scheduled backup failed:', error);
    }
  }, intervalMs);

  console.log('Backup scheduler started successfully');
}

/**
 * Stop the backup scheduler
 */
export function stopBackupScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('Backup scheduler stopped');
  }
}

/**
 * Check if scheduler is running
 */
export function isSchedulerRunning(): boolean {
  return schedulerInterval !== null;
}
