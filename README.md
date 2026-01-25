# AS500 - Modern Mainframe Terminal System

A modern client-server solution that emulates an AS400 mainframe terminal. The backend sends complete screens (not data), controls navigation, owns validation, and treats the UI as a dumb terminal.

![Terminal Screenshot](https://img.shields.io/badge/style-green%20screen-33ff33?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?style=flat-square)
![React](https://img.shields.io/badge/React-18-61dafb?style=flat-square)
![WebSocket](https://img.shields.io/badge/WebSocket-ws-yellow?style=flat-square)

## Features

- Classic green-on-black terminal aesthetic with CRT effects
- WebSocket-based real-time communication
- Session persistence via cookies and file-based persistence (development)
- bcrypt password authentication
- PostgreSQL database (with SQLite support)
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
└─────────────┘                    └──────┬──────┘
                                          │
                                   ┌──────▼──────┐
                                   │ PostgreSQL  │
                                   └─────────────┘
```

- **Backend owns everything** - UI is a "dumb terminal"
- **Screen-based** - Server sends complete rendered screens
- **Session-based** - All state lives on the server

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

## Development Features

### Session Persistence

In development mode, sessions are automatically persisted to disk (`server/data/sessions.json`). This means:
- **Sessions survive server restarts** - No need to log in again after code changes
- **Automatic restoration** - Valid sessions are restored when the server starts
- **Production mode** - Sessions remain in-memory only (set `NODE_ENV=production`)

Sessions still expire after 15 minutes of inactivity, but they'll persist through server restarts during that window.

### Hot Reload

Both server and client support hot reload:
- **Server**: Uses `tsx watch` - automatically restarts on file changes
- **Client**: Uses Vite HMR - instant updates in the browser
- **Docker**: Volume mounts ensure code changes are reflected immediately

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


