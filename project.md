# AS500 - Modern Mainframe Terminal System

A modern client-server solution that works and looks like an AS400 mainframe. The backend sends complete screens (not data), controls navigation, owns validation, and treats the UI as a dumb terminal.

---

## Current Status

### What's Working

- [x] WebSocket server with session management
- [x] SQLite database with users table
- [x] bcrypt password authentication
- [x] LOGIN screen with validation
- [x] MAIN_MENU screen (mocked - options show "not implemented")
- [x] React terminal renderer with green-on-black CRT aesthetic
- [x] Keyboard handling (Tab, Enter, F-keys)
- [x] Input fields with password masking
- [x] Session persistence via browser cookies
- [x] Session resume on page refresh
- [x] Sign-off (F3) clears session

### Default Test User

- **Username:** `FREDRIC`
- **Password:** `fredric`

### What's Next

- [ ] Implement actual menu navigation (Customer, Orders, etc.)
- [ ] Create subfile (scrollable list) component
- [ ] Add F12 back navigation using screenStack
- [ ] Build Customer maintenance screens
- [ ] Add more users / user management

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

## Protocol Specification

### Request (Client → Server)

```json
{
  "sessionId": "abc123",
  "screenId": "LOGIN",
  "cursor": { "row": 10, "col": 22 },
  "input": {
    "10,22": "FREDRIC",
    "11,22": "secret123"
  },
  "key": "ENTER"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | string | Session identifier (null on first connect) |
| `screenId` | string | Current screen ID |
| `cursor` | object | Current cursor position |
| `input` | object | Field values keyed by "row,col" |
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
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
│       ├── index.ts        # WebSocket server entry point
│       ├── types/
│       │   └── index.ts    # TypeScript interfaces
│       ├── db/
│       │   ├── index.ts    # Database connection & schema
│       │   └── seed.ts     # Seeds default user
│       ├── session/
│       │   └── index.ts    # Session management (in-memory)
│       ├── services/
│       │   └── auth.ts     # Authentication logic
│       └── screens/
│           ├── login.ts    # LOGIN screen handler
│           └── mainMenu.ts # MAIN_MENU screen handler
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

### 1. Create Screen Handler (Server)

```typescript
// server/src/screens/customerList.ts
import type { Session, ClientRequest, ScreenResponse, Field } from '../types/index.js';

export function customerListScreen(session: Session): Omit<ScreenResponse, 'sessionId'> {
  const rows: string[] = [];
  // Build 24 rows of 80 characters each
  // ...
  
  return {
    screenId: 'CUSTOMER_LIST',
    cursor: { row: 5, col: 10 },
    rows,
    fields: [/* field definitions */],
    message: null,
    messageType: null,
    statusLine: 'F3=Exit  F6=Add  F12=Cancel',
    bell: false,
  };
}

export function handleCustomerList(
  session: Session,
  request: ClientRequest
): ScreenResponse {
  // Handle F-keys, ENTER, etc.
  // Return appropriate screen response
}
```

### 2. Register in Router (Server)

```typescript
// server/src/index.ts
import { handleCustomerList } from './screens/customerList.js';

// In the message handler switch:
case 'CUSTOMER_LIST':
  if (!currentSession.authenticated) {
    // redirect to login
  }
  response = handleCustomerList(currentSession, request);
  break;
```

### 3. Update Navigation

In `mainMenu.ts`, handle menu selection to navigate to new screen:

```typescript
if (option === 1) {
  session.screenStack.push('MAIN_MENU');
  session.currentScreen = 'CUSTOMER_LIST';
  return {
    ...customerListScreen(session),
    sessionId: session.id,
  };
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