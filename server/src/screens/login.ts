import type { Session, ClientRequest, ScreenResponse } from '../types/index.js';
import { validateCredentials } from '../services/auth.js';
import { mainMenuScreen } from './mainMenu.js';
import { persistSessions } from '../session/index.js';

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

  // Only process ENTER key
  if (request.key !== 'ENTER') {
    return { ...buildLoginScreen(), ...base };
  }

  // Get input values by field name (client sends input keyed by field name)
  const username = request.input['username'] || '';
  const password = request.input['password'] || '';

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
  session.currentScreen = 'MAIN_MENU';
  session.screenStack = ['LOGIN'];
  
  // Persist session immediately after authentication
  persistSessions();

  // Return main menu
  return {
    ...mainMenuScreen(session),
    sessionId: session.id,
  };
}
