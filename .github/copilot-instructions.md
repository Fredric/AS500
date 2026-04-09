# GitHub Copilot Instructions for AS500

## Project Overview

AS500 is a modern implementation of an AS/400 mainframe terminal system - a unique full-stack web application that emulates the classic green-screen mainframe experience using modern web technologies. This is a time tracking system with an authentic AS/400 user experience.

**Critical Architectural Principle**: This is NOT a typical REST API web application. It's a terminal emulator with a WebSocket-based protocol where the **server controls everything**. The client is literally a "dumb terminal" that only displays 80×24 character screens and captures keyboard input.

## Technology Stack

- **Backend**: Node.js + TypeScript (ES2022, ESNext modules)
- **Frontend**: React 18 + TypeScript + Vite
- **Database**: PostgreSQL 16 (Alpine)
- **Communication**: WebSocket (ws package)
- **Development**: Docker Compose
- **Key Dependencies**: ws, pg, drizzle-orm, bcrypt, uuid, tsx (server); react, react-dom, vite (client)

## Repository Structure

```
AS500/
├── server/              # Backend (Node.js + TypeScript)
│   ├── src/
│   │   ├── index.ts     # WebSocket server entry point & router
│   │   ├── types/       # Shared TypeScript interfaces
│   │   ├── db/          # PostgreSQL schema & seeding
│   │   ├── session/     # Session management (persisted in dev)
│   │   ├── services/    # Business logic (auth, timeReg)
│   │   ├── dsl/         # Screen DSL system (like AS/400 DDS)
│   │   └── screens/     # Screen definitions & handlers
│   ├── data/            # Session persistence (dev only, gitignored)
│   ├── backups/         # Database backups (gitignored)
│   └── scripts/         # Database backup/restore utilities
│
└── client/             # Frontend (React + TypeScript)
    └── src/
        ├── components/  # Terminal renderer
        ├── hooks/       # useTerminal (WebSocket, keyboard, state)
        └── styles/      # Green screen CRT aesthetics
```

## Build, Test, and Development Workflows

### Initial Setup (Docker - RECOMMENDED)

**ALWAYS use Docker Compose for development** to avoid environment setup issues:

```bash
# Start all services (PostgreSQL, Server, Client)
docker-compose up

# In another terminal, seed the database (first time only)
docker-compose exec server npm run seed
```

This automatically starts:
- **PostgreSQL** on port 5433 (host) mapped from container port 5432
- **Server** on ws://localhost:3001
- **Client** on http://localhost:5173

### Development Commands

**Docker Compose** (from project root):
```bash
docker-compose up           # Start all services
docker-compose up -d        # Start in background
docker-compose down         # Stop all services
docker-compose down -v      # Stop and remove volumes (reset DB)
docker-compose logs -f      # Follow logs
docker-compose exec server npm run seed  # Seed database
```

**Server** (inside container: `docker-compose exec server bash` or run locally):
```bash
npm run dev       # Start dev server with hot reload (tsx watch)
npm run build     # Compile TypeScript to dist/
npm start         # Run compiled production build
npm run seed      # Seed database with test data
npm run backup-db   # Create PostgreSQL backup (pg_dump)
npm run restore-db <file>  # Restore from backup (psql)
```

**Client** (inside container or locally):
```bash
npm run dev     # Start Vite dev server (http://localhost:5173)
npm run build   # Build for production (outputs to dist/)
npm run preview # Preview production build
```

### Testing Changes

1. **Always start with Docker Compose**: `docker-compose up`
2. **Login credentials**: Username: `FREDRIC`, Password: `fredric`
3. **Hot reload is enabled**: Changes to server/client code automatically reload
4. **Sessions persist in dev**: Sessions saved to `server/data/sessions.json` (survives restarts)
5. **Database persists**: PostgreSQL data stored in Docker volume `postgres_data`
6. **To reset database**: `docker-compose down -v && docker-compose up`

### Environment Variables

**For Docker** (set automatically via docker-compose.yml):
```
DATABASE_URL=postgresql://as500:as500@postgres:5432/as500
```

**For Local Development** (without Docker):
```bash
export PGHOST=localhost
export PGPORT=5433     # Docker maps host 5433 to container 5432
export PGUSER=as500
export PGPASSWORD=as500
export PGDATABASE=as500
```

## Key Architectural Patterns

### 1. Dumb Terminal Architecture

**Server Owns**:
- Current screen state and screen stack (navigation history)
- User context & authentication
- ALL validation logic and ALL business logic
- Session data
- Screen rendering (80×24 grid)

**Client Owns**:
- Displaying the screen exactly as sent
- Capturing keyboard input (Enter, F-keys, Tab)
- Managing session cookie
- Visual effects (CRT glow, scanlines)

**IMPORTANT**: The client does NO validation, NO navigation logic, NO business logic. It's purely presentational.

### 2. Screen DSL Pattern

Inspired by AS/400 DDS (Display Data Structures), the DSL separates logical screen definition from physical rendering.

**Pattern**: Screen Definition (DSL) → Layout Engine → 80×24 Renderer

**Files**:
- `server/src/dsl/index.ts` - Public API
- `server/src/dsl/renderer.ts` - 80×24 renderer
- `server/src/dsl/components/` - DSL components (primitives, header, form, subfile, menu)

