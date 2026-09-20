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
import { McpToolError } from '../../core/mcp/errors.js';
import { worldSpaces, worldThings } from '../db/schema.js';
import {
  BOOKSHELF_CONFIG_ID,
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
    bindingTarget: bindingTargetOf(b),
    bindingScope: bindingScopeOf(b),
    x: t?.x != null ? String(t.x) : '',
    y: t?.y != null ? String(t.y) : '',
    // Display-only summary column.
    boundTo: describeBinding(b),
  };
}

/**
 * The `Target` column of a binding, as one editable string.
 *
 * Six binding fields collapse to two on the form because a dumb terminal cannot
 * show and hide fields as you type — visibility is only re-evaluated on a server
 * round trip, so a field revealed by the value you are currently entering can
 * never appear. Rather than five permanently-visible fields of which four are
 * always irrelevant, `Target` carries whichever single identifier the chosen
 * kind needs. This is how AS/400 qualifier fields have always worked.
 */
export function bindingTargetOf(b: ThingBinding | null): string {
  if (!b) return '';
  switch (b.kind) {
    case 'crud':
    case 'record':  return b.configId;
    case 'service': return b.serviceKey;
    case 'agent':   return String(b.userId);
    case 'door':    return b.spaceKey;
    default:        return '';
  }
}

/** The `Scope` column: list scope for crud, the primary key for record. */
export function bindingScopeOf(b: ThingBinding | null): string {
  if (!b) return '';
  if (b.kind === 'crud') return b.scope ? stringifyScope(b.scope) : '';
  if (b.kind === 'record') return String(b.recordId);
  return '';
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
    case 'door':        return `door:${b.spaceKey}`;
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
  /** Config id, service key, or agent user id — whichever the kind needs. */
  bindingTarget?: string;
  /** List scope (`folderId=42`) for crud; the primary key for record. */
  bindingScope?: string;
}

/**
 * Build a {@link ThingBinding} from the two form fields.
 *
 * Returns an error message rather than throwing so the same rules can back both
 * a form validator (which shows the message against the field) and the service
 * call (which must still refuse a bad binding arriving over MCP or REST).
 */
export function validateBinding(f: BindingFields): string | null {
  const kind = (f.bindingKind || 'none').trim();
  if (!(THING_BINDING_KINDS as string[]).includes(kind)) {
    return `Binds to must be one of: ${THING_BINDING_KINDS.join(', ')}`;
  }

  const target = (f.bindingTarget ?? '').trim();
  const scope = (f.bindingScope ?? '').trim();

  switch (kind as ThingBindingKind) {
    case 'crud':
      if (!target) return 'A crud binding needs a Target (the config id, e.g. documents)';
      try { parseScope(scope); } catch (err) { return `Scope: ${(err as Error).message}`; }
      return null;

    case 'record':
      if (!target) return 'A record binding needs a Target (the config id)';
      if (!scope) return 'A record binding needs the record id in Scope';
      return null;

    case 'service':
      if (!target) return 'A service binding needs a Target (the service key, e.g. docs-api)';
      return null;

    case 'agent': {
      const userId = Number(target);
      if (!Number.isInteger(userId) || userId <= 0) {
        return 'An agent binding needs a numeric user id in Target';
      }
      return null;
    }

    case 'door':
      if (!target) return 'A door binding needs a Target (the destination space\'s key)';
      return null;

    default:
      return null;
  }
}

/**
 * A `type: 'bookshelf'` object shows one book per subfolder of a My Documents
 * folder, so it may only be bound to that config. Returns an error message,
 * same convention as {@link validateBinding}, so it can back both a form
 * validator and the create/update service call.
 */
export function validateShelfBinding(
  type: string,
  bindingKind: string,
  bindingTarget: string,
): string | null {
  if (type !== 'bookshelf') return null;
  if (bindingKind !== 'crud' || bindingTarget.trim() !== BOOKSHELF_CONFIG_ID) {
    return `A bookshelf must bind to '${BOOKSHELF_CONFIG_ID}' — set Binds to=crud, Target=${BOOKSHELF_CONFIG_ID}`;
  }
  return null;
}

/**
 * A `type: 'postit'`/`'board'` thing owns its own payload (Phase 2 — see
 * `notes.ts`) rather than binding to a config: its scope is its own thing id,
 * which doesn't exist yet at placement time, so no binding kind fits. Same
 * convention as {@link validateShelfBinding}: an error message, not a throw,
 * so it backs both a form validator and the create/update service call.
 */
export function validateNoteBinding(type: string, bindingKind: string): string | null {
  if (type !== 'postit' && type !== 'board') return null;
  if (bindingKind !== 'none') {
    return `A ${type} owns its own text and cannot bind to anything — set Binds to=none`;
  }
  return null;
}

