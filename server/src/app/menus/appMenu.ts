import { registerMenuItems } from '../../core/menus/menuRegistry.js';
import { initTimeRegV2Context } from '../configs/timeRegV2.js';
import { initMotorcyclesContext } from '../configs/motorcyclesConfig.js';
import { PERMISSIONS } from '../../core/services/access.js';

registerMenuItems([
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
]);
