import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFile, stat } from 'fs/promises';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { createSession, getSession } from './session/index.js';
import { buildLoginScreen, handleLogin } from './screens/login.js';
import { mainMenuScreen, handleMainMenu } from './screens/mainMenu.js';
import type { ClientRequest, ScreenResponse, Session } from './types/index.js';
import { validateAccessToken, refreshAuthTokens, DEFAULT_DEVICE_NAME, type DeviceInfo } from './services/auth.js';
import { loadUserPermissions } from './services/access.js';
import { tokenRefreshRateLimiter } from './utils/rateLimiter.js';

// Import database initialization
import { initializeDatabase, closeDatabase } from './db/index.js';

// CRUDTable system
import { registerCRUDConfigs } from './configs/index.js';
import { handleCRUDScreen, buildCRUDScreenForResume } from './crudtable/router.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

// Lazily load permissions into session after resume from disk (permissions are not persisted)
async function ensurePermissionsLoaded(session: Session): Promise<void> {
  if (session.authenticated && session.viserId && !session.permissions) {
    session.permissions = await loadUserPermissions(session.viserId, session.isAdmin);
  }
}
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

    case 'LOGIN':
      return buildLoginScreen();

    default: {
      // Try CRUDTable screens
      const crudScreen = await buildCRUDScreenForResume(session);
      if (crudScreen) return crudScreen;

      // Try MENU_* screens
      if (session.currentScreen.startsWith('MENU_') && session.authenticated) {
        const { getMenuNodeByScreenId, buildMenuScreen: buildMenu } = await import('./menus/menuRuntime.js');
        const menuNode = getMenuNodeByScreenId(session.currentScreen);
        if (menuNode) return buildMenu(menuNode, session);
      }

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

        // Handle RESUME - client trying to restore a session (or auto-login via tokens)
        if (request.key === 'RESUME') {
          const existingSession = request.sessionId ? getSession(request.sessionId) : null;

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

          // Session expired or not found - try access token first
          if (request.accessToken) {
            const user = await validateAccessToken(request.accessToken);

            if (user) {
              // Valid access token - auto-authenticate
              const session = existingSession ?? createSession();
              session.authenticated = true;
              session.viserId = user.id;
              session.username = user.username;
              session.userRole = user.role;
              session.isAdmin = user.role === 'admin' || user.is_admin;
              session.permissions = await loadUserPermissions(user.id, session.isAdmin);
              if (session.currentScreen === 'LOGIN') {
                session.currentScreen = 'MAIN_MENU';
                session.screenStack = ['LOGIN'];
                session.context = {};
              }

              connectionSessions.set(ws, session.id);
              console.log(`Auto-authenticated via access token for user: ${user.username}`);

              const response: ScreenResponse = {
                ...(await getCurrentScreenResponse(session)),
                sessionId: session.id,
                message: `Welcome back, ${user.username}`,
                messageType: 'info',
              };

              ws.send(JSON.stringify(response));
              return;
            }

            // Access token expired - try to refresh using refresh token
            if (request.refreshToken) {
              // Rate limiting for token refresh (prevent abuse)
              const refreshRateLimitKey = `refresh:${request.refreshToken.substring(0, 8)}`;
              if (!tokenRefreshRateLimiter.check(refreshRateLimitKey)) {
                console.warn('Token refresh rate limit exceeded');
                // Don't reveal rate limiting - just treat as expired token
                const newSession = createSession();
                connectionSessions.set(ws, newSession.id);
                ws.send(JSON.stringify({
                  ...buildLoginScreen('Session expired. Please sign on again.', 'warning'),
                  sessionId: newSession.id,
                  accessToken: null,
                  refreshToken: null,
                }));
                return;
              }

              const deviceInfo: DeviceInfo = {
                deviceId: request.deviceId || 'unknown',
                deviceName: DEFAULT_DEVICE_NAME,
              };

              const refreshResult = await refreshAuthTokens(request.refreshToken, deviceInfo);

              if (refreshResult) {
                const { user: refreshedUser, ...tokens } = refreshResult;
                const session = existingSession ?? createSession();
                session.authenticated = true;
                session.viserId = refreshedUser.id;
                session.username = refreshedUser.username;
                session.userRole = refreshedUser.role;
                session.isAdmin = refreshedUser.role === 'admin' || refreshedUser.is_admin;
                session.permissions = await loadUserPermissions(refreshedUser.id, session.isAdmin);
                if (session.currentScreen === 'LOGIN') {
                  session.currentScreen = 'MAIN_MENU';
                  session.screenStack = ['LOGIN'];
                  session.context = {};
                }

                connectionSessions.set(ws, session.id);
                console.log(`Auto-authenticated via refresh token for user: ${refreshedUser.username}`);

                const response: ScreenResponse = {
                  ...(await getCurrentScreenResponse(session)),
                  sessionId: session.id,
                  message: `Welcome back, ${refreshedUser.username}`,
                  messageType: 'info',
                  accessToken: tokens.accessToken,
                  refreshToken: tokens.refreshToken,
                  accessExpiresAt: tokens.accessExpiresAt.toISOString(),
                  refreshExpiresAt: tokens.refreshExpiresAt.toISOString(),
                };

                ws.send(JSON.stringify(response));
                return;
              }
            }
          }

          // Invalid or expired tokens - create new session and require login
          const newSession = createSession();
          connectionSessions.set(ws, newSession.id);

          const sessionExpiredResponse: ScreenResponse = request.sessionId || request.accessToken
            ? {
                ...buildLoginScreen('Session expired. Please sign on again.', 'warning'),
                sessionId: newSession.id,
                accessToken: null, // Signal client to clear stale tokens
                refreshToken: null,
              }
            : {
                ...buildLoginScreen(),
                sessionId: newSession.id,
              };

          ws.send(JSON.stringify(sessionExpiredResponse));
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

        // Ensure permissions are loaded (needed after disk-restore where Set is not persisted)
        await ensurePermissionsLoaded(currentSession);

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

          default: {
            // Try CRUDTable screens
            const crudResponse = await handleCRUDScreen(currentSession, request);
            if (crudResponse) {
              response = crudResponse;
              break;
            }

            // Try MENU_* screens
            if (currentSession.currentScreen.startsWith('MENU_')) {
              const { getMenuNodeByScreenId, handleMenuScreen } = await import('./menus/menuRuntime.js');
              const menuNode = getMenuNodeByScreenId(currentSession.currentScreen);
              if (menuNode) {
                response = await handleMenuScreen(menuNode, currentSession, request);
                break;
              }
            }

            // Unknown screen - return to login
            currentSession.currentScreen = 'LOGIN';
            response = {
              ...buildLoginScreen(),
              sessionId: currentSession.id,
            };
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
