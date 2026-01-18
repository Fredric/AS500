// Backup Scheduler
// Handles automatic scheduled backups
import { createBackup, cleanupOldBackups } from './backup.js';
let schedulerInterval = null;
/**
 * Start the backup scheduler
 * @param config - Backup configuration
 */
export function startBackupScheduler(config) {
    if (!config.enabled) {
        console.log('Backup scheduler is disabled');
        return;
    }
    // Stop existing scheduler if running
    stopBackupScheduler();
    const intervalMs = config.intervalMinutes * 60 * 1000;
    console.log(`Starting backup scheduler: every ${config.intervalMinutes} minutes, keeping ${config.keepCount} backups`);
    // Run initial backup (async)
    (async () => {
        try {
            await createBackup();
            cleanupOldBackups(config.keepCount);
        }
        catch (error) {
            console.error('Initial backup failed:', error);
        }
    })();
    // Schedule periodic backups
    schedulerInterval = setInterval(async () => {
        try {
            console.log('Running scheduled backup...');
            await createBackup();
            cleanupOldBackups(config.keepCount);
        }
        catch (error) {
            console.error('Scheduled backup failed:', error);
        }
    }, intervalMs);
    console.log('Backup scheduler started successfully');
}
/**
 * Stop the backup scheduler
 */
export function stopBackupScheduler() {
    if (schedulerInterval) {
        clearInterval(schedulerInterval);
        schedulerInterval = null;
        console.log('Backup scheduler stopped');
    }
}
/**
 * Check if scheduler is running
 */
export function isSchedulerRunning() {
    return schedulerInterval !== null;
}
