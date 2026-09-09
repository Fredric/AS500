/**
 * World service — CRUD over spaces and things.
 *
 * Plain functions taking a single params object, exactly like the app services.
 * Consumed by the Office Layout CRUDTable configs (and therefore, for free, by
 * the MCP and REST surfaces) and by the :3006 runtime.
 *
 * This module owns placement only. It never reads bound application data —
 * that is `resolver.ts`, which goes through the config registry.
 */

import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../core/db/index.js';
import { getAllConfigs } from '../../core/crudtable/registry.js';
import { worldSpaces, worldThings } from '../db/schema.js';
import {
  THING_BINDING_KINDS,
  THING_TYPES,
  type ThingBinding,
  type ThingBindingKind,
  type Transform,
  type WorldSpaceRow,
  type WorldThingRow,
} from '../types.js';

// ============================================
// Row shaping
// ============================================

function toSpaceRow(r: typeof worldSpaces.$inferSelect): WorldSpaceRow {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    kind: r.kind,
    layout: (r.layout as WorldSpaceRow['layout']) ?? null,
    ownerUserId: r.owner_user_id,
  };
}

function toThingRow(r: typeof worldThings.$inferSelect): WorldThingRow {
  return {
    id: r.id,
    spaceId: r.space_id,
    parentThingId: r.parent_thing_id,
    type: r.type,
    label: r.label,
    slot: r.slot,
    zone: r.zone,
    transform: (r.transform as Transform | null) ?? null,
    binding: (r.binding as ThingBinding | null) ?? null,
    ownerUserId: r.owner_user_id,
    visibility: r.visibility,
    sortOrder: r.sort_order,
  };
}

/**
 * Flatten a thing into the string-ish record the CRUDTable list and form expect.
 * The binding is exploded into discrete fields so it can be edited in a green
 * screen; {@link composeBinding} puts it back together on save.
 */
function toThingDisplay(r: typeof worldThings.$inferSelect): Record<string, unknown> {
  const row = toThingRow(r);
  const b = row.binding;
  const t = row.transform;
  return {
    ...row,
    id: row.id,
    bindingKind: b?.kind ?? 'none',
    bindingConfigId: b && (b.kind === 'crud' || b.kind === 'record') ? b.configId : '',
    bindingScope: b && b.kind === 'crud' && b.scope ? stringifyScope(b.scope) : '',
    bindingRecordId: b && b.kind === 'record' ? String(b.recordId) : '',
    bindingServiceKey: b && b.kind === 'service' ? b.serviceKey : '',
    bindingAgentUserId: b && b.kind === 'agent' ? String(b.userId) : '',
    x: t?.x != null ? String(t.x) : '',
    y: t?.y != null ? String(t.y) : '',
    // Display-only summary column.
    boundTo: describeBinding(b),
  };
}

/** One-line description of a binding, for the list screen and the floorplan. */
export function describeBinding(b: ThingBinding | null): string {
  if (!b || b.kind === 'none') return '-';
  switch (b.kind) {
    case 'crud': {
      const scope = b.scope && Object.keys(b.scope).length ? ` ${stringifyScope(b.scope)}` : '';
      return `${b.configId}${scope}`;
    }
    case 'record':      return `${b.configId}#${b.recordId}`;
    case 'service':     return `svc:${b.serviceKey}`;
    case 'agent':       return `agent:${b.userId}`;
    case 'workstation': return 'workstation';
  }
}

// ============================================
// Scope parsing — `{"folderId":42}` or `folderId=42,kind=folder`
// ============================================

/**
 * Parse the scope a user typed on the green screen.
 *
 * Accepts JSON when it starts with `{`, otherwise a comma-separated `k=v` list,
 * which is far kinder to type into an 80-column field. Numeric-looking values
 * become numbers so `services.list.params()` receives what it expects — a
 * `folderId` of `"42"` would silently miss on an integer column.
 */
export function parseScope(raw: string): Record<string, unknown> {
  const s = raw.trim();
  if (!s) return {};

  if (s.startsWith('{')) {
    const parsed = JSON.parse(s) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Scope JSON must be an object');
    }
    return parsed as Record<string, unknown>;
  }

  const out: Record<string, unknown> = {};
  for (const pair of s.split(',')) {
    const [k, ...rest] = pair.split('=');
    const key = k.trim();
    if (!key) continue;
    if (rest.length === 0) throw new Error(`Scope entry "${pair.trim()}" is missing "=value"`);
    out[key] = coerce(rest.join('=').trim());
  }
  return out;
}

