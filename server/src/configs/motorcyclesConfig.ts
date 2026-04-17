// Motorcycles CRUDTable Config
// User-owned motorcycle garage — each user sees only their own bikes

import type { CRUDTableConfig } from '../crudtable/types.js';
import type { Session } from '../types/index.js';
import * as motorcycleService from '../services/motorcycleService.js';

const currentYear = new Date().getFullYear();

// Helpers to coerce form string values into service params
function toIntOrNull(s: string | undefined): number | null {
  if (!s || s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : NaN as unknown as number;
}

function toStringOrNull(s: string | undefined): string | null {
  if (!s || s.trim() === '') return null;
  return s.trim();
}

function formatCost(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export const motorcyclesConfig: CRUDTableConfig = {
  id: 'motorcycles',
  title: 'My Motorcycles',
  requireAuth: true,
  requirePermission: 'motorcycles:read',

  services: {
    list: {
      service: motorcycleService as unknown as Record<string, Function>,
      method: 'listMotorcycles',
      params: (ctx) => ({ userId: ctx.input.userId as number }),
    },
    create: {
      service: motorcycleService as unknown as Record<string, Function>,
      method: 'createMotorcycle',
      requirePermission: 'motorcycles:write',
      params: (ctx) => ({
        userId: ctx.input.userId as number,
        brand: ctx.values.brand?.trim() || '',
        model: ctx.values.model?.trim() || '',
        year: Number(ctx.values.year),
        purchase_date: toStringOrNull(ctx.values.purchase_date),
        sell_date: toStringOrNull(ctx.values.sell_date),
        cost: toStringOrNull(ctx.values.cost),
        nickname: toStringOrNull(ctx.values.nickname),
        odometer_km: toIntOrNull(ctx.values.odometer_km),
        engine_cc: toIntOrNull(ctx.values.engine_cc),
        color: toStringOrNull(ctx.values.color),
        notes: toStringOrNull(ctx.values.notes),
      }),
    },
    update: {
      service: motorcycleService as unknown as Record<string, Function>,
      method: 'updateMotorcycle',
      requirePermission: 'motorcycles:write',
      params: (ctx) => ({
        id: ctx.editRecord!.id as number,
        userId: ctx.input.userId as number,
        brand: ctx.values.brand?.trim() || '',
        model: ctx.values.model?.trim() || '',
        year: Number(ctx.values.year),
        purchase_date: toStringOrNull(ctx.values.purchase_date),
        sell_date: toStringOrNull(ctx.values.sell_date),
        cost: toStringOrNull(ctx.values.cost),
        nickname: toStringOrNull(ctx.values.nickname),
        odometer_km: toIntOrNull(ctx.values.odometer_km),
        engine_cc: toIntOrNull(ctx.values.engine_cc),
        color: toStringOrNull(ctx.values.color),
        notes: toStringOrNull(ctx.values.notes),
      }),
    },
    delete: {
      service: motorcycleService as unknown as Record<string, Function>,
      method: 'deleteMotorcycle',
      requirePermission: 'motorcycles:write',
      params: (ctx) => ({
        id: ctx.selection[0].id as number,
        userId: ctx.input.userId as number,
      }),
    },
  },

  fieldConfigs: {
    brand: {
      field: 'brand',
      label: 'Brand',
      length: 20,
      form: { required: true, hint: '(e.g. Honda, KTM, BMW)' },
      column: { width: 12 },
    },
    model: {
      field: 'model',
      label: 'Model',
      length: 30,
      form: { required: true, hint: '(e.g. Africa Twin 1100)' },
      column: { width: 18 },
    },
    year: {
      field: 'year',
      label: 'Year',
      length: 4,
      type: 'numeric',
      form: {
        required: true,
        hint: '(YYYY)',
        validators: [
          (ctx) => {
            const n = Number(ctx.values.year);
            if (!Number.isInteger(n) || n < 1885 || n > currentYear + 1) {
              return `Year must be between 1885 and ${currentYear + 1}`;
            }
            return null;
          },
        ],
      },
      column: { width: 4, align: 'right' },
    },
    nickname: {
      field: 'nickname',
      label: 'Nickname',
      length: 20,
      form: { hint: '(give it a name)' },
      column: { width: 12 },
    },
    odometer_km: {
      field: 'odometer_km',
      label: 'Odometer km',
      length: 8,
      type: 'numeric',
      form: { hint: '(current km)' },
      column: {
        width: 8,
        align: 'right',
        cellRenderer: (r) => {
          const v = r.odometer_km;
          if (v === null || v === undefined || v === '') return '';
          return Number(v).toLocaleString('en-US');
        },
      },
    },
    engine_cc: {
      field: 'engine_cc',
      label: 'Engine cc',
      length: 6,
      type: 'numeric',
      form: { hint: '(displacement)' },
    },
    color: {
      field: 'color',
      label: 'Color',
      length: 15,
      form: { hint: '(e.g. Rally Red)' },
    },
    purchase_date: {
      field: 'purchase_date',
      label: 'Purchased',
      length: 10,
      type: 'date',
      form: { hint: '(YYYY-MM-DD)' },
    },
    sell_date: {
      field: 'sell_date',
      label: 'Sold on',
      length: 10,
      type: 'date',
      form: { hint: '(YYYY-MM-DD, blank = still own)' },
    },
    cost: {
      field: 'cost',
      label: 'Cost',
      length: 12,
      form: { hint: '(purchase price)' },
    },
    notes: {
      field: 'notes',
      label: 'Notes',
      length: 40,
      form: { hint: '(mods, memories, trips)' },
    },
    status: {
      field: 'status',
      label: 'Status',
      length: 6,
      column: { width: 6 },
    },
  },

  columnBuilder: ['brand', 'model', 'year', 'nickname', 'odometer_km', 'status'],
  formBuilder: [
    'brand',
    'model',
    'year',
    'nickname',
    'color',
    'engine_cc',
    'odometer_km',
    'purchase_date',
    'sell_date',
    'cost',
    'notes',
  ],

  getInitialValues: () => ({
    year: String(currentYear),
  }),

  // Garage summary header: bike counts + total spent
  listHeader: (ctx) => {
    const records = ctx.records;
    const owned = records.filter((r) => !r.sell_date || r.sell_date === '').length;
    const sold = records.length - owned;
    const total = records.reduce((sum, r) => {
      const n = Number(r.cost);
      return Number.isFinite(n) ? sum + n : sum;
    }, 0);

    return [
      { row: 5, col: 2, content: `Garage: ${records.length} bikes  (${owned} owned, ${sold} sold)` },
      { row: 5, col: 50, content: `Total spent: ${formatCost(total)}` },
    ];
  },
};

/**
 * Initialize CRUDContext for motorcycles.
 * Call when navigating to CRUD_MOTORCYCLES from main menu.
 */
export function initMotorcyclesContext(session: Session): void {
  session.context.crud_motorcycles_input = {
    userId: session.viserId,
  };
}
