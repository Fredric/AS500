# AS500 Electron App

This directory contains the Electron wrapper for the AS500 terminal application, allowing it to run as a standalone desktop application on macOS (and other platforms).

## Features

- **Standalone Application**: No need to run separate server and client processes
- **Seamless UI**: The terminal blends seamlessly with the application window
- **Native macOS Experience**: Uses macOS native window styling with hidden title bar
- **Embedded Server**: WebSocket server runs automatically within the Electron app
- **Draggable Window**: The entire application window can be dragged

## Development

### Prerequisites

- Node.js 20+
- npm

### Setup

1. Install all dependencies:
```bash
# Install root dependencies (Electron)
npm install

# Install server dependencies
cd server && npm install && cd ..

# Install client dependencies
cd client && npm install && cd ..
```

2. Initialize the database:
```bash
cd server && npm run seed && cd ..
```

### Running in Development

```bash
npm start
```

This will:
1. Build the client (React app)
2. Build the server (TypeScript to JavaScript)
3. Build the Electron main process
4. Launch the Electron app

### Building for Distribution

#### Build for macOS

```bash
npm run dist:mac
```

This creates:
- A DMG installer in `release/` directory
- A ZIP archive in `release/` directory

#### Build for all platforms

```bash
npm run dist
```

## Project Structure

```
AS500/
├── electron/              # Electron main process
│   ├── main.ts           # Main Electron entry point
│   ├── preload.ts        # Preload script for renderer
│   └── tsconfig.json     # TypeScript config for Electron
├── client/               # React frontend (unchanged)
├── server/               # Node.js backend (unchanged)
├── package.json          # Root package with Electron config
└── README_ELECTRON.md    # This file
```

## How It Works

1. **Electron Main Process** (`electron/main.ts`):
   - Imports and starts the WebSocket server (from compiled server code)
   - Creates a BrowserWindow with native macOS styling
   - Loads the built React client
   - Manages application lifecycle

2. **Client** (React app):
   - Built as static files in `client/dist/`
   - Loaded by Electron's BrowserWindow
   - Connects to the embedded WebSocket server on `ws://localhost:3001`
   - Uses seamless styling (no borders) to blend with the window

3. **Server** (Node.js):
   - Compiled to JavaScript in `server/dist/`
   - Dynamically imported by Electron main process
   - Runs WebSocket server on port 3001
   - Handles all terminal logic and database operations

## Seamless UI Design

The terminal interface has been modified for a seamless experience:

- **No Border**: Terminal container has no visible border
- **Full Window**: Terminal fills the entire window
- **Draggable**: The window can be dragged from anywhere (using `-webkit-app-region: drag`)
- **Native Title Bar**: Uses `titleBarStyle: 'hiddenInset'` for native macOS appearance
- **Black Background**: Consistent black background throughout

## Troubleshooting

### "Cannot find module" errors

Make sure all parts are built:
```bash
npm run build
```

### Database errors

Initialize the database:
```bash
cd server && npm run seed && cd ..
```

### Port already in use

If port 3001 is already in use, you'll need to:
1. Stop any other AS500 server instances
2. Or modify the port in both `electron/main.ts` and `client/src/hooks/useTerminal.ts`

## Default Credentials

- **Username:** `FREDRIC`
- **Password:** `fredric`

## Icon

To add a custom application icon:
1. Create an `.icns` file (macOS) 
2. Place it in `assets/icon.icns`
3. Uncomment the icon lines in `package.json` under the `build.mac` section
