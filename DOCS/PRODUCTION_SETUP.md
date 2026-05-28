# AS500 Production Setup Guide

Complete reference for deploying a new AS500 server instance from scratch.

---

## Architecture Overview

```
Internet → Caddy (HTTPS :443) → Node.js app (:3001, WebSocket + static SPA)
                              → MCP/API server (:3002, HTTP)
                                  /mcp          — MCP Streamable HTTP (OAuth 2.1)
                                  /api          — REST API (Bearer token)
                                  /api/auth     — First-party credential exchange
                                  /authorize    — OAuth consent page
                                  /token        — OAuth token endpoint
                                  /.well-known  — OAuth discovery
                              → as500-docs (:8080, internal only)
                                  /search       — Hybrid vector + keyword RAG search
                                  /ask          — Full RAG answer generation
                                  /healthz      — Health check
                              → PostgreSQL (:5432, internal only)

Dev machine (WireGuard VPN)
  └── Ollama (:11434) ← as500-docs uses for embeddings (nomic-embed-text)
```

All services run as Docker containers. Caddy runs on the host and terminates TLS.

---

## Environment Variables

### Quick Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | **YES** | — | PostgreSQL connection string |
| `POSTGRES_PASSWORD` | **YES** | — | Password for Docker Postgres service |
| `AS500_MCP_JWT_SECRET` | **YES** | — | HS256 signing key for MCP tokens (≥32 chars) |
| `MCP_PUBLIC_URL` | **YES** | — | Public HTTPS URL of the MCP endpoint |
| `NODE_ENV` | recommended | `undefined` | Set to `production` |
| `PORT` | no | `3001` | WebSocket / HTTP server port |
| `MCP_PORT` | no | `3002` | MCP OAuth server port |
| `MCP_ENABLED` | no | `true` | Set to `false` to disable MCP server |
| `ADMIN_PASSWORD` | no | — | Initial seed password for FREDRIC admin account |
| `JIRA_BASE_URL` | no | — | e.g. `https://your-org.atlassian.net` |
| `JIRA_USER_EMAIL` | no | — | Jira account email for API auth |
| `JIRA_API_TOKEN` | no | — | Jira API token (from Atlassian account settings) |

---

### Full Variable Descriptions

#### `DATABASE_URL` — Required

PostgreSQL connection string in URI format.

```
postgresql://USER:PASSWORD@HOST:PORT/DATABASE
```

Examples:
```
postgresql://as500:s3cr3t@localhost:5432/as500
postgresql://as500:s3cr3t@postgres:5432/as500   # Docker service name
```

If set, this takes precedence over all `PG*` variables. For hosted databases (RDS, Heroku), the driver automatically enables SSL when the URL contains `amazonaws.com` or `heroku`.

---

#### `POSTGRES_PASSWORD` — Required (Docker deployments)

The password used by the `postgres` Docker service. Must match the password in `DATABASE_URL`.

Set this in a `.env` file at the project root so `docker-compose.prod.yml` can read it.

---

#### `AS500_MCP_JWT_SECRET` — Required in production

HS256 signing key for MCP access tokens. Must be at least 32 characters.

**Generate a secure value:**
```bash
openssl rand -base64 48
```

**Behaviour:**
- Production: server refuses to start if unset or shorter than 32 chars.
- Development: auto-generates a random secret per process (tokens do not survive restart — acceptable for dev).

This value must remain stable across deployments. Rotating it invalidates all active MCP sessions.

---

#### `MCP_PUBLIC_URL` — Required in production

The external HTTPS URL that MCP clients will use for OAuth discovery and token endpoints. Must match the URL advertised in `/.well-known/oauth-authorization-server`.

```
https://your-domain.com
```

Do **not** include a trailing slash or path suffix. The server appends `/mcp`, `/authorize`, `/token`, etc. internally.

---

#### `NODE_ENV`

Set to `production` to:
- Disable verbose error messages in MCP responses
- Serve the compiled React SPA as static files from the same process
- Apply stricter rate limits (5 login attempts/min, 10 token refreshes/hour)

```
NODE_ENV=production
```

---

#### `PORT`

WebSocket and HTTP server port. Default: `3001`.

