import type { Session, ClientRequest, ScreenResponse } from '../types/index.js';
import { validateCredentials, createAuthTokens, DEFAULT_DEVICE_NAME } from '../services/auth.js';
import { loadUserPermissions } from '../services/access.js';
import { mainMenuScreen } from './mainMenu.js';
import { persistSessions } from '../session/index.js';
import { loginRateLimiter } from '../utils/rateLimiter.js';

// Import DSL
import {
  defineScreen,
  render,
  box,
  centeredText,
  form,
  field,
} from '../dsl/index.js';

// ============================================
// Screen Definition (Logical)
// ============================================

const LOGIN_SCREEN = defineScreen('LOGIN', {
  elements: [
    // Logo box
    box(3, 19, 42, 6, { border: 'double' }),
    centeredText(5, 'A S 5 0 0'),
    centeredText(6, 'TERMINAL SYSTEM'),

    // Login form
    form(10, [
      ['User  . . . :', field('username', 20, 'alpha', { required: true, uppercase: true })],
      ['Password  . :', field('password', 20, 'password', { required: true })],
    ], {
      labelCol: 25,
      fieldCol: 40,
    }),

    // Instructions
    centeredText(14, 'Press ENTER to sign on'),
  ],
  defaultCursor: 'username',
});

// ============================================
// Screen Builder (uses DSL renderer)
// ============================================

export function buildLoginScreen(
  message: string | null = null,
  messageType: 'info' | 'warning' | 'error' | null = null
): Omit<ScreenResponse, 'sessionId'> {
  const result = render(LOGIN_SCREEN, {}, { message, messageType });

  return {
    screenId: result.screenId,
    cursor: result.cursor,
    rows: result.rows,
    fields: result.fields,
    message: result.message,
    messageType: result.messageType,
    statusLine: result.statusLine,
    bell: result.bell,
  };
}

// ============================================
// Screen Handler (Business Logic)
// ============================================

export async function handleLogin(
  session: Session,
  request: ClientRequest
): Promise<ScreenResponse> {
  const base = { sessionId: session.id };

  if (request.key !== 'ENTER') {
    return { ...buildLoginScreen(), ...base };
  }

  const username = request.input['username'] || '';
  const password = request.input['password'] || '';

  // Rate limit per account to block brute force regardless of session
  const normalizedUsername = username.toUpperCase().trim();
  const rateLimitKey = normalizedUsername ? `login:${normalizedUsername}` : `login:${session.id}`;
  if (!loginRateLimiter.check(rateLimitKey)) {
    return {
      ...buildLoginScreen('Too many login attempts. Please try again later.', 'error'),
      ...base,
    };
  }

  // Validate required fields
  if (!username.trim()) {
    return {
      ...buildLoginScreen('User ID is required', 'error'),
      ...base,
    };
  }

  if (!password) {
    return {
      ...buildLoginScreen('Password is required', 'error'),
      ...base,
    };
  }

  // Authenticate
  const user = await validateCredentials(username, password);

  if (!user) {
    return {
      ...buildLoginScreen('Invalid user or password', 'error'),
      ...base,
    };
  }

  // Success! Update session
  session.authenticated = true;
  session.viserId = user.id;
  session.username = user.username;
  session.userRole = user.role;
  session.isAdmin = user.role === 'admin' || user.is_admin;
  session.permissions = await loadUserPermissions(user.id, session.isAdmin);
  session.currentScreen = 'MAIN_MENU';
  session.screenStack = ['LOGIN'];
  
  // Persist session immediately after authentication
  persistSessions();

  const tokens = await createAuthTokens(user.id, {
    deviceId: request.deviceId || 'unknown',
    deviceName: DEFAULT_DEVICE_NAME,
  });

  return {
    ...mainMenuScreen(session),
    sessionId: session.id,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessExpiresAt: tokens.accessExpiresAt.toISOString(),
    refreshExpiresAt: tokens.refreshExpiresAt.toISOString(),
  };
}
