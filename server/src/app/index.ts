// App registration entry point — side effects only.
// Import order matters: configs must be registered before menu items,
// and both must be registered before the server starts handling requests.
import { registerConfig } from '../core/crudtable/registry.js';

import { timeRegV2Config } from './configs/timeRegV2.js';
import { motorcyclesConfig } from './configs/motorcyclesConfig.js';
import { modsConfig } from './configs/modsConfig.js';
import { servicesPerformedConfig } from './configs/servicesPerformedConfig.js';
import { documentsConfig } from './configs/documentsConfig.js';

registerConfig(timeRegV2Config);
registerConfig(motorcyclesConfig);
registerConfig(modsConfig);
registerConfig(servicesPerformedConfig);
registerConfig(documentsConfig);

// Menu items — must come after config registration (initContext references config objects)
import './menus/appMenu.js';

// Standalone MCP tool groups (Option B) — registered after configs
import './mcp/userTools.js';
