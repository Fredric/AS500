// CRUDTable Config Registration
// Import and register all CRUDTable configs at startup

import { registerConfig } from '../crudtable/registry.js';
import { timeRegV2Config } from './timeRegV2.js';

export function registerCRUDConfigs(): void {
  registerConfig(timeRegV2Config);
}
