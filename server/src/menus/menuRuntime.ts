// Menu Runtime — generic build/handle for all menu screens
// Each menu is a standalone full-screen numbered list (AS/400 style).
// Selecting a menu node navigates to that screen; Esc/F12 always returns to parent.

import type { Session, ClientRequest, ScreenResponse, MenuNavigation } from '../types/index.js';
import type { MenuNode, AppNode } from './menuTree.js';
import { menuScreenId, getMenuNodeByScreenId } from './menuTree.js';
import { hasPermission } from '../services/access.js';
import { revokeAllUserTokens } from '../services/auth.js';
import { defineScreen, render, header, text } from '../dsl/index.js';

const ITEM_ROW_BASE = 8;

// ============================================
// Permission filter
// ============================================

function isVisible(node: AppNode, session: Session): boolean {
  if (node.requireAdmin && !session.isAdmin) return false;
  if (node.requirePermission && !hasPermission(session, node.requirePermission)) return false;
  return true;
}

function getVisibleItems(node: MenuNode, session: Session): AppNode[] {
  return node.items.filter((item) => isVisible(item, session));
}

// ============================================
// Build a menu screen (sync — DSL render only)
// ============================================

export function buildMenuScreen(node: MenuNode, session: Session): Omit<ScreenResponse, 'sessionId'> {
  const items = getVisibleItems(node, session);
  const title = node.title ?? node.name.toUpperCase();
  const screenId = menuScreenId(node.key);

  const labeledItems = items.map((item, index) => ({
    option: String(index + 1),
    label: `${index + 1}. ${item.name}`,
    row: ITEM_ROW_BASE + index,
  }));

  const screenDef = defineScreen(screenId, {
    elements: [
      header({ system: 'AS500 SYSTEM', title, showDateTime: true, showUser: true }),
      text(7, 8, 'Select one of the following:'),
      ...labeledItems.map((item) => text(item.row, 13, item.label)),
    ],
    statusLine: '↑↓=Navigate  Enter=Select  Esc=Back',
    defaultCursor: undefined,
  });

  const result = render(screenDef, {}, { user: session.username || 'UNKNOWN' });

  const menuNav: MenuNavigation = {
    items: labeledItems.map((item) => ({ row: item.row, value: item.option })),
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
// Handle a menu screen
// ============================================

export async function handleMenuScreen(
  node: MenuNode,
  session: Session,
  request: ClientRequest
): Promise<ScreenResponse> {
  const base = { sessionId: session.id };

  // F3 / F12 / Esc — go back (pop stack or stay at root)
  if (request.key === 'F3' || request.key === 'F12') {
    const prevScreen = session.screenStack.pop();
    if (prevScreen) {
      session.currentScreen = prevScreen;
      // If returning to a parent menu, render it
      const parentMenu = getMenuNodeByScreenId(prevScreen);
      if (parentMenu && session.authenticated) {
        return { ...buildMenuScreen(parentMenu, session), ...base };
      }
    }
    // At root or nowhere to go — just refresh the current menu
    return { ...buildMenuScreen(node, session), ...base };
  }

  // ENTER — process selection
  if (request.key === 'ENTER') {
    const selection = request.input['selection'] || '';
    const option = parseInt(selection, 10);
    const items = getVisibleItems(node, session);
    const selected = items[option - 1];

    if (!selected) {
      return {
        ...buildMenuScreen(node, session),
        ...base,
        message: 'Invalid selection',
        messageType: 'error',
        bell: true,
      };
    }

    // Navigate to sub-menu
    if (selected.type === 'menu') {
      session.screenStack.push(menuScreenId(node.key));
      session.currentScreen = menuScreenId(selected.key);
      return { ...buildMenuScreen(selected, session), ...base };
    }

    // Navigate to CRUD screen
    if (selected.type === 'crudtable') {
      if (selected.initContext) {
        await selected.initContext(session);
      }
      session.screenStack.push(menuScreenId(node.key));
      session.currentScreen = `CRUD_${selected.configId.toUpperCase()}`;

      const { buildListScreen } = await import('../crudtable/runtime.js');
      const { getConfig } = await import('../crudtable/registry.js');
      const config = getConfig(selected.configId);
      if (!config) {
        return {
          ...buildMenuScreen(node, session),
          ...base,
          message: `Config '${selected.configId}' not found`,
          messageType: 'error',
        };
      }
      return { ...(await buildListScreen(config, session)), ...base };
    }

    // Action node
    if (selected.type === 'action' && selected.action === 'log_off') {
      return { ...(await handleLogOff(session)), ...base };
    }

    return { ...buildMenuScreen(node, session), ...base };
  }

  // Default — show menu
  return { ...buildMenuScreen(node, session), ...base };
}

// ============================================
// Log off
// ============================================

async function handleLogOff(
  session: Session
): Promise<Omit<ScreenResponse, 'sessionId'> & { accessToken: null; refreshToken: null }> {
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

  const { buildLoginScreen } = await import('../screens/login.js');
  return {
    ...buildLoginScreen('Signed off successfully', 'info'),
    accessToken: null,
    refreshToken: null,
  };
}

// Re-export for use by runtime.ts buildReturnScreen
export { getMenuNodeByScreenId };
