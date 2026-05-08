import type { CRUDTableConfig } from '../crudtable/types.js';
import { PERMISSIONS } from '../services/access.js';
import {
  VALID_ROLES,
  isValidPermissionKey,
  roleDefaultsCrudService,
} from '../services/roleDefaultsService.js';

const VALID_ROLES_UPPER = VALID_ROLES.map((role) => role.toUpperCase());

export const roleDefaultsConfig: CRUDTableConfig = {
  id: 'role_defaults',
  title: 'Role Default Permissions',
  requireAuth: true,
  requirePermission: PERMISSIONS.SYS_ADMIN,

  services: {
    list: {
      service: roleDefaultsCrudService,
      method: 'listRoleDefaults',
    },
    create: {
      service: roleDefaultsCrudService,
      method: 'createRoleDefault',
      requirePermission: PERMISSIONS.SYS_ADMIN,
      params: (ctx) => ({
        role: ctx.values.role,
        permissionKey: ctx.values.permission_key,
      }),
    },
    update: {
      service: roleDefaultsCrudService,
      method: 'updateRoleDefault',
      requirePermission: PERMISSIONS.SYS_ADMIN,
      params: (ctx) => ({
        originalRole: ctx.editRecord!.original_role as string,
        originalPermissionKey: ctx.editRecord!.original_permission_key as string,
        role: ctx.values.role,
        permissionKey: ctx.values.permission_key,
      }),
    },
    delete: {
      service: roleDefaultsCrudService,
      method: 'deleteRoleDefault',
      requirePermission: PERMISSIONS.SYS_ADMIN,
      params: (ctx) => ({
        role: ctx.selection[0].role as string,
        permissionKey: ctx.selection[0].permission_key as string,
      }),
    },
  },

  fieldConfigs: {
    role: {
      field: 'role',
      label: 'Role',
      length: 10,
      form: {
        required: true,
        uppercase: true,
        hint: '(USER/SUPERUSER/AIAGENT/ADMIN)',
        formValue: (value) => String(value ?? '').toUpperCase(),
        validators: [
          (ctx) => {
            const role = ctx.values.role;
            if (!VALID_ROLES_UPPER.includes(role)) {
              return 'Role must be USER, SUPERUSER, AIAGENT, or ADMIN';
            }
            return null;
          },
        ],
      },
      column: {
        width: 10,
        cellRenderer: (record) => String(record.role ?? '').toUpperCase(),
      },
    },

    permission_key: {
      field: 'permission_key',
      label: 'Permission',
      length: 20,
      form: {
        required: true,
        hint: '(example: time_reg:read)',
        validators: [
          (ctx) => {
            if (!isValidPermissionKey(ctx.values.permission_key || '')) {
              return 'Permission key must be a seeded permission';
            }
            return null;
          },
        ],
      },
      column: {
        width: 18,
      },
    },

    permission_description: {
      field: 'permission_description',
      label: 'Description',
      length: 34,
      column: {
        width: 34,
      },
    },
  },

  columnBuilder: ['role', 'permission_key', 'permission_description'],
  formBuilder: ['role', 'permission_key'],

  getInitialValues: () => ({
    role: 'USER',
  }),

  listHeader: () => ([
    { row: 5, col: 2, content: 'Manage seeded default permissions for each role.' },
  ]),
};
