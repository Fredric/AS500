#!/bin/bash
# AS500 database backup script
# Runs pg_dump inside the postgres container and saves to /var/backups/as500/
# Keeps the last 14 backups, deletes older ones.

set -euo pipefail

BACKUP_DIR="/var/backups/as500"
CONTAINER="as500-postgres-1"
DB_USER="as500"
DB_NAME="as500"
KEEP=14

# Load password from .env
ENV_FILE="/var/www/AS500/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: .env file not found at $ENV_FILE" >&2
  exit 1
fi
PGPASSWORD=$(grep '^POSTGRES_PASSWORD=' "$ENV_FILE" | cut -d'=' -f2-)
if [ -z "$PGPASSWORD" ]; then
  echo "ERROR: POSTGRES_PASSWORD not found in $ENV_FILE" >&2
  exit 1
fi

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H-%M-%S")
BACKUP_FILE="$BACKUP_DIR/as500-backup-$TIMESTAMP.sql"

echo "$(date -u +"%Y-%m-%d %H:%M:%S UTC") Starting backup..."

# Run pg_dump inside the container
docker exec -e PGPASSWORD="$PGPASSWORD" "$CONTAINER" \
  pg_dump \
    --host=localhost \
    --username="$DB_USER" \
    --dbname="$DB_NAME" \
    --no-owner \
    --no-acl \
    --clean \
    --if-exists \
    --format=plain \
  > "$BACKUP_FILE"

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "$(date -u +"%Y-%m-%d %H:%M:%S UTC") Backup saved: $BACKUP_FILE ($SIZE)"

# Delete backups older than the most recent $KEEP
COUNT=$(ls -1t "$BACKUP_DIR"/as500-backup-*.sql 2>/dev/null | wc -l)
if [ "$COUNT" -gt "$KEEP" ]; then
  ls -1t "$BACKUP_DIR"/as500-backup-*.sql | tail -n +"$((KEEP + 1))" | xargs rm -f
  echo "$(date -u +"%Y-%m-%d %H:%M:%S UTC") Cleaned up old backups (kept $KEEP most recent)"
fi

echo "$(date -u +"%Y-%m-%d %H:%M:%S UTC") Done."
