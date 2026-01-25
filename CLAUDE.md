# CLAUDE.md - AI Assistant Guide for AS500

This document provides comprehensive guidance for AI assistants working with the AS500 codebase.

## Project Overview

**AS500** is a modern implementation of an AS/400 mainframe terminal system. It's a unique full-stack web application that emulates the classic green-screen mainframe experience using modern web technologies.

### Key Characteristics

- **Architecture Pattern**: "Dumb Terminal" - Backend owns ALL logic, frontend is purely presentational
- **Communication**: Real-time WebSocket (ws protocol)
- **Backend**: Node.js + TypeScript + PostgreSQL
- **Frontend**: React + TypeScript + Vite
- **Development**: Docker Compose (PostgreSQL + Server + Client containers)
- **Purpose**: Time tracking system with authentic AS/400 UX

### Critical Architectural Principle

⚠️ **The server controls everything.** The client is literally a "dumb terminal" that:
- Displays 80×24 character screens exactly as sent by the server
- Captures keyboard input (Enter, F-keys, Tab)
- Sends keystrokes and field data to the server
- Does NO validation, NO navigation logic, NO business logic

This is not a typical REST API web app. It's a terminal emulator with a WebSocket-based protocol.

---

## Repository Structure

```
AS500/
├── README.md                 # Quick start guide
├── project.md                # Comprehensive technical documentation
├── BACKUP.md                 # Backup system documentation
├── CLAUDE.md                 # This file - AI assistant guide
├── docker-compose.yml        # Docker development environment
│
├── server/                   # Backend (Node.js + TypeScript)
│   ├── package.json         # Server dependencies
│   ├── tsconfig.json        # TypeScript config (ES2022, ESNext modules)
│   │
│   ├── data/                # Session persistence (dev only, gitignored)
│   │   └── sessions.json    # Persisted sessions for dev hot-reload
│   │
│   ├── backups/             # Database backups (pg_dump output, gitignored)
│   │
│   ├── scripts/             # Database utility scripts
│   │   ├── backup-database.ts   # PostgreSQL backup (pg_dump)
│   │   └── restore-database.ts  # PostgreSQL restore (psql)
│   │
│   └── src/
│       ├── index.ts         # WebSocket server entry point & router
│       │
│       ├── types/
│       │   └── index.ts     # Shared TypeScript interfaces
│       │
│       ├── db/
│       │   ├── index.ts     # PostgreSQL connection pool & schema
│       │   └── seed.ts      # Database seeding script
│       │
│       ├── session/
│       │   └── index.ts     # Session management (persisted to file in dev)
│       │
│       ├── services/
│       │   ├── auth.ts      # Authentication (bcrypt)
│       │   └── timeReg.ts   # Time tracking business logic
│       │
│       ├── dsl/             # Screen DSL system (like AS/400 DDS)
│       │   ├── index.ts     # Public API exports
│       │   ├── types.ts     # DSL type definitions
│       │   ├── renderer.ts  # 80×24 grid renderer
│       │   └── components/
│       │       ├── primitives.ts  # text(), field(), box(), line()
│       │       ├── header.ts      # Standard screen header
│       │       ├── form.ts        # Form layout component
│       │       ├── subfile.ts     # Scrollable list component
│       │       └── menu.ts        # Menu component
│       │
│       └── screens/         # Screen definitions & handlers
│           ├── login.ts     # LOGIN screen
│           ├── mainMenu.ts  # MAIN_MENU screen
│           ├── timeReg.ts   # TIME_REG (subfile list)
│           ├── timeEntry.ts # TIME_ENTRY (form)
│           └── timeRegHelp.ts  # TIME_REG_HELP
│
└── client/                  # Frontend (React + TypeScript)
    ├── package.json        # Client dependencies
    ├── tsconfig.json       # TypeScript config (ES2020, React JSX)
    ├── vite.config.ts      # Vite config (port 5173)
    ├── index.html          # HTML entry point
    │
    └── src/
        ├── main.tsx        # React entry point
        ├── App.tsx         # Root App component
        │
        ├── types/
        │   └── index.ts    # Client TypeScript interfaces
        │
        ├── hooks/
        │   └── useTerminal.ts  # WebSocket, keyboard, state mgmt
        │
        ├── components/
        │   └── Terminal.tsx    # Terminal renderer component
        │
        └── styles/
            └── terminal.css    # Green screen CRT aesthetics
```

