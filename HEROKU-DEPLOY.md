# Heroku Deployment Guide

How to deploy new versions to Heroku without destroying the database.

## Quick Deploy (Safe)

```bash
# 1. Commit your changes
git add .
git commit -m "Your changes"

# 2. Push to Heroku
git push heroku main

# 3. Run seed script 
heroku run "ADMIN_PASSWORD=<adminpassword> node server/dist/db/seed.js";
```

That's it. Heroku automatically:
- Builds the application
- Restarts the dyno with new code
- Keeps the database intact

## What's Safe

These actions preserve your database:

| Action | Safe? | Notes |
|--------|-------|-------|
| `git push heroku main` | ✅ | Deploys code only |
| Restart dyno | ✅ | `heroku restart` |
| Scale dynos | ✅ | `heroku ps:scale web=1` |
| View logs | ✅ | `heroku logs --tail` |
| Add new tables | ✅ | Use `CREATE TABLE IF NOT EXISTS` |
| Add columns | ✅ | Use `ALTER TABLE ADD COLUMN` |

## What Destroys Data

Never do these without a backup:

| Action | Danger | What happens |
|--------|--------|--------------|
| `heroku pg:reset` | ❌ DESTROYS | Wipes entire database |
| `DROP TABLE` | ❌ DESTROYS | Deletes table and data |
| `TRUNCATE TABLE` | ❌ DESTROYS | Deletes all rows |
| Delete Heroku app | ❌ DESTROYS | Deletes everything |
| Downgrade Postgres plan | ⚠️ RISKY | May lose data |

## Pre-Deploy Checklist

Before deploying significant changes:

### 1. Backup the Database

```bash
# Create a backup on Heroku
heroku pg:backups:capture

# List backups
heroku pg:backups

# Download backup locally (optional)
heroku pg:backups:download
```

### 2. Review Database Changes

If your code changes the database schema:

```sql
-- SAFE: Adding new tables
CREATE TABLE IF NOT EXISTS new_table (...);

-- SAFE: Adding new columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS new_col TEXT;

-- DANGEROUS: Dropping columns (data loss)
ALTER TABLE users DROP COLUMN old_col;

-- DANGEROUS: Changing column types (may fail or lose data)
ALTER TABLE users ALTER COLUMN name TYPE VARCHAR(50);
```

### 3. Test Locally First

```bash
# Run locally with Docker
docker-compose up

# Test your changes work
# Then deploy to Heroku
```

### 4. Build and lockfiles

- **One lockfile per app** – `server/package-lock.json` and `client/package-lock.json` are shared for local, CI, and Heroku. We do not generate different lockfiles per environment.
- **Build uses `npm ci`** – The build scripts run `npm ci` (not `npm install`) in `server/` and `client/`, so the lockfiles are never modified during build. When adding or updating dependencies, run `npm install` in the relevant directory, then commit both `package.json` and `package-lock.json`.
- **Client lockfile** – The client lockfile must keep `resolved`/`integrity` and all `@rollup/rollup-*` platform entries (including `@rollup/rollup-linux-x64-gnu` for Heroku). Don’t strip them or use “minimal” lockfile tooling on the client.

## Deployment Steps

### Standard Deployment

```bash
# 1. Make sure you're on main branch
git checkout main

# 2. Pull latest changes
git pull origin main

# 3. Push to Heroku
git push heroku main

# 4. Watch the build
heroku logs --tail

# 5. Verify the app works
heroku open
```

### If Something Goes Wrong

```bash
# Roll back to previous release
heroku rollback

# Or roll back to specific version
heroku releases
heroku rollback v42
```

## Database Migrations

The AS500 schema uses `CREATE TABLE IF NOT EXISTS`, so re-running initialization is safe. However, for schema changes:

### Adding a New Table

Add to `server/src/db/index.ts`:

```typescript
await client.query(`
  CREATE TABLE IF NOT EXISTS new_table (
    id SERIAL PRIMARY KEY,
    ...
  )
`);
```

This is safe - it won't affect existing tables.

### Adding a Column to Existing Table

Create a migration in your code that runs on startup:

```typescript
// Check if column exists before adding
await client.query(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS new_column TEXT
`);
```

### Modifying Existing Data

Always backup first, then run manually:

```bash
# Connect to Heroku Postgres
heroku pg:psql

# Run your migration SQL
UPDATE users SET status = 'active' WHERE status IS NULL;
```

## Useful Commands

```bash
# View recent deployments
heroku releases

# View app status
heroku ps

# View logs
heroku logs --tail

# Connect to database
heroku pg:psql

# Check database info
heroku pg:info

# Create manual backup
heroku pg:backups:capture

# List backups
heroku pg:backups

# Restore from backup
heroku pg:backups:restore b001 DATABASE_URL
```

## Environment Variables

View/set config without affecting database:

```bash
# View all config
heroku config

# Set a variable
heroku config:set MY_VAR=value

# Remove a variable
heroku config:unset MY_VAR
```

## Emergency Recovery

If you accidentally destroyed data:

### From Heroku Backup

```bash
# List available backups
heroku pg:backups

# Restore from backup (REPLACES current data)
heroku pg:backups:restore b001 DATABASE_URL --confirm your-app-name
```

### From Local Backup

If you have a local SQL dump:

```bash
# Reset the database first (if needed)
heroku pg:reset DATABASE_URL --confirm your-app-name

# Restore from local file
heroku pg:psql < backup.sql
```

## Summary

1. `git push heroku main` is always safe for the database
2. Backup before any schema changes: `heroku pg:backups:capture`
3. Use `IF NOT EXISTS` for new tables/columns
4. Never run `heroku pg:reset` unless you mean to wipe everything
5. Use `heroku rollback` if code deployment breaks something
