# Backup System

The AS500 system includes an automated backup system for the SQLite database using SQLite's native **Online Backup API**.

## Features

- **Hot Backups**: Backups work **WITHOUT stopping the server** - uses SQLite's native online backup API
- **Automatic Scheduled Backups**: Backups are created automatically every 60 minutes
- **Safe Concurrent Access**: Handles concurrent database writes safely during backup
- **Backup Retention**: The system keeps the last 10 backups and automatically removes older ones
- **Manual Backups**: Create backups on-demand via the UI or command line
- **Backup Management UI**: View all available backups through the terminal interface
- **Progress Tracking**: Monitor backup progress with page-by-page tracking

## How It Works

The backup system uses SQLite's **Online Backup API** through better-sqlite3, which:

1. **Does NOT lock the database** - the server continues running normally
2. **Copies the database page by page** - allowing other operations to proceed
3. **Handles concurrent writes safely** - if data changes during backup, it's handled correctly
4. **Provides consistent snapshots** - the backup is a valid point-in-time snapshot
5. **Works in the background** - minimal impact on server performance

This is SQLite's recommended approach for backing up databases while they are in use.

## Configuration

The backup system is configured in `server/src/index.ts`:

```typescript
startBackupScheduler({
  enabled: true,           // Enable/disable automatic backups
  intervalMinutes: 60,     // Backup every 60 minutes
  keepCount: 10,          // Keep last 10 backups
});
```

## Backup Location

All backups are stored in: `server/backups/`

Backup files are named with timestamps: `as500-backup-YYYY-MM-DDTHH-MM-SS-mmmZ.db`

**Note**: The backup directory is excluded from git via `.gitignore`.

## Creating Backups

### Automatic Backups

Backups are created automatically:
1. When the server starts (initial backup)
2. Every 60 minutes while the server is running

### Manual Backup (Command Line)

```bash
cd server
npm run backup
```

This will:
- Create a new backup
- List all available backups
- Clean up old backups (keeping last 10)

### Manual Backup (UI)

1. Log in to the AS500 terminal
2. From the Main Menu, select option `7` (Backup management)
3. Press `F5` to create a backup immediately
4. Press `F3` or `F12` to exit back to the main menu

## Restoring from Backup

**Important**: Restoring a backup cannot be done while the server is running.

To restore from a backup:

1. **Stop the server**:
   ```bash
   # Press Ctrl+C in the terminal running the server
   ```

2. **Backup the current database** (optional but recommended):
   ```bash
   cd server
   cp data/as500.db data/as500.db.backup
   ```

3. **Copy the backup file**:
   ```bash
   # Replace the timestamp with your desired backup file
   cp backups/as500-backup-2026-01-18T18-07-10-622Z.db data/as500.db
   ```

4. **Restart the server**:
   ```bash
   npm run dev
   ```

## Viewing Backups

### Via UI

1. Log in to the AS500 terminal
2. From the Main Menu, select option `7` (Backup management)
3. View the list of available backups with timestamps and file sizes

### Via Command Line

```bash
cd server
ls -lh backups/
```

## Backup File Format

Backups are complete copies of the SQLite database file created using SQLite's built-in backup API. This ensures:
- Consistent snapshots even if the database is in use
- Minimal impact on server performance
- Full data integrity

## Troubleshooting

### Backup Directory Doesn't Exist

The backup directory is created automatically when the server starts. If you encounter issues:

```bash
cd server
mkdir -p backups
```

### Disk Space Issues

If backups are consuming too much disk space:

1. Reduce the `keepCount` in the backup scheduler configuration
2. Manually delete old backups:
   ```bash
   cd server/backups
   rm as500-backup-*.db
   ```

### Backup Failed Error

Check the server logs for specific error messages. Common causes:
- Insufficient disk space
- Permission issues (backup directory not writable)
- Database file locked (rare with SQLite WAL mode)

## Maintenance

### Changing Backup Frequency

Edit `server/src/index.ts` and change the `intervalMinutes` value:

```typescript
startBackupScheduler({
  enabled: true,
  intervalMinutes: 30,  // Changed to 30 minutes
  keepCount: 10,
});
```

Restart the server for changes to take effect.

### Changing Retention Policy

Edit `server/src/index.ts` and change the `keepCount` value:

```typescript
startBackupScheduler({
  enabled: true,
  intervalMinutes: 60,
  keepCount: 20,  // Changed to keep 20 backups
});
```

Restart the server for changes to take effect.

### Disabling Automatic Backups

Set `enabled: false` in the backup scheduler configuration:

```typescript
startBackupScheduler({
  enabled: false,  // Disables automatic backups
  intervalMinutes: 60,
  keepCount: 10,
});
```

You can still create manual backups using `npm run backup` or via the UI.