---

## Technology Stack

### Server Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| ws | ^8.18.0 | WebSocket server |
| pg | ^8.13.0 | PostgreSQL client (connection pool) |
| bcrypt | ^6.0.0 | Password hashing (10 rounds) |
| uuid | ^11.0.4 | Session ID generation |
| tsx | ^4.19.2 | TypeScript execution for dev |
| typescript | ^5.7.3 | Type checking |

### Client Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| react | ^18.3.1 | UI framework |
| react-dom | ^18.3.1 | DOM rendering |
| vite | ^6.0.7 | Build tool & dev server |
| typescript | ^5.7.3 | Type checking |
| @vitejs/plugin-react | ^4.3.4 | React support for Vite |

### TypeScript Configuration

**Server** (`server/tsconfig.json`):
- Target: ES2022
- Module: ESNext
- Module Resolution: bundler
- Strict mode enabled
- Output: `dist/` directory

**Client** (`client/tsconfig.json`):
- Target: ES2020
- Module: ESNext
- JSX: react-jsx
- Strict mode enabled
- No emit (Vite handles bundling)

---

## Development Workflows

### Initial Setup (Docker - Recommended)

```bash
# Start all services (PostgreSQL, Server, Client)
docker-compose up

# In another terminal, seed the database
docker-compose exec server npm run seed
```

