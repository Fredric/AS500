// CRUD for motorcycles1 — one row per bike, scoped by user_id

import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { motorcycles1 } from '../db/schema.js';

export interface ListMotorcyclesParams {
  userId: number;
}

function parseOptionalInt(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number.parseInt(t, 10);
  if (!Number.isFinite(n)) throw new Error('Use whole numbers for km / cc / mm fields');
  return n;
}

function parseOptionalMoney(raw: string): string | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number.parseFloat(t.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new Error('Invalid cost');
  return n.toFixed(2);
}

export async function listMotorcycles(params: ListMotorcyclesParams): Promise<Record<string, unknown>[]> {
  const rows = await db
    .select()
    .from(motorcycles1)
    .where(eq(motorcycles1.user_id, params.userId))
    .orderBy(desc(motorcycles1.id));

  return rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    brand: r.brand,
    make: r.make,
    model_year: r.model_year,
    purchase_date: r.purchase_date ?? '',
    sell_date: r.sell_date ?? '',
    cost: r.cost != null ? String(r.cost) : '',
    odometer_km: r.odometer_km ?? '',
    displacement_cc: r.displacement_cc ?? '',
    seat_height_mm: r.seat_height_mm ?? '',
    heated_grips: r.heated_grips ? 'Y' : 'N',
    longest_trip_km: r.longest_trip_km ?? '',
    notes: r.notes ?? '',
  }));
}

export interface MotorcycleWriteBase {
  userId: number;
  brand: string;
  make: string;
  model_year: number;
  purchase_date: string | null;
  sell_date: string | null;
  cost: string | null;
  odometer_km: number | null;
  displacement_cc: number | null;
  seat_height_mm: number | null;
  heated_grips: boolean;
  longest_trip_km: number | null;
  notes: string | null;
}

export type CreateMotorcycleParams = MotorcycleWriteBase;

export interface UpdateMotorcycleParams extends MotorcycleWriteBase {
  id: number;
}

async function assertOwns(userId: number, id: number): Promise<void> {
  const [row] = await db
    .select({ id: motorcycles1.id })
    .from(motorcycles1)
    .where(and(eq(motorcycles1.id, id), eq(motorcycles1.user_id, userId)));
  if (!row) throw new Error('Motorcycle not found or access denied');
}

export async function createMotorcycle(params: CreateMotorcycleParams): Promise<unknown> {
  const [inserted] = await db
    .insert(motorcycles1)
    .values({
      user_id: params.userId,
      brand: params.brand.trim(),
      make: params.make.trim(),
      model_year: params.model_year,
      purchase_date: params.purchase_date || null,
      sell_date: params.sell_date || null,
      cost: params.cost,
      odometer_km: params.odometer_km,
      displacement_cc: params.displacement_cc,
      seat_height_mm: params.seat_height_mm,
      heated_grips: params.heated_grips,
      longest_trip_km: params.longest_trip_km,
      notes: params.notes?.trim() || null,
    })
    .returning();
  return inserted;
}

export async function updateMotorcycle(params: UpdateMotorcycleParams): Promise<unknown> {
  await assertOwns(params.userId, params.id);
  const [updated] = await db
    .update(motorcycles1)
    .set({
      brand: params.brand.trim(),
      make: params.make.trim(),
      model_year: params.model_year,
      purchase_date: params.purchase_date || null,
      sell_date: params.sell_date || null,
      cost: params.cost,
      odometer_km: params.odometer_km,
      displacement_cc: params.displacement_cc,
      seat_height_mm: params.seat_height_mm,
      heated_grips: params.heated_grips,
      longest_trip_km: params.longest_trip_km,
      notes: params.notes?.trim() || null,
    })
    .where(and(eq(motorcycles1.id, params.id), eq(motorcycles1.user_id, params.userId)))
    .returning();
  return updated;
}

export async function deleteMotorcycle(params: { userId: number; id: number }): Promise<void> {
  await assertOwns(params.userId, params.id);
  await db.delete(motorcycles1).where(and(eq(motorcycles1.id, params.id), eq(motorcycles1.user_id, params.userId)));
}

/** Map form strings to typed payload for create/update. */
export function buildMotorcyclePayload(
  userId: number,
  values: Record<string, string>,
  id?: number,
): CreateMotorcycleParams | UpdateMotorcycleParams {
  const brand = values.brand?.trim() ?? '';
  const make = values.make?.trim() ?? '';
  if (!brand) throw new Error('Brand is required');
  if (!make) throw new Error('Make (model) is required');

  const y = Number.parseInt(values.model_year, 10);
  if (!Number.isFinite(y) || y < 1970 || y > 2035) {
    throw new Error('Model year must be a number between 1970 and 2035');
  }

  const base: MotorcycleWriteBase = {
    userId,
    brand,
    make,
    model_year: y,
    purchase_date: values.purchase_date?.trim() || null,
    sell_date: values.sell_date?.trim() || null,
    cost: parseOptionalMoney(values.cost ?? ''),
    odometer_km: parseOptionalInt(values.odometer_km ?? ''),
    displacement_cc: parseOptionalInt(values.displacement_cc ?? ''),
    seat_height_mm: parseOptionalInt(values.seat_height_mm ?? ''),
    heated_grips: values.heated_grips === 'Y',
    longest_trip_km: parseOptionalInt(values.longest_trip_km ?? ''),
    notes: values.notes?.trim() || null,
  };

  if (id !== undefined) {
    return { ...base, id };
  }
  return base;
}
