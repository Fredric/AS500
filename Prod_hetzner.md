# AS500 Production — Hetzner VPS

## Server Overview

- **Provider**: Hetzner VPS
- **OS**: Ubuntu (kernel 6.8.0-52-generic)
- **Domain**: https://adv.entence.se
- **Web server**: Caddy v2.8.4 (handles HTTPS + reverse proxy)
- **App runtime**: Docker 29.3.1
- **Node.js**: v20 (inside Docker container)

---

## Architecture

```
Internet
    │ HTTPS (443)
    ▼
  Caddy                     ← /etc/caddy/Caddyfile
    │ reverse proxy to [::1]:3001
    ▼
  Docker: as500-app         ← Node.js server (port 3001)
    │  - Serves React SPA (static files from client/dist)
    │  - Handles WebSocket connections (terminal protocol)
    ▼
  Docker: as500-postgres    ← PostgreSQL 16 (internal network only)
```

Caddy automatically manages the TLS certificate for `adv.entence.se`.

---

## Docker Setup

**File**: `docker-compose.prod.yml`  
**Dockerfile**: `Dockerfile.prod`

Two containers:
- `as500-postgres-1` — PostgreSQL 16 Alpine, data persisted in Docker volume `as500_postgres_data`
- `as500-app-1` — Node.js app, pre-built at image build time (client + server)

### Why Dockerfile.prod?

The VPS has IPv6 internet but Docker containers only have IPv4 routing. `npm install` at container start time fails (ETIMEDOUT). The Dockerfile uses `network: host` during build so `npm install` runs over the host's network, then the built image is self-contained — no network needed at runtime.

---

## Caddy Configuration

**File**: `/etc/caddy/Caddyfile`

```
{
  email fredric.berling@gmail.com
}

adv.entence.se {
  reverse_proxy [::1]:3001
}
```

Caddy auto-renews the TLS cert via Let's Encrypt.

---

## Common Commands

### Deploy a code update

```bash
cd /var/www/AS500

# Pull latest code
git pull

# Rebuild image and restart app container (postgres keeps running)
docker compose -f docker-compose.prod.yml build app
docker compose -f docker-compose.prod.yml up -d app
```

### View logs

```bash
# App logs (live)
docker compose -f docker-compose.prod.yml logs -f app

# Postgres logs
docker compose -f docker-compose.prod.yml logs postgres

# Caddy logs
journalctl -u caddy -f
```

### Restart services

```bash
# Restart app only
docker compose -f docker-compose.prod.yml restart app

# Restart everything
docker compose -f docker-compose.prod.yml down && docker compose -f docker-compose.prod.yml up -d
```

### Stop everything

```bash
docker compose -f docker-compose.prod.yml down
```

### Seed the database (first-time setup or reset)

```bash
docker compose -f docker-compose.prod.yml exec app npm run seed
```

Creates users: `FREDRIC` / `fredric` and `KALLE` / `password`

### Reset the database (destroys all data)

```bash
docker compose -f docker-compose.prod.yml down -v
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml exec app npm run seed
```

### Backup the database

```bash
docker compose -f docker-compose.prod.yml exec app npm run backup-db
# Output saved to server/backups/as500-backup-TIMESTAMP.sql
```

### Restore from backup

```bash
docker compose -f docker-compose.prod.yml exec app npm run restore-db as500-backup-TIMESTAMP.sql
```

---

## Container Status Check

```bash
docker compose -f docker-compose.prod.yml ps
```

Both containers should show `healthy` / `running`. If `as500-app-1` is restarting repeatedly, check logs — the most likely cause is a database connection issue (postgres not ready yet).

---

## Troubleshooting

**App not reachable**
1. `docker compose -f docker-compose.prod.yml ps` — check containers are running
2. `curl http://localhost:3001/` — test app bypassing Caddy
3. `systemctl status caddy` — check Caddy is running

**TLS certificate issues**
- `caddy reload --config /etc/caddy/Caddyfile` — reload Caddy config
- Cert is stored and auto-renewed by Caddy; check `journalctl -u caddy`

**Database connection refused**
- Postgres health check must pass before app starts (`depends_on: condition: service_healthy`)
- `docker compose -f docker-compose.prod.yml logs postgres`