Only change this if port 3001 is unavailable. If changed, update the Caddy reverse proxy config to match.

---

#### `MCP_PORT`

MCP OAuth server port. Default: `3002`.

Only change this if port 3002 is unavailable. If changed, update the Caddy reverse proxy config to match.

---

#### `MCP_ENABLED`

Set to `false` to disable the MCP server entirely. Useful for deployments that only expose the terminal interface.

```
MCP_ENABLED=false
```

---

#### `ADMIN_PASSWORD`

If set during database seeding, the initial `FREDRIC` admin account is created with this password instead of the default `fredric`.

```bash
docker compose -f docker-compose.prod.yml exec server npm run seed
```

Only relevant on first-time database initialisation. Has no effect if the user already exists.

---

#### `JIRA_BASE_URL`, `JIRA_USER_EMAIL`, `JIRA_API_TOKEN`

Optional integration with Atlassian Jira for task lookup in time registration. All three must be set for the integration to work.

```
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_USER_EMAIL=you@your-org.com
JIRA_API_TOKEN=ATATT3xFfGF0...
```

Generate an API token at: https://id.atlassian.com/manage-profile/security/api-tokens

---

## Production `.env` Template

Create `/var/www/AS500/.env` on the server with this template. Fill in all required values before first deployment.

```bash
# ==============================================================================
# AS500 Production Environment
# Generated: $(date +%Y-%m-%d)
# ==============================================================================

# --- Database -----------------------------------------------------------------
# Connection string for PostgreSQL.
DATABASE_URL=postgresql://as500:CHANGE_ME@postgres:5432/as500

# Password for the Docker postgres service — must match DATABASE_URL above.
POSTGRES_PASSWORD=CHANGE_ME

# --- Security -----------------------------------------------------------------
# HS256 signing key for MCP tokens. Generate with: openssl rand -base64 48
# REQUIRED. Must be ≥32 chars. Rotating this invalidates all MCP sessions.
AS500_MCP_JWT_SECRET=CHANGE_ME_openssl_rand_-base64_48

# --- MCP / OAuth --------------------------------------------------------------
# Public HTTPS URL of this server (no trailing slash). Used in OAuth discovery.
MCP_PUBLIC_URL=https://your-domain.com

# --- Runtime ------------------------------------------------------------------
NODE_ENV=production

# Optional: change only if ports 3001/3002 conflict with other services.
# PORT=3001
# MCP_PORT=3002

# Optional: set to false to disable MCP server entirely.
# MCP_ENABLED=false

# --- Initial Seed (first deploy only) ----------------------------------------
# If set, the FREDRIC admin account is seeded with this password.
# Remove or leave blank after first deploy.
# ADMIN_PASSWORD=CHANGE_ME

# --- Jira Integration (optional) ---------------------------------------------
# JIRA_BASE_URL=https://your-org.atlassian.net
# JIRA_USER_EMAIL=you@your-org.com
# JIRA_API_TOKEN=
```

---

## Server Setup: Step by Step

### Prerequisites

- Ubuntu 22.04 LTS (or compatible Debian-based system)
- Docker Engine 24+
- Docker Compose plugin v2
- Caddy 2.x installed on the host
- A domain name with DNS A record pointing to the server IP

