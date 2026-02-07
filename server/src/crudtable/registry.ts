// CRUDTable Registry
// Stores configs and derives screen IDs

import type { CRUDTableConfig } from './types.js';

const configs = new Map<string, CRUDTableConfig>();

// Screen ID convention: CRUD_{ID} for list, CRUD_{ID}_FORM for form
export function listScreenId(configId: string): string {
  return `CRUD_${configId.toUpperCase()}`;
}

export function formScreenId(configId: string): string {
  return `CRUD_${configId.toUpperCase()}_FORM`;
}

export function registerConfig(config: CRUDTableConfig): void {
  configs.set(config.id, config);
}

export function getConfig(id: string): CRUDTableConfig | undefined {
  return configs.get(id);
}

// Match a screen ID back to its config + mode
export function getConfigByScreenId(screenId: string): { config: CRUDTableConfig; mode: 'list' | 'form' } | null {
  if (!screenId.startsWith('CRUD_')) return null;

  for (const config of configs.values()) {
    if (screenId === listScreenId(config.id)) {
      return { config, mode: 'list' };
    }
    if (screenId === formScreenId(config.id)) {
      return { config, mode: 'form' };
    }
  }

  return null;
}
