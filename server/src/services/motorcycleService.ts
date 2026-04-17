// Motorcycle service — CRUD for user-owned motorcycles

import { and, eq, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { motorcycles } from '../db/schema.js';

export interface ListParams {
  userId: number;
}

export interface CreateParams {
  userId: number;
  brand: string;
  model: string;
  year: number;
  purchase_date: string | null;
  sell_date: string | null;
  cost: string | null;
  nickname: string | null;
  odometer_km: number | null;
  engine_cc: number | null;
  color: string | null;
  notes: string | null;
}

export interface UpdateParams extends CreateParams {
  id: number;
}

export async function listMotorcycles(params: ListParams): Promise<Record<string, unknown>[]> {
  const rows = await db
    .select()
    .from(motorcycles)
    .where(eq(motorcycles.user_id, params.userId))
    .orderBy(asc(motorcycles.sell_date), asc(motorcycles.brand), asc(motorcycles.model));

  return rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    brand: r.brand,
    model: r.model,
    year: r.year,
    purchase_date: r.purchase_date ?? '',
    sell_date: r.sell_date ?? '',
    cost: r.cost ?? '',
    nickname: r.nickname ?? '',
    odometer_km: r.odometer_km ?? '',
    engine_cc: r.engine_cc ?? '',
    color: r.color ?? '',
    notes: r.notes ?? '',
    // Derived: owned = no sell date
    status: r.sell_date ? 'Sold' : 'Owned',
  }));
}

export async function createMotorcycle(params: CreateParams): Promise<Record<string, unknown>> {
  validate(params);
  const [row] = await db
    .insert(motorcycles)
    .values({
      user_id: params.userId,
      brand: params.brand,
      model: params.model,
      year: params.year,
      purchase_date: params.purchase_date,
      sell_date: params.sell_date,
      cost: params.cost,
      nickname: params.nickname,
      odometer_km: params.odometer_km,
      engine_cc: params.engine_cc,
      color: params.color,
      notes: params.notes,
    })
    .returning();
  return row;
}

export async function updateMotorcycle(params: UpdateParams): Promise<Record<string, unknown>> {
  validate(params);
  const [row] = await db
    .update(motorcycles)
    .set({
      brand: params.brand,
      model: params.model,
      year: params.year,
      purchase_date: params.purchase_date,
      sell_date: params.sell_date,
      cost: params.cost,
      nickname: params.nickname,
      odometer_km: params.odometer_km,
      engine_cc: params.engine_cc,
      color: params.color,
      notes: params.notes,
    })
    .where(and(eq(motorcycles.id, params.id), eq(motorcycles.user_id, params.userId)))
    .returning();

  if (!row) {
    throw new Error('Motorcycle not found or not owned by you');
  }
  return row;
}

export async function deleteMotorcycle(params: { id: number; userId: number }): Promise<void> {
  const result = await db
    .delete(motorcycles)
    .where(and(eq(motorcycles.id, params.id), eq(motorcycles.user_id, params.userId)))
    .returning({ id: motorcycles.id });

  if (result.length === 0) {
    throw new Error('Motorcycle not found or not owned by you');
  }
}

// ============================================
// Helpers
// ============================================

function validate(p: CreateParams): void {
  if (!p.brand || p.brand.trim().length === 0) {
    throw new Error('Brand is required');
  }
  if (!p.model || p.model.trim().length === 0) {
    throw new Error('Model is required');
  }
  const currentYear = new Date().getFullYear();
  if (!Number.isInteger(p.year) || p.year < 1885 || p.year > currentYear + 1) {
    throw new Error(`Year must be between 1885 and ${currentYear + 1}`);
  }
  if (p.purchase_date && !isValidDate(p.purchase_date)) {
    throw new Error('Purchase date must be YYYY-MM-DD');
  }
  if (p.sell_date && !isValidDate(p.sell_date)) {
    throw new Error('Sell date must be YYYY-MM-DD');
  }
  if (p.purchase_date && p.sell_date && p.sell_date < p.purchase_date) {
    throw new Error('Sell date cannot be before purchase date');
  }
  if (p.odometer_km !== null && (!Number.isInteger(p.odometer_km) || p.odometer_km < 0)) {
    throw new Error('Odometer must be a non-negative whole number');
  }
  if (p.engine_cc !== null && (!Number.isInteger(p.engine_cc) || p.engine_cc <= 0)) {
    throw new Error('Engine displacement must be a positive whole number');
  }
  if (p.cost !== null && !/^\d+(\.\d{1,2})?$/.test(p.cost)) {
    throw new Error('Cost must be a number with up to 2 decimals');
  }
}

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
