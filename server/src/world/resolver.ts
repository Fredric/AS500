/**
 * Binding resolver — the heart of the world layer.
 *
 * Turns a stored {@link ThingBinding} into something a renderer can draw, by
 * going through the **config registry** rather than touching application tables:
 *
 *     thing.binding {crud, 'documents', {folderId:42}}
 *       → getConfig('documents')
 *       → hasPermission(actor, config.requirePermission)
 *       → config.services.list.params(syntheticCtx)
 *       → documentService.listFolderContents(...)
 *
 * This is the identical path the terminal, MCP and REST take. Two consequences
 * that the whole design leans on:
 *
 *   1. There is no world-specific access control. `config.requirePermission`
 *      and `ServiceCall.requirePermission` already gate every object.
 *   2. Any CRUDTableConfig anyone registers in future is immediately placeable,
 *      with no change here.
 *
 * A thing the actor may not open is returned marked `denied`, never omitted:
 * you see the cabinet, you just cannot open it. Omitting it would make the
 * room's furniture depend on who is looking, and leak the object's absence.
 */

import type { CRUDContext, CRUDTableConfig } from '../core/crudtable/types.js';
import { getConfig } from '../core/crudtable/registry.js';
import type {
  ResolvedContents,
  ResolvedScene,
  ResolvedThing,
  ThingBinding,
  WorldSpaceRow,
  WorldThingRow,
} from './types.js';
import { describeBinding } from './services/worldService.js';
import { probeStatusFor } from './serviceStatus.js';

/** How many bound records a Thing shows before it just reports a count. */
const PREVIEW_LIMIT = 8;

/**
 * The acting identity. Mirrors the shape of `McpCallUser` and of the permission
 * fields on `Session`, so any of the three can be adapted into it.
 */
export interface WorldActor {
  userId: number;
  username: string;
  isAdmin: boolean;
  permissions: Set<string>;
}

function actorHasPermission(actor: WorldActor, key: string | undefined): boolean {
  if (!key) return true;
  if (actor.isAdmin) return true;
  return actor.permissions.has(key);
}

/**
 * Build the minimal `CRUDContext` a config's `services.list.params(ctx)` needs.
 *
 * The binding scope lands in `ctx.input`, which is exactly where a
 * `RelationConfig.mapInput` would have put it in the in-process screen flow and
 * where `MCPScopeParam`s land for a tool call — so configs need no knowledge
 * that a room is asking.
 *
 * `userId` is injected from the authenticated actor and deliberately written
 * AFTER the stored scope, so a binding can never widen access by naming another
 * user's id. This mirrors `injectFromAuth: 'userId'` on the MCP/REST surfaces.
 */
function synthesizeWorldContext(actor: WorldActor, scope: Record<string, unknown>): CRUDContext {
  return {
    records: [],
    selection: [],
    values: {},
    input: { ...scope, userId: actor.userId },
    user: actor.username,
    formMode: null,
    editRecord: null,
    pendingDeleteRecord: null,
    pageOffset: 0,
    formPage: 0,
    datasources: {},
  };
}

/**
 * Drop rows that are navigation affordances rather than contents.
 *
 * A list built for the terminal can carry rows that exist only to move around
 * in it — `documentsConfig` synthesizes a `..` row so Enter goes up a folder.
 * Those rows have no primary key, and counting them would tell someone their
 * drawer holds four documents when it holds three.
 *
 * The fallback matters: a few configs key on something other than `id`
 * (`roleDefaultsConfig` keys on the role name), and there every row is real. So
 * identity-less rows are only dropped when something else in the list has an
 * identity to be distinguished from.
 */
function contentRows(records: Record<string, unknown>[]): Record<string, unknown>[] {
  const identified = records.filter((r) => r.id !== null && r.id !== undefined);
  return identified.length > 0 ? identified : records;
}

/** Best-effort human label for a bound record, using the config's own columns. */
function labelRecord(config: CRUDTableConfig, record: Record<string, unknown>): string {
  for (const key of config.columnBuilder) {
    const fc = config.fieldConfigs[key];
    if (!fc) continue;
    const raw = record[fc.field];
    if (raw != null && String(raw).trim() !== '') return String(raw).trim();
  }
  const fallback = record.name ?? record.label ?? record.title ?? record.id;
  return fallback != null ? String(fallback) : '(untitled)';
}

async function resolveCrudBinding(
  actor: WorldActor,
  configId: string,
  scope: Record<string, unknown>,
): Promise<Pick<ResolvedThing, 'access' | 'reason' | 'contents'>> {
  const config = getConfig(configId);
  if (!config) {
    return { access: 'error', reason: `No registered config '${configId}'`, contents: null };
  }

  // Screen-level permission, then the list operation's own permission.
  if (!actorHasPermission(actor, config.requirePermission)) {
    return { access: 'denied', reason: `Requires ${config.requirePermission}`, contents: null };
  }
  if (!actorHasPermission(actor, config.services.list?.requirePermission)) {
    return { access: 'denied', reason: `Requires ${config.services.list?.requirePermission}`, contents: null };
  }

  const ctx = synthesizeWorldContext(actor, scope);
  const call = config.services.list;
  const fn = call.service[call.method];
  if (typeof fn !== 'function') {
    return { access: 'error', reason: `Service method '${call.method}' not found`, contents: null };
  }

  const params = call.params ? await call.params(ctx) : undefined;
  const result = params !== undefined ? await fn(params) : await fn();
  const raw = Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
  const records = contentRows(raw);

  const contents: ResolvedContents = {
    count: records.length,
    preview: records.slice(0, PREVIEW_LIMIT).map((r) => ({
      id: (r.id as string | number | undefined) ?? null,
      label: labelRecord(config, r),
    })),
    truncated: records.length > PREVIEW_LIMIT,
  };

  return { access: 'ok', reason: null, contents };
}

