import type { Session, ClientRequest, ScreenResponse, Field } from '../types/index.js';
import { validateCredentials } from '../services/auth.js';
import { mainMenuScreen } from './mainMenu.js';

const SCREEN_WIDTH = 80;
const SCREEN_HEIGHT = 24;

// Field positions
const USERNAME_ROW = 10;
const USERNAME_COL = 36;
const PASSWORD_ROW = 11;
const PASSWORD_COL = 36;
const FIELD_LENGTH = 20;

function padLine(line: string): string {
  return line.padEnd(SCREEN_WIDTH, ' ');
}

function centerText(text: string, width: number = SCREEN_WIDTH): string {
  const padding = Math.floor((width - text.length) / 2);
  return ' '.repeat(padding) + text;
}

export function buildLoginScreen(message: string | null = null, messageType: 'info' | 'warning' | 'error' | null = null): Omit<ScreenResponse, 'sessionId'> {
  const rows: string[] = [];
  
  // Build the screen content
  rows.push(padLine(''));
  rows.push(padLine(''));
  rows.push(padLine(''));
  rows.push(padLine(centerText('╔════════════════════════════════════════╗')));
  rows.push(padLine(centerText('║                                        ║')));
  rows.push(padLine(centerText('║            A S 5 0 0                   ║')));
  rows.push(padLine(centerText('║       TERMINAL SYSTEM                  ║')));
  rows.push(padLine(centerText('║                                        ║')));
  rows.push(padLine(centerText('╚════════════════════════════════════════╝')));
  rows.push(padLine(''));
  rows.push(padLine('                         User  . . . : ' + '_'.repeat(FIELD_LENGTH)));
  rows.push(padLine('                         Password  . : ' + '_'.repeat(FIELD_LENGTH)));
  rows.push(padLine(''));
  rows.push(padLine(''));
  rows.push(padLine(centerText('Press ENTER to sign on')));
  rows.push(padLine(''));
  rows.push(padLine(''));
  rows.push(padLine(''));
  rows.push(padLine(''));
  rows.push(padLine(''));
  rows.push(padLine(''));
  rows.push(padLine(''));
  
  // Status line (row 23)
  rows.push(padLine(''));
  
  // Message line (row 24)
  rows.push(padLine(''));
  
  const fields: Field[] = [
    {
      row: USERNAME_ROW,
      col: USERNAME_COL,
      length: FIELD_LENGTH,
      type: 'alpha',
      name: 'username',
      required: true,
      uppercase: true,
    },
    {
      row: PASSWORD_ROW,
      col: PASSWORD_COL,
      length: FIELD_LENGTH,
      type: 'password',
      name: 'password',
      required: true,
    },
  ];
  
  return {
    screenId: 'LOGIN',
    cursor: { row: USERNAME_ROW, col: USERNAME_COL },
    rows,
    fields,
    message,
    messageType,
    statusLine: '',
    bell: messageType === 'error',
  };
}

export async function handleLogin(
  session: Session,
  request: ClientRequest
): Promise<ScreenResponse> {
  const base = { sessionId: session.id };
  
  // Only process ENTER key
  if (request.key !== 'ENTER') {
    return { ...buildLoginScreen(), ...base };
  }
  
  // Get input values
  const username = request.input[`${USERNAME_ROW},${USERNAME_COL}`] || '';
  const password = request.input[`${PASSWORD_ROW},${PASSWORD_COL}`] || '';
  
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
  
  // Return main menu
  return {
    ...mainMenuScreen(session),
    sessionId: session.id,
  };
}
