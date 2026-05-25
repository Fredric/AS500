// Services Performed CRUDTable Config
// Motorcycle service records — scoped to a specific motorcycle via motorcycleId in input

import type { CRUDTableConfig } from '../../core/crudtable/types.js';
import * as servicesPerformedService from '../services/servicesPerformedService.js';

function toStringOrNull(s: string | undefined): string | null {
  if (!s || s.trim() === '') return null;
  return s.trim();
}

function toIntOrNull(s: string | undefined): number | null {
  if (!s || s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export const servicesPerformedConfig: CRUDTableConfig = {
  id: 'services_performed',
  title: 'Services Performed',
  requireAuth: true,
  requirePermission: 'services_performed:read',

  services: {
    list: {
      service: servicesPerformedService as unknown as Record<string, Function>,
      method: 'listServicesPerformed',
      params: (ctx) => ({
        motorcycleId: ctx.input.motorcycleId as number,
        userId: ctx.input.userId as number | undefined,
      }),
    },
    read: {
      service: servicesPerformedService as unknown as Record<string, Function>,
      method: 'readServicePerformed',
      params: (ctx) => ({
        id: ctx.input.id as number,
        motorcycleId: ctx.input.motorcycleId as number,
      }),
    },
    create: {
      service: servicesPerformedService as unknown as Record<string, Function>,
      method: 'createServicePerformed',
      requirePermission: 'services_performed:write',
      params: (ctx) => ({
        motorcycleId: ctx.input.motorcycleId as number,
        userId: ctx.input.userId as number | undefined,
        service_type: ctx.values.service_type?.trim() || '',
        service_date: ctx.values.service_date?.trim() || '',
        odometer_km: toIntOrNull(ctx.values.odometer_km),
        cost: toStringOrNull(ctx.values.cost),
        shop: toStringOrNull(ctx.values.shop),
        notes: toStringOrNull(ctx.values.notes),
      }),
    },
    update: {
      service: servicesPerformedService as unknown as Record<string, Function>,
      method: 'updateServicePerformed',
      requirePermission: 'services_performed:write',
      params: (ctx) => ({
        id: ctx.editRecord!.id as number,
        motorcycleId: ctx.input.motorcycleId as number,
        userId: ctx.input.userId as number | undefined,
        service_type: ctx.values.service_type?.trim() || '',
        service_date: ctx.values.service_date?.trim() || '',
        odometer_km: toIntOrNull(ctx.values.odometer_km),
        cost: toStringOrNull(ctx.values.cost),
        shop: toStringOrNull(ctx.values.shop),
        notes: toStringOrNull(ctx.values.notes),
      }),
    },
    delete: {
      service: servicesPerformedService as unknown as Record<string, Function>,
      method: 'deleteServicePerformed',
      requirePermission: 'services_performed:write',
      params: (ctx) => ({
        id: ctx.selection[0].id as number,
        motorcycleId: ctx.input.motorcycleId as number,
        userId: ctx.input.userId as number | undefined,
      }),
    },
  },

  fieldConfigs: {
    service_type: {
      field: 'service_type',
      label: 'Service Type',
      length: 30,
      form: { required: true, hint: '(e.g. Oil Change, Tire Change, Chain)' },
      column: { width: 22 },
    },
    service_date: {
      field: 'service_date',
      label: 'Date',
      length: 10,
      type: 'date',
      form: { required: true, hint: '(YYYY-MM-DD)' },
      column: { width: 10 },
    },
    odometer_km: {
      field: 'odometer_km',
      label: 'Odometer km',
      length: 8,
      type: 'numeric',
      form: { hint: '(km at service)' },
      column: {
        width: 10,
        align: 'right',
        cellRenderer: (_ctx, r) => {
          const v = r.odometer_km;
          if (v === null || v === undefined || v === '') return '';
          return Number(v).toLocaleString('en-US');
        },
      },
    },
    cost: {
      field: 'cost',
      label: 'Cost',
      length: 12,
      form: { hint: '(total cost)' },
      column: { width: 10 },
    },
    shop: {
      field: 'shop',
      label: 'Shop',
      length: 30,
      form: { hint: '(workshop or DIY)' },
      column: { width: 16 },
    },
    notes: {
      field: 'notes',
      label: 'Notes',
      length: 50,
      form: { hint: '(what was done)' },
    },
  },

  columnBuilder: ['service_type', 'service_date', 'odometer_km', 'cost', 'shop'],
  formBuilder: ['service_type', 'service_date', 'odometer_km', 'cost', 'shop', 'notes'],

  listHeader: (ctx) => {
    const label = ctx.input.motorcycleLabel as string | undefined;
    return [
      { row: 5, col: 2, content: `Services: ${label ?? ''}` },
    ];
  },

  // ============================================
  // MCP (Model Context Protocol) exposure
  // ============================================
  //
  // Exposes five tools:
  //   services_performed.list   services_performed.read
  //   services_performed.create services_performed.update services_performed.delete
  //
  // `motorcycleId` is provided by the agent. `userId` is injected from the
  // OAuth token — the service verifies the motorcycle belongs to that user
  // before executing any operation.

  mcp: {
    name: 'services_performed',
    description:
      'Service and maintenance records for a specific motorcycle. Each record ' +
      'represents one service event with type, date, odometer reading, cost, ' +
      'shop, and notes. Pass the motorcycleId of a bike owned by the authenticated user.',
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
        description: 'ID of the motorcycle whose service history to list or modify.',
      },
    ],
  },

  // ============================================
  // REST API exposure
  // ============================================
  //
  // GET|POST /api/services_performed?motorcycleId=<id>
  // GET|PUT|DELETE /api/services_performed/:id?motorcycleId=<id>

  api: {
    name: 'services_performed',
    description: 'Service records for a motorcycle owned by the authenticated user.',
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

