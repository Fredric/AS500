# AS500 - Modern Mainframe Terminal System

A modern client-server solution that emulates an AS400 mainframe terminal. The backend sends complete screens (not data), controls navigation, owns validation, and treats the UI as a dumb terminal.

![Terminal Screenshot](https://img.shields.io/badge/style-green%20screen-33ff33?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?style=flat-square)
![React](https://img.shields.io/badge/React-18-61dafb?style=flat-square)
![WebSocket](https://img.shields.io/badge/WebSocket-ws-yellow?style=flat-square)

## Features

- Classic green-on-black terminal aesthetic with CRT effects
- WebSocket-based real-time communication
- Session persistence via cookies
- bcrypt password authentication
- SQLite database
- Full keyboard support (F-keys, Tab, Enter)
- Automated backup system with scheduled backups

## Quick Start

```bash
# Terminal 1: Start server
cd server
npm install
npm run seed    # Creates default user (first time only)
npm run dev     # Runs on ws://localhost:3001

# Terminal 2: Start client
cd client
npm install
npm run dev     # Runs on http://localhost:5173
```

Open http://localhost:5173 and login with:
- **Username:** `FREDRIC`
- **Password:** `fredric`

## Architecture

```
┌─────────────┐     WebSocket      ┌─────────────┐
│   Client    │◄──────────────────►│   Server    │
│   (React)   │   JSON messages    │  (Node.js)  │
└─────────────┘                    └──────┬──────┘
                                          │
                                   ┌──────▼──────┐
                                   │   SQLite    │
                                   └─────────────┘
```

- **Backend owns everything** - UI is a "dumb terminal"
- **Screen-based** - Server sends complete rendered screens
- **Session-based** - All state lives on the server

## Tech Stack

| Component | Technology |
|-----------|------------|
| Server | Node.js, TypeScript, ws, better-sqlite3, bcrypt |
| Client | React 18, TypeScript, Vite |
| Database | SQLite |

## Project Structure

```
AS500/
├── server/
│   └── src/
│       ├── index.ts          # WebSocket server
│       ├── screens/          # Screen handlers
│       ├── services/         # Business logic
│       ├── session/          # Session management
│       └── db/               # Database
└── client/
    └── src/
        ├── components/       # React components
        ├── hooks/            # Custom hooks
        └── styles/           # CSS
```

## Documentation

See [project.md](project.md) for detailed documentation including:
- Protocol specification
- Adding new screens
- Session management
- Troubleshooting

See [BACKUP.md](BACKUP.md) for backup system documentation including:
- Automated backup configuration
- Manual backup creation
- Restoring from backups
- Backup management


