import type { Session, ClientRequest, ScreenResponse, MenuNavigation } from '../types/index.js';
import { buildLoginScreen } from './login.js';
import { initTimeRegV2Context } from '../configs/timeRegV2.js';
import { initUserMgmtContext } from '../configs/userMgmtConfig.js';
import { revokeAllUserTokens } from '../services/auth.js';
import { hasPermission, PERMISSIONS } from '../services/access.js';

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

type MainMenuAction = 'time_reg' | 'user_mgmt' | 'role_defaults' | 'log_off';

interface MainMenuItem {
  option: string;
  label: string;
  row: number;
  action: MainMenuAction;
}

function getMainMenuItems(session: Session): MainMenuItem[] {
  const actions: Array<{ label: string; action: MainMenuAction }> = [
    { label: 'Time Registration', action: 'time_reg' },
  ];

  if (session.isAdmin || hasPermission(session, PERMISSIONS.USER_MGMT_ADMIN)) {
    actions.push({ label: 'User Management', action: 'user_mgmt' });
  }

  if (session.isAdmin || hasPermission(session, PERMISSIONS.SYS_ADMIN)) {
    actions.push({ label: 'Role Defaults', action: 'role_defaults' });
  }

  actions.push({ label: 'Log Off', action: 'log_off' });

  return actions.map((item, index) => ({
    option: String(index + 1),
    label: `${index + 1}. ${item.label}`,
    row: ITEM_ROW_BASE + index,
    action: item.action,
  }));
}

// ============================================
// Screen Builder
// ============================================

export function mainMenuScreen(session: Session): Omit<ScreenResponse, 'sessionId'> {
  const menuItems = getMainMenuItems(session);
  const screenDef = defineScreen('MAIN_MENU', {
    elements: [
      header({ system: 'AS500 SYSTEM', title: 'MAIN MENU', showDateTime: true, showUser: true }),
      text(7, 8, 'Select one of the following:'),
      ...menuItems.map(item => text(item.row, 13, item.label)),
    ],
    statusLine: '↑↓=Navigate  Enter=Select',
    defaultCursor: undefined,
  });

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
  session.userRole = null;
  session.permissions = null;
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
    const menuItems = getMainMenuItems(session);
    const selectedItem = menuItems[option - 1];

    if (selectedItem?.action === 'time_reg') {
      session.screenStack.push('MAIN_MENU');
      session.currentScreen = 'CRUD_TIMEREG_V2';
      await initTimeRegV2Context(session);

      const { buildListScreen } = await import('../crudtable/runtime.js');
      const { getConfig } = await import('../crudtable/registry.js');
      const config = getConfig('timereg_v2')!;

      return { ...(await buildListScreen(config, session)), ...base };
    }

    if (selectedItem?.action === 'user_mgmt') {
      session.screenStack.push('MAIN_MENU');
      session.currentScreen = 'CRUD_USER_MGMT';
      initUserMgmtContext(session);

      const { buildListScreen } = await import('../crudtable/runtime.js');
      const { getConfig } = await import('../crudtable/registry.js');
      const config = getConfig('user_mgmt')!;

      return { ...(await buildListScreen(config, session)), ...base };
    }

    if (selectedItem?.action === 'role_defaults') {
      session.screenStack.push('MAIN_MENU');
      session.currentScreen = 'CRUD_ROLE_DEFAULTS';

      const { buildListScreen } = await import('../crudtable/runtime.js');
      const { getConfig } = await import('../crudtable/registry.js');
      const config = getConfig('role_defaults')!;

      return { ...(await buildListScreen(config, session)), ...base };
    }

    if (selectedItem?.action === 'log_off') {
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
