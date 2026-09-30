// Folder Covers CRUDTable Config
//
// Read-only visibility into which folders have a generated box-art cover
// (see folderCoverScheduler.ts / folderCoverService.ts), plus a "Regenerate
// now" action for forcing a rebuild without waiting for the scheduler or for
// the folder's contents to change. No create/update/delete — these rows
// reflect Thing folders, not records of their own.

import type { CRUDTableConfig } from '../../core/crudtable/types.js';
import * as scheduler from '../things/folderCoverScheduler.js';

export const folderCoversConfig: CRUDTableConfig = {
  id: 'folder_covers',
  title: 'Folder Covers',
  requireAuth: true,
  requirePermission: 'things:read',

  services: {
    list: {
      service: scheduler as unknown as Record<string, Function>,
      method: 'listFolderCovers',
      params: () => ({}),
    },
    read: {
      service: scheduler as unknown as Record<string, Function>,
      method: 'readFolderCover',
      params: (ctx) => ctx.editRecord?.id ?? ctx.input.id,
    },
  },

  fieldConfigs: {
    name: {
      field: 'name',
      label: 'Folder',
      length: 24,
      column: { width: 22 },
    },
    itemCount: {
      field: 'itemCount',
      label: 'Items',
      length: 8,
      column: { width: 8 },
    },
    hasCover: {
      field: 'hasCover',
      label: 'Cover',
      length: 8,
      column: {
        width: 8,
        cellRenderer: (_ctx, r) => (r.hasCover ? 'yes' : 'no'),
      },
    },
    updatedAt: {
      field: 'updatedAt',
      label: 'Updated',
      length: 20,
      column: { width: 18 },
    },
  },

  columnBuilder: ['name', 'itemCount', 'hasCover', 'updatedAt'],
  formBuilder: ['name', 'itemCount', 'hasCover'],

  actions: {
    regenerateNow: {
      label: 'Regenerate now',
      scope: 'record',
      service: scheduler as unknown as Record<string, Function>,
      method: 'runFolderCoverNow',
      params: (ctx) => ({
        folderId: ctx.selection[0]?.id as number,
      }),
      confirm: {
        message: (ctx) =>
          `Regenerate the cover for "${String(ctx.selection[0]?.name ?? '')}" now?`,
      },
    },
  },

  listStatusHints: ['5=Regenerate now'],
};
