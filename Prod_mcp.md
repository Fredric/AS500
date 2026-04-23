# AS500 Production — MCP Server Setup

Companion to [`Prod_hetzner.md`](Prod_hetzner.md). This file covers **only** what's needed to expose the remote MCP server (OAuth 2.1 + `/mcp`) on `https://adv.entence.se/mcp`.

Assumes the base stack from `Prod_hetzner.md` is already running (Caddy + Docker + Postgres + app on port `3001`).

---

## TL;DR — what you're doing

1. **Generate a persistent JWT secret** (one-time).
2. **Create `.env` next to `docker-compose.prod.yml`** with that secret + the public MCP URL.
3. **Pull the latest code** (the compose file already publishes `127.0.0.1:3002:3002`).
4. **Add one Caddy route** that proxies `/mcp` and the OAuth discovery paths to `127.0.0.1:3002`.
5. **Rebuild + restart** the app container, reload Caddy.
6. **Verify** with two `curl`s and a `claude mcp add`.

~10 minutes end-to-end.

---

## 1. Generate the JWT secret (one-time)

SSH into the VPS, then:

```bash
openssl rand -hex 48
# example output:
# 9a7f3c...e2c1   (96 hex chars — well over the 32-char minimum)
```

Copy the output. Losing it invalidates every agent's access token on the next regeneration, but it's not a catastrophic secret — MCP access tokens live 1 hour and refresh tokens can be reissued via the consent flow.

---

## 2. Create `/var/www/AS500/.env`

Docker Compose automatically loads a file named `.env` next to `docker-compose.prod.yml` and substitutes `${VAR}` references. Create it:

```bash
cd /var/www/AS500
sudo tee .env >/dev/null <<'EOF'
# Postgres
POSTGRES_PASSWORD=<your existing postgres password>
DATABASE_URL=postgresql://as500:<your existing postgres password>@postgres:5432/as500

# Remote MCP server
AS500_MCP_JWT_SECRET=<paste the openssl output from step 1>
MCP_PUBLIC_URL=https://adv.entence.se
EOF

sudo chmod 600 .env
sudo chown root:root .env
```

### What each variable does

| Variable | Required? | Purpose |
|---|---|---|
| `POSTGRES_PASSWORD` | Yes (already set) | Postgres password inside the container. |
| `DATABASE_URL` | Yes (already set) | App → Postgres DSN. |
| `AS500_MCP_JWT_SECRET` | **Yes (new)** | HS256 key that signs MCP access tokens. Must be ≥32 chars. If unset, a random key is generated per process start and every restart kicks every agent out. |
| `MCP_PUBLIC_URL` | **Yes (new)** | Origin that OAuth discovery advertises. Must match exactly what agents type (`https://adv.entence.se`, no trailing slash, no path). Without it, discovery returns `http://localhost:3002/...` and Claude Code fails with a confusing redirect error. |

Do **not** commit `.env` — it's already in `.gitignore`.

---

## 3. Pull the updated `docker-compose.prod.yml`

The compose file now publishes port `3002` to `127.0.0.1` (localhost only — Caddy reaches it, the public internet cannot) and passes `AS500_MCP_JWT_SECRET` + `MCP_PUBLIC_URL` into the container:

```bash
cd /var/www/AS500
git pull
```

Relevant excerpt — no edits needed, just confirming what you're getting:

```yaml
app:
  ports:
    - "3001:3001"
    - "127.0.0.1:3002:3002"   # ← MCP, localhost-only
  environment:
    DATABASE_URL: ${DATABASE_URL}
    NODE_ENV: production
    AS500_MCP_JWT_SECRET: ${AS500_MCP_JWT_SECRET}
    MCP_PUBLIC_URL: ${MCP_PUBLIC_URL}
```

---

## 4. Update Caddy

Edit `/etc/caddy/Caddyfile`:

```caddy
{
  email fredric.berling@gmail.com
}

adv.entence.se {
  # MCP server — OAuth discovery + Streamable HTTP transport.
  # Must be BEFORE the catch-all reverse_proxy below so these paths
  # don't fall through to the WebSocket server on :3001.
  @mcp {
    path /mcp /mcp/*
    path /.well-known/oauth-authorization-server
    path /.well-known/oauth-authorization-server/*
    path /.well-known/oauth-protected-resource
    path /.well-known/oauth-protected-resource/*
    path /register
    path /authorize
    path /authorize/*
    path /token
    path /revoke
  }
  reverse_proxy @mcp 127.0.0.1:3002

  # Everything else → green-screen app (WebSocket + SPA).
  reverse_proxy [::1]:3001
}
```

### Why each path is in the matcher

