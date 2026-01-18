// Backup Service
// Handles database backup and restore operations

import db from '../db/index.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';

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
 * Create a backup of the database using SQLite's native Online Backup API
 * This method works while the database is in use and does NOT require stopping the server
 * 
 * The backup API uses SQLite's online backup feature which:
 * - Copies the database page by page
 * - Handles concurrent writes safely
 * - Provides a consistent snapshot even if the database is being modified
 * - Does not lock the database for the entire duration
 * 
 * @returns Promise that resolves to the path of the backup file
 */
export async function createBackup(): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFilename = `as500-backup-${timestamp}.db`;
  const backupPath = join(backupDir, backupFilename);

  // Use better-sqlite3's backup API which wraps SQLite's Online Backup API
  // This performs a hot backup without requiring the server to be stopped
  const metadata = await db.backup(backupPath, {
    progress({ totalPages, remainingPages }) {
      const progress = ((totalPages - remainingPages) / totalPages * 100).toFixed(1);
      if (remainingPages === 0) {
        console.log(`Backup progress: 100% (${totalPages} pages)`);
      }
      return 200; // Copy 200 pages at a time
    }
  });

  console.log(`Database backed up to: ${backupPath} (${metadata.totalPages} pages)`);
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
 * Note: This functionality is not safe to implement while server is running
 * as it would require closing the shared database connection.
 * To restore a backup:
 * 1. Stop the server
 * 2. Manually copy the backup file to server/data/as500.db
 * 3. Restart the server
 * @param backupFilename - Name of the backup file (not full path)
 * @returns Success status
 */
export function restoreBackup(backupFilename: string): boolean {
  console.warn(`Restore functionality requires server restart - not implemented. Requested file: ${backupFilename}`);
  return false;
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