This starts:
- **PostgreSQL** on port 5433 (mapped from container's 5432)
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

**Server** (`server/` - run inside container or locally):
```bash
npm run dev       # Start dev server with hot reload (tsx watch)
npm run build     # Compile TypeScript to dist/
npm start         # Run compiled production build
npm run seed      # Seed database with test data
npm run backup-db   # Create PostgreSQL backup (pg_dump)
npm run restore-db <file>  # Restore from backup (psql)
```

**Client** (`client/`):
```bash
npm run dev     # Start Vite dev server (http://localhost:5173)
npm run build   # Build for production (outputs to dist/)
npm run preview # Preview production build
```

### Running the Application

**Option 1: Docker (Recommended)**
```bash
docker-compose up
# Open http://localhost:5173
# Login: FREDRIC / fredric
```

**Option 2: Local Development**
1. Start PostgreSQL (use Docker or local install)
2. Set environment variables (see below)
3. Run server and client manually

### Environment Variables

**For Docker** (set automatically via docker-compose.yml):
```
DATABASE_URL=postgresql://as500:as500@postgres:5432/as500
```

**For Local Development** (without Docker):
```bash
export PGHOST=localhost
export PGPORT=5433     # Docker maps 5433:5432
export PGUSER=as500
export PGPASSWORD=as500
export PGDATABASE=as500
```

### Development Workflow

1. **Docker manages everything**: PostgreSQL, Server, Client all run in containers
2. **Hot reload works**: Server uses `tsx watch`, Client uses Vite
3. **Sessions persist**: Sessions are saved to `server/data/sessions.json` during development (survives server restarts)
4. **Database persists**: PostgreSQL data stored in Docker volume `postgres_data`
5. **To reset database**: `docker-compose down -v && docker-compose up`

---

## Key Architectural Patterns

### 1. Dumb Terminal Architecture

```
┌─────────────┐     WebSocket      ┌─────────────┐
│   Client    │◄──────────────────►│   Server    │
│   (React)   │   JSON messages    │  (Node.js)  │
│  Renderer   │                    │ All Logic   │
└─────────────┘                    └──────┬──────┘
                                          │
                                   ┌──────▼──────┐
                                   │ PostgreSQL  │
                                   └─────────────┘
```

**Server Owns:**
- Current screen state
- Screen stack (navigation history)
- User context & authentication
- All validation logic
- All business logic
- Session data
- Screen rendering (80×24 grid)

**Client Owns:**
- Displaying the screen
- Capturing keyboard input
- Managing session cookie
- Visual effects (CRT glow, scanlines)

### 2. Screen DSL Pattern

Inspired by AS/400 DDS (Display Data Structures), the DSL separates logical screen definition from physical rendering.

**Pattern**:
```
Screen Definition (DSL)  →  Layout Engine  →  80×24 Renderer
   defineScreen()           Components           rows[] + fields[]
```

**Example**:
```typescript
// 1. Define screen structure (logical)
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

// 2. Render to protocol format (physical)
const screen = render(MY_SCREEN, fieldValues, options);
```

**Files**:
- `server/src/dsl/index.ts` - Public API
- `server/src/dsl/renderer.ts` - 80×24 renderer
- `server/src/dsl/components/` - DSL components

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
  sessionId: string,            // Session UUID
  screenId: string,             // Screen to display
  cursor: { row: number, col: number },
  rows: string[],              // 24 rows of 80 chars
  fields: Field[],             // Input field definitions
  fieldValues?: { name: "value" }, // Pre-populated values
  message: string | null,       // Status/error message
  messageType: "info" | "warning" | "error" | null,
  statusLine: string,          // F-key hints
  bell: boolean                // Play terminal bell
}
```

**Special Keys**:
- `CONNECT` - Initial connection (no session)
- `RESUME` - Restore existing session from cookie

### 4. Session Management

**Storage**: In-memory Map + file persistence (development only)

In development mode (`NODE_ENV !== 'production'`), sessions are automatically persisted to `server/data/sessions.json`. This means:
- Sessions survive server restarts during development
- Hot-reload doesn't lose your login state
- File writes are debounced (500ms) to avoid excessive I/O

**Session Interface** (`server/src/types/index.ts`):
```typescript
interface Session {
  id: string;                    // UUID
  viserId: number | null;        // User ID from DB
  username: string | null;
  authenticated: boolean;
  currentScreen: string;         // e.g., "MAIN_MENU"
  screenStack: string[];         // For F12 navigation
  context: Record<string, unknown>; // Working data
  lastActivity: Date;
}
```

**Lifecycle**:
1. Client connects → Server creates session
2. Session ID stored in browser cookie (1 day)
3. Session timeout: 15 minutes of inactivity
4. On page refresh: client sends RESUME with sessionId
5. On sign-off (F3): session deleted, cookie cleared
6. (Dev only) Sessions saved to file on every change

**File**: `server/src/session/index.ts`

---

## Database Schema

**Database**: PostgreSQL 16 (Alpine)
**Connection**: Via `pg` package with connection pool
**Location**: Docker volume `postgres_data` (or external PostgreSQL instance)

### Connection Configuration

The server supports two connection methods:

1. **DATABASE_URL** (preferred for Docker/production):
   ```
   postgresql://as500:as500@postgres:5432/as500
   ```

2. **Individual PG* variables** (for local development):
   ```
   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
   ```

### Tables

#### users
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,       -- bcrypt hash
  full_name TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### days
Time registration - one record per user per day
```sql
CREATE TABLE days (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  workday DATE NOT NULL,
  daysum NUMERIC(5,2) DEFAULT 0,     -- Total hours for day
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, workday)
);
```

#### day_items
Individual time entries for a day
```sql
CREATE TABLE day_items (
  id SERIAL PRIMARY KEY,
  day_id INTEGER NOT NULL REFERENCES days(id) ON DELETE CASCADE,
  start_hour TEXT NOT NULL,          -- "HH:MM"
  end_hour TEXT NOT NULL,            -- "HH:MM"
  jiratask TEXT,                     -- e.g., "STEAKT-2987"
  description TEXT,                  -- Free text (30 chars)
  rowsum NUMERIC(5,2) DEFAULT 0,     -- Calculated hours
  sort_order INTEGER DEFAULT 0
);
```

**Files**:
- Schema & Pool: `server/src/db/index.ts`
- Seeding: `server/src/db/seed.ts`

---

## Coding Conventions

### TypeScript Patterns

1. **ES Modules**: All code uses ES modules (`import`/`export`)
   ```typescript
   import { something } from './module.js';  // Note: .js extension
   ```

2. **Type Safety**: Strict mode enabled
   - Always use proper types from `types/index.ts`
   - No `any` types unless absolutely necessary

3. **Function Signatures**:
   ```typescript
   // Screen handlers (async for database operations)
   export async function handleMyScreen(
     session: Session,
     request: ClientRequest
   ): Promise<ScreenResponse> {
     // ...
   }

   // Screen builders (can be sync if no DB calls)
   export function buildMyScreen(
     session: Session,
     message?: string,
     messageType?: 'info' | 'error' | 'warning'
   ): Omit<ScreenResponse, 'sessionId'> {
     // ...
   }
   ```

### Naming Conventions

1. **Screen IDs**: UPPER_CASE_SNAKE
   - Examples: `LOGIN`, `MAIN_MENU`, `TIME_REG`, `TIME_ENTRY`

2. **Screen Constants**: UPPER_CASE_SNAKE + `_SCREEN` suffix
   ```typescript
   const LOGIN_SCREEN = defineScreen('LOGIN', { ... });
   ```

3. **Functions**:
   - Handlers: `handleScreenName()` - e.g., `handleLogin()`
   - Builders: `buildScreenNameScreen()` - e.g., `buildLoginScreen()`
   - Services: camelCase - e.g., `authenticateUser()`, `getTimeEntries()`

4. **Files**: camelCase
   - Screen files: `screenName.ts` - e.g., `login.ts`, `mainMenu.ts`
   - Service files: `serviceName.ts` - e.g., `auth.ts`, `timeReg.ts`

### File Organization

1. **Screen files** should contain:
   - Screen DSL definition (constant)
   - `buildScreen()` function (renders screen)
   - `handleScreen()` function (business logic)

2. **Service files** should contain:
   - Pure business logic
   - Database operations
   - No screen rendering

3. **DSL components** should:
   - Return `Element` objects
   - Be composable and reusable
   - Handle positioning automatically where possible

### Code Style

1. **Error Handling**:
   ```typescript
   try {
     // operation
   } catch (error) {
     console.error('Descriptive error:', error);
     return { ...buildScreen(session, 'Error message', 'error'), ...base };
   }
   ```

2. **Database Operations**: Use async PostgreSQL pool API
   ```typescript
   import { pool } from '../db/index.js';

   // Query with parameters (use $1, $2, etc. for placeholders)
   const result = await pool.query(
     'SELECT * FROM users WHERE username = $1',
     [username]
   );
   const user = result.rows[0];
   ```

3. **Session Context**: Store working data in `session.context`
   ```typescript
   session.context.currentDate = '2026-01-20';
   session.context.selectedCustomerId = 123;
   ```

---

## Screen Development Guide

### Adding a New Screen

**Step 1: Create Screen File**

Create `server/src/screens/myScreen.ts`:

```typescript
import type { Session, ClientRequest, ScreenResponse } from '../types/index.js';
import { defineScreen, render, header, form, field } from '../dsl/index.js';

