import { WebSocketServer, WebSocket } from 'ws';
import { createSession, getSession } from './session/index.js';
import { buildLoginScreen, handleLogin } from './screens/login.js';
import { mainMenuScreen, handleMainMenu } from './screens/mainMenu.js';
import { buildTimeRegScreen, handleTimeReg } from './screens/timeReg.js';
import { buildTimeEntryScreen, handleTimeEntry } from './screens/timeEntry.js';
import type { ClientRequest, ScreenResponse, Session } from './types/index.js';

// Import database initialization
import { initializeDatabase, closeDatabase } from './db/index.js';
import { handleTimeRegHelp } from './screens/timeRegHelp.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

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

    case 'LOGIN':
    default:
      return buildLoginScreen();
  }
}

async function startServer() {
  // Initialize database before starting server
  await initializeDatabase();

  const wss = new WebSocketServer({ port: PORT });

  console.log(`AS500 Server running on ws://localhost:${PORT}`);

  wss.on('connection', (ws: WebSocket) => {
    console.log('Client connected');

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

          default:
            // Unknown screen - return to login
            currentSession.currentScreen = 'LOGIN';
            response = {
              ...buildLoginScreen(),
              sessionId: currentSession.id,
            };
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
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    wss.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
  });

  process.on('SIGTERM', async () => {
    console.log('\nShutting down...');
    wss.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
  });
}

// Start the server
startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
