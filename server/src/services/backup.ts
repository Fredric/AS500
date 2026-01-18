// Backup Service
// Handles database backup and restore operations

import db from '../db/index.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, unlinkSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const backupDir = join(__dirname, '../../backups');

// Ensure backup directory exists
if (!existsSync(backupDir)) {
  mkdirSync(backupDir, { recursive: true });
}

export interface BackupInfo {
  filename: string;
  path: string;
  timestamp: Date;
  size: number;
}

/**
 * Create a backup of the database
 * @returns Path to the backup file
 */
export function createBackup(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFilename = `as500-backup-${timestamp}.db`;
  const backupPath = join(backupDir, backupFilename);

  // Use better-sqlite3's backup API for safe backup
  // This ensures a consistent snapshot even if database is in use
  db.backup(backupPath);

  console.log(`Database backed up to: ${backupPath}`);
  return backupPath;
}

/**
 * List all available backups
 * @returns Array of backup information
 */
export function listBackups(): BackupInfo[] {
  if (!existsSync(backupDir)) {
    return [];
  }

  const files = readdirSync(backupDir);
  const backups: BackupInfo[] = [];

  for (const filename of files) {
    if (filename.endsWith('.db')) {
      const path = join(backupDir, filename);
      const stats = statSync(path);
      
      // Use file modification time as timestamp
      const timestamp = stats.mtime;

      backups.push({
        filename,
        path,
        timestamp,
        size: stats.size,
      });
    }
  }

  // Sort by timestamp, newest first
  backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return backups;
}

/**
 * Restore database from a backup file
 * Note: This should only be done when the server is not actively processing requests
 * @param backupFilename - Name of the backup file (not full path)
 * @returns Success status
 */
export function restoreBackup(backupFilename: string): boolean {
  const backupPath = join(backupDir, backupFilename);
  
  if (!existsSync(backupPath)) {
    console.error(`Backup file not found: ${backupPath}`);
    return false;
  }

  const dbPath = join(__dirname, '../../data/as500.db');
  
  try {
    // Close existing database connection
    db.close();
    
    // Copy backup over current database
    copyFileSync(backupPath, dbPath);
    
    console.log(`Database restored from: ${backupPath}`);
    
    // Note: A restart of the server would be needed to reopen the database
    // For now, we'll just indicate success
    return true;
  } catch (error) {
    console.error(`Failed to restore backup: ${error}`);
    return false;
  }
}

/**
 * Delete old backups, keeping only the specified number of most recent backups
 * @param keepCount - Number of backups to keep
 */
export function cleanupOldBackups(keepCount: number = 10): number {
  const backups = listBackups();
  
  if (backups.length <= keepCount) {
    return 0;
  }

  const toDelete = backups.slice(keepCount);
  let deletedCount = 0;

  for (const backup of toDelete) {
    try {
      unlinkSync(backup.path);
      deletedCount++;
      console.log(`Deleted old backup: ${backup.filename}`);
    } catch (error) {
      console.error(`Failed to delete backup ${backup.filename}: ${error}`);
    }
  }

  return deletedCount;
}

/**
 * Format file size in human-readable format
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