// Define screen structure
const MY_SCREEN = defineScreen('MY_SCREEN', {
  elements: [
    header({ system: 'AS500 SYSTEM', title: 'My Screen Title' }),
    form(10, [
      ['Field Label:', field('fieldName', 20, 'alpha', { required: true })],
    ]),
  ],
  statusLine: 'F3=Exit  F12=Cancel',
  defaultCursor: 'fieldName',
});

// Screen builder (renders screen)
export function buildMyScreen(
  session: Session,
  message?: string,
  messageType?: 'info' | 'error' | 'warning'
): Omit<ScreenResponse, 'sessionId'> {
  const fieldValues = {}; // Pre-populate if editing
  return render(MY_SCREEN, fieldValues, { message, messageType, user: session.username });
}

// Screen handler (business logic - async for DB operations)
export async function handleMyScreen(
  session: Session,
  request: ClientRequest
): Promise<ScreenResponse> {
  const base = { sessionId: session.id };

  // Handle F3 (Exit)
  if (request.key === 'F3') {
    session.currentScreen = session.screenStack.pop() || 'MAIN_MENU';
    // Return to previous screen...
  }

  // Handle F12 (Cancel)
  if (request.key === 'F12') {
    session.currentScreen = session.screenStack.pop() || 'MAIN_MENU';
    // Return to previous screen...
  }

  // Handle ENTER (Submit)
  if (request.key === 'ENTER') {
    // Validate input
    if (!request.input.fieldName?.trim()) {
      return { ...buildMyScreen(session, 'Field is required', 'error'), ...base };
    }

    // Process business logic
    try {
      // ... do work (await database operations) ...
      session.currentScreen = 'NEXT_SCREEN';
      // Return next screen...
    } catch (error) {
      return { ...buildMyScreen(session, 'Operation failed', 'error'), ...base };
    }
  }

  // Default: re-render current screen
  return { ...buildMyScreen(session), ...base };
}
```

**Step 2: Register in Router**

Edit `server/src/index.ts`:

```typescript
// Import
import { buildMyScreen, handleMyScreen } from './screens/myScreen.js';

