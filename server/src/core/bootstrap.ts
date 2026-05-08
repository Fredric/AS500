import { registerConfig } from './crudtable/registry.js';
import { userMgmtConfig } from './configs/userMgmtConfig.js';
import { roleDefaultsConfig } from './configs/roleDefaultsConfig.js';
import { authTokensConfig } from './configs/authTokensConfig.js';
import { oauthClientsConfig } from './configs/oauthClientsConfig.js';
import { mcpAuditConfig } from './configs/mcpAuditConfig.js';

export function bootstrapCore(): void {
  registerConfig(userMgmtConfig);
  registerConfig(roleDefaultsConfig);
  registerConfig(authTokensConfig);
  registerConfig(oauthClientsConfig);
  registerConfig(mcpAuditConfig);
}
