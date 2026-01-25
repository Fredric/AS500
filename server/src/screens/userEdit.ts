// USER_EDIT Screen - Create/Edit User or Reset Password
// Three modes:
// 1. Create mode (editUserId = null): Full form with username and password
// 2. Edit mode (editUserId = number, resetPasswordMode = false): Edit details, no password
// 3. Password reset mode (editUserId = number, resetPasswordMode = true): Password only

import type { Session, ClientRequest, ScreenResponse } from '../types/index.js';
import { buildUserMgmtScreen } from './userMgmt.js';
import {
  defineScreen,
  render,
  header,
  text,
  form,
  field,
} from '../dsl/index.js';
import {
  getUserById,
  createUser,
  updateUser,
  resetUserPassword,
  usernameExists,
  isValidUsername,
  isValidPassword,
  type UserDisplay,
} from '../services/userMgmt.js';

// ============================================
// Screen Definitions (Logical)
// ============================================

// Create mode - full form
const USER_CREATE_SCREEN = defineScreen('USER_EDIT', {
  elements: [
    header({ system: 'AS500 SYSTEM', title: 'CREATE USER', showDateTime: true, showUser: true }),

    form(7, [
      ['Username . . . . :', field('username', 20, 'alpha', { required: true, uppercase: true })],
      ['Full name  . . . :', field('full_name', 30, 'alpha')],
      ['Password . . . . :', field('password', 20, 'password', { required: true })],
      ['Confirm password :', field('confirm', 20, 'password', { required: true })],
      ['Active (Y/N) . . :', field('active', 1, 'alpha', { required: true, uppercase: true })],
      ['Admin (Y/N)  . . :', field('is_admin', 1, 'alpha', { required: true, uppercase: true })],
    ], {
      labelCol: 8,
      fieldCol: 28,
    }),

    text(7, 50, '(3-20 chars, alphanumeric)'),
    text(9, 50, '(min 6 characters)'),
  ],
  statusLine: 'F3=Exit  F12=Cancel',
  defaultCursor: 'username',
});

// Edit mode - no password, username readonly
const USER_EDIT_SCREEN = defineScreen('USER_EDIT', {
  elements: [
    header({ system: 'AS500 SYSTEM', title: 'EDIT USER', showDateTime: true, showUser: true }),

    form(7, [
      ['Username . . . . :', field('username', 20, 'readonly')],
      ['Full name  . . . :', field('full_name', 30, 'alpha')],
      ['Active (Y/N) . . :', field('active', 1, 'alpha', { required: true, uppercase: true })],
      ['Admin (Y/N)  . . :', field('is_admin', 1, 'alpha', { required: true, uppercase: true })],
    ], {
      labelCol: 8,
      fieldCol: 28,
    }),
  ],
  statusLine: 'F3=Exit  F12=Cancel',
  defaultCursor: 'full_name',
});

// Password reset mode - only password fields
const PASSWORD_RESET_SCREEN = defineScreen('USER_EDIT', {
  elements: [
    header({ system: 'AS500 SYSTEM', title: 'RESET PASSWORD', showDateTime: true, showUser: true }),

    form(7, [
      ['Username . . . . :', field('username', 20, 'readonly')],
      ['New password . . :', field('password', 20, 'password', { required: true })],
      ['Confirm password :', field('confirm', 20, 'password', { required: true })],
    ], {
      labelCol: 8,
      fieldCol: 28,
    }),

    text(8, 50, '(min 6 characters)'),
  ],
  statusLine: 'F3=Exit  F12=Cancel',
  defaultCursor: 'password',
});

// ============================================
// Screen Builder
// ============================================

