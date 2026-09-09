/**
 * Resolves the payload of a `type: 'postit'`/`'board'` thing.
 *
 * Kept isolated from `resolver.ts`, the same way `documentsShelf.ts` is, and
 * for the same reason: it goes through `getConfig('world_notes')` — never a
 * raw table query — reusing the exact RBAC + context-building path
 * `resolver.ts` already established (`actorHasPermission`,
 * `synthesizeWorldContext`), so a postit has no world-specific access rule
 * either. A dynamic import from `resolver.ts` avoids a circular import, the
 * same idiom `documentsShelf.ts` and `menuRuntime.ts` already use.
 */

import { getConfig } from '../core/crudtable/registry.js';
import type { ResolvedNote } from './types.js';
import { actorHasPermission, synthesizeWorldContext, type WorldActor } from './resolver.js';

/**
 * `null` means the thing has never been written to — a blank post-it, not an
 * error. Throws (caught by `resolveThing`'s try/catch, same as every other
 * binding kind) only on a genuine permission/config problem.
 */
export async function resolveNote(actor: WorldActor, thingId: number): Promise<ResolvedNote | null> {
  const config = getConfig('world_notes');
  if (!config) throw new Error(`No registered config 'world_notes'`);

  if (!actorHasPermission(actor, config.requirePermission)) {
    throw new Error(`Requires ${config.requirePermission}`);
  }
  const call = config.services.read;
  if (!call) throw new Error(`Config 'world_notes' has no read service`);
  if (!actorHasPermission(actor, call.requirePermission)) {
    throw new Error(`Requires ${call.requirePermission}`);
  }

  const ctx = synthesizeWorldContext(actor, { thingId });
  const fn = call.service[call.method];
  if (typeof fn !== 'function') throw new Error(`Service method '${call.method}' not found`);

  const params = call.params ? await call.params(ctx) : undefined;
  const record = (params !== undefined ? await fn(params) : await fn()) as Record<string, unknown> | null;
  if (!record) return null;

  return {
    body: String(record.body ?? ''),
    color: String(record.color ?? 'yellow'),
    updatedAt: String(record.updatedAt ?? ''),
  };
}