### 1. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in for group change to take effect
```

### 2. Install Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

### 3. Clone the Repository

```bash
sudo mkdir -p /var/www/AS500
sudo chown $USER:$USER /var/www/AS500
git clone git@github.com:fredric/as500.git /var/www/AS500
cd /var/www/AS500
```

### 4. Create the `.env` File

```bash
cp /dev/stdin /var/www/AS500/.env << 'EOF'
# Paste the template from the section above, with real values filled in
EOF
chmod 600 /var/www/AS500/.env
```

### 5. Configure Caddy

Create `/etc/caddy/Caddyfile`:

```caddy
your-domain.com {
    # MCP Streamable HTTP endpoint
    handle /mcp* {
        reverse_proxy [::1]:3002
    }

    # REST API + first-party auth
    handle /api* {
        reverse_proxy [::1]:3002
    }

    # OAuth well-known discovery + consent + token endpoints
    handle /.well-known/* {
        reverse_proxy [::1]:3002
    }
    handle /register {
        reverse_proxy [::1]:3002
    }
    handle /authorize* {
        reverse_proxy [::1]:3002
    }
    handle /token {
        reverse_proxy [::1]:3002
    }
    handle /revoke {
        reverse_proxy [::1]:3002
    }

    # Terminal WebSocket + static SPA (catch-all — must be last)
    reverse_proxy [::1]:3001
}
```

> **Important:** The `/api*` and `/mcp*` handle blocks must appear **before** the catch-all `reverse_proxy` at the bottom. Caddy matches handle blocks in order; without them, API and MCP requests would be forwarded to port 3001 (the WebSocket server) instead of port 3002.

```bash
sudo systemctl reload caddy
sudo caddy validate --config /etc/caddy/Caddyfile
```

Caddy automatically provisions and renews a Let's Encrypt certificate for the domain.

### 6. Build and Start

```bash
cd /var/www/AS500
docker compose -f docker-compose.prod.yml build app
docker compose -f docker-compose.prod.yml up -d
```

### 7. Seed the Database (first deploy only)

```bash
docker compose -f docker-compose.prod.yml exec server npm run seed
```

This creates the `FREDRIC` admin account. If `ADMIN_PASSWORD` is set in `.env`, that password is used; otherwise the default is `fredric` — change it immediately after login.

### 8. Verify the Deployment

```bash
# Check container health
docker compose -f docker-compose.prod.yml ps

# Tail application logs
docker compose -f docker-compose.prod.yml logs -f server

# HTTP health check (terminal app)
curl -I https://your-domain.com

# MCP health check
curl https://your-domain.com/mcp/health

# REST API — first-party login (returns access + refresh tokens)
curl -s -X POST https://your-domain.com/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{"username":"FREDRIC","password":"<your-admin-password>"}' | jq .

# REST API — discovery (list exposed resources; requires Bearer token from above)
ACCESS_TOKEN="<access_token from previous command>"
curl -s https://your-domain.com/api \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq .
```

---

## REST API

The REST API is mounted at `/api` on the same port as the MCP server (3002) and proxied through Caddy. No additional environment variables or services are required beyond what is already configured for MCP.

### Authentication

Two flows produce identical Bearer tokens. Choose based on whether you own the client app.

**First-party (you own the client — no browser redirect needed):**

```http
POST https://your-domain.com/api/auth/token
Content-Type: application/json

{ "username": "FREDRIC", "password": "<password>" }
```

Response:
```json
{
  "access_token": "<JWT>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "<opaque>"
}
```

**Third-party / AI agent (OAuth 2.1 + PKCE consent flow):**

Use the same OAuth endpoints as MCP (`/register` → `/authorize` → `/token`). The resulting Bearer tokens are identical in format and accepted by all `/api/*` routes.

### Using the Token

Pass `Authorization: Bearer <access_token>` on every REST request:

```http
GET https://your-domain.com/api/timereg_v2?date=2026-05-08
Authorization: Bearer <access_token>
```

### Token Rotation

Access tokens expire after 1 hour. Rotate with the refresh token before expiry:

```http
POST https://your-domain.com/api/auth/refresh
Content-Type: application/json

{ "refresh_token": "<opaque>" }
```

Returns a new `access_token` + new `refresh_token`. The old pair is immediately revoked.

### Revoke / Logout

```http
POST https://your-domain.com/api/auth/revoke
Content-Type: application/json

{ "token": "<refresh_token>", "token_type_hint": "refresh_token" }
```

Always returns `{ "ok": true }`.

### Available Endpoints

| Method | URL | Description |
|--------|-----|-------------|
| `GET` | `/api` | Discovery — lists all exposed resources and their operations |
| `GET` | `/api/:configId` | List records (supports `?offset=&limit=`, max 100) |
| `GET` | `/api/:configId/:id` | Read single record |
| `POST` | `/api/:configId` | Create record |
| `PUT` | `/api/:configId/:id` | Update record |
| `DELETE` | `/api/:configId/:id` | Delete record (204 no body) |

Scope parameters (e.g. `?date=…`) are passed as query string on all methods. The body contains only the resource's own writable fields.

### Rate Limits

In production (`NODE_ENV=production`): 60 API calls/minute per client. The `/api/auth/token` endpoint is additionally limited to 10 login attempts/minute per IP.

### Audit Log

Every API call writes a row to the `mcp_audit_log` table with `source='api'`. The built-in audit admin screen in the terminal app shows both MCP and REST calls.

---

## Updating an Existing Deployment

```bash
cd /var/www/AS500
git pull
docker compose -f docker-compose.prod.yml build app
docker compose -f docker-compose.prod.yml up -d app
```

Database migrations run automatically on server startup. No manual migration step needed.

---

## Backup and Restore

### Backup

```bash
cd /var/www/AS500
docker compose -f docker-compose.prod.yml exec server npm run backup-db
# Creates a timestamped .sql file in server/data/
```

### Restore

```bash
docker compose -f docker-compose.prod.yml exec server npm run restore-db server/data/backup-YYYY-MM-DD.sql
```

---

## Logs

```bash
# Live logs (all services)
docker compose -f docker-compose.prod.yml logs -f

# Application only
docker compose -f docker-compose.prod.yml logs -f server

# Filter for errors
docker compose -f docker-compose.prod.yml logs server 2>&1 | grep -i error
```

---

## Common Issues

### Server starts but login fails

Check that the database was seeded:
```bash
docker compose -f docker-compose.prod.yml exec postgres psql -U as500 -c "SELECT username FROM users;"
```

If the `users` table is empty, run the seed command (Step 7 above).

### MCP tokens don't survive a restart

`AS500_MCP_JWT_SECRET` is not set in `.env`, so a new random secret is generated on each startup. Set a stable value.

### WebSocket connection refused

Caddy is not proxying port 3001. Check that `[::1]:3001` is reachable from the host:
```bash
curl -s http://localhost:3001/health || echo "not reachable"
```
And verify the Caddy config has a `reverse_proxy [::1]:3001` line for the root path.

### REST API returns 404 for `/api/*`

The Caddy config is missing the `handle /api*` block (or it appears after the catch-all `reverse_proxy`). Check that `/api*` is proxied to port 3002 and that the block is listed **before** the catch-all at the bottom of the site block.

```bash
# Confirm the API server is reachable directly on the host
curl -s http://localhost:3002/api | jq .resources
```

If that works but `https://your-domain.com/api` returns 404, the Caddy config needs updating.

### `POST /api/auth/token` returns 401 with valid credentials

The user account may be inactive or the password may differ from what was set during seed. Verify in the terminal app (log in via the browser) or check the DB:

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U as500 -c "SELECT username, active FROM users WHERE username = 'FREDRIC';"
```

### `POST /api/auth/token` returns 429

Rate limit exceeded: 10 login attempts/minute per IP. Wait 60 seconds and retry.

### OAuth discovery returns wrong URLs

`MCP_PUBLIC_URL` is set incorrectly. It must exactly match the external HTTPS URL of the server — no trailing slash, no `/mcp` suffix.

### Caddy certificate provisioning fails

Ensure port 80 and 443 are open in the firewall:
```bash
sudo ufw allow 80
sudo ufw allow 443
```
And that the domain's DNS A record resolves to the correct server IP before starting Caddy.

---

## Security Checklist (before going live)

- [ ] `AS500_MCP_JWT_SECRET` is at least 48 characters and unique to this deployment
- [ ] `POSTGRES_PASSWORD` is a strong random password (not the default `as500`)
- [ ] `ADMIN_PASSWORD` was set during seed and the default `fredric` password has been changed
- [ ] `.env` file permissions are `600` (`chmod 600 .env`)
- [ ] Ports 3001 and 3002 are not exposed to the internet (only Caddy on 80/443 is public)
- [ ] `NODE_ENV=production` is set
- [ ] MCP JWT secret rotation plan is documented (invalidates all MCP and REST API sessions)
- [ ] Caddy config includes `handle /api*` proxied to port 3002 (REST API reachable externally)
- [ ] REST API access tested end-to-end: `POST /api/auth/token` → `GET /api` returns resource list