export async function buildUserEditScreen(
  session: Session,
  message: string | null = null,
  messageType: 'info' | 'warning' | 'error' | null = null
): Promise<Omit<ScreenResponse, 'sessionId'>> {
  const editUserId = session.context.editUserId as number | null;
  const resetPasswordMode = session.context.resetPasswordMode as boolean;

  let screenDef = USER_CREATE_SCREEN;
  let fieldValues: Record<string, string> = {};

  if (editUserId) {
    // Get user data
    const user = await getUserById(editUserId);

    if (user) {
      if (resetPasswordMode) {
        // Password reset mode
        screenDef = PASSWORD_RESET_SCREEN;
        fieldValues = {
          username: user.username,
        };
      } else {
        // Edit mode
        screenDef = USER_EDIT_SCREEN;
        fieldValues = {
          username: user.username,
          full_name: user.full_name || '',
          active: user.active ? 'Y' : 'N',
          is_admin: user.is_admin ? 'Y' : 'N',
        };
      }
    }
  } else {
    // Create mode - default values
    fieldValues = {
      active: 'Y',
      is_admin: 'N',
    };
  }

  // Render the screen
  const result = render(screenDef, fieldValues, {
    message,
    messageType,
    user: session.username || 'UNKNOWN',
  });

  return {
    screenId: result.screenId,
    cursor: result.cursor,
    rows: result.rows,
    fields: result.fields,
    fieldValues: Object.keys(fieldValues).length > 0 ? fieldValues : undefined,
    message: result.message,
    messageType: result.messageType,
    statusLine: result.statusLine,
    bell: result.bell,
  };
}

// ============================================
// Screen Handler
// ============================================

export async function handleUserEdit(
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

  const editUserId = session.context.editUserId as number | null;
  const resetPasswordMode = session.context.resetPasswordMode as boolean;

  // F3 or F12 - Cancel and return to USER_MGMT
  if (request.key === 'F3' || request.key === 'F12') {
    session.currentScreen = 'USER_MGMT';
    session.screenStack = session.screenStack.filter(s => s !== 'USER_EDIT');
    delete session.context.editUserId;
    delete session.context.resetPasswordMode;

    return {
      ...(await buildUserMgmtScreen(session)),
      ...base,
    };
  }

  // ENTER - Process form
  if (request.key === 'ENTER') {
    if (resetPasswordMode && editUserId) {
      // Password reset mode
      return await handlePasswordReset(session, request, editUserId);
    } else if (editUserId) {
      // Edit mode
      return await handleEditUser(session, request, editUserId);
    } else {
      // Create mode
      return await handleCreateUser(session, request);
    }
  }

  // Default - show screen
  return {
    ...(await buildUserEditScreen(session)),
    ...base,
  };
}

// ============================================
// Mode-specific Handlers
// ============================================

async function handleCreateUser(
  session: Session,
  request: ClientRequest
): Promise<ScreenResponse> {
  const base = { sessionId: session.id };

  const username = request.input['username']?.trim() || '';
  const fullName = request.input['full_name']?.trim() || null;
  const password = request.input['password'] || '';
  const confirm = request.input['confirm'] || '';
  const activeInput = request.input['active']?.trim().toUpperCase() || '';
  const isAdminInput = request.input['is_admin']?.trim().toUpperCase() || '';

  // Validate username
  if (!username) {
    return {
      ...(await buildUserEditScreen(session, 'Username is required', 'error')),
      ...base,
    };
  }

  if (!isValidUsername(username)) {
    return {
      ...(await buildUserEditScreen(session, 'Username must be 3-20 alphanumeric characters', 'error')),
      ...base,
    };
  }

  if (await usernameExists(username)) {
    return {
      ...(await buildUserEditScreen(session, 'Username already exists', 'error')),
      ...base,
    };
  }

  // Validate password
  if (!password) {
    return {
      ...(await buildUserEditScreen(session, 'Password is required', 'error')),
      ...base,
    };
  }

  if (!isValidPassword(password)) {
    return {
      ...(await buildUserEditScreen(session, 'Password must be at least 6 characters', 'error')),
      ...base,
    };
  }

  if (password !== confirm) {
    return {
      ...(await buildUserEditScreen(session, 'Passwords do not match', 'error')),
      ...base,
    };
  }

  // Validate active/admin flags
  if (activeInput !== 'Y' && activeInput !== 'N') {
    return {
      ...(await buildUserEditScreen(session, 'Active must be Y or N', 'error')),
      ...base,
    };
  }

  if (isAdminInput !== 'Y' && isAdminInput !== 'N') {
    return {
      ...(await buildUserEditScreen(session, 'Admin must be Y or N', 'error')),
      ...base,
    };
  }

  const active = activeInput === 'Y';
  const isAdmin = isAdminInput === 'Y';

  try {
    await createUser(username, password, fullName, active, isAdmin);

    // Return to USER_MGMT with success message
    session.currentScreen = 'USER_MGMT';
    session.screenStack = session.screenStack.filter(s => s !== 'USER_EDIT');
    delete session.context.editUserId;
    delete session.context.resetPasswordMode;

    return {
      ...(await buildUserMgmtScreen(session, `User ${username} created`, 'info')),
      ...base,
    };
  } catch (error) {
    console.error('Error creating user:', error);
    return {
      ...(await buildUserEditScreen(session, 'Error creating user', 'error')),
      ...base,
    };
  }
}

