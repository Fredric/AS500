import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientRequest, ScreenResponse, Session } from '../server/dist/types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let wss: WebSocketServer | null = null;
const connectionSessions = new Map<WebSocket, string>();

// Import server modules dynamically after they're compiled
let serverModules: any = {};

async function importServerModules() {
  const baseServerPath = path.join(__dirname, '../server/dist');
  
  serverModules = {
    session: await import(path.join(baseServerPath, 'session/index.js')),
    login: await import(path.join(baseServerPath, 'screens/login.js')),
    mainMenu: await import(path.join(baseServerPath, 'screens/mainMenu.js')),
    timeReg: await import(path.join(baseServerPath, 'screens/timeReg.js')),
    timeEntry: await import(path.join(baseServerPath, 'screens/timeEntry.js')),
    backupMgmt: await import(path.join(baseServerPath, 'screens/backupMgmt.js')),
    timeRegHelp: await import(path.join(baseServerPath, 'screens/timeRegHelp.js')),
    backupScheduler: await import(path.join(baseServerPath, 'services/backupScheduler.js')),
  };

  // Import db to ensure tables are created
  await import(path.join(baseServerPath, 'db/index.js'));
}

// Get current screen response for a session
function getCurrentScreenResponse(session: Session): Omit<ScreenResponse, 'sessionId'> {
  switch (session.currentScreen) {
    case 'MAIN_MENU':
      if (session.authenticated) {
        return serverModules.mainMenu.mainMenuScreen(session);
      }
      session.currentScreen = 'LOGIN';
      return serverModules.login.buildLoginScreen();

    case 'TIME_REG':
      if (session.authenticated) {
        return serverModules.timeReg.buildTimeRegScreen(session);
      }
      session.currentScreen = 'LOGIN';
      return serverModules.login.buildLoginScreen();

    case 'TIME_ENTRY':
      if (session.authenticated) {
        return serverModules.timeEntry.buildTimeEntryScreen(session);
      }
      session.currentScreen = 'LOGIN';
      return serverModules.login.buildLoginScreen();

    case 'TIME_REG_HELP':
      if (session.authenticated) {
        return serverModules.timeRegHelp.timeRegHelpScreen(session);
      }
      session.currentScreen = 'LOGIN';
      return serverModules.login.buildLoginScreen();

    case 'BACKUP_MGMT':
      if (session.authenticated) {
        return serverModules.backupMgmt.buildBackupMgmtScreen(session);
      }
      session.currentScreen = 'LOGIN';
      return serverModules.login.buildLoginScreen();

    case 'LOGIN':
    default:
      return serverModules.login.buildLoginScreen();
  }
}

// Handle client messages
async function handleClientMessage(session: Session, msg: ClientRequest): Promise<ScreenResponse> {
  switch (session.currentScreen) {
    case 'LOGIN':
      return await serverModules.login.handleLogin(session, msg);
    case 'MAIN_MENU':
      return serverModules.mainMenu.handleMainMenu(session, msg);
    case 'TIME_REG':
      return serverModules.timeReg.handleTimeReg(session, msg);
    case 'TIME_ENTRY':
      return serverModules.timeEntry.handleTimeEntry(session, msg);
    case 'BACKUP_MGMT':
      return await serverModules.backupMgmt.handleBackupMgmt(session, msg);
    default:
      return {
        sessionId: session.id,
        ...serverModules.login.buildLoginScreen(),
      };
  }
}

function startWebSocketServer() {
  const PORT = 3001;
  wss = new WebSocketServer({ port: PORT });

  console.log(`AS500 Server running on ws://localhost:${PORT}`);

  // Start backup scheduler
  serverModules.backupScheduler.startBackupScheduler({
    enabled: true,
    intervalMinutes: 60,
    keepCount: 10,
  });

  wss.on('connection', (ws: WebSocket) => {
    console.log('Client connected');

    ws.on('message', async (data: Buffer) => {
      try {
        const msg: ClientRequest = JSON.parse(data.toString());

        // Handle RESUME request
        if (msg.key === 'RESUME' && msg.sessionId) {
          const session = serverModules.session.getSession(msg.sessionId);
          if (session) {
            connectionSessions.set(ws, session.id);
            const response: ScreenResponse = {
              sessionId: session.id,
              ...getCurrentScreenResponse(session),
            };
            ws.send(JSON.stringify(response));
            console.log(`Session ${session.id} resumed`);
            return;
          }
        }

        // Get or create session
        let sessionId = connectionSessions.get(ws) || msg.sessionId;
        let session = sessionId ? serverModules.session.getSession(sessionId) : null;

        if (!session) {
          session = serverModules.session.createSession();
          connectionSessions.set(ws, session.id);
          console.log(`Created session: ${session.id}`);
        }

        // Handle request and send response
        const response = await handleClientMessage(session, msg);
        ws.send(JSON.stringify(response));
      } catch (err) {
        console.error('Error handling message:', err);
        ws.send(JSON.stringify({
          error: 'Server error processing request'
        }));
      }
    });

    ws.on('close', () => {
      const sessionId = connectionSessions.get(ws);
      if (sessionId) {
        console.log(`Client disconnected (session: ${sessionId})`);
      }
      connectionSessions.delete(ws);
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
    });

    // Send initial screen
    const session = serverModules.session.createSession();
    connectionSessions.set(ws, session.id);
    const response: ScreenResponse = {
      sessionId: session.id,
      ...serverModules.login.buildLoginScreen(),
    };
    ws.send(JSON.stringify(response));
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Load the built client
  const clientPath = path.join(__dirname, '../client/dist/index.html');
  mainWindow.loadFile(clientPath);

  // Open DevTools in development
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Import server modules first
  await importServerModules();

  // Start the WebSocket server
  startWebSocketServer();

  // Create the window
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  // Close WebSocket server
  if (wss) {
    wss.close();
  }
});
