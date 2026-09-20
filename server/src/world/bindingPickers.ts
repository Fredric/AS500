/**
 * Pickers for the three binding fields on an office object — Shows, Source and
 * Filter — so the terminal form can offer real choices instead of asking you to
 * know a config id, a service key or `folderId=42` by heart.
 *
 * Kept out of `services/worldService.ts` on purpose: that module owns
 * *placement* and never reads application data, while a picker has to look at
 * document folders, motorcycles, users and the service registry to offer their
 * identifiers. Same reason `documentsShelf.ts` and `serviceStatus.ts` are their
 * own modules.
 *
 * Every function returns `{ id, title }` rows: `id` is exactly what gets stored
 * in the field (so the value is unchanged from typing it by hand), `title` is
 * what the dropdown shows. Nothing here grants access — a binding is still
 * resolved per viewer by `resolver.ts`, so listing a config here does not let
 * anyone open data they could not already open.
 */

import { asc, eq } from 'drizzle-orm';
import { db } from '../core/db/index.js';
import { getAllConfigs } from '../core/crudtable/registry.js';
import { users } from '../core/db/schema.js';
import { motorcycles } from '../app/db/schema.js';
import { listFolderPaths } from '../app/services/documentService.js';
import { COMPONENTS } from '../monitor/config.js';
import { listSpaces } from './services/worldService.js';
import type { ThingBindingKind } from './types.js';

/**
 * What each "Shows" choice means, in plain words. The stored value stays the
 * kind itself (`crud`, `record`, ...): it is also the enum an MCP agent sends,
 * so only the words shown *around* it are free to change.
 */
export const BINDING_KIND_HELP: Record<ThingBindingKind, string> = {
  crud: 'A list of records',
  record: 'One single record',
  workstation: 'A workstation (a computer)',
  service: 'A service and its health',
  agent: 'An agent\'s seat',
  door: 'A door to another space',
  none: 'Nothing (a plain object)',
};

/** Longest tag below, so the titles line up in the dropdown's fixed-width list. */
const TAG_WIDTH = '[list/record]'.length;

function tagged(tag: string, text: string): string {
  return `${`[${tag}]`.padEnd(TAG_WIDTH)} ${text}`.slice(0, 72);
}

/**
 * Everything a binding's Source can be, across all binding kinds, each tagged
 * with the "Shows" choice it belongs to.
 *
 * One merged list rather than one per kind because the terminal only re-reads a
 * field's options on a server round trip: picking "Shows: service" cannot swap
 * this list while the form is still open. The tags do that job instead —
 * pick the row whose tag matches what you chose in Shows.
 */
export async function listBindingSources(): Promise<Array<{ id: string; title: string }>> {
  const configs = getAllConfigs()
    .map((c) => ({ id: c.id, title: tagged('list/record', `${c.title}  (${c.id})`) }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const services = COMPONENTS
    .map((c) => ({ id: c.id, title: tagged('service', `${c.label}  (${c.id})`) }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const spaces = (await listSpaces()).map((s) => ({
    id: String(s.key),
    title: tagged('door', `${String(s.name)}  (${String(s.key)})`),
  }));

  // Agent seats are for AI agents; the id is what gets stored.
  const agents = (
    await db
      .select({ id: users.id, username: users.username, fullName: users.full_name })
      .from(users)
      .where(eq(users.role, 'aiagent'))
      .orderBy(asc(users.username))
  ).map((u) => ({
    id: String(u.id),
    title: tagged('agent', `${u.fullName || u.username}  (id ${u.id})`),
  }));

  return [...configs, ...services, ...spaces, ...agents];
}

/**
 * Filters worth offering: a My Documents folder (`folderId=N`, for a `documents`
 * list) and a motorcycle (`motorcycleId=N`, for `mods` / `services_performed`).
 *
 * Scoped to `userId` — the person editing the layout — because a binding's
 * scope can never name someone else's data (see the note on userId in
 * `thingsConfig.openUI.mapContext`).
 */
export async function listBindingFilters(params: {
  userId: number;
}): Promise<Array<{ id: string; title: string }>> {
  if (!Number.isInteger(params.userId)) return [];

  const folders = (await listFolderPaths({ userId: params.userId })).map((f) => ({
    id: `folderId=${f.id}`,
    title: tagged('folder', f.path),
  }));

  const bikes = (
    await db
      .select()
      .from(motorcycles)
      .where(eq(motorcycles.user_id, params.userId))
      .orderBy(asc(motorcycles.brand), asc(motorcycles.model))
  ).map((m) => ({
    id: `motorcycleId=${m.id}`,
    title: tagged(
      'motorcycle',
      `${m.year} ${m.brand} ${m.model}${m.nickname ? ` "${m.nickname}"` : ''}`,
    ),
  }));

  return [...folders, ...bikes];
}