**Example**:
```typescript
const MY_SCREEN = defineScreen('MY_SCREEN', {
  elements: [
    header({ title: 'My Screen' }),
    form(10, [
      ['Name:', field('name', 20, 'alpha', { required: true })],
      ['Age:', field('age', 3, 'numeric')],
    ]),
  ],
  statusLine: 'F3=Exit  F12=Cancel',
  defaultCursor: 'name',
});

const screen = render(MY_SCREEN, fieldValues, options);
```

### 3. WebSocket Protocol

**Client Request** (to server):
```typescript
{
  sessionId: string | null,     // Session UUID
  screenId: string,             // Current screen ID
  cursor: { row: number, col: number },
  input: { fieldName: "value" }, // Field values
  key: string                   // "ENTER", "F3", "F12", etc.
}
```

**Server Response** (to client):
```typescript
{
  sessionId: string,
  screenId: string,
  cursor: { row: number, col: number },
  rows: string[],              // 24 rows of 80 chars
  fields: Field[],             // Input field definitions
  fieldValues?: { name: "value" },
  message: string | null,
  messageType: "info" | "warning" | "error" | null,
  statusLine: string,
  bell: boolean
}
```

**Special Keys**: `CONNECT` (initial connection), `RESUME` (restore session)

### 4. Session Management

- **Storage**: In-memory Map + file persistence in development only
- **Session timeout**: 15 minutes of inactivity
- **Dev mode**: Sessions automatically saved to `server/data/sessions.json`
- **File**: `server/src/session/index.ts`

## Database Layer

**PostgreSQL 16** accessed via **Drizzle ORM** (typed query builder) on top of a `pg` connection pool.

### Tables

**users**: User accounts with bcrypt password hashing
**days**: Time registration - one record per user per day (user_id, workday, daysum)
**day_items**: Individual time entries (day_id, start_hour, end_hour, jiratask, description, rowsum)
**auth_tokens**: Access + refresh tokens for WebSocket authentication

### Key files

- `server/src/db/schema.ts` — Drizzle table definitions, single source of truth for column types
- `server/src/db/index.ts` — exports `db` (Drizzle instance) and `pool` (raw pg); runs `CREATE TABLE IF NOT EXISTS` migrations at startup
- `server/src/db/seed.ts` — seeds default users

### Writing database queries

Services import `db` and table objects from the schema — **do not use raw `pool.query`**:

```typescript
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';

const rows = await db.select().from(users).where(eq(users.id, id));
await db.insert(users).values({ username: 'FOO', ... }).returning();
await db.update(users).set({ active: false }).where(eq(users.id, id));
```

### Migrations

There is no drizzle-kit migration tooling. Schema changes are applied via `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE` blocks inside `initializeDatabase()` in `db/index.ts`, which runs automatically on every server start.

## Coding Conventions

### TypeScript

1. **ES Modules**: All code uses `import`/`export` with `.js` extensions in imports
2. **Strict mode**: Always use proper types from `types/index.ts`
3. **No `any` types** unless absolutely necessary

### Naming Conventions

1. **Screen IDs**: `UPPER_CASE_SNAKE` (e.g., `LOGIN`, `MAIN_MENU`, `TIME_REG`)
2. **Screen Constants**: `UPPER_CASE_SNAKE` + `_SCREEN` suffix (e.g., `LOGIN_SCREEN`)
3. **Functions**:
   - Handlers: `handleScreenName()` (e.g., `handleLogin()`)
   - Builders: `buildScreenNameScreen()` (e.g., `buildLoginScreen()`)
   - Services: camelCase (e.g., `authenticateUser()`, `getTimeEntries()`)
4. **Files**: camelCase (e.g., `login.ts`, `mainMenu.ts`, `auth.ts`)

### File Organization

**Screen files** (`server/src/screens/*.ts`) should contain:
- Screen DSL definition (constant)
- `buildScreen()` function (renders screen)
- `handleScreen()` function (business logic)

**Service files** (`server/src/services/*.ts`) should contain:
- Pure business logic functions
- Database operations
- No screen rendering

## Important Notes for Coding Agents

1. **Always use Docker Compose** for development unless explicitly instructed otherwise
2. **Never modify client-side validation logic** - the client is a dumb terminal
3. **All business logic must be in the server** - never in the client
4. **TypeScript imports use `.js` extensions** even for `.ts` files (ES modules)
5. **Session persistence is dev-only** - don't rely on it in production code
6. **Database queries**: Use `db` (Drizzle) from `server/src/db/index.ts`, not raw `pool.query`. Connection is configured via `DATABASE_URL` or individual `PG*` variables.
7. **Hot reload is automatic** - no need to manually restart during development
8. **Seed the database first** before testing: `docker-compose exec server npm run seed`

## Testing Workflow

1. Start services: `docker-compose up`
2. Seed database (first time): `docker-compose exec server npm run seed`
3. Open browser: http://localhost:5173
4. Login with: FREDRIC / fredric
5. Make code changes (hot reload will apply them)
6. Test in browser
7. Check logs: `docker-compose logs -f`

## Common Issues

- **Database connection errors**: Ensure PostgreSQL is running via `docker-compose up` or `docker-compose up postgres`
- **Port conflicts**: Default ports are 5173 (client), 3001 (server), 5433 (postgres host port)
- **Session lost**: Check `server/data/sessions.json` exists and is valid JSON
- **TypeScript errors**: Ensure you're using ES module syntax with `.js` import extensions

For detailed documentation, see:
- `README.md` - Quick start guide
- `CLAUDE.md` - Comprehensive AI assistant guide
- `BACKUP.md` - Backup system documentation