function coerce(v: string): unknown {
  if (v === '') return '';
  if (v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}

export function stringifyScope(scope: Record<string, unknown>): string {
  return Object.entries(scope)
    .map(([k, v]) => `${k}=${v === null ? 'null' : String(v)}`)
    .join(',');
}

// ============================================
// Binding composition
// ============================================

export interface BindingFields {
  bindingKind: string;
  bindingConfigId?: string;
  bindingScope?: string;
  bindingRecordId?: string;
  bindingServiceKey?: string;
  bindingAgentUserId?: string;
}

/** Build a {@link ThingBinding} from the discrete form fields, validating as it goes. */
export function composeBinding(f: BindingFields): ThingBinding {
  const kind = (f.bindingKind || 'none').trim() as ThingBindingKind;
  if (!THING_BINDING_KINDS.includes(kind)) {
    throw new Error(`Unknown binding kind '${kind}'`);
  }

  switch (kind) {
    case 'none':
    case 'workstation':
      return { kind };

    case 'crud': {
      const configId = (f.bindingConfigId ?? '').trim();
      if (!configId) throw new Error('A crud binding needs a Config Id');
      return { kind, configId, scope: parseScope(f.bindingScope ?? '') };
    }

    case 'record': {
      const configId = (f.bindingConfigId ?? '').trim();
      const recordId = (f.bindingRecordId ?? '').trim();
      if (!configId) throw new Error('A record binding needs a Config Id');
      if (!recordId) throw new Error('A record binding needs a Record Id');
      return { kind, configId, recordId: /^-?\d+$/.test(recordId) ? Number(recordId) : recordId };
    }

    case 'service': {
      const serviceKey = (f.bindingServiceKey ?? '').trim();
      if (!serviceKey) throw new Error('A service binding needs a Service Key');
      return { kind, serviceKey };
    }

    case 'agent': {
      const raw = (f.bindingAgentUserId ?? '').trim();
      const userId = Number(raw);
      if (!Number.isInteger(userId) || userId <= 0) {
        throw new Error('An agent binding needs a numeric User Id');
      }
      return { kind, userId };
    }
  }
}

/**
 * Every registered CRUDTableConfig, as options for the binding picker.
 *
 * A datasource rather than `staticOptions` so the list is built when the form
 * renders, not when this module is imported — registration order would
 * otherwise decide which configs are bindable.
 */
export async function listBindableConfigs(): Promise<Record<string, unknown>[]> {
  return getAllConfigs()
    .map((c) => ({ id: c.id, title: `${c.id} - ${c.title}`.slice(0, 40) }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

// ============================================
// Spaces
// ============================================

export async function listSpaces(): Promise<Record<string, unknown>[]> {
  const rows = await db.select().from(worldSpaces).orderBy(asc(worldSpaces.name));
  const counts = await db
    .select({ space_id: worldThings.space_id, n: sql<number>`count(*)::int` })
    .from(worldThings)
    .groupBy(worldThings.space_id);
  const bySpace = new Map(counts.map((c) => [c.space_id, c.n]));

  return rows.map((r) => ({ ...toSpaceRow(r), thingCount: bySpace.get(r.id) ?? 0 }));
}

export async function readSpace(params: { id: number }): Promise<Record<string, unknown> | null> {
  const [r] = await db.select().from(worldSpaces).where(eq(worldSpaces.id, params.id));
  return r ? { ...toSpaceRow(r) } : null;
}

export async function getSpaceByKey(key: string): Promise<WorldSpaceRow | null> {
  const [r] = await db.select().from(worldSpaces).where(eq(worldSpaces.key, key));
  return r ? toSpaceRow(r) : null;
}

export interface SpaceWriteParams {
  userId: number;
  key: string;
  name: string;
  kind: string;
}

export async function createSpace(p: SpaceWriteParams): Promise<Record<string, unknown>> {
  const key = normaliseKey(p.key);
  const [row] = await db
    .insert(worldSpaces)
    .values({ key, name: requireText(p.name, 'Name'), kind: p.kind || 'office', owner_user_id: p.userId })
    .returning();
  return { ...toSpaceRow(row) };
}

export async function updateSpace(p: SpaceWriteParams & { id: number }): Promise<Record<string, unknown>> {
  const [row] = await db
    .update(worldSpaces)
    .set({
      key: normaliseKey(p.key),
      name: requireText(p.name, 'Name'),
      kind: p.kind || 'office',
      updated_at: new Date(),
    })
    .where(eq(worldSpaces.id, p.id))
    .returning();
  if (!row) throw new Error('Space not found');
  return { ...toSpaceRow(row) };
}

export async function deleteSpace(p: { id: number }): Promise<void> {
  const res = await db.delete(worldSpaces).where(eq(worldSpaces.id, p.id)).returning({ id: worldSpaces.id });
  if (res.length === 0) throw new Error('Space not found');
}

// ============================================
// Things
// ============================================

export interface ListThingsParams {
  spaceId: number;
  /** null / undefined = the top level of the space. */
  parentThingId?: number | null;
}

export async function listThings(p: ListThingsParams): Promise<Record<string, unknown>[]> {
  const parentId = p.parentThingId ?? null;
  const rows = await db
    .select()
    .from(worldThings)
    .where(and(
      eq(worldThings.space_id, p.spaceId),
      parentId === null ? isNull(worldThings.parent_thing_id) : eq(worldThings.parent_thing_id, parentId),
    ))
    .orderBy(asc(worldThings.sort_order), asc(worldThings.id));

  const childCounts = await countChildren(rows.map((r) => r.id));
  return rows.map((r) => ({ ...toThingDisplay(r), childCount: childCounts.get(r.id) ?? 0 }));
}

/** Every thing in a space, in one query — the resolver rebuilds the tree in memory. */
export async function listAllThingsInSpace(spaceId: number): Promise<WorldThingRow[]> {
  const rows = await db
    .select()
    .from(worldThings)
    .where(eq(worldThings.space_id, spaceId))
    .orderBy(asc(worldThings.sort_order), asc(worldThings.id));
  return rows.map(toThingRow);
}

export async function readThing(params: { id: number }): Promise<Record<string, unknown> | null> {
  const [r] = await db.select().from(worldThings).where(eq(worldThings.id, params.id));
  return r ? toThingDisplay(r) : null;
}

export async function getThing(id: number): Promise<WorldThingRow | null> {
  const [r] = await db.select().from(worldThings).where(eq(worldThings.id, id));
  return r ? toThingRow(r) : null;
}

async function countChildren(ids: number[]): Promise<Map<number, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ parent: worldThings.parent_thing_id, n: sql<number>`count(*)::int` })
    .from(worldThings)
    .where(sql`${worldThings.parent_thing_id} = ANY(${sql.raw(`ARRAY[${ids.join(',')}]::int[]`)})`)
    .groupBy(worldThings.parent_thing_id);
  return new Map(rows.filter((r) => r.parent != null).map((r) => [r.parent as number, r.n]));
}

export interface ThingWriteParams extends BindingFields {
  userId: number;
  spaceId: number;
  parentThingId?: number | null;
  type: string;
  label: string;
  slot?: string;
  zone?: string;
  x?: string;
  y?: string;
}

export async function createThing(p: ThingWriteParams): Promise<Record<string, unknown>> {
  const values = buildThingValues(p);
  const [row] = await db
    .insert(worldThings)
    .values({
      space_id: p.spaceId,
      parent_thing_id: p.parentThingId ?? null,
      owner_user_id: p.userId,
      ...values,
    })
    .returning();
  return toThingDisplay(row);
}

export async function updateThing(p: ThingWriteParams & { id: number }): Promise<Record<string, unknown>> {
  const values = buildThingValues(p);
  const [row] = await db
    .update(worldThings)
    .set({ ...values, updated_at: new Date() })
    .where(eq(worldThings.id, p.id))
    .returning();
  if (!row) throw new Error('Object not found');
  return toThingDisplay(row);
}

export async function deleteThing(p: { id: number }): Promise<void> {
  // Children would be orphaned rather than cascade-deleted (parent_thing_id is a
  // plain column, matching document_folders.parent_id), so refuse explicitly
  // instead of leaving unreachable furniture behind.
  const [child] = await db
    .select({ id: worldThings.id })
    .from(worldThings)
    .where(eq(worldThings.parent_thing_id, p.id))
    .limit(1);
  if (child) throw new Error('Object still contains other objects — empty it first');

  const res = await db.delete(worldThings).where(eq(worldThings.id, p.id)).returning({ id: worldThings.id });
  if (res.length === 0) throw new Error('Object not found');
}

function buildThingValues(p: ThingWriteParams) {
  const type = (p.type || '').trim().toLowerCase();
  if (!type) throw new Error('Type is required');
  if (!(THING_TYPES as readonly string[]).includes(type)) {
    throw new Error(`Unknown type '${type}'. One of: ${THING_TYPES.join(', ')}`);
  }

  const binding = composeBinding(p);
  const transform = buildTransform(p.x, p.y);

  return {
    type,
    label: requireText(p.label, 'Label'),
    slot: emptyToNull(p.slot),
    zone: emptyToNull(p.zone),
    transform,
    binding,
  };
}

function buildTransform(x?: string, y?: string): Transform | null {
  const hasX = x != null && x.trim() !== '';
  const hasY = y != null && y.trim() !== '';
  if (!hasX && !hasY) return null;

  const nx = Number(x);
  const ny = Number(y);
  if (hasX && !Number.isFinite(nx)) throw new Error('X must be a number');
  if (hasY && !Number.isFinite(ny)) throw new Error('Y must be a number');
  return { x: hasX ? nx : 0, y: hasY ? ny : 0 };
}

// ============================================
// Helpers
// ============================================

function requireText(v: string | undefined, label: string): string {
  const s = (v ?? '').trim();
  if (!s) throw new Error(`${label} is required`);
  return s;
}

function emptyToNull(v: string | undefined): string | null {
  const s = (v ?? '').trim();
  return s === '' ? null : s;
}

/** Space keys address the world API (`/api/space/:key`), so keep them URL-safe. */
function normaliseKey(raw: string): string {
  const s = (raw ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!s) throw new Error('Key is required (letters, digits, - and _)');
  return s;
}
