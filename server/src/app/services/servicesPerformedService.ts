// Services Performed service — CRUD for motorcycle service records

import { and, eq, desc } from 'drizzle-orm';
import { db } from '../../core/db/index.js';
import { servicesPerformed, motorcycles } from '../db/schema.js';

export interface ListParams {
  motorcycleId: number;
  /** When provided (MCP/API path) the motorcycle's ownership is verified. */
  userId?: number;
}

export interface CreateParams {
  motorcycleId: number;
  /** When provided (MCP/API path) the motorcycle's ownership is verified. */
  userId?: number;
  service_type: string;
  service_date: string;
  odometer_km: number | null;
  cost: string | null;
  shop: string | null;
  notes: string | null;
}

export interface UpdateParams extends CreateParams {
  id: number;
}

async function verifyOwnership(motorcycleId: number, userId: number): Promise<void> {
  const [row] = await db
    .select({ id: motorcycles.id })
    .from(motorcycles)
    .where(and(eq(motorcycles.id, motorcycleId), eq(motorcycles.user_id, userId)));
  if (!row) throw new Error('Motorcycle not found or not owned by you');
}

export async function readServicePerformed(params: { id: number; motorcycleId: number }): Promise<Record<string, unknown> | null> {
  const [r] = await db
    .select()
    .from(servicesPerformed)
    .where(and(eq(servicesPerformed.id, params.id), eq(servicesPerformed.motorcycle_id, params.motorcycleId)));
  if (!r) return null;
  return {
    id: r.id,
    motorcycle_id: r.motorcycle_id,
    service_type: r.service_type,
    service_date: r.service_date,
    odometer_km: r.odometer_km ?? '',
    cost: r.cost ?? '',
    shop: r.shop ?? '',
    notes: r.notes ?? '',
  };
}

export async function listServicesPerformed(params: ListParams): Promise<Record<string, unknown>[]> {
  if (params.userId !== undefined) await verifyOwnership(params.motorcycleId, params.userId);

  const rows = await db
    .select()
    .from(servicesPerformed)
    .where(eq(servicesPerformed.motorcycle_id, params.motorcycleId))
    .orderBy(desc(servicesPerformed.service_date));

  return rows.map((r) => ({
    id: r.id,
    motorcycle_id: r.motorcycle_id,
    service_type: r.service_type,
    service_date: r.service_date,
    odometer_km: r.odometer_km ?? '',
    cost: r.cost ?? '',
    shop: r.shop ?? '',
    notes: r.notes ?? '',
  }));
}

export async function createServicePerformed(params: CreateParams): Promise<Record<string, unknown>> {
  if (params.userId !== undefined) await verifyOwnership(params.motorcycleId, params.userId);
  validate(params);
  const [row] = await db
    .insert(servicesPerformed)
    .values({
      motorcycle_id: params.motorcycleId,
      service_type: params.service_type,
      service_date: params.service_date,
      odometer_km: params.odometer_km,
      cost: params.cost,
      shop: params.shop,
      notes: params.notes,
    })
    .returning();
  return row;
}

export async function updateServicePerformed(params: UpdateParams): Promise<Record<string, unknown>> {
  if (params.userId !== undefined) await verifyOwnership(params.motorcycleId, params.userId);
  validate(params);
  const [row] = await db
    .update(servicesPerformed)
    .set({
      service_type: params.service_type,
      service_date: params.service_date,
      odometer_km: params.odometer_km,
      cost: params.cost,
      shop: params.shop,
      notes: params.notes,
    })
    .where(and(eq(servicesPerformed.id, params.id), eq(servicesPerformed.motorcycle_id, params.motorcycleId)))
    .returning();
  if (!row) throw new Error('Service record not found');
  return row;
}

export async function deleteServicePerformed(params: { id: number; motorcycleId: number; userId?: number }): Promise<void> {
  if (params.userId !== undefined) await verifyOwnership(params.motorcycleId, params.userId);
  const result = await db
    .delete(servicesPerformed)
    .where(and(eq(servicesPerformed.id, params.id), eq(servicesPerformed.motorcycle_id, params.motorcycleId)))
    .returning({ id: servicesPerformed.id });
  if (result.length === 0) throw new Error('Service record not found');
}

function validate(p: CreateParams): void {
  if (!p.service_type || p.service_type.trim().length === 0) throw new Error('Service type is required');
  if (!p.service_date || !isValidDate(p.service_date)) throw new Error('Service date must be YYYY-MM-DD');
  if (p.cost !== null && p.cost !== '' && !/^\d+(\.\d{1,2})?$/.test(p.cost)) {
    throw new Error('Cost must be a number with up to 2 decimals');
  }
  if (p.odometer_km !== null && (!Number.isInteger(p.odometer_km) || p.odometer_km < 0)) {
    throw new Error('Odometer must be a non-negative whole number');
  }
}

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
