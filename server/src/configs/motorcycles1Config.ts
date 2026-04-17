// Motorcycle ownership register (table motorcycles1)

import type { CRUDTableConfig } from '../crudtable/types.js';
import type { Session } from '../types/index.js';
import * as motorcycleService from '../services/motorcycleService.js';

export const motorcycles1Config: CRUDTableConfig = {
  id: 'motorcycles1',
  title: 'Motorcycles',
  requireAuth: true,
  requirePermission: 'motorcycles1:read',

  services: {
    list: {
      service: motorcycleService,
      method: 'listMotorcycles',
      params: (ctx) => ({ userId: ctx.input.userId as number }),
    },
    create: {
      service: motorcycleService,
      method: 'createMotorcycle',
      requirePermission: 'motorcycles1:write',
      params: (ctx) =>
        motorcycleService.buildMotorcyclePayload(ctx.input.userId as number, ctx.values),
    },
    update: {
      service: motorcycleService,
      method: 'updateMotorcycle',
      requirePermission: 'motorcycles1:write',
      params: (ctx) =>
        motorcycleService.buildMotorcyclePayload(
          ctx.input.userId as number,
          ctx.values,
          ctx.editRecord!.id as number,
        ),
    },
    delete: {
      service: motorcycleService,
      method: 'deleteMotorcycle',
      requirePermission: 'motorcycles1:write',
      params: (ctx) => ({
        userId: ctx.input.userId as number,
        id: ctx.selection[0].id as number,
      }),
    },
  },

  fieldConfigs: {
    brand: {
      field: 'brand',
      label: 'Brand',
      length: 14,
      form: { required: true },
      column: { width: 12 },
    },
    make: {
      field: 'make',
      label: 'Make',
      length: 16,
      form: { required: true, hint: '(model name)' },
      column: { width: 14 },
    },
    model_year: {
      field: 'model_year',
      label: 'Year',
      length: 4,
      type: 'numeric',
      form: { required: true, type: 'numeric' },
      column: { width: 4, align: 'right' },
    },
    purchase_date: {
      field: 'purchase_date',
      label: 'Purchased',
      length: 10,
      form: { type: 'date', hint: '(YYYY-MM-DD)' },
      column: { width: 10 },
    },
    sell_date: {
      field: 'sell_date',
      label: 'Sold',
      length: 10,
      form: {
        type: 'date',
        hint: '(YYYY-MM-DD)',
        validators: [
          (ctx) => {
            const p = (ctx.values.purchase_date || '').trim();
            const s = (ctx.values.sell_date || '').trim();
            if (p && s && s < p) return 'Sold date cannot be before purchase date';
            return null;
          },
        ],
      },
      column: { width: 10 },
    },
    cost: {
      field: 'cost',
      label: 'Cost',
      length: 12,
      type: 'numeric',
      form: { type: 'numeric', hint: '(optional)' },
      column: { width: 9, align: 'right' },
    },
    odometer_km: {
      field: 'odometer_km',
      label: 'Odo km',
      length: 7,
      type: 'numeric',
      form: { type: 'numeric', hint: '(when bought)' },
      column: { width: 7, align: 'right' },
    },
    displacement_cc: {
      field: 'displacement_cc',
      label: 'CC',
      length: 5,
      type: 'numeric',
      form: { type: 'numeric', hint: '(engine)' },
      column: { width: 5, align: 'right' },
    },
    seat_height_mm: {
      field: 'seat_height_mm',
      label: 'Seat mm',
      length: 5,
      type: 'numeric',
      form: { type: 'numeric', hint: '(factory spec)' },
      column: { width: 5, align: 'right' },
    },
    heated_grips: {
      field: 'heated_grips',
      label: 'Htd grp',
      length: 1,
      staticOptions: [
        { value: 'Y', display: 'Y' },
        { value: 'N', display: 'N' },
      ],
      form: { required: true },
      column: {
        width: 3,
        cellRenderer: (r) => (String(r.heated_grips) === 'Y' ? 'Y' : 'N'),
      },
    },
    longest_trip_km: {
      field: 'longest_trip_km',
      label: 'Best trip',
      length: 6,
      type: 'numeric',
      form: { type: 'numeric', hint: '(longest day km)' },
      column: { width: 6, align: 'right' },
    },
    notes: {
      field: 'notes',
      label: 'Notes',
      length: 40,
      form: { hint: '(tires, luggage, mods)' },
      column: { width: 25 },
    },
  },

  getInitialValues: () => ({
    heated_grips: 'N',
  }),

  columnBuilder: [
    'brand',
    'make',
    'model_year',
    'purchase_date',
    'cost',
    'heated_grips',
    'notes',
  ],
  formBuilder: [
    'brand',
    'make',
    'model_year',
    'purchase_date',
    'sell_date',
    'cost',
    'odometer_km',
    'displacement_cc',
    'seat_height_mm',
    'heated_grips',
    'longest_trip_km',
    'notes',
  ],
};

export function initMotorcycles1Context(session: Session): void {
  session.context.crud_motorcycles1_input = {
    userId: session.viserId!,
  };
}