// Add to getCurrentScreenResponse()
case 'MY_SCREEN':
  return buildMyScreen(session);

// Add to message handler switch
case 'MY_SCREEN':
  response = handleMyScreen(currentSession, request);
  break;
```

**Step 3: Add Navigation**

Edit the screen that should navigate to your new screen (e.g., `server/src/screens/mainMenu.ts`):

```typescript
if (option === 5) {  // Menu option number
  session.screenStack.push('MAIN_MENU');
  session.currentScreen = 'MY_SCREEN';
  return { ...buildMyScreen(session), ...base };
}
```

### DSL Components Reference

#### header()
Standard screen header with system name, title, date/time, user

```typescript
header({
  system?: string,  // Default: 'AS500 SYSTEM'
  title: string,    // Screen title
})
```

#### form()
Aligned label/field rows for data entry

```typescript
form(startRow: number, rows: FormRow[], options?: {
  labelCol?: number,  // Default: 20
  fieldCol?: number,  // Default: 40
})

type FormRow = [label: string, field: ReturnType<typeof field>];
```

#### field()
Input field definition

```typescript
field(
  name: string,
  length: number,
  type: 'alpha' | 'numeric' | 'date' | 'password' | 'readonly',
  options?: {
    required?: boolean,
    uppercase?: boolean,
  }
)
```

#### subfile()
Scrollable list with column headers

```typescript
subfile(
  name: string,           // Data array key
  startRow: number,       // Starting row
  pageSize: number,       // Rows per page
  columns: SubfileColumn[]
)

interface SubfileColumn {
  header: string,         // Column header text
  key?: string,           // Data key (for display columns)
  field?: string,         // Field name (for input columns)
  width: number,          // Column width
  type?: 'alpha' | 'numeric',  // For input fields
  align?: 'left' | 'right',    // Text alignment
}
```

#### menu()
Numbered menu options

```typescript
menu(startRow: number, options: string[])
```

#### text()
Static text at position

```typescript
text(row: number, col: number, content: string, color?: string)
```

#### box()
Bordered rectangle

```typescript
box(row: number, col: number, width: number, height: number, char?: string)
```

#### line()
Horizontal line

```typescript
line(row: number, char?: string)
```

---

## Common Development Tasks

### Task 1: Add a Database Table

1. **Edit schema** in `server/src/db/index.ts` (inside `initializeDatabase()`):
   ```typescript
   await client.query(`
     CREATE TABLE IF NOT EXISTS my_table (
       id SERIAL PRIMARY KEY,
       name TEXT NOT NULL,
       created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
     )
   `);
   ```

2. **Add TypeScript interface** in `server/src/types/index.ts`:
   ```typescript
   export interface MyModel {
     id: number;
     name: string;
     created_at: Date;
   }
   ```

3. **Reset database**:
   ```bash
   # With Docker
   docker-compose down -v && docker-compose up -d
   docker-compose exec server npm run seed

   # Or just re-run seed (tables use IF NOT EXISTS)
   docker-compose exec server npm run seed
   ```

### Task 2: Add Business Logic

1. **Create service file** `server/src/services/myService.ts`:
   ```typescript
   import { pool } from '../db/index.js';

   export async function getMyData(userId: number) {
     const result = await pool.query(
       'SELECT * FROM my_table WHERE user_id = $1',
       [userId]
     );
     return result.rows;
   }

   export async function createMyRecord(data: { name: string }) {
     const result = await pool.query(
       'INSERT INTO my_table (name) VALUES ($1) RETURNING *',
       [data.name]
     );
     return result.rows[0];
   }
   ```

2. **Import in screen handler** (handlers are async):
   ```typescript
   import { getMyData, createMyRecord } from '../services/myService.js';

   // In handler:
   const data = await getMyData(session.viserId!);
   ```

### Task 3: Modify Existing Screen

1. **Locate screen file** in `server/src/screens/`
2. **Update screen definition** (DSL constant)
3. **Update handler logic** (handleScreen function)
4. Changes are hot-reloaded by `tsx watch`

### Task 4: Add Client-Side Styling

1. **Edit** `client/src/styles/terminal.css`
2. Changes are hot-reloaded by Vite
3. **Use CSS classes**:
   - `.terminal-container` - Main container
   - `.terminal-screen` - 80×24 grid
   - `.terminal-row` - Single row
   - `.field-overlay` - Input field styling

### Task 5: Debug WebSocket Messages

1. **Server side** - messages are logged to console by default
2. **Client side** - open browser DevTools → Console
3. **View raw messages**:
   ```javascript
   // In useTerminal.ts
   console.log('Sent:', message);
   console.log('Received:', response);
   ```

---

## Important Concepts for AI Assistants

### 1. Server-Side Rendering

Unlike typical React apps, the server renders the entire screen as text:
- The server calls `render()` which returns 24 rows of 80 characters each
- The client displays these rows exactly as received
- The client does NOT interpret or transform the content

### 2. Field Handling

Fields work differently than HTML forms:
- Server defines field positions, types, and validation rules
- Client overlays input fields at the specified row/col positions
- When user presses Enter/F-key, ALL field values are sent to server
- Server performs ALL validation and provides feedback

### 3. Navigation Stack

The `screenStack` array enables F12 (back) functionality:
```typescript
// Going to a new screen
session.screenStack.push('CURRENT_SCREEN');
session.currentScreen = 'NEW_SCREEN';

