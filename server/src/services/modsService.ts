// Mods service — CRUD for motorcycle modifications

import { and, eq, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { mods } from '../db/schema.js';

export interface ListParams {
  motorcycleId: number;
}

export interface CreateParams {
  motorcycleId: number;
  name: string;
  category: string | null;
  cost: string | null;
  installed_date: string | null;
  notes: string | null;
}

export interface UpdateParams extends CreateParams {
  id: number;
}

export async function listMods(params: ListParams): Promise<Record<string, unknown>[]> {
  const rows = await db
    .select()
    .from(mods)
    .where(eq(mods.motorcycle_id, params.motorcycleId))
    .orderBy(asc(mods.installed_date), asc(mods.name));

  return rows.map((r) => ({
    id: r.id,
    motorcycle_id: r.motorcycle_id,
    name: r.name,
    category: r.category ?? '',
    cost: r.cost ?? '',
    installed_date: r.installed_date ?? '',
    notes: r.notes ?? '',
  }));
}

export async function createMod(params: CreateParams): Promise<Record<string, unknown>> {
  validate(params);
  const [row] = await db
    .insert(mods)
    .values({
      motorcycle_id: params.motorcycleId,
      name: params.name,
      category: params.category,
      cost: params.cost,
      installed_date: params.installed_date,
      notes: params.notes,
    })
    .returning();
  return row;
}

export async function updateMod(params: UpdateParams): Promise<Record<string, unknown>> {
  validate(params);
  const [row] = await db
    .update(mods)
    .set({
      name: params.name,
      category: params.category,
      cost: params.cost,
      installed_date: params.installed_date,
      notes: params.notes,
    })
    .where(and(eq(mods.id, params.id), eq(mods.motorcycle_id, params.motorcycleId)))
    .returning();
  if (!row) throw new Error('Mod not found');
  return row;
}

export async function deleteMod(params: { id: number; motorcycleId: number }): Promise<void> {
  const result = await db
    .delete(mods)
    .where(and(eq(mods.id, params.id), eq(mods.motorcycle_id, params.motorcycleId)))
    .returning({ id: mods.id });
  if (result.length === 0) throw new Error('Mod not found');
}

function validate(p: CreateParams): void {
  if (!p.name || p.name.trim().length === 0) throw new Error('Name is required');
  if (p.cost !== null && p.cost !== '' && !/^\d+(\.\d{1,2})?$/.test(p.cost)) {
    throw new Error('Cost must be a number with up to 2 decimals');
  }
  if (p.installed_date && !isValidDate(p.installed_date)) {
    throw new Error('Installed date must be YYYY-MM-DD');
  }
}

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
