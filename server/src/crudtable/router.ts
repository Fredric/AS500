// CRUDTable Router
// Integration hooks for index.ts

import type { Session, ClientRequest, ScreenResponse } from '../types/index.js';
import { getConfigByScreenId } from './registry.js';
import { buildListScreen, handleList, buildFormScreen, handleForm } from './runtime.js';
import { buildLoginScreen } from '../screens/login.js';
import { hasPermission } from '../services/access.js';

// Handle a CRUD screen request (called from message handler)
export async function handleCRUDScreen(
  session: Session,
  request: ClientRequest
): Promise<ScreenResponse | null> {
  const match = getConfigByScreenId(session.currentScreen);
  if (!match) return null;

  const { config, mode } = match;
  const base = { sessionId: session.id };

  // Auth checks
  if (config.requireAuth !== false && !session.authenticated) {
    session.currentScreen = 'LOGIN';
    return {
      ...buildLoginScreen('Please sign on to continue', 'warning'),
      ...base,
    };
  }

  if (config.requireAdmin && !session.isAdmin) {
    session.currentScreen = 'LOGIN';
    return {
      ...buildLoginScreen('Access denied. Admin privileges required.', 'error'),
      ...base,
    };
  }

  if (config.requirePermission && !hasPermission(session, config.requirePermission)) {
    session.currentScreen = 'MAIN_MENU';
    return {
      ...buildLoginScreen('Access denied. Insufficient permissions.', 'error'),
      ...base,
    };
  }

  if (mode === 'list') {
    return await handleList(config, session, request);
  }

  return await handleForm(config, session, request);
}

// Build a CRUD screen for session resume (called from getCurrentScreenResponse)
export async function buildCRUDScreenForResume(
  session: Session
): Promise<Omit<ScreenResponse, 'sessionId'> | null> {
  const match = getConfigByScreenId(session.currentScreen);
  if (!match) return null;

  const { config, mode } = match;

  // Auth checks
  if (config.requireAuth !== false && !session.authenticated) {
    session.currentScreen = 'LOGIN';
    return buildLoginScreen();
  }

  if (config.requireAdmin && !session.isAdmin) {
    session.currentScreen = 'LOGIN';
    return buildLoginScreen('Access denied. Admin privileges required.', 'error');
  }

  if (config.requirePermission && !hasPermission(session, config.requirePermission)) {
    session.currentScreen = 'MAIN_MENU';
    return buildLoginScreen('Access denied. Insufficient permissions.', 'error');
  }

  if (mode === 'list') {
    return await buildListScreen(config, session);
  }

  return await buildFormScreen(config, session);
}
