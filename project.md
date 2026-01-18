# AS500 - Modern Mainframe Terminal System

A modern client-server solution that works and looks like an AS400 mainframe. The backend sends complete screens (not data), controls navigation, owns validation, and treats the UI as a dumb terminal.

---

## Current Status

### What's Working

- [x] WebSocket server with session management
- [x] SQLite database with users table
- [x] bcrypt password authentication
- [x] LOGIN screen with validation
- [x] MAIN_MENU screen with navigation
- [x] React terminal renderer with green-on-black CRT aesthetic
- [x] Keyboard handling (Tab, Enter, F-keys)
- [x] Input fields with password masking
- [x] Session persistence via browser cookies
- [x] Session resume on page refresh
- [x] Sign-off (F3) clears session
- [x] **Screen DSL** - Declarative screen definitions (like AS/400 DDS)
- [x] **Subfile component** - Scrollable lists with column headers
- [x] **Time Registration** - Full CRUD with day navigation (Menu option 6)

### Default Test User

- **Username:** `FREDRIC`
- **Password:** `fredric`

### What's Next

- [ ] Build Customer maintenance screens
- [ ] Add F4 prompt/lookup windows
- [ ] Implement PAGEUP/PAGEDOWN for subfile scrolling
- [ ] Add more users / user management
- [ ] Help system (F1)

---

## Quick Start

```bash
# Terminal 1: Start server
cd server
npm install
npm run seed    # Creates default user (only needed once)
npm run dev     # Runs on ws://localhost:3001

# Terminal 2: Start client
cd client
npm install
npm run dev     # Runs on http://localhost:5173
```

Open `http://localhost:5173` and login with `FREDRIC` / `fredric`

---

## Architecture Overview

### Core Principles

- **Backend owns everything** — UI is a "dumb terminal"
- **Screen-based** — Server sends complete rendered screens
- **Session-based** — All state lives on the server
- **WebSocket communication** — Real-time bidirectional
- **React frontend** — Renders what it's told, captures keystrokes

### Server Responsibilities

- Current screen state
- User context & authentication
- Work data (selected records, form state)
- Navigation stack (for F12/back)
- All validation logic
- Screen rendering

### Client Responsibilities

- Render rows exactly as received
- Capture input in defined fields
- Send keystrokes (ENTER, F-keys, TAB)
- Position cursor where told
- Play bell when requested
- Store sessionId in cookie for persistence

---

## Screen DSL

A declarative system for defining screens, inspired by AS/400 DDS (Display File Source). Separates logical screen definition from physical 80×24 rendering.

### Architecture

```
Screen Definition (DSL)     →    Layout Engine    →    80×24 Renderer
   defineScreen()                 Components            rows[] + fields[]
   header(), form(),              Primitives
   subfile(), menu()              Positioning
```

### Example: Form Screen

```typescript
import { defineScreen, render, header, form, field } from '../dsl/index.js';

const LOGIN_SCREEN = defineScreen('LOGIN', {
  elements: [
    header({ system: 'AS500 SYSTEM', title: 'LOGIN' }),
    form(10, [
      ['User  . . . :', field('username', 20, 'alpha', { required: true })],
      ['Password  . :', field('password', 20, 'password', { required: true })],
    ], { labelCol: 25, fieldCol: 40 }),
  ],
  statusLine: 'F3=Exit',
  defaultCursor: 'username',
});

// Render to protocol format
const screen = render(LOGIN_SCREEN, {}, { user: session.username });
```

### Example: Subfile Screen

```typescript
const TIME_REG_SCREEN = defineScreen('TIME_REG', {
  elements: [
    header({ system: 'AS500 SYSTEM', title: 'TIME REGISTRATION' }),
    subfile('entries', 7, 10, [  // name, startRow, pageSize
      { header: 'Opt', field: 'opt', width: 3, type: 'alpha' },
      { header: 'Start', key: 'start_hour', width: 5 },
      { header: 'End', key: 'end_hour', width: 5 },
      { header: 'Hours', key: 'rowsum', width: 5, align: 'right' },
      { header: 'Task', key: 'jiratask', width: 11 },
      { header: 'Description', key: 'description', width: 30 },
    ]),
  ],
  statusLine: 'F3=Exit  F6=Add  F7=Prev day  F8=Next day',
});

// Render with data
const screen = render(TIME_REG_SCREEN, { entries: timeEntries }, { user });
```

### DSL Components

