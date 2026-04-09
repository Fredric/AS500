# AS500 - Modern Mainframe Terminal System

A modern client-server solution that emulates an AS400 mainframe terminal. The backend sends complete screens (not data), controls navigation, owns validation, and treats the UI as a dumb terminal.

![Terminal Screenshot](https://img.shields.io/badge/style-green%20screen-33ff33?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?style=flat-square)
![React](https://img.shields.io/badge/React-18-61dafb?style=flat-square)
![WebSocket](https://img.shields.io/badge/WebSocket-ws-yellow?style=flat-square)

## Features

- Classic green-on-black terminal aesthetic with CRT effects
- WebSocket-based real-time communication
- **CRUDTable config system** — declarative configs that auto-generate list + form screens
- **Modern token-based authentication** — OAuth 2.0-inspired access/refresh token pattern
- **Secure session management** — 30-day auto-login with 1-hour token rotation
- **Device tracking** — Multi-device session management with device fingerprinting
- **Rate limiting** — Protection against brute force and token abuse
- bcrypt password hashing with PostgreSQL storage
- Full keyboard support (F-keys, Tab, Enter)
- Automated backup system with scheduled backups
- Docker Compose setup for easy development environment

## Quick Start

### Option 1: Docker Compose (Recommended for Development)

Run everything in Docker containers:

```bash
# Start all services (PostgreSQL, server, and client)
docker-compose up

# Or run in detached mode
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

The application will be available at:
- **Client UI:** http://localhost:5173
- **Server WebSocket:** ws://localhost:3001
- **PostgreSQL:** localhost:5433

**Features:**
- Hot reload for both server and client code changes
- Session persistence survives server restarts during development
- Isolated `node_modules` in Docker volumes (no conflicts with host)
- Automatic dependency installation

### Option 2: Local Development

Run services directly on your machine:

```bash
# Optional: PostgreSQL via Docker (maps host 5433 → container 5432)
docker-compose up -d postgres

# Terminal 1: Start server
cd server
npm install
npm run seed    # Creates default user (first time only)
PGPORT=5433 npm run dev   # Use 5433 if using Docker Postgres (avoids local Postgres on 5432)
# Or: npm run dev         # Uses PGPORT from .env or default 5432

# Terminal 2: Start client
cd client
npm install
npm run dev     # Runs on http://localhost:5173
```

**Note:** If you run Postgres in Docker (`docker-compose up -d postgres`), set `PGPORT=5433` when starting the server (or in `server/.env`). Docker maps `5433:5432` so the app doesn’t hit a local Postgres on 5432.

### Login Credentials

Open http://localhost:5173 and login with:
- **Username:** `FREDRIC`
- **Password:** `fredric`

## Architecture

```
┌─────────────┐     WebSocket      ┌─────────────┐
│   Client    │◄──────────────────►│   Server    │
│   (React)   │   JSON messages    │  (Node.js)  │
│             │                    │             │
│  Cookies:   │                    │  Sessions + │
│  • Session  │                    │  Auth Tokens│
│  • Access   │                    │             │
│  • Refresh  │                    │             │
│  • Device   │                    │             │
└─────────────┘                    └──────┬──────┘
                                          │
                                   ┌──────▼──────┐
                                   │ PostgreSQL  │
                                   │  • Users    │
                                   │  • Tokens   │
                                   │  • Sessions │
                                   └─────────────┘
```

- **Backend owns everything** - UI is a "dumb terminal"
- **Screen-based** - Server sends complete rendered screens
- **Session-based** - All state lives on the server
- **Token-based auth** - Secure access/refresh token rotation

## Tech Stack

| Component | Technology |
|-----------|------------|
| Server | Node.js, TypeScript, ws, pg (PostgreSQL), bcrypt |
| Client | React 18, TypeScript, Vite |
| Database | PostgreSQL (with SQLite support) |
| Development | Docker Compose, tsx (hot reload) |

## Project Structure

```
AS500/
├── server/
│   └── src/
│       ├── index.ts          # WebSocket server & router
│       ├── crudtable/        # CRUDTable runtime engine
│       │   ├── types.ts      # Config interfaces
│       │   ├── registry.ts   # Config store
│       │   ├── runtime.ts    # Core engine (list + form screens)
│       │   └── router.ts     # Router integration
│       ├── configs/          # CRUDTable config definitions
│       ├── screens/          # Hand-written screens (login, menu, help)
│       ├── services/         # Business logic
│       ├── session/          # Session management
│       └── db/               # Database
└── client/
    └── src/
        ├── components/       # React components
        ├── hooks/            # Custom hooks
        └── styles/           # CSS
```

## CRUDTable System

The recommended way to create CRUD screens. Instead of writing ~300 lines of screen handlers, write a ~60 line config:

```typescript
// server/src/configs/myItems.ts
export const myItemsConfig: CRUDTableConfig = {
  id: 'my_items',
  title: 'My Items',
  services: {
    list:   { service: myService, method: 'getAll' },
    create: { service: myService, method: 'create', params: ctx => ctx.values },
    update: { service: myService, method: 'update', params: ctx => ({ id: ctx.editRecord!.id, ...ctx.values }) },
    delete: { service: myService, method: 'remove', params: ctx => ctx.selection[0].id },
  },
  fieldConfigs: {
    name: { field: 'name', label: 'Name', length: 20, form: { required: true } },
  },
  columnBuilder: ['name'],
  formBuilder: ['name'],
};
```

The runtime auto-generates: paginated list screen, create/edit form, option handling (2=Edit, 4=Delete), F-key navigation, validation, and error handling.

See [CLAUDE.md](CLAUDE.md) for the full CRUDTable reference.

## Authentication & Security

AS500 implements a modern, secure authentication system aligned with 2026 industry standards:

### Token-Based Authentication

**Dual-Token Pattern** (inspired by OAuth 2.0):
- **Access Token** - Short-lived (1 hour), used for active authentication
- **Refresh Token** - Long-lived (30 days), used to reissue access tokens
- **Token Rotation** - Both tokens are rotated when refresh token is used (prevents replay attacks)

**User Experience:**
- Login once, stay authenticated for 30 days
- Access tokens automatically refresh in the background
- No password re-entry needed unless refresh token expires
- Seamless session restoration on browser restart

### Security Features

**Implemented (Phase 1):**
- ✅ **bcrypt password hashing** - Industry-standard password security
- ✅ **Token rotation** - Access and refresh tokens both rotate on use
- ✅ **Device tracking** - Each token pair linked to device fingerprint
- ✅ **Rate limiting** - Protection against brute force (5 login attempts/min, 10 token refreshes/hour)
- ✅ **Secure cookies** - `SameSite=Strict`, `Secure` flag for HTTPS
- ✅ **Token revocation** - Sign out, sign out all devices, or revoke specific device
- ✅ **Audit trail** - `last_used_at` tracking for all tokens
- ✅ **Auto-cleanup** - Expired and revoked tokens automatically purged

**Database Schema:**
```sql
auth_tokens (
  access_token, refresh_token,         -- Dual tokens
  access_expires_at, refresh_expires_at, -- Separate expiry
  device_id, device_name, user_agent,  -- Device tracking
  ip_address,                          -- Security context
  last_used_at, revoked_at             -- Audit trail
)
```

### Session Management

**Triple-Layer Approach:**
1. **WebSocket Session** (15 min) - Active connection state
2. **Session Cookie** (7 days) - Session ID persistence
3. **Auth Tokens** (1h + 30d) - Authentication credentials

**Flow:**
```
User logs in
  └─> Server issues: Session ID + Access Token + Refresh Token
      ├─> Client stores in cookies (auto-sent with requests)
      └─> Session expires (15 min inactivity)
          ├─> Access token still valid? → Auto-restore session
          └─> Access token expired?
              ├─> Refresh token valid? → Rotate tokens + restore session
              └─> Refresh token expired? → Require login
```

**Benefits:**
- Users stay logged in for 30 days without re-entering password
- Short access token window (1h) limits exposure if compromised
- Token rotation detects theft (old tokens invalidated)
- Device tracking enables "where you're signed in" feature

### Rate Limiting

In-memory rate limiting protects against abuse:
- **Login**: 5 attempts per minute per session
- **Token Refresh**: 10 per hour per user
- **General Requests**: 100 per minute per user

### Future Enhancements (Roadmap)

**Phase 2 - Scalability:**
- [ ] Migrate sessions to Redis for horizontal scaling
- [ ] Add comprehensive audit logging (`auth_events` table)
- [ ] Build admin security dashboard

**Phase 3 - User Experience:**
- [ ] "Active Sessions" screen - view/revoke devices
- [ ] Email notifications for new device logins
- [ ] Geolocation-based security alerts
- [ ] "Remember this device for 90 days" option

## Development Features

### Session & Token Persistence

**Development Mode** (`NODE_ENV !== 'production'`):
- **Sessions** persisted to disk (`server/data/sessions.json`)
- **Tokens** stored in PostgreSQL with full audit trail
- Sessions survive server restarts during development
- Automatic restoration of valid sessions on server start
- 15-minute session timeout still applies

**Production Mode**:
- Sessions remain in-memory only (no file persistence)
- Tokens stored in PostgreSQL (production-ready)
- Token-based auto-login keeps users authenticated for 30 days

**Authentication Testing:**
```bash
# Login once, then test persistence:
1. Login with FREDRIC / fredric
2. Close browser
3. Reopen → Should auto-login via refresh token
4. Wait 1 hour → Access token expires → Should auto-refresh
5. Restart server → Session + tokens restored
```

**Check Cookies** (Browser DevTools → Application → Cookies):
- `as500_session` - Session ID (7 days)
- `as500_access_token` - Short-lived auth (1 hour)
- `as500_refresh_token` - Long-lived auth (30 days)
- `as500_device_id` - Device fingerprint (1 year)

### Hot Reload

Both server and client support hot reload:
- **Server**: Uses `tsx watch` - automatically restarts on file changes
- **Client**: Uses Vite HMR - instant updates in the browser
- **Docker**: Volume mounts ensure code changes are reflected immediately

### Database Tools

```bash
# Access PostgreSQL in Docker
docker-compose exec postgres psql -U as500 -d as500

# Check auth tokens
SELECT user_id, device_name, last_used_at, 
       access_expires_at > NOW() as access_valid,
       refresh_expires_at > NOW() as refresh_valid
FROM auth_tokens 
WHERE revoked_at IS NULL;

# Revoke all tokens for a user (force logout)
UPDATE auth_tokens SET revoked_at = NOW() WHERE user_id = 1;
```

## Documentation

See [CLAUDE.MD](CLAUDE.MD) for detailed documentation including:
- Protocol specification
- Adding new screens
- Session management
- Troubleshooting

See [BACKUP.md](BACKUP.md) for backup system documentation including:
- Automated backup configuration
- Manual backup creation
- Restoring from backups
- Backup management


