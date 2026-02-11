import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFile, stat } from 'fs/promises';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { createSession, getSession } from './session/index.js';
import { buildLoginScreen, handleLogin } from './screens/login.js';
import { mainMenuScreen, handleMainMenu } from './screens/mainMenu.js';
import { buildTimeRegScreen, handleTimeReg } from './screens/timeReg.js';
import { buildTimeEntryScreen, handleTimeEntry } from './screens/timeEntry.js';
import { buildUserMgmtScreen, handleUserMgmt } from './screens/userMgmt.js';
import { buildUserEditScreen, handleUserEdit } from './screens/userEdit.js';
import type { ClientRequest, ScreenResponse, Session } from './types/index.js';

// Import database initialization
import { initializeDatabase, closeDatabase } from './db/index.js';
import { handleTimeRegHelp } from './screens/timeRegHelp.js';

// CRUDTable system
import { registerCRUDConfigs } from './configs/index.js';
import { handleCRUDScreen, buildCRUDScreenForResume } from './crudtable/router.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Static file serving for production
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLIENT_DIST = join(__dirname, '../../client/dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url || '/';
  let filePath = join(CLIENT_DIST, url === '/' ? 'index.html' : url);

  try {
    const stats = await stat(filePath);
    if (stats.isDirectory()) {
      filePath = join(filePath, 'index.html');
    }

    const content = await readFile(filePath);
    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    // File not found - serve index.html for SPA routing
    try {
      const indexContent = await readFile(join(CLIENT_DIST, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(indexContent);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  }
}

// Ping interval for keeping WebSocket connections alive (Heroku 55s timeout)
const PING_INTERVAL = 30000; // 30 seconds

// Map WebSocket connections to session IDs
const connectionSessions = new Map<WebSocket, string>();

// Get current screen response for a session
async function getCurrentScreenResponse(session: Session): Promise<Omit<ScreenResponse, 'sessionId'>> {
  switch (session.currentScreen) {
    case 'MAIN_MENU':
      if (session.authenticated) {
        return mainMenuScreen(session);
      }
      // Fall through to login if not authenticated
      session.currentScreen = 'LOGIN';
      return buildLoginScreen();

    case 'TIME_REG':
      if (session.authenticated) {
        return await buildTimeRegScreen(session);
      }
      session.currentScreen = 'LOGIN';
      return buildLoginScreen();

    case 'TIME_ENTRY':
      if (session.authenticated) {
        return await buildTimeEntryScreen(session);
      }
      session.currentScreen = 'LOGIN';
      return buildLoginScreen();

    case 'USER_MGMT':
      if (session.authenticated && session.isAdmin) {
        return await buildUserMgmtScreen(session);
      }
      session.currentScreen = 'LOGIN';
      return buildLoginScreen('Access denied. Admin privileges required.', 'error');

    case 'USER_EDIT':
      if (session.authenticated && session.isAdmin) {
        return await buildUserEditScreen(session);
      }
      session.currentScreen = 'LOGIN';
      return buildLoginScreen('Access denied. Admin privileges required.', 'error');

    case 'LOGIN':
      return buildLoginScreen();

    default: {
      // Try CRUDTable screens
      const crudScreen = await buildCRUDScreenForResume(session);
      if (crudScreen) return crudScreen;
      return buildLoginScreen();
    }
  }
}

async function startServer() {
  // Initialize database before starting server
  await initializeDatabase();

  // Register CRUDTable configs
  registerCRUDConfigs();

  // Create HTTP server for static file serving in production
  const httpServer = createServer((req, res) => {
    if (IS_PRODUCTION) {
      serveStatic(req, res);
    } else {
      // In development, just return a simple message (Vite serves the client)
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('AS500 WebSocket Server - Use Vite dev server for client');
    }
  });

  // Attach WebSocket server to HTTP server
  const wss = new WebSocketServer({ server: httpServer });

  // Start HTTP server
  httpServer.listen(PORT, () => {
    console.log(`AS500 Server running on port ${PORT}`);
    if (IS_PRODUCTION) {
      console.log(`Serving static files from ${CLIENT_DIST}`);
    }
  });

  // Ping/pong keepalive for Heroku (55s idle timeout)
  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if ((ws as WebSocket & { isAlive?: boolean }).isAlive === false) {
        return ws.terminate();
      }
      (ws as WebSocket & { isAlive?: boolean }).isAlive = false;
      ws.ping();
    });
  }, PING_INTERVAL);

  wss.on('connection', (ws: WebSocket) => {
    console.log('Client connected');

    // Mark connection as alive for ping/pong
    (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    ws.on('pong', () => {
      (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    });

    // Don't create session immediately - wait for first message
    // This allows client to send RESUME with existing sessionId

    ws.on('message', async (data: Buffer) => {
      try {
        const request: ClientRequest = JSON.parse(data.toString());

        // Handle RESUME - client trying to restore a session
        if (request.key === 'RESUME' && request.sessionId) {
          const existingSession = getSession(request.sessionId);

          if (existingSession && existingSession.authenticated) {
            // Valid authenticated session - restore it
            connectionSessions.set(ws, existingSession.id);
            console.log(`Session resumed for user: ${existingSession.username}`);

            const response: ScreenResponse = {
              ...(await getCurrentScreenResponse(existingSession)),
              sessionId: existingSession.id,
              message: `Welcome back, ${existingSession.username}`,
              messageType: 'info',
            };

            ws.send(JSON.stringify(response));
            return;
          }

          // Invalid or expired session - create new one
          const newSession = createSession();
          connectionSessions.set(ws, newSession.id);

          const response: ScreenResponse = {
            ...buildLoginScreen('Session expired. Please sign on again.', 'warning'),
            sessionId: newSession.id,
          };

          ws.send(JSON.stringify(response));
          return;
        }

        // Handle PING - heartbeat to keep session alive
        if (request.key === 'PING' && request.sessionId) {
          const session = getSession(request.sessionId);
          
          if (session) {
            // Session found and activity updated by getSession()
            // Send minimal acknowledgment (no screen update needed)
            ws.send(JSON.stringify({ type: 'PONG', sessionId: session.id }));
            return;
          }
          
          // Session not found or expired - client will need to reconnect
          return;
        }

        // Get or create session
        let currentSession: Session | null = null;

        if (request.sessionId) {
          currentSession = getSession(request.sessionId);
        }

        if (!currentSession) {
          // No valid session - create new one
          currentSession = createSession();
          connectionSessions.set(ws, currentSession.id);

          // If this is the first message (no session), just send login screen
          if (!request.sessionId) {
            const loginScreen: ScreenResponse = {
              ...buildLoginScreen(),
              sessionId: currentSession.id,
            };
            ws.send(JSON.stringify(loginScreen));
            return;
          }

          // Session was provided but invalid/expired
          const expiredScreen: ScreenResponse = {
            ...buildLoginScreen('Session expired. Please sign on again.', 'warning'),
            sessionId: currentSession.id,
          };

          ws.send(JSON.stringify(expiredScreen));
          return;
        }

        // Update connection mapping
        connectionSessions.set(ws, currentSession.id);

        // Route to appropriate handler based on current screen
        let response: ScreenResponse;

        switch (currentSession.currentScreen) {
          case 'LOGIN':
            response = await handleLogin(currentSession, request);
            break;

          case 'MAIN_MENU':
            // Check authentication
            if (!currentSession.authenticated) {
              currentSession.currentScreen = 'LOGIN';
              response = {
                ...buildLoginScreen('Please sign on to continue', 'warning'),
                sessionId: currentSession.id,
              };
            } else {
              response = await handleMainMenu(currentSession, request);
            }
            break;

          case 'TIME_REG':
            // Check authentication
            if (!currentSession.authenticated) {
              currentSession.currentScreen = 'LOGIN';
              response = {
                ...buildLoginScreen('Please sign on to continue', 'warning'),
                sessionId: currentSession.id,
              };
            } else {
              response = await handleTimeReg(currentSession, request);
            }
            break;

          case 'TIME_ENTRY':
            // Check authentication
            if (!currentSession.authenticated) {
              currentSession.currentScreen = 'LOGIN';
              response = {
                ...buildLoginScreen('Please sign on to continue', 'warning'),
                sessionId: currentSession.id,
              };
            } else {
              response = await handleTimeEntry(currentSession, request);
            }
            break;

          case 'TIME_REG_HELP':
            // Check authentication
            if (!currentSession.authenticated) {
              currentSession.currentScreen = 'LOGIN';
              response = {
                ...buildLoginScreen('Please sign on to continue', 'warning'),
                sessionId: currentSession.id,
              };
            } else {
              response = await handleTimeRegHelp(currentSession, request);
            }
            break;

          case 'USER_MGMT':
            // Check authentication and admin status
            if (!currentSession.authenticated || !currentSession.isAdmin) {
              currentSession.currentScreen = 'LOGIN';
              response = {
                ...buildLoginScreen('Access denied. Admin privileges required.', 'error'),
                sessionId: currentSession.id,
              };
            } else {
              response = await handleUserMgmt(currentSession, request);
            }
            break;

          case 'USER_EDIT':
            // Check authentication and admin status
            if (!currentSession.authenticated || !currentSession.isAdmin) {
              currentSession.currentScreen = 'LOGIN';
              response = {
                ...buildLoginScreen('Access denied. Admin privileges required.', 'error'),
                sessionId: currentSession.id,
              };
            } else {
              response = await handleUserEdit(currentSession, request);
            }
            break;

          default: {
            // Try CRUDTable screens
            const crudResponse = await handleCRUDScreen(currentSession, request);
            if (crudResponse) {
              response = crudResponse;
            } else {
              // Unknown screen - return to login
              currentSession.currentScreen = 'LOGIN';
              response = {
                ...buildLoginScreen(),
                sessionId: currentSession.id,
              };
            }
            break;
          }
        }

        // Update session's current screen
        if (response.screenId !== currentSession.currentScreen) {
          currentSession.currentScreen = response.screenId;
        }

        ws.send(JSON.stringify(response));

      } catch (error) {
        console.error('Error handling message:', error);

        // Send error response
        const sessionId = connectionSessions.get(ws) || 'unknown';
        const errorResponse: ScreenResponse = {
          ...buildLoginScreen('System error. Please try again.', 'error'),
          sessionId,
        };

        ws.send(JSON.stringify(errorResponse));
      }
    });

    ws.on('close', () => {
      console.log('Client disconnected');
      connectionSessions.delete(ws);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      connectionSessions.delete(ws);
    });
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...');
    clearInterval(pingInterval);
    wss.close(async () => {
      httpServer.close(async () => {
        await closeDatabase();
        process.exit(0);
      });
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Start the server
startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
