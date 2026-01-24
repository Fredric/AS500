# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AS500 is a mainframe terminal emulator with client-server architecture. The backend (Node.js/TypeScript/WebSocket) controls all logic and sends complete 80×24 character screens to the frontend (React), treating it as a dumb terminal - mimicking AS/400 mainframe patterns.

## Commands

### Server (from /server directory)
```bash
npm run dev      # Start dev server with hot reload (ws://localhost:3001)
npm run build    # Compile TypeScript to dist/
npm run start    # Run production build
npm run seed     # Seed database with test user (FREDRIC/fredric)
npm run backup   # Manual database backup
```

### Client (from /client directory)
```bash
npm run dev      # Start Vite dev server (http://localhost:5173)
npm run build    # TypeScript check + production build
```

### Quick Start
```bash
# Terminal 1: cd server && npm install && npm run seed && npm run dev
# Terminal 2: cd client && npm install && npm run dev
# Login at http://localhost:5173 with FREDRIC/fredric
```

## Architecture

### Core Principle
Server owns all state, validation, and navigation. Client renders what server sends.

### WebSocket Protocol
- **Client → Server:** `{ sessionId, screenId, cursor, input, key }` (key: ENTER, F1-F12, PAGEUP, PAGEDOWN)
- **Server → Client:** `{ sessionId, screenId, cursor, rows[], fields[], fieldValues, message, statusLine }`

### Screen DSL System
Screens are defined declaratively using a DSL in `server/src/dsl/`:
- `defineScreen()` - Declare screen structure with elements
- `render()` - Convert DSL to 80×24 character grid
- Components: `header()`, `form()`, `subfile()`, `menu()`
- Primitives: `text()`, `field()`, `box()`, `line()`

### Screen Handler Pattern
Each screen has two functions:
1. **Builder** - Pure rendering, returns screen layout with fields
2. **Handler** - Business logic, processes keystrokes, updates session, returns new screen

Screens are registered in `server/src/index.ts` via `getCurrentScreenResponse()` and the message handler.

### Session Management
- In-memory Map with 15-minute timeout
- Client persists sessionId in cookie for reconnection
- Session stores: currentScreen, user, authentication state, screen-specific data

### Database
SQLite with WAL mode. Schema: `users`, `days` (one per user per date), `day_items` (time entries).

## Key Directories

```
server/src/
├── index.ts          # WebSocket server & message router
├── dsl/              # Screen DSL (defineScreen, render, components)
├── screens/          # Screen builders & handlers
├── services/         # Business logic (auth, timeReg, backup)
├── session/          # Session management
├── db/               # Database setup & queries
└── types/            # Shared TypeScript interfaces

client/src/
├── hooks/useTerminal.ts    # WebSocket, keyboard, cookies
├── components/Terminal.tsx # 80×24 grid renderer
└── styles/terminal.css     # Green-on-black CRT styling
```

## Adding a New Screen

1. Define screen with DSL in `server/src/screens/newscreen.ts`:
   ```typescript
   const SCREEN = defineScreen('NEW_SCREEN', {
     elements: [header({...}), form([...])],
     statusLine: 'F3=Exit',
   });
   export function buildNewScreen(session) { return render(SCREEN, {...}); }
   export function handleNewScreen(session, request) { /* process input, return next screen */ }
   ```

2. Register in `server/src/index.ts`:
   - Add case in `getCurrentScreenResponse()`
   - Add case in message handler

3. Add navigation from existing screens

## F-Key Conventions
- F3: Exit/Sign off
- F5: Refresh
- F6: Add/Create
- F7: Previous (navigation)
- F8: Next (navigation)
- F12: Cancel/Back
