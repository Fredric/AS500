// CRUDTable Config Registration
// Import and register all CRUDTable configs at startup

import { registerConfig } from '../crudtable/registry.js';
import { timeRegV2Config } from './timeRegV2.js';
import { userMgmtConfig } from './userMgmtConfig.js';
import { roleDefaultsConfig } from './roleDefaultsConfig.js';
import { motorcyclesConfig } from './motorcyclesConfig.js';
import { modsConfig } from './modsConfig.js';
import { servicesPerformedConfig } from './servicesPerformedConfig.js';
import { authTokensConfig } from './authTokensConfig.js';
import { oauthClientsConfig } from './oauthClientsConfig.js';
import { mcpAuditConfig } from './mcpAuditConfig.js';

export function registerCRUDConfigs(): void {
  registerConfig(timeRegV2Config);
  registerConfig(userMgmtConfig);
  registerConfig(roleDefaultsConfig);
  registerConfig(motorcyclesConfig);
  registerConfig(modsConfig);
  registerConfig(servicesPerformedConfig);
  registerConfig(authTokensConfig);
  registerConfig(oauthClientsConfig);
  registerConfig(mcpAuditConfig);
}
