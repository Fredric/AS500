// Menu Tree — core (system) nodes only
// App-specific menu items are registered via menuRegistry.ts → registerMenuItems()

import { PERMISSIONS } from '../services/access.js';
import { initUserMgmtContext } from '../configs/userMgmtConfig.js';
import { buildMenuTree } from './menuRegistry.js';
import type { MenuNode, AppNode } from '../types/index.js';

// Re-export types for backward compatibility
export type { MenuNode, CrudNode, ActionNode, AppNode } from '../types/index.js';

// ============================================
// Screen ID helpers
// ============================================

export function menuScreenId(key: string): string {
  return key === 'main' ? 'MAIN_MENU' : `MENU_${key.toUpperCase()}`;
}

// ============================================
// Tree lookup helpers
// ============================================

export function getMenuNodeByScreenId(screenId: string): MenuNode | null {
  const tree = buildMenuTree(adminMenuNode, logOffNode);
  if (screenId === 'MAIN_MENU') return tree;
  if (!screenId.startsWith('MENU_')) return null;
  const key = screenId.substring('MENU_'.length).toLowerCase();
  return findMenuByKey(tree, key);
}

function findMenuByKey(node: MenuNode, key: string): MenuNode | null {
  for (const item of node.items) {
    if (item.type === 'menu') {
      if (item.key === key) return item;
      const found = findMenuByKey(item, key);
      if (found) return found;
    }
  }
  return null;
}

// ============================================
// Core (system) menu nodes
// ============================================

export const adminMenuNode: MenuNode = {
  type: 'menu',
  key: 'admin',
  name: 'Administration',
  requirePermission: PERMISSIONS.USER_MGMT_ADMIN,
  items: [
    {
      type: 'crudtable',
      key: 'user_mgmt',
      name: 'User Management',
      requirePermission: PERMISSIONS.USER_MGMT_ADMIN,
      configId: 'user_mgmt',
      initContext: initUserMgmtContext,
    },
    {
      type: 'crudtable',
      key: 'role_defaults',
      name: 'Role Defaults',
      requirePermission: PERMISSIONS.SYS_ADMIN,
      configId: 'role_defaults',
    },
    {
      type: 'crudtable',
      key: 'auth_tokens',
      name: 'Auth Tokens',
      requirePermission: PERMISSIONS.SYS_ADMIN,
      configId: 'auth_tokens',
    },
    {
      type: 'crudtable',
      key: 'oauth_clients',
      name: 'OAuth Clients',
      requirePermission: PERMISSIONS.SYS_ADMIN,
      configId: 'oauth_clients',
    },
    {
      type: 'crudtable',
      key: 'mcp_audit',
      name: 'MCP Audit Log',
      requirePermission: PERMISSIONS.SYS_ADMIN,
      configId: 'mcp_audit',
    },
  ],
};

export const logOffNode: AppNode = {
  type: 'action',
  key: 'log_off',
  name: 'Log Off',
  action: 'log_off',
};
