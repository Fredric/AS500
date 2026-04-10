# Backup & Restore

AS500 uses PostgreSQL on production (Hetzner VPS). Backups are plain SQL dumps created with `pg_dump`.

---

## Automated Backups (Production)

A cron job runs `/var/www/AS500/backup.sh` every night at **02:00 UTC**:

```
0 2 * * * /var/www/AS500/backup.sh >> /var/log/as500-backup.log 2>&1
```

The script runs `pg_dump` inside the `as500-postgres-1` Docker container and saves the output to the VPS host filesystem.

| Setting | Value |
|---------|-------|
| Storage location | `/var/backups/as500/` on VPS host |
| File naming | `as500-backup-YYYY-MM-DDTHH-MM-SS.sql` |
| Format | Plain SQL (`--clean --if-exists --no-owner --no-acl`) |
| Retention | Last 14 backups kept; older ones deleted automatically |
| Log file | `/var/log/as500-backup.log` |

### Check backup logs

```bash
tail -50 /var/log/as500-backup.log
```

### List available backups

```bash
ls -lht /var/backups/as500/
```

---

## Manual Backup

### On the VPS (recommended)

Run the backup script directly:

```bash
/var/www/AS500/backup.sh
```

### In local development

From `server/`:

```bash
npm run backup-db
```

Saves to `server/backups/as500-backup-TIMESTAMP.sql`. Requires `pg_dump` installed locally and the database running on port 5433.

---

## Restore from Backup

> **Warning**: Restoring replaces all existing data in the database.

### On the VPS (production)

The backup files are on the VPS host at `/var/backups/as500/`. To restore, copy the SQL file into the running postgres container and pipe it through `psql`:

```bash
# Choose the backup file to restore
BACKUP_FILE="/var/backups/as500/as500-backup-2026-04-10T02-00-00.sql"

# Load password from .env
PGPASSWORD=$(grep '^POSTGRES_PASSWORD=' /var/www/AS500/.env | cut -d'=' -f2-)

# Copy file into container and restore
docker cp "$BACKUP_FILE" as500-postgres-1:/tmp/restore.sql
docker exec -e PGPASSWORD="$PGPASSWORD" as500-postgres-1 \
  psql --host=localhost --username=as500 --dbname=as500 \
  --file=/tmp/restore.sql

# Clean up
docker exec as500-postgres-1 rm /tmp/restore.sql
```

The app container does **not** need to be stopped — `psql` with `--clean --if-exists` handles the table replacement. However, active user sessions will break, so it's good practice to restart the app after restoring:

```bash
cd /var/www/AS500
docker compose -f docker-compose.prod.yml restart app
```

### In local development

From `server/`, pass either the filename (looked up in `server/backups/`) or an absolute path:

```bash
npm run restore-db as500-backup-2026-04-10T02-00-00.sql
# or
npm run restore-db /absolute/path/to/backup.sql
```

The script waits 3 seconds before executing — press `Ctrl+C` to abort.

---

## Backup File Format

Plain SQL produced by `pg_dump --format=plain --clean --if-exists --no-owner --no-acl`.

- Can be restored with any standard `psql` client
- `--clean` drops and recreates tables before inserting data
- `--no-owner` / `--no-acl` makes the dump portable across different PostgreSQL users
