// Mods CRUDTable Config
// Motorcycle modifications — scoped to a specific motorcycle via motorcycleId in input

import type { CRUDTableConfig } from '../../core/crudtable/types.js';
import * as modsService from '../services/modsService.js';

function toStringOrNull(s: string | undefined): string | null {
  if (!s || s.trim() === '') return null;
  return s.trim();
}

export const modsConfig: CRUDTableConfig = {
  id: 'mods',
  title: 'Motorcycle Mods',
  requireAuth: true,
  requirePermission: 'mods:read',

  services: {
    list: {
      service: modsService as unknown as Record<string, Function>,
      method: 'listMods',
      params: (ctx) => ({
        motorcycleId: ctx.input.motorcycleId as number,
        userId: ctx.input.userId as number | undefined,
      }),
    },
    read: {
      service: modsService as unknown as Record<string, Function>,
      method: 'readMod',
      params: (ctx) => ({
        id: ctx.input.id as number,
        motorcycleId: ctx.input.motorcycleId as number,
      }),
    },
    create: {
      service: modsService as unknown as Record<string, Function>,
      method: 'createMod',
      requirePermission: 'mods:write',
      params: (ctx) => ({
        motorcycleId: ctx.input.motorcycleId as number,
        userId: ctx.input.userId as number | undefined,
        name: ctx.values.name?.trim() || '',
        category: toStringOrNull(ctx.values.category),
        cost: toStringOrNull(ctx.values.cost),
        installed_date: toStringOrNull(ctx.values.installed_date),
        notes: toStringOrNull(ctx.values.notes),
      }),
    },
    update: {
      service: modsService as unknown as Record<string, Function>,
      method: 'updateMod',
      requirePermission: 'mods:write',
      params: (ctx) => ({
        id: ctx.editRecord!.id as number,
        motorcycleId: ctx.input.motorcycleId as number,
        userId: ctx.input.userId as number | undefined,
        name: ctx.values.name?.trim() || '',
        category: toStringOrNull(ctx.values.category),
        cost: toStringOrNull(ctx.values.cost),
        installed_date: toStringOrNull(ctx.values.installed_date),
        notes: toStringOrNull(ctx.values.notes),
      }),
    },
    delete: {
      service: modsService as unknown as Record<string, Function>,
      method: 'deleteMod',
      requirePermission: 'mods:write',
      params: (ctx) => ({
        id: ctx.selection[0].id as number,
        motorcycleId: ctx.input.motorcycleId as number,
        userId: ctx.input.userId as number | undefined,
      }),
    },
  },

  fieldConfigs: {
    name: {
      field: 'name',
      label: 'Name',
      length: 30,
      form: { required: true, hint: '(e.g. Exhaust, Suspension, Lighting)' },
      column: { width: 25 },
    },
    category: {
      field: 'category',
      label: 'Category',
      length: 20,
      form: { hint: '(e.g. Performance, Cosmetic, Safety)' },
      column: { width: 16 },
    },
    cost: {
      field: 'cost',
      label: 'Cost',
      length: 12,
      form: { hint: '(purchase price)' },
      column: { width: 10 },
    },
    installed_date: {
      field: 'installed_date',
      label: 'Installed',
      length: 10,
      type: 'date',
      form: { hint: '(YYYY-MM-DD)' },
      column: { width: 10 },
    },
    notes: {
      field: 'notes',
      label: 'Notes',
      length: 50,
      form: { hint: '(details about the mod)' },
    },
  },

  columnBuilder: ['name', 'category', 'cost', 'installed_date'],
  formBuilder: ['name', 'category', 'cost', 'installed_date', 'notes'],

  listHeader: (ctx) => {
    const label = ctx.input.motorcycleLabel as string | undefined;
    return [
      { row: 5, col: 2, content: `Mods: ${label ?? ''}` },
    ];
  },

  // ============================================
  // MCP (Model Context Protocol) exposure
  // ============================================
  //
  // Exposes five tools:
  //   mods.list   mods.read
  //   mods.create mods.update mods.delete
  //
  // `motorcycleId` is provided by the agent. `userId` is injected from the
  // OAuth token — the service verifies the motorcycle belongs to that user
  // before executing any operation.

  mcp: {
    name: 'mods',
    description:
      'Modifications installed on a specific motorcycle. Each record represents ' +
      'one mod with name, category, cost, installation date, and notes. ' +
      'Pass the motorcycleId of a bike owned by the authenticated user.',
    operations: {
      list: true,
      read: true,
      create: true,
      update: true,
      delete: true,
    },
    scope: [
      {
        name: 'userId',
        type: 'number' as const,
        required: true,
        description:
          'Automatically injected from the OAuth token — not a tool input. ' +
          'Used to verify the motorcycle belongs to the authenticated user.',
        injectFromAuth: 'userId' as const,
      },
      {
        name: 'motorcycleId',
        type: 'number' as const,
        required: true,
        description: 'ID of the motorcycle whose mods to list or modify.',
      },
    ],
  },

  // ============================================
  // REST API exposure
  // ============================================
  //
  // GET|POST /api/mods?motorcycleId=<id>
  // GET|PUT|DELETE /api/mods/:id?motorcycleId=<id>

  api: {
    name: 'mods',
    description: 'Modifications for a motorcycle owned by the authenticated user.',
    operations: {
      list: true,
      read: true,
      create: true,
      update: true,
      delete: true,
    },
    scope: [
      {
        name: 'userId',
        type: 'number' as const,
        required: true,
        description: 'Injected from the Bearer token — never a request param.',
        injectFromAuth: 'userId' as const,
      },
      {
        name: 'motorcycleId',
        type: 'number' as const,
        required: true,
        description: 'ID of the motorcycle. Pass as a query param.',
      },
    ],
  },
};