// Going back (F12)
session.currentScreen = session.screenStack.pop() || 'MAIN_MENU';
```

### 4. Session Context

Use `session.context` to store working data:
```typescript
// Storing current work
session.context.currentDate = '2026-01-20';
session.context.editingId = 123;
session.context.pageNumber = 2;

// Retrieving
const date = session.context.currentDate as string;
```

### 5. Validation Pattern

Always validate on the server:
```typescript
if (request.key === 'ENTER') {
  // Validate
  if (!request.input.username?.trim()) {
    return { ...buildScreen(session, 'Username required', 'error'), ...base };
  }

  // Process
  const result = doSomething(request.input.username);

  // Handle result
  if (result.success) {
    session.currentScreen = 'NEXT_SCREEN';
    // ...
  } else {
    return { ...buildScreen(session, result.error, 'error'), ...base };
  }
}
```

### 6. F-Key Conventions

Standard F-key usage (follow these conventions):

| Key | Purpose | Implementation |
|-----|---------|----------------|
| F1 | Help | Show help screen for current context |
| F3 | Exit | Return to main menu, sign off |
| F4 | Prompt | Show lookup/selection window |
| F5 | Refresh | Reload current screen data |
| F6 | Create | Add new record |
| F7 | Previous | Previous page/record/day |
| F8 | Next | Next page/record/day |
| F9 | Retrieve | Get previous values |
| F12 | Cancel | Go back to previous screen |

### 7. Error Handling Pattern

```typescript
try {
  // Database or business logic operation (async)
  const result = await pool.query('...', [...]);

  // Success - navigate or show success message
  return { ...buildNextScreen(session, 'Success!', 'info'), ...base };

} catch (error) {
  console.error('Operation failed:', error);

  // Failure - stay on current screen with error
  return { ...buildCurrentScreen(session, 'Operation failed', 'error'), ...base };
}
```

---

## Testing Approach

### Current State

⚠️ **No testing framework is currently set up.** This is a working prototype without formal tests.

### Recommended Testing Strategy (Future)

1. **Backend Unit Tests**:
   - Test service functions (business logic)
   - Test DSL rendering functions
   - Test database operations
   - Recommended: Vitest or Jest

2. **Backend Integration Tests**:
   - Test screen handlers with mock sessions
   - Test WebSocket message flow
   - Test authentication flow

3. **Frontend Unit Tests**:
   - Test Terminal component rendering
   - Test useTerminal hook
   - Recommended: Vitest + React Testing Library

4. **E2E Tests**:
   - Test full user flows (login, navigation, data entry)
   - Recommended: Playwright or Cypress

### Manual Testing

For now, test manually:
1. Start server and client
2. Test each screen's functionality
3. Test navigation (F3, F12)
4. Test data entry and validation
5. Test error scenarios

---

## Troubleshooting Guide

### Docker Issues

**Containers won't start**:
```bash
# Check status
docker-compose ps

