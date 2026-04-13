import type { Session, ClientRequest, ScreenResponse, MenuNavigation } from '../types/index.js';
import { buildLoginScreen } from './login.js';
import { initTimeRegV2Context } from '../configs/timeRegV2.js';
import { initUserMgmtContext } from '../configs/userMgmtConfig.js';
import { revokeAllUserTokens } from '../services/auth.js';

import {
  defineScreen,
  render,
  header,
  text,
} from '../dsl/index.js';

// ============================================
// Screen Definitions
// ============================================

// Option rows (0-indexed in 24-row screen)
const ITEM_ROW_BASE = 8;

// Regular user menu items
const USER_MENU_ITEMS = [
  { option: '1', label: '1. Time Registration', row: ITEM_ROW_BASE },
  { option: '2', label: '2. Log Off',            row: ITEM_ROW_BASE + 1 },
];

// Admin menu items
const ADMIN_MENU_ITEMS = [
  { option: '1', label: '1. Time Registration', row: ITEM_ROW_BASE },
  { option: '2', label: '2. User Management',   row: ITEM_ROW_BASE + 1 },
  { option: '3', label: '3. Log Off',            row: ITEM_ROW_BASE + 2 },
];

const MAIN_MENU_SCREEN = defineScreen('MAIN_MENU', {
  elements: [
    header({ system: 'AS500 SYSTEM', title: 'MAIN MENU', showDateTime: true, showUser: true }),
    text(7, 8, 'Select one of the following:'),
    ...USER_MENU_ITEMS.map(item => text(item.row, 13, item.label)),
  ],
  statusLine: '↑↓=Navigate  Enter=Select',
  defaultCursor: undefined,
});

const ADMIN_MENU_SCREEN = defineScreen('MAIN_MENU', {
  elements: [
    header({ system: 'AS500 SYSTEM', title: 'MAIN MENU', showDateTime: true, showUser: true }),
    text(7, 8, 'Select one of the following:'),
    ...ADMIN_MENU_ITEMS.map(item => text(item.row, 13, item.label)),
  ],
  statusLine: '↑↓=Navigate  Enter=Select',
  defaultCursor: undefined,
});

// ============================================
// Screen Builder
// ============================================

export function mainMenuScreen(session: Session): Omit<ScreenResponse, 'sessionId'> {
  const screenDef = session.isAdmin ? ADMIN_MENU_SCREEN : MAIN_MENU_SCREEN;
  const menuItems = session.isAdmin ? ADMIN_MENU_ITEMS : USER_MENU_ITEMS;

  const result = render(screenDef, {}, {
    user: session.username || 'UNKNOWN',
  });

  const menuNav: MenuNavigation = {
    items: menuItems.map(item => ({ row: item.row, value: item.option })),
    selectionField: 'selection',
  };

  return {
    screenId: result.screenId,
    cursor: result.cursor,
    rows: result.rows,
    fields: result.fields,
    message: result.message,
    messageType: result.messageType,
    statusLine: result.statusLine,
    bell: result.bell,
    navigation: { type: 'menu', menu: menuNav },
  };
}

// ============================================
// Sign-off helper
// ============================================

async function signOff(session: Session): Promise<Omit<ScreenResponse, 'sessionId'> & { accessToken: null; refreshToken: null }> {
  const userId = session.viserId;

  session.authenticated = false;
  session.isAdmin = false;
  session.viserId = null;
  session.username = null;
  session.currentScreen = 'LOGIN';
  session.screenStack = [];
  session.context = {};

  if (userId) {
    await revokeAllUserTokens(userId);
  }

  return {
    ...buildLoginScreen('Signed off successfully', 'info'),
    accessToken: null,
    refreshToken: null,
  };
}

// ============================================
// Screen Handler
// ============================================

export async function handleMainMenu(
  session: Session,
  request: ClientRequest
): Promise<ScreenResponse> {
  const base = { sessionId: session.id };

  // Esc (sent as F3) from main menu — no back, just refresh
  if (request.key === 'F3') {
    return { ...mainMenuScreen(session), ...base };
  }

  // Handle ENTER — menu selection (client fills 'selection' field)
  if (request.key === 'ENTER') {
    const selection = request.input['selection'] || '';
    const option = parseInt(selection, 10);

    // Option 1 — Time Registration (both user types)
    if (option === 1) {
      session.screenStack.push('MAIN_MENU');
      session.currentScreen = 'CRUD_TIMEREG_V2';
      await initTimeRegV2Context(session);

      const { buildListScreen } = await import('../crudtable/runtime.js');
      const { getConfig } = await import('../crudtable/registry.js');
      const config = getConfig('timereg_v2')!;

      return { ...(await buildListScreen(config, session)), ...base };
    }

    // Option 2 — User Management (admin) or Log Off (regular user)
    if (option === 2) {
      if (session.isAdmin) {
        session.screenStack.push('MAIN_MENU');
        session.currentScreen = 'CRUD_USER_MGMT';
        initUserMgmtContext(session);

        const { buildListScreen } = await import('../crudtable/runtime.js');
        const { getConfig } = await import('../crudtable/registry.js');
        const config = getConfig('user_mgmt')!;

        return { ...(await buildListScreen(config, session)), ...base };
      }

      // Regular user: option 2 = Log Off
      return { ...(await signOff(session)), ...base };
    }

    // Option 3 — Log Off (admin only)
    if (option === 3 && session.isAdmin) {
      return { ...(await signOff(session)), ...base };
    }

    // Invalid selection — refresh with error
    return {
      ...mainMenuScreen(session),
      ...base,
      message: 'Invalid selection',
      messageType: 'error',
      bell: true,
    };
  }

  // Default — show menu
  return { ...mainMenuScreen(session), ...base };
}
