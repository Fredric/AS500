// USER_MGMT Screen - User Management List
// Shows all users with options to edit or reset password

import type { Session, ClientRequest, ScreenResponse } from '../types/index.js';
import { mainMenuScreen } from './mainMenu.js';
import { buildUserEditScreen } from './userEdit.js';
import {
  defineScreen,
  render,
  header,
  text,
  subfile,
} from '../dsl/index.js';
import {
  getAllUsers,
  getUserById,
  formatDate,
  type UserDisplay,
} from '../services/userMgmt.js';

// ============================================
// Screen Definition (Logical)
// ============================================

const USER_MGMT_SCREEN = defineScreen('USER_MGMT', {
  elements: [
    header({ system: 'AS500 SYSTEM', title: 'USER MANAGEMENT', showDateTime: true, showUser: true }),

    // Instructions
    text(5, 2, 'Type option and press Enter.'),
    text(5, 40, '2=Edit  5=Reset password'),

    // Subfile for users
    subfile('users', 7, 12, [
      { header: 'Opt', field: 'opt', width: 3, type: 'alpha' },
      { header: 'Username', key: 'username', width: 10 },
      { header: 'Full Name', key: 'full_name', width: 20 },
      { header: 'Active', key: 'active', width: 6 },
      { header: 'Admin', key: 'is_admin', width: 5 },
      { header: 'Created', key: 'created_at', width: 10 },
    ]),
  ],
  statusLine: 'F3=Exit  F6=Create user  F12=Cancel',
  defaultCursor: 'opt_0',
});

// ============================================
// Screen Builder
// ============================================

export async function buildUserMgmtScreen(
  session: Session,
  message: string | null = null,
  messageType: 'info' | 'warning' | 'error' | null = null
): Promise<Omit<ScreenResponse, 'sessionId'>> {
  // Get all users
  const allUsers = await getAllUsers();

  // Store user IDs in context for option processing
  session.context.userMgmtUserIds = allUsers.map(u => u.id);

  // Format users for subfile display
  const users = allUsers.map((user) => ({
    id: user.id,
    username: user.username,
    full_name: user.full_name || '',
    active: user.active ? 'Yes' : 'No',
    is_admin: user.is_admin ? 'Yes' : 'No',
    created_at: formatDate(user.created_at),
  }));

  // Render the screen
  const result = render(USER_MGMT_SCREEN, { users }, {
    message,
    messageType,
    user: session.username || 'UNKNOWN',
  });

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
// Screen Handler
// ============================================

export async function handleUserMgmt(
  session: Session,
  request: ClientRequest
): Promise<ScreenResponse> {
  const base = { sessionId: session.id };

  // Security check - must be admin
  if (!session.isAdmin) {
    session.currentScreen = 'LOGIN';
    const { buildLoginScreen } = await import('./login.js');
    return {
      ...buildLoginScreen('Access denied. Admin privileges required.', 'error'),
      ...base,
    };
  }

  // F3 - Exit to main menu
  if (request.key === 'F3') {
    session.currentScreen = 'MAIN_MENU';
    session.screenStack = session.screenStack.filter(s => s !== 'USER_MGMT');
    delete session.context.userMgmtUserIds;

    return {
      ...mainMenuScreen(session),
      ...base,
    };
  }

  // F12 - Cancel (same as F3 for this screen)
  if (request.key === 'F12') {
    session.currentScreen = 'MAIN_MENU';
    session.screenStack = session.screenStack.filter(s => s !== 'USER_MGMT');
    delete session.context.userMgmtUserIds;

    return {
      ...mainMenuScreen(session),
      ...base,
    };
  }

  // F6 - Create new user
  if (request.key === 'F6') {
    session.screenStack.push('USER_MGMT');
    session.currentScreen = 'USER_EDIT';
    session.context.editUserId = null; // Create mode
    session.context.resetPasswordMode = false;

    return {
      ...(await buildUserEditScreen(session)),
      ...base,
    };
  }

  // ENTER - Process option selections
  if (request.key === 'ENTER') {
    const userIds = session.context.userMgmtUserIds as number[] || [];

    // Check each opt field for input
    for (let i = 0; i < userIds.length; i++) {
      const opt = request.input[`opt_${i}`]?.trim();

      if (opt === '2') {
        // Edit user
        session.screenStack.push('USER_MGMT');
        session.currentScreen = 'USER_EDIT';
        session.context.editUserId = userIds[i];
        session.context.resetPasswordMode = false;

        return {
          ...(await buildUserEditScreen(session)),
          ...base,
        };
      }

      if (opt === '5') {
        // Reset password
        session.screenStack.push('USER_MGMT');
        session.currentScreen = 'USER_EDIT';
        session.context.editUserId = userIds[i];
        session.context.resetPasswordMode = true;

        return {
          ...(await buildUserEditScreen(session)),
          ...base,
        };
      }

      if (opt && opt !== '') {
        // Invalid option
        return {
          ...(await buildUserMgmtScreen(session, `Invalid option '${opt}'. Use 2=Edit, 5=Reset password`, 'error')),
          ...base,
        };
      }
    }

    // No option entered - just refresh
    return {
      ...(await buildUserMgmtScreen(session)),
      ...base,
    };
  }

  // Default - show screen
  return {
    ...(await buildUserMgmtScreen(session)),
    ...base,
  };
}