# View logs
docker-compose logs

# Restart everything
docker-compose down && docker-compose up
```

**PostgreSQL authentication failed (28P01)**:
```bash
# Stale volume with old credentials - reset everything
docker-compose down -v
docker-compose up
```

**Port conflicts**:
```bash
# Check what's using ports
lsof -ti:3001   # Server
lsof -ti:5173   # Client
lsof -ti:5433   # PostgreSQL

# Kill processes if needed
lsof -ti:3001 | xargs kill -9
```

### Server Won't Start

**Error**: Cannot connect to PostgreSQL
- Ensure Docker containers are running: `docker-compose ps`
- Check PostgreSQL is healthy: `docker-compose logs postgres`
- Verify port 5433 is accessible

**Error**: Module not found (running locally)
```bash
cd server
rm -rf node_modules package-lock.json
npm install
```

### Client Won't Start

**Error**: Port 5173 already in use
```bash
lsof -ti:5173 | xargs kill -9
```

**Error**: WebSocket connection failed
- Ensure server is running on ws://localhost:3001
- Check browser console for errors
- Clear browser cookies and refresh

### Database Issues

**Reset database completely**:
```bash
# Remove Docker volume and recreate
docker-compose down -v
docker-compose up -d
docker-compose exec server npm run seed
```

**View database contents**:
```bash
# Connect to PostgreSQL in Docker
docker-compose exec postgres psql -U as500 -d as500

# SQL commands
\dt                    -- List tables
SELECT * FROM users;   -- Query data
\q                     -- Quit
```

**Create a backup**:
```bash
# From host (requires pg_dump installed)
npm run backup-db

# Output goes to server/backups/as500-backup-TIMESTAMP.sql
```

**Restore from backup**:
```bash
# List available backups
ls server/backups/

# Restore (3-second warning before proceeding)
npm run restore-db as500-backup-2026-01-24T15-30-45.sql
```

### Session Issues

**Clear session cookie**:
- Open DevTools → Application → Cookies
- Delete `as500_session` cookie
- Refresh page

**Clear persisted sessions** (dev mode):
```bash
rm server/data/sessions.json
```

**Session timeout**:
- Sessions expire after 15 minutes of inactivity
- Server logs will show "Session expired"
- Client will be redirected to login

### Build Issues

**TypeScript errors**:
```bash
# Server (inside Docker or locally)
docker-compose exec server npx tsc --noEmit

# Client
cd client
npx tsc --noEmit
```

**Clear build artifacts**:
```bash
# Server
cd server
rm -rf dist/

# Client
cd client
rm -rf dist/
```

---

## Key Files Reference

### Entry Points

- **Server**: `server/src/index.ts` - WebSocket server & router
- **Client**: `client/src/main.tsx` - React entry point

### Core Systems

- **Database**: `server/src/db/index.ts`
- **Session Management**: `server/src/session/index.ts`
- **Authentication**: `server/src/services/auth.ts`
- **DSL API**: `server/src/dsl/index.ts`
- **DSL Renderer**: `server/src/dsl/renderer.ts`
- **Terminal Hook**: `client/src/hooks/useTerminal.ts`
- **Terminal Component**: `client/src/components/Terminal.tsx`

### Type Definitions

- **Server Types**: `server/src/types/index.ts`
- **Client Types**: `client/src/types/index.ts`
- **DSL Types**: `server/src/dsl/types.ts`

### Configuration

- **Docker Compose**: `docker-compose.yml` - Development environment
- **Server Package**: `server/package.json`
- **Client Package**: `client/package.json`
- **Server TypeScript**: `server/tsconfig.json`
- **Client TypeScript**: `client/tsconfig.json`
- **Vite Config**: `client/vite.config.ts`
- **Git Ignore**: `.gitignore`

### Database Scripts

- **Backup**: `server/scripts/backup-database.ts` - Creates pg_dump backups
- **Restore**: `server/scripts/restore-database.ts` - Restores from SQL dump

### Documentation

- **README**: `README.md` - Quick start
- **Project Docs**: `project.md` - Comprehensive technical docs
- **This File**: `CLAUDE.md` - AI assistant guide

---

## Backup System

The project includes backup/restore scripts using PostgreSQL's native `pg_dump` and `psql` tools.

### Key Features

- **Format**: Plain SQL dumps (human-readable, portable)
- **Tool**: Uses `pg_dump` for backup, `psql` for restore
- **Location**: `server/backups/`
- **Naming**: `as500-backup-YYYY-MM-DDTHH-MM-SS.sql`

### Prerequisites

PostgreSQL client tools must be installed on your host machine:
```bash
# macOS
brew install postgresql

