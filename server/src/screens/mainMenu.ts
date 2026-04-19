// Main Menu screen — delegates to the generic menu runtime using the app menu tree.
// All menu logic (permission filtering, navigation, log off) lives in menuRuntime.ts.

import type { Session, ClientRequest, ScreenResponse } from '../types/index.js';
import { appMenuTree } from '../menus/menuTree.js';
import { buildMenuScreen, handleMenuScreen } from '../menus/menuRuntime.js';

export function mainMenuScreen(session: Session): Omit<ScreenResponse, 'sessionId'> {
  return buildMenuScreen(appMenuTree, session);
}

export async function handleMainMenu(
  session: Session,
  request: ClientRequest
): Promise<ScreenResponse> {
  return handleMenuScreen(appMenuTree, session, request);
}
