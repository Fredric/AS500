/**
 * World bootstrap — registers the Office Layout screens and the menu entry.
 *
 * Self-registering, exactly like `app/index.ts`: nothing in `core/menus/` or
 * `app/` names the world. Guarded by WORLD_ENABLED so the whole feature can be
 * switched off without the menu entry appearing.
 */

import { registerConfig } from '../core/crudtable/registry.js';
import { registerMenuItems } from '../core/menus/menuRegistry.js';
import { PERMISSIONS } from '../core/services/access.js';
import { WORLD_ENABLED } from './config.js';
import { initSpacesContext, spacesConfig } from './configs/spacesConfig.js';
import { thingsConfig } from './configs/thingsConfig.js';
import { notesConfig } from './configs/notesConfig.js';

export function bootstrapWorld(): void {
  if (!WORLD_ENABLED) return;

  registerConfig(spacesConfig);
  registerConfig(thingsConfig);
  registerConfig(notesConfig);

  // Objects are reached by pressing T on a space, never directly: the objects
  // list is meaningless until a space scopes it, so it gets no menu entry of
  // its own.
  registerMenuItems([
    {
      type: 'menu',
      key: 'office',
      name: 'Virtual Office',
      requirePermission: PERMISSIONS.WORLD_READ,
      items: [
        {
          type: 'crudtable',
          key: 'world_spaces',
          name: 'Spaces',
          requirePermission: PERMISSIONS.WORLD_READ,
          configId: 'world_spaces',
          initContext: initSpacesContext,
        },
      ],
    },
  ]);
}
