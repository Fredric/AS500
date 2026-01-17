import { WebSocketServer, WebSocket } from 'ws';
import { createSession, getSession } from './session/index.js';
import { buildLoginScreen, handleLogin } from './screens/login.js';
import { mainMenuScreen, handleMainMenu } from './screens/mainMenu.js';
import type { ClientRequest, ScreenResponse, Session } from './types/index.js';

// Import db to ensure tables are created
import './db/index.js';

const PORT = 3001;

const wss = new WebSocketServer({ port: PORT });

console.log(`AS500 Server running on ws://localhost:${PORT}`);

// Map WebSocket connections to session IDs
const connectionSessions = new Map<WebSocket, string>();

// Get current screen response for a session
function getCurrentScreenResponse(session: Session): Omit<ScreenResponse, 'sessionId'> {
  switch (session.currentScreen) {
    case 'MAIN_MENU':
      if (session.authenticated) {
        return mainMenuScreen(session);
      }
      // Fall through to login if not authenticated
      session.currentScreen = 'LOGIN';
      return buildLoginScreen();
    
    case 'LOGIN':
    default:
      return buildLoginScreen();
  }
}

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
            ...getCurrentScreenResponse(existingSession),
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
            response = handleMainMenu(currentSession, request);
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
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  wss.close(() => {
    process.exit(0);
  });
});