| Component | Purpose |
|-----------|---------|
| `header()` | Standard screen header (system, title, date/time, user) |
| `form()` | Aligned label/field rows for data entry |
| `subfile()` | Scrollable list with column headers and option fields |
| `menu()` | Numbered menu options with selection field |
| `text()` | Static text at position |
| `box()` | Bordered rectangle |
| `field()` | Input field definition |

### DSL Files

```
server/src/dsl/
├── index.ts              # Public API exports
├── types.ts              # TypeScript interfaces
├── renderer.ts           # 80×24 grid renderer
└── components/
    ├── primitives.ts     # text(), field(), box(), line()
    ├── header.ts         # Standard screen header
    ├── form.ts           # Form layout component
    ├── subfile.ts        # Subfile/list component
    └── menu.ts           # Menu component
```

---

## Protocol Specification

### Request (Client → Server)

```json
{
  "sessionId": "abc123",
  "screenId": "LOGIN",
  "cursor": { "row": 10, "col": 22 },
  "input": {
    "username": "FREDRIC",
    "password": "secret123"
  },
  "key": "ENTER"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | string | Session identifier (null on first connect) |
| `screenId` | string | Current screen ID |
| `cursor` | object | Current cursor position |
| `input` | object | Field values keyed by field name |
| `key` | string | Key pressed: ENTER, F1-F12, PAGEUP, PAGEDOWN, RESUME, CONNECT |

### Special Keys

| Key | Purpose |
|-----|---------|
| `CONNECT` | Initial connection request (no session) |
| `RESUME` | Attempt to restore existing session from cookie |

### Response (Server → Client)

```json
{
  "sessionId": "uuid-here",
  "screenId": "MAIN_MENU",
  "cursor": { "row": 8, "col": 15 },
  "rows": ["... 24 rows of 80 chars each ..."],
  "fields": [
    {
      "row": 7,
      "col": 14,
      "length": 1,
      "type": "numeric",
      "name": "selection"
    }
  ],
  "fieldValues": { "start_hour": "08:00", "end_hour": "12:00" },
  "message": null,
  "messageType": null,
  "statusLine": "F3=Exit  F5=Refresh",
  "bell": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | string | Session identifier |
| `screenId` | string | Screen identifier |
| `cursor` | object | Where to position cursor |
| `rows` | string[] | Screen content (24 rows × 80 cols) |
| `fields` | array | Input field definitions |
| `fieldValues` | object? | Pre-populated field values (for edit mode) |
| `message` | string? | Message to display (row 24) |
| `messageType` | string? | "info", "warning", "error" |
| `statusLine` | string | F-key hints (row 23) |
| `bell` | boolean | Play terminal bell sound |

### Field Types

| Type | Description |
|------|-------------|
| `alpha` | Any text input |
| `numeric` | Numbers only (0-9, -, .) |
| `date` | Date input (YYYY-MM-DD) |
| `password` | Masked with bullets |
| `readonly` | Display only, highlighted |

---

## Key Handling

| Key | Code | Typical Use |
|-----|------|-------------|
| Enter | `ENTER` | Submit/Confirm |
| F1 | `F1` | Help |
| F3 | `F3` | Exit / Sign off |
| F4 | `F4` | Prompt/List values |
| F5 | `F5` | Refresh |
| F6 | `F6` | Create/Add new |
| F9 | `F9` | Retrieve previous |
| F12 | `F12` | Cancel/Go back |
| Tab | `TAB` | Next field (client-side) |
| Page Up | `PAGEUP` | Scroll up (subfiles) |
| Page Down | `PAGEDOWN` | Scroll down (subfiles) |

---

## Authentication & Sessions

### Authentication Flow

1. Client connects via WebSocket
2. Client sends `CONNECT` (new) or `RESUME` (returning) request
3. For RESUME: server checks if session exists and is authenticated
4. If valid session: restore and return current screen
5. If no/invalid session: create new session, return LOGIN screen
6. User enters credentials, presses ENTER
7. Server validates against database (bcrypt)
8. On success: session marked authenticated, MAIN_MENU sent
9. On failure: LOGIN screen re-sent with error message

### Session Persistence (Cookies)

- Client stores `as500_session` cookie with sessionId
- Cookie persists for 1 day
- On page refresh, client sends RESUME with stored sessionId
- On sign-off (F3), cookie is cleared
- Server sessions timeout after 15 minutes of inactivity

### Database Schema

```sql
-- Users table
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Time registration: Days (one per user per date)
CREATE TABLE days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  workday TEXT NOT NULL,           -- "2026-01-18"
  daysum REAL DEFAULT 0,           -- Total hours for day
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, workday),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Time registration: Day items (time entries)
CREATE TABLE day_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_id INTEGER NOT NULL,
  start_hour TEXT NOT NULL,        -- "08:00"
  end_hour TEXT NOT NULL,          -- "11:30"
  jiratask TEXT,                   -- "STEAKT-2987"
  description TEXT,                -- Free text (30 chars)
  rowsum REAL DEFAULT 0,           -- Calculated hours
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (day_id) REFERENCES days(id) ON DELETE CASCADE
);
```

### Session State (Server Memory)

```typescript
interface Session {
  id: string;
  userId: number | null;
  username: string | null;
  authenticated: boolean;
  currentScreen: string;
  screenStack: string[];
  context: Record<string, any>;
  lastActivity: Date;
}
```

---

## Time Registration Feature

A complete time tracking feature accessible from Main Menu option 6.

### Screens

**TIME_REG** - Subfile listing time entries for a day:
```
  AS500 SYSTEM                                      2026-01-18  14:30
════════════════════════════════════════════════════════════════════════════════

                    TIME REGISTRATION                     User: FREDRIC

  Date: 2026-01-18  Saturday                           Day total: 7.50 hrs

  Opt  Start  End    Hours  Task         Description
  ---  -----  -----  -----  -----------  ------------------------------
  ___  08:00  10:30   2.50  STEAKT-2987  Morning standup and dev
  ___  10:45  12:00   1.25  STEAKT-2988  Code review
  ___  13:00  16:45   3.75  STEAKT-2987  Feature implementation



 F3=Exit  F6=Add  F7=Prev day  F8=Next day  F12=Cancel
```

**TIME_ENTRY** - Form for adding/editing entries:
```
  AS500 SYSTEM                                      2026-01-18  14:30
════════════════════════════════════════════════════════════════════════════════

                      TIME ENTRY                         User: FREDRIC

  Date: 2026-01-18  Saturday

        Start time . . : _____ (HH:MM)
        End time . . . : _____ (HH:MM)
        Task ID  . . . : ___________
        Description  . : ______________________________


 F3=Exit  F12=Cancel
```

### Navigation

| Key | Action |
|-----|--------|
| F3 | Exit to main menu |
| F6 | Add new time entry |
| F7 | Previous day |
| F8 | Next day |
| F12 | Cancel / Back |
| Opt 2 | Edit selected entry |
| Opt 4 | Delete selected entry |

### Files

| File | Purpose |
|------|---------|
| `server/src/services/timeReg.ts` | Business logic, CRUD, hour calculations |
| `server/src/screens/timeReg.ts` | TIME_REG subfile screen |
| `server/src/screens/timeEntry.ts` | TIME_ENTRY form screen |

---

## Visual Design

### Colors

| Element | Color | Hex |
|---------|-------|-----|
| Background | Black | `#0a0a0a` |
| Normal text | Green | `#33ff33` |
| Input fields | Bright green | `#00ff00` |
| Error messages | Red | `#ff3333` |
| Warnings | Yellow | `#ffff33` |
| Info/Highlights | Cyan | `#33ffff` |

### Typography

- **Font:** IBM Plex Mono (loaded from Google Fonts)
- **Fallback:** Courier New, monospace
- **Size:** 16px
- **Line height:** 1.4

### Screen Dimensions

- **Columns:** 80
- **Rows:** 24
- Rows 0-21: Screen content
- Row 22: Status line (F-key hints)
- Row 23: Message line

### CRT Effects

- Scanline overlay
- Phosphor glow animation
- Screen curvature vignette
- Cursor blink animation

---

## Project Structure

```
AS500/
├── project.md              # This file
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── data/
│   │   └── as500.db        # SQLite database (auto-created)
│   └── src/
│       ├── index.ts        # WebSocket server & router
│       ├── types/
│       │   └── index.ts    # TypeScript interfaces
│       ├── db/
│       │   ├── index.ts    # Database connection & schema
│       │   └── seed.ts     # Seeds users and sample data
│       ├── session/
│       │   └── index.ts    # Session management (in-memory)
│       ├── dsl/                    # Screen DSL system
│       │   ├── index.ts            # Public API exports
│       │   ├── types.ts            # DSL type definitions
│       │   ├── renderer.ts         # 80×24 grid renderer
│       │   └── components/
│       │       ├── primitives.ts   # text(), field(), box(), line()
│       │       ├── header.ts       # Screen header component
│       │       ├── form.ts         # Form layout component
│       │       ├── subfile.ts      # Subfile/list component
│       │       └── menu.ts         # Menu component
│       ├── services/
│       │   ├── auth.ts             # Authentication logic
│       │   └── timeReg.ts          # Time registration CRUD
│       └── screens/
│           ├── login.ts            # LOGIN screen
│           ├── mainMenu.ts         # MAIN_MENU screen
│           ├── timeReg.ts          # TIME_REG subfile screen
│           └── timeEntry.ts        # TIME_ENTRY form screen
└── client/
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.tsx        # React entry point
        ├── App.tsx         # App component
        ├── types/
        │   └── index.ts    # TypeScript interfaces
        ├── hooks/
        │   └── useTerminal.ts  # WebSocket, keyboard, cookies
        ├── components/
        │   └── Terminal.tsx    # Terminal renderer
        └── styles/
            └── terminal.css    # Green screen styling
```

---

## Adding New Screens

### 1. Define Screen with DSL

```typescript
// server/src/screens/customerList.ts
import type { Session, ClientRequest, ScreenResponse } from '../types/index.js';
import { defineScreen, render, header, subfile } from '../dsl/index.js';

// Screen definition (logical structure)
const CUSTOMER_LIST_SCREEN = defineScreen('CUSTOMER_LIST', {
  elements: [
    header({ system: 'AS500 SYSTEM', title: 'CUSTOMER LIST' }),
    subfile('customers', 6, 12, [
      { header: 'Opt', field: 'opt', width: 3, type: 'alpha' },
      { header: 'ID', key: 'id', width: 8 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'City', key: 'city', width: 20 },
    ]),
  ],
  statusLine: 'F3=Exit  F6=Add  F12=Cancel',
});

// Screen builder
export function buildCustomerListScreen(
  session: Session,
  message?: string,
  messageType?: 'info' | 'error'
): Omit<ScreenResponse, 'sessionId'> {
  const customers = getCustomers(); // Your data fetch
  return render(CUSTOMER_LIST_SCREEN, { customers }, { message, messageType, user: session.username });
}

// Screen handler (business logic)
export function handleCustomerList(session: Session, request: ClientRequest): ScreenResponse {
  const base = { sessionId: session.id };
  
  if (request.key === 'F3') {
    // Return to menu
  }
  if (request.key === 'ENTER') {
    // Process option selections
  }
  
  return { ...buildCustomerListScreen(session), ...base };
}
```

### 2. Register in Router

```typescript
// server/src/index.ts
import { buildCustomerListScreen, handleCustomerList } from './screens/customerList.js';

// In getCurrentScreenResponse():
case 'CUSTOMER_LIST':
  return buildCustomerListScreen(session);

// In message handler switch:
case 'CUSTOMER_LIST':
  response = handleCustomerList(currentSession, request);
  break;
```

### 3. Add Navigation from Menu

```typescript
// In mainMenu.ts handleMainMenu():
if (option === 1) {
  session.screenStack.push('MAIN_MENU');
  session.currentScreen = 'CUSTOMER_LIST';
  return { ...buildCustomerListScreen(session), ...base };
}
```

---

## Tech Stack

### Server

| Package | Version | Purpose |
|---------|---------|---------|
| ws | ^8.18.0 | WebSocket server |
| better-sqlite3 | ^11.7.0 | SQLite database |
| bcrypt | ^5.1.1 | Password hashing |
| uuid | ^11.0.4 | Session ID generation |
| tsx | ^4.19.2 | TypeScript execution |
| typescript | ^5.7.3 | Type checking |

### Client

| Package | Version | Purpose |
|---------|---------|---------|
| react | ^18.3.1 | UI framework |
| react-dom | ^18.3.1 | React DOM bindings |
| vite | ^6.0.7 | Build tool |
| typescript | ^5.7.3 | Type checking |
| @vitejs/plugin-react | ^4.3.4 | React plugin for Vite |

---

## Troubleshooting

### Port Already in Use

```bash
# Kill process on port 3001
lsof -ti:3001 | xargs kill -9

# Kill process on port 5173
lsof -ti:5173 | xargs kill -9
```

### Reset Database

```bash
cd server
rm -rf data/
npm run seed
```

### Clear Session Cookie

Open browser DevTools → Application → Cookies → Delete `as500_session`

---

## Open Decisions

- [ ] Multi-user record locking strategy
- [ ] Help system implementation (F1)
- [ ] Print/export functionality
- [ ] Audit logging requirements
- [ ] Session persistence to database (currently in-memory)