/**
 * A `type: 'door'` object is a passage to another space, so it may only
 * carry a `door` binding — and, unlike bookshelf/note, the constraint runs
 * the other way too: a `door` binding only makes sense on a door-typed
 * object (nothing else knows to walk through it). Same convention as
 * {@link validateShelfBinding}.
 */
export function validateDoorBinding(type: string, bindingKind: string): string | null {
  if (type === 'door' && bindingKind !== 'door') {
    return `A door must bind to a space — set Binds to=door, Target=<space key>`;
  }
  if (type !== 'door' && bindingKind === 'door') {
    return `A door binding only makes sense on a door — set Type=door`;
  }
  return null;
}

/**
 * Build a {@link ThingBinding} from the two form fields, validating as it goes.
 *
 * `async` only because of the `door` case: its target is a space, which
 * lives in Postgres rather than the in-memory config registry every other
 * kind resolves through, so resolving it (and catching a typo'd target
 * immediately, not silently) needs a query. `createThing`/`updateThing`,
 * this function's only callers, are already `async`.
 */
export async function composeBinding(f: BindingFields): Promise<ThingBinding> {
  const problem = validateBinding(f);
  if (problem) throw new Error(problem);

  const kind = (f.bindingKind || 'none').trim() as ThingBindingKind;
  const target = (f.bindingTarget ?? '').trim();
  const scope = (f.bindingScope ?? '').trim();

  switch (kind) {
    case 'none':
    case 'workstation':
      return { kind };

    case 'crud':
      return { kind, configId: target, scope: parseScope(scope) };

    case 'record':
      return { kind, configId: target, recordId: /^-?\d+$/.test(scope) ? Number(scope) : scope };

    case 'service':
      return { kind, serviceKey: target };

    case 'agent':
      return { kind, userId: Number(target) };

    case 'door': {
      const space = await getSpaceByKey(target);
      if (!space) {
        // A field validator can't make this check — it needs a DB query,
        // and validators run synchronously (core/crudtable/runtime.ts) — so
        // this is the ONLY enforcement point, unlike every other kind's
        // Target check, which validateBinding's field validator already
        // catches before a service call is ever made. A plain thrown Error
        // here would map to a bare 500 internal_error over REST/MCP
        // (core/api/handlers.ts's apiResultFromThrown); McpToolError gets
        // the same clean 400 validation_failed every other rejected field
        // already gets. The terminal's own error handling (runtime.ts)
        // catches any Error identically either way.
        throw new McpToolError('validation_failed', `No space '${target}'`, [
          { name: 'bindingTarget', message: `No space '${target}'` },
        ]);
      }
      return { kind, spaceKey: target, spaceId: space.id, spaceName: space.name };
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

/**
 * Every thing bound `{ kind: 'agent', userId }` to one user, across every
 * space — an agent presence entry (`agentPresence.ts`) needs to know where to
 * seat the agent before anyone has entered that space to trigger a scoped
 * lookup. Resolves-then-filters in application code rather than a jsonb
 * operator in SQL, matching this codebase's existing convention (e.g.
 * `resolver.ts`'s `contentRows()`) — there's no jsonb-in-SQL precedent here
 * to break with, and this table is small.
 */
export async function findAgentThings(userId: number): Promise<Array<WorldThingRow & { spaceKey: string }>> {
  const rows = await db
    .select({ thing: worldThings, spaceKey: worldSpaces.key })
    .from(worldThings)
    .innerJoin(worldSpaces, eq(worldThings.space_id, worldSpaces.id));

  return rows
    .map((r) => ({ ...toThingRow(r.thing), spaceKey: r.spaceKey }))
    .filter((t) => t.binding?.kind === 'agent' && t.binding.userId === userId);
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
  const values = await buildThingValues(p);
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
  const values = await buildThingValues(p);
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

async function buildThingValues(p: ThingWriteParams) {
  const type = (p.type || '').trim().toLowerCase();
  if (!type) throw new Error('Type is required');
  if (!(THING_TYPES as readonly string[]).includes(type)) {
    throw new Error(`Unknown type '${type}'. One of: ${THING_TYPES.join(', ')}`);
  }

  const binding = await composeBinding(p);

  const shelfProblem = validateShelfBinding(type, p.bindingKind || 'none', p.bindingTarget ?? '');
  if (shelfProblem) throw new Error(shelfProblem);

  const noteProblem = validateNoteBinding(type, p.bindingKind || 'none');
  if (noteProblem) throw new Error(noteProblem);

  const doorProblem = validateDoorBinding(type, p.bindingKind || 'none');
  if (doorProblem) throw new Error(doorProblem);

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

/** Space keys address the world API (`/world/api/space/:key`), so keep them URL-safe. */
function normaliseKey(raw: string): string {
  const s = (raw ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!s) throw new Error('Key is required (letters, digits, - and _)');
  return s;
}