async function resolveRecordBinding(
  actor: WorldActor,
  configId: string,
  recordId: string | number,
): Promise<Pick<ResolvedThing, 'access' | 'reason' | 'contents'>> {
  const config = getConfig(configId);
  if (!config) {
    return { access: 'error', reason: `No registered config '${configId}'`, contents: null };
  }
  if (!actorHasPermission(actor, config.requirePermission)) {
    return { access: 'denied', reason: `Requires ${config.requirePermission}`, contents: null };
  }

  const call = config.services.read;
  if (!call) {
    return { access: 'error', reason: `Config '${configId}' has no read service`, contents: null };
  }
  if (!actorHasPermission(actor, call.requirePermission)) {
    return { access: 'denied', reason: `Requires ${call.requirePermission}`, contents: null };
  }

  const ctx = synthesizeWorldContext(actor, { id: recordId });
  // `services.read.params` conventionally reads the key from ctx.input.id, but
  // several configs read it from ctx.editRecord instead (see documentsConfig).
  // Populate both so either convention resolves.
  ctx.editRecord = { id: recordId };

  const fn = call.service[call.method];
  if (typeof fn !== 'function') {
    return { access: 'error', reason: `Service method '${call.method}' not found`, contents: null };
  }

  const params = call.params ? await call.params(ctx) : undefined;
  const record = (params !== undefined ? await fn(params) : await fn()) as Record<string, unknown> | null;
  if (!record) return { access: 'error', reason: 'Record not found', contents: null };

  return {
    access: 'ok',
    reason: null,
    contents: {
      count: 1,
      preview: [{ id: recordId, label: labelRecord(config, record) }],
      truncated: false,
    },
  };
}

/**
 * Resolve one Thing for one actor. Never throws: a binding that blows up is
 * reported as `access: 'error'` with the message, because one broken object
 * must not take down the whole room.
 */
export async function resolveThing(
  thing: WorldThingRow,
  actor: WorldActor,
  children: ResolvedThing[] = [],
): Promise<ResolvedThing> {
  const base: ResolvedThing = {
    ...thing,
    access: 'unbound',
    reason: null,
    contents: null,
    service: null,
    children,
  };

  const binding: ThingBinding | null = thing.binding;
  if (!binding || binding.kind === 'none') return base;

  try {
    switch (binding.kind) {
      case 'crud':
        return { ...base, ...(await resolveCrudBinding(actor, binding.configId, binding.scope ?? {})) };

      case 'record':
        return { ...base, ...(await resolveRecordBinding(actor, binding.configId, binding.recordId)) };

      case 'workstation':
      case 'agent':
        // Phase 3 streams the bound session's screen. Until then the object is
        // simply present and openable, with no contents to leak.
        return { ...base, access: 'ok' };

      case 'service':
        // Identity only in Phase 1 — see `serviceStatus.ts` for why live health
        // waits for the monitor snapshot subscription in Phase 3.
        return { ...base, access: 'ok', service: await probeStatusFor(binding.serviceKey) };
    }
  } catch (err) {
    // A binding usually scopes to its owner's data — `userId` is injected from
    // the *viewer*, so someone else's drawer legitimately fails to resolve for
    // you. That is a normal state in a shared room, not a fault, and the owner's
    // diagnostic text is not yours to read. Report it as denied and keep the
    // real message for the owner and for admins, who are the ones debugging it.
    const message = (err as Error).message;
    const isOwnObject = actor.isAdmin || thing.ownerUserId === null || thing.ownerUserId === actor.userId;
    if (!isOwnObject) {
      return { ...base, access: 'denied', reason: 'Bound to data you cannot reach' };
    }
    return { ...base, access: 'error', reason: message };
  }
}

/**
 * Resolve a whole space: rebuild the furniture tree in memory from one flat
 * query, then resolve every node depth-first.
 *
 * Sibling resolution is sequential rather than parallel on purpose — each bound
 * config runs its own query, and a room with thirty drawers should not open
 * thirty concurrent connections against a pool of ten.
 */
export async function resolveScene(
  space: WorldSpaceRow,
  rows: WorldThingRow[],
  actor: WorldActor,
): Promise<ResolvedScene> {
  const byParent = new Map<number | null, WorldThingRow[]>();
  for (const r of rows) {
    const key = r.parentThingId ?? null;
    const list = byParent.get(key);
    if (list) list.push(r);
    else byParent.set(key, [r]);
  }

  // A corrupt parent pointer (a thing whose parent was deleted, or a cycle)
  // must not strand furniture or loop forever, so descent is depth-capped and
  // every visited id is tracked.
  const seen = new Set<number>();

  async function build(parentId: number | null, depth: number): Promise<ResolvedThing[]> {
    if (depth > 8) return [];
    const out: ResolvedThing[] = [];
    for (const row of byParent.get(parentId) ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      const children = await build(row.id, depth + 1);
      out.push(await resolveThing(row, actor, children));
    }
    return out;
  }

  return { space, things: await build(null, 0), ts: new Date().toISOString() };
}

export { describeBinding };
