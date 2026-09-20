/**
 * Office Layout — spaces.
 *
 * An ordinary CRUDTableConfig, deliberately: the office is furnished from the
 * green screen using the same runtime as every other list in AS500. Pressing
 * `T` on a space's edit form descends into its objects (`RelationConfig`),
 * which is the furniture tree with no new runtime code.
 */

import type { CRUDTableConfig } from '../../core/crudtable/types.js';
import type { Session } from '../../core/types/index.js';
import { PERMISSIONS } from '../../core/services/access.js';
import * as worldService from '../services/worldService.js';

const svc = worldService as unknown as Record<string, Function>;

export const spacesConfig: CRUDTableConfig = {
  id: 'world_spaces',
  title: 'Office Layout - Spaces',
  requireAuth: true,
  requirePermission: PERMISSIONS.WORLD_READ,

  services: {
    list: { service: svc, method: 'listSpaces' },
    read: {
      service: svc,
      method: 'readSpace',
      params: (ctx) => ({ id: Number(ctx.editRecord?.id ?? ctx.input.id) }),
    },
    create: {
      service: svc,
      method: 'createSpace',
      requirePermission: PERMISSIONS.WORLD_WRITE,
      params: (ctx) => ({
        userId: ctx.input.userId as number,
        key: ctx.values.key ?? '',
        name: ctx.values.name ?? '',
        kind: ctx.values.kind ?? 'office',
      }),
    },
    update: {
      service: svc,
      method: 'updateSpace',
      requirePermission: PERMISSIONS.WORLD_WRITE,
      params: (ctx) => ({
        id: ctx.editRecord!.id as number,
        userId: ctx.input.userId as number,
        key: ctx.values.key ?? '',
        name: ctx.values.name ?? '',
        kind: ctx.values.kind ?? 'office',
      }),
    },
    delete: {
      service: svc,
      method: 'deleteSpace',
      requirePermission: PERMISSIONS.WORLD_WRITE,
      params: (ctx) => ({ id: ctx.selection[0].id as number }),
    },
  },

  fieldConfigs: {
    key: {
      field: 'key',
      label: 'Key',
      length: 24,
      form: { required: true, uppercase: false, hint: '(url-safe; addresses /world/api/space/:key)' },
      column: { width: 18 },
    },
    name: {
      field: 'name',
      label: 'Name',
      length: 40,
      form: { required: true, hint: '(e.g. Main Office)' },
      column: { width: 28 },
    },
    kind: {
      field: 'kind',
      label: 'Kind',
      length: 16,
      staticOptions: [
        { value: 'office', display: 'Office' },
        { value: 'server_room', display: 'Server room' },
        { value: 'archive', display: 'Archive' },
      ],
      form: { hint: '(office / server_room / archive)' },
      column: { width: 12 },
    },
    thingCount: {
      field: 'thingCount',
      label: 'Objects',
      length: 7,
      column: { width: 7, align: 'right' },
    },
  },

  columnBuilder: ['key', 'name', 'kind', 'thingCount'],
  formBuilder: ['key', 'name', 'kind'],

  getInitialValues: () => ({ kind: 'office' }),

  relations: [
    {
      label: 'Objects',
      actionKey: 'T',
      targetConfigId: 'world_things',
      // A relation's mapInput REPLACES the child's `ctx.input`, so every key the
      // child needs must be named here — userId included. Without it the child's
      // bound configs resolve for user `undefined`.
      mapInput: (ctx) => ({
        userId: ctx.input.userId,
        spaceId: ctx.editRecord!.id,
        spaceLabel: String(ctx.editRecord!.name ?? ''),
        parentThingId: null,
        parentLabel: '',
      }),
    },
  ],

  listHeader: (ctx) => [
    { row: 5, col: 2, content: `${ctx.records.length} space(s)   T=Objects on a space` },
  ],

  mcp: {
    name: 'world_spaces',
    description:
      'Rooms in the AS500 virtual office. Each space is a container for placed ' +
      'objects (desks, cabinets, drawers, racks). The `key` addresses the space ' +
      'in the world API. Use world_things to place objects inside a space.',
    operations: { list: true, read: true, create: true, update: true, delete: true },
    scope: [
      {
        name: 'userId',
        type: 'number' as const,
        required: true,
        description: 'Injected from the OAuth token — not a tool input.',
        injectFromAuth: 'userId' as const,
      },
    ],
  },

  api: {
    name: 'world_spaces',
    description: 'Rooms in the AS500 virtual office.',
    operations: { list: true, read: true, create: true, update: true, delete: true },
    scope: [
      {
        name: 'userId',
        type: 'number' as const,
        required: true,
        description: 'Injected from the Bearer token — never a request param.',
        injectFromAuth: 'userId' as const,
      },
    ],
  },
};

export function initSpacesContext(session: Session): void {
  session.context.crud_world_spaces_input = { userId: session.viserId };
  session.context.crud_world_spaces_pageOffset = 0;
}
