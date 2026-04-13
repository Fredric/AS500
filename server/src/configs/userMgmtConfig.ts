// User Management CRUDTable Config
import type { CRUDTableConfig } from '../crudtable/types.js';
import type { Session } from '../types/index.js';
import * as userService from '../services/userService.js';

export const userMgmtConfig: CRUDTableConfig = {
  id: 'user_mgmt',
  title: 'User Management',
  requireAuth: true,
  requireAdmin: true,
  requirePermission: 'user_mgmt:read',

  services: {
    list: {
      service: userService as unknown as Record<string, Function>,
      method: 'listUsers',
    },
    create: {
      service: userService as unknown as Record<string, Function>,
      method: 'createUser',
      requirePermission: 'user_mgmt:admin',
      params: (ctx) => ({
        username: ctx.values.username,
        password: ctx.values.password,
        fullName: ctx.values.full_name || null,
        active: ctx.values.active === 'Y',
        isAdmin: ctx.values.is_admin === 'Y',
      }),
    },
    update: {
      service: userService as unknown as Record<string, Function>,
      method: 'updateUser',
      requirePermission: 'user_mgmt:admin',
      params: (ctx) => ({
        id: (ctx.editRecord!.id as number),
        fullName: ctx.values.full_name || null,
        active: ctx.values.active === 'Y',
        isAdmin: ctx.values.is_admin === 'Y',
        password: ctx.values.password || null,
      }),
    },
    delete: {
      service: userService as unknown as Record<string, Function>,
      method: 'deleteUser',
      requirePermission: 'user_mgmt:admin',
      params: (ctx) => (ctx.selection[0].id as number),
    },
  },

  fieldConfigs: {
    username: {
      field: 'username',
      label: 'Username',
      length: 20,
      form: {
        required: (ctx) => ctx.formMode === 'create',
        disabled: (ctx) => ctx.formMode === 'edit',
        uppercase: true,
        hint: '(3-20 alphanumeric)',
      },
      column: { width: 12 },
    },

    full_name: {
      field: 'full_name',
      label: 'Full Name',
      length: 30,
      column: { width: 20 },
    },

    password: {
      field: 'password',
      label: 'Password',
      length: 20,
      form: {
        type: 'password',
        required: (ctx) => ctx.formMode === 'create',
        hint: '(blank=keep existing)',
        validators: [
          (ctx) => {
            const pw = ctx.values.password;
            const confirm = ctx.values.confirm;
            if (pw && pw !== confirm) return 'Passwords do not match';
            return null;
          },
        ],
      },
    },

    confirm: {
      field: 'confirm',
      label: 'Confirm password',
      length: 20,
      form: {
        type: 'password',
        required: (ctx) => ctx.formMode === 'create',
      },
    },

    active: {
      field: 'active',
      label: 'Active (Y/N)',
      length: 1,
      form: {
        required: true,
        uppercase: true,
        formValue: (v) => v === true ? 'Y' : v === false ? 'N' : String(v ?? ''),
        validators: [
          (ctx) => {
            const v = ctx.values.active;
            if (v && v !== 'Y' && v !== 'N') return 'Active must be Y or N';
            return null;
          },
        ],
      },
      column: {
        width: 6,
        cellRenderer: (record) => (record.active as boolean) ? 'Yes' : 'No',
      },
    },

    is_admin: {
      field: 'is_admin',
      label: 'Admin (Y/N)',
      length: 1,
      form: {
        required: true,
        uppercase: true,
        formValue: (v) => v === true ? 'Y' : v === false ? 'N' : String(v ?? ''),
        validators: [
          (ctx) => {
            const v = ctx.values.is_admin;
            if (v && v !== 'Y' && v !== 'N') return 'Admin must be Y or N';
            return null;
          },
          (ctx) => {
            if (
              ctx.formMode === 'edit' &&
              (ctx.editRecord?.id as number) === (ctx.input.currentUserId as number) &&
              ctx.values.is_admin === 'N'
            ) {
              return 'Cannot remove your own admin status';
            }
            return null;
          },
        ],
      },
      column: {
        width: 5,
        cellRenderer: (record) => (record.is_admin as boolean) ? 'Yes' : 'No',
      },
    },
  },

  columnBuilder: ['username', 'full_name', 'active', 'is_admin'],
  formBuilder: ['username', 'full_name', 'password', 'confirm', 'active', 'is_admin'],

  getInitialValues: () => ({
    active: 'Y',
    is_admin: 'N',
  }),
};

/**
 * Initialize CRUDContext for user management.
 * Call when navigating to CRUD_USER_MGMT from main menu.
 */
export function initUserMgmtContext(session: Session): void {
  session.context.crud_user_mgmt_input = {
    currentUserId: session.viserId,
  };
}
