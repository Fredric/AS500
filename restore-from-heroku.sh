#!/bin/bash
# Pull data from Heroku PostgreSQL and restore it into the local Docker database.
#
# Usage:
#   ./restore-from-heroku.sh "postgres://user:password@host:5432/dbname"
#
# The Heroku DATABASE_URL can be found at:
#   Heroku dashboard → App → Settings → Config Vars → DATABASE_URL
#   Or: heroku config:get DATABASE_URL -a YOUR_APP_NAME

set -euo pipefail

HEROKU_URL="${1:-}"
CONTAINER="as500-postgres-1"
LOCAL_USER="as500"
LOCAL_DB="as500"
BACKUP_DIR="/var/backups/as500"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H-%M-%S")
DUMP_FILE="$BACKUP_DIR/heroku-import-$TIMESTAMP.sql"

if [ -z "$HEROKU_URL" ]; then
  echo "Usage: $0 \"postgres://user:password@host:5432/dbname\""
  echo ""
  echo "Get your Heroku DATABASE_URL from:"
  echo "  heroku config:get DATABASE_URL -a YOUR_APP_NAME"
  exit 1
fi

# Safety: back up local database first
echo "Step 1/3: Backing up local database before overwriting..."
mkdir -p "$BACKUP_DIR"
LOCAL_PGPASSWORD=$(grep '^POSTGRES_PASSWORD=' /var/www/AS500/.env | cut -d'=' -f2-)
docker exec -e PGPASSWORD="$LOCAL_PGPASSWORD" "$CONTAINER" \
  pg_dump --host=localhost --username="$LOCAL_USER" --dbname="$LOCAL_DB" \
  --no-owner --no-acl --clean --if-exists --format=plain \
  > "$BACKUP_DIR/pre-heroku-import-$TIMESTAMP.sql"
echo "  Local backup saved: $BACKUP_DIR/pre-heroku-import-$TIMESTAMP.sql"

# Dump from Heroku using pg_dump on the host (container lacks internet access)
echo "Step 2/3: Dumping data from Heroku..."
/usr/lib/postgresql/17/bin/pg_dump "$HEROKU_URL" \
  --no-owner --no-acl --clean --if-exists --format=plain \
  > "$DUMP_FILE"
SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo "  Heroku dump saved: $DUMP_FILE ($SIZE)"

# Restore into local database
echo "Step 3/3: Restoring into local database..."
echo ""
echo "  WARNING: This will replace all data in the local database."
echo "  Press Ctrl+C to cancel, or wait 5 seconds to continue..."
sleep 5

docker exec -e PGPASSWORD="$LOCAL_PGPASSWORD" -i "$CONTAINER" \
  psql --host=localhost --username="$LOCAL_USER" --dbname="$LOCAL_DB" \
  < "$DUMP_FILE"

echo ""
echo "Done. Heroku data is now in your local database."
echo "If anything looks wrong, restore the pre-import backup:"
echo "  docker exec -e PGPASSWORD=\$PGPASSWORD -i $CONTAINER psql -U $LOCAL_USER -d $LOCAL_DB < $BACKUP_DIR/pre-heroku-import-$TIMESTAMP.sql"