# Ubuntu/Debian
sudo apt-get install postgresql-client
```

### Manual Backup

```bash
# From project root (connects to Docker PostgreSQL on port 5433)
cd server
npm run backup-db

# Output: server/backups/as500-backup-2026-01-25T10-30-45.sql
```

### Restore from Backup

```bash
cd server

# List available backups
ls backups/

# Restore (has 3-second safety delay)
npm run restore-db as500-backup-2026-01-25T10-30-45.sql

# Can also use full path
npm run restore-db backups/as500-backup-2026-01-25T10-30-45.sql
```

⚠️ **Warning**: Restore replaces ALL existing data in the database.

### Connection Settings

The scripts automatically detect connection settings:
1. **DATABASE_URL** environment variable (Docker/production)
2. **PG* variables** (PGHOST, PGPORT, etc.) - defaults to localhost:5433

---

## Default Credentials

**Username**: `FREDRIC`
**Password**: `fredric`

These are created by the seed script (`npm run seed`).

---

## Ports

- **PostgreSQL**: localhost:5433 (Docker maps 5433→5432)
- **Server WebSocket**: ws://localhost:3001
- **Client Dev Server**: http://localhost:5173

---

## Best Practices for AI Assistants

### DO

✅ Use the DSL system for screen definitions
✅ Keep business logic in service files
✅ Always validate input on the server
✅ Use proper TypeScript types from `types/index.ts`
✅ Follow F-key conventions
✅ Store working data in `session.context`
✅ Use the navigation stack for F12 support
✅ Handle errors gracefully with user-friendly messages
✅ Test manually after making changes
✅ Read existing screen implementations for patterns

### DON'T

❌ Add validation logic to the client
❌ Add navigation logic to the client
❌ Break the 80×24 grid constraint
❌ Store state in React components
❌ Use REST endpoints (it's WebSocket-based)
❌ Skip the DSL system and manually create rows
❌ Forget to register new screens in index.ts router
❌ Hard-code screen rendering logic in handlers
❌ Use client-side routing (navigation is server-controlled)

### When Adding Features

1. **Understand the pattern**: Read similar existing code first
2. **Use the DSL**: Don't manually build screen rows
3. **Separate concerns**: Service logic separate from screen handlers
4. **Follow conventions**: F-keys, naming, file structure
5. **Test manually**: Run the app and verify behavior
6. **Update docs**: Add to project.md if adding major features

### When Debugging

1. **Check server logs**: Most issues show up in server console
2. **Check browser console**: WebSocket messages are logged
3. **Verify session state**: Log `session.context` values
4. **Test the DSL output**: Verify `render()` produces correct rows
5. **Check field definitions**: Ensure row/col/length are correct

---

## Additional Resources

### External Documentation

- **WebSocket API**: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
- **PostgreSQL**: https://www.postgresql.org/docs/
- **node-postgres (pg)**: https://node-postgres.com/
- **Docker Compose**: https://docs.docker.com/compose/
- **React**: https://react.dev/
- **Vite**: https://vitejs.dev/
- **TypeScript**: https://www.typescriptlang.org/docs/

### AS/400 References

This project is inspired by AS/400 (IBM i) systems:
- **DDS**: Display Data Structures
- **Green Screen**: 5250 terminal emulation
- **Subfiles**: Scrollable data grids
- **Function Keys**: F1-F24 for navigation

---

**Last Updated**: 2026-01-25
**Project Status**: Working prototype with time tracking feature (Docker + PostgreSQL)
