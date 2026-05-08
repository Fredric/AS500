// Main Menu screen — delegates to the generic menu runtime using the dynamic app menu tree.
// All menu logic (permission filtering, navigation, log off) lives in menuRuntime.ts.

import type { Session, ClientRequest, ScreenResponse } from '../types/index.js';
import { adminMenuNode, logOffNode } from '../menus/menuTree.js';
import { buildMenuTree } from '../menus/menuRegistry.js';
import { buildMenuScreen, handleMenuScreen } from '../menus/menuRuntime.js';

export function mainMenuScreen(session: Session): Omit<ScreenResponse, 'sessionId'> {
  return buildMenuScreen(buildMenuTree(adminMenuNode, logOffNode), session);
}

export async function handleMainMenu(
  session: Session,
  request: ClientRequest
): Promise<ScreenResponse> {
  return handleMenuScreen(buildMenuTree(adminMenuNode, logOffNode), session, request);
}
