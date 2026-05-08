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
      params: (ctx) => ({ motorcycleId: ctx.input.motorcycleId as number }),
    },
    create: {
      service: modsService as unknown as Record<string, Function>,
      method: 'createMod',
      requirePermission: 'mods:write',
      params: (ctx) => ({
        motorcycleId: ctx.input.motorcycleId as number,
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
};

