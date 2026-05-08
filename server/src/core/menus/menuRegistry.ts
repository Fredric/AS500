import type { AppNode, MenuNode } from '../types/index.js';

const registeredAppItems: AppNode[] = [];

export function registerMenuItems(items: AppNode[]): void {
  registeredAppItems.push(...items);
}

export function buildMenuTree(coreAdminNode: MenuNode, logOffNode: AppNode): MenuNode {
  return {
    type: 'menu',
    key: 'main',
    name: 'Main Menu',
    title: 'MAIN MENU',
    items: [
      ...registeredAppItems,
      coreAdminNode,
      logOffNode,
    ],
  };
}