| Path | Purpose |
|---|---|
| `/mcp`, `/mcp/*` | The actual MCP Streamable HTTP endpoint Claude Code POSTs to. |
| `/.well-known/oauth-authorization-server*` | OAuth 2.1 discovery — tells clients where `/authorize`, `/token`, `/register` live. |
| `/.well-known/oauth-protected-resource*` | MCP-specific discovery — tells clients which authorization server protects `/mcp`. |
| `/register` | Dynamic Client Registration (DCR). Claude Code POSTs here the first time a user adds the server. |
| `/authorize`, `/authorize/*` | Consent page (GET) and consent form POST (`/authorize/consent`). |
| `/token` | Exchange auth code → access + refresh tokens; refresh token rotation. |
| `/revoke` | Client-initiated token revocation. |

Validate + reload:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy auto-fetches/renews TLS — no cert work needed for the new paths; they share the existing `adv.entence.se` cert.

---

## 5. Rebuild and restart the app

```bash
cd /var/www/AS500
docker compose -f docker-compose.prod.yml build app
docker compose -f docker-compose.prod.yml up -d app
```

Watch the startup log — you should see **two** "running" lines:

```bash
docker compose -f docker-compose.prod.yml logs --tail=30 app
```

```
AS500 Server running on port 3001
AS500 MCP server running on http://0.0.0.0:3002/mcp — N tool(s) across M config(s). OAuth 2.1 + DCR enabled.
```

If you see `WARNING: AS500_MCP_JWT_SECRET is not set` instead, the `.env` file isn't being picked up — check the path and that you ran compose from `/var/www/AS500`.

---

## 6. Verify

From the VPS (bypasses Caddy):

```bash
curl http://localhost:3002/mcp/health
# => {"ok":true,"auth":"oauth2.1","phase":3}
```

From anywhere (through Caddy + TLS):

```bash
curl https://adv.entence.se/mcp/health
# => {"ok":true,"auth":"oauth2.1","phase":3}

curl https://adv.entence.se/.well-known/oauth-authorization-server
# issuer MUST be "https://adv.entence.se/" — if it says "http://localhost:3002/"
# then MCP_PUBLIC_URL didn't make it into the container.
```

From your laptop:

```bash
claude mcp add --transport http as500-prod https://adv.entence.se/mcp
# Next tool invocation opens the browser → AS500 consent page → done.
```

---

## Rolling a compromised JWT secret

If `AS500_MCP_JWT_SECRET` leaks:

```bash
# 1. New secret
openssl rand -hex 48

# 2. Update /var/www/AS500/.env

# 3. Restart the app container (no rebuild needed — env only)
docker compose -f docker-compose.prod.yml up -d app

# 4. Optional belt-and-suspenders: nuke all live MCP tokens from the DB
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U as500 -d as500 -c \
  "DELETE FROM auth_tokens WHERE kind IN ('mcp_access','mcp_refresh','mcp_authcode');"
```

All agents will need to re-consent on their next call (Claude Code handles this automatically — it just re-opens the browser).

---

## Disabling MCP in prod without a redeploy

Add to `.env`:

```
MCP_ENABLED=false
```

Then `docker compose -f docker-compose.prod.yml up -d app`. The MCP server won't boot; port `3002` will sit idle in the container. Caddy will start returning `502 Bad Gateway` on `/mcp` paths, which is fine.

---

## Troubleshooting

**`claude mcp add` succeeds but first tool call hangs on OAuth**
The browser opened `http://localhost:3002/authorize` instead of `https://adv.entence.se/authorize`. → `MCP_PUBLIC_URL` is not reaching the container. Check `docker compose exec app env | grep MCP_PUBLIC_URL`.

**`curl https://adv.entence.se/mcp` returns the React SPA HTML**
The Caddy matcher didn't match `/mcp`. → The `@mcp` block must come **before** the catch-all `reverse_proxy [::1]:3001`. Caddy processes matchers in order.

**`502 Bad Gateway` on all MCP paths**
MCP server isn't running inside the container. → `docker compose logs app | grep -i mcp` and check for the "MCP server running" line or an error.

**Agents get kicked out after a deploy**
`AS500_MCP_JWT_SECRET` is unset or was regenerated. → Check `.env` exists and `docker compose exec app printenv AS500_MCP_JWT_SECRET` returns it.

**OAuth metadata returns `localhost` URLs**
`MCP_PUBLIC_URL` is unset or malformed. Must be a full origin with scheme, no trailing slash: `https://adv.entence.se` (✅), `adv.entence.se` (❌), `https://adv.entence.se/` (❌ — trailing slash breaks issuer comparison in some clients).
