// Menu Tree — declarative source of truth for all navigation
// Every menu screen is a flat numbered list; selecting a menu node navigates to that screen.

import type { Session } from '../types/index.js';
import { PERMISSIONS } from '../services/access.js';
import { initTimeRegV2Context } from '../configs/timeRegV2.js';
import { initMotorcyclesContext } from '../configs/motorcyclesConfig.js';
import { initUserMgmtContext } from '../configs/userMgmtConfig.js';

// ============================================
// Types
// ============================================

interface BaseNode {
  key: string;
  name: string;
  requirePermission?: string;
}

export interface MenuNode extends BaseNode {
  type: 'menu';
  title?: string; // Screen title — defaults to name.toUpperCase()
  items: AppNode[];
}

export interface CrudNode extends BaseNode {
  type: 'crudtable';
  configId: string; // CRUDTableConfig.id  e.g. 'motorcycles'
  initContext?: (session: Session) => void | Promise<void>;
}

export interface ActionNode extends BaseNode {
  type: 'action';
  action: 'log_off';
}

export type AppNode = MenuNode | CrudNode | ActionNode;

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
  if (screenId === 'MAIN_MENU') return appMenuTree;
  if (!screenId.startsWith('MENU_')) return null;
  const key = screenId.substring('MENU_'.length).toLowerCase();
  return findMenuByKey(appMenuTree, key);
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
// Application menu tree
// ============================================

export const appMenuTree: MenuNode = {
  type: 'menu',
  key: 'main',
  name: 'Main Menu',
  title: 'MAIN MENU',
  items: [
    {
      type: 'crudtable',
      key: 'time_reg',
      name: 'Time Registration',
      requirePermission: PERMISSIONS.TIME_REG_READ,
      configId: 'timereg_v2',
      initContext: initTimeRegV2Context,
    },
    {
      type: 'menu',
      key: 'garage',
      name: 'My Garage',
      requirePermission: PERMISSIONS.MOTORCYCLES_READ,
      items: [
        {
          type: 'crudtable',
          key: 'motorcycles',
          name: 'Motorcycles',
          requirePermission: PERMISSIONS.MOTORCYCLES_READ,
          configId: 'motorcycles',
          initContext: initMotorcyclesContext,
        },
      ],
    },
    {
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
      ],
    },
    {
      type: 'action',
      key: 'log_off',
      name: 'Log Off',
      action: 'log_off',
    },
  ],
};