async function handleEditUser(
  session: Session,
  request: ClientRequest,
  userId: number
): Promise<ScreenResponse> {
  const base = { sessionId: session.id };

  const fullName = request.input['full_name']?.trim() || null;
  const activeInput = request.input['active']?.trim().toUpperCase() || '';
  const isAdminInput = request.input['is_admin']?.trim().toUpperCase() || '';

  // Validate active/admin flags
  if (activeInput !== 'Y' && activeInput !== 'N') {
    return {
      ...(await buildUserEditScreen(session, 'Active must be Y or N', 'error')),
      ...base,
    };
  }

  if (isAdminInput !== 'Y' && isAdminInput !== 'N') {
    return {
      ...(await buildUserEditScreen(session, 'Admin must be Y or N', 'error')),
      ...base,
    };
  }

  const active = activeInput === 'Y';
  const isAdmin = isAdminInput === 'Y';

  // Prevent admin from removing their own admin status
  if (userId === session.viserId && !isAdmin) {
    return {
      ...(await buildUserEditScreen(session, 'Cannot remove your own admin status', 'error')),
      ...base,
    };
  }

  try {
    const user = await updateUser(userId, fullName, active, isAdmin);

    if (!user) {
      return {
        ...(await buildUserEditScreen(session, 'User not found', 'error')),
        ...base,
      };
    }

    // Return to USER_MGMT with success message
    session.currentScreen = 'USER_MGMT';
    session.screenStack = session.screenStack.filter(s => s !== 'USER_EDIT');
    delete session.context.editUserId;
    delete session.context.resetPasswordMode;

    return {
      ...(await buildUserMgmtScreen(session, `User ${user.username} updated`, 'info')),
      ...base,
    };
  } catch (error) {
    console.error('Error updating user:', error);
    return {
      ...(await buildUserEditScreen(session, 'Error updating user', 'error')),
      ...base,
    };
  }
}

async function handlePasswordReset(
  session: Session,
  request: ClientRequest,
  userId: number
): Promise<ScreenResponse> {
  const base = { sessionId: session.id };

  const password = request.input['password'] || '';
  const confirm = request.input['confirm'] || '';

  // Validate password
  if (!password) {
    return {
      ...(await buildUserEditScreen(session, 'Password is required', 'error')),
      ...base,
    };
  }

  if (!isValidPassword(password)) {
    return {
      ...(await buildUserEditScreen(session, 'Password must be at least 6 characters', 'error')),
      ...base,
    };
  }

  if (password !== confirm) {
    return {
      ...(await buildUserEditScreen(session, 'Passwords do not match', 'error')),
      ...base,
    };
  }

  try {
    const user = await getUserById(userId);
    const success = await resetUserPassword(userId, password);

    if (!success) {
      return {
        ...(await buildUserEditScreen(session, 'User not found', 'error')),
        ...base,
      };
    }

    // Return to USER_MGMT with success message
    session.currentScreen = 'USER_MGMT';
    session.screenStack = session.screenStack.filter(s => s !== 'USER_EDIT');
    delete session.context.editUserId;
    delete session.context.resetPasswordMode;

    return {
      ...(await buildUserMgmtScreen(session, `Password reset for ${user?.username || 'user'}`, 'info')),
      ...base,
    };
  } catch (error) {
    console.error('Error resetting password:', error);
    return {
      ...(await buildUserEditScreen(session, 'Error resetting password', 'error')),
      ...base,
    };
  }
}
