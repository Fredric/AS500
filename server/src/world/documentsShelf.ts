/**
 * Bookshelves — a `type: 'bookshelf'` Thing bound to a My Documents folder,
 * showing one book per subfolder.
 *
 * A book is never a `world_things` row. It is derived live from
 * `document_folders` on every resolve, exactly like a normal binding's
 * `ResolvedContents.preview` — a bookshelf is a lens onto the folder tree,
 * not a cache of it. This module is the one place that reaches for
 * `document_folders` shape (folder vs file, breadcrumb) beyond the generic
 * `{id, label}` every other binding kind is happy with, so it is kept
 * separate from `resolver.ts` rather than folded into the generic
 * `resolveCrudBinding`, which every other binding kind also relies on
 * unchanged.
 *
 * Both functions go through `getConfig(BOOKSHELF_CONFIG_ID)` and its own
 * `services.list`, the identical path `resolveCrudBinding` takes — so RBAC
 * (`config.requirePermission`, `services.list.requirePermission`) is
 * enforced identically, with no world-specific access control here either.
 *
 * `getBreadcrumbPath` is the one direct call to `documentService` in this
 * module — a deliberate, narrow exception: it is a pure, already-exported,
 * userId-scoped read helper, not a raw table query, and `resolver.ts`
 * already reuses `worldService.ts` functions the same way.
 */

import { getConfig } from '../core/crudtable/registry.js';
import { getBreadcrumbPath } from '../app/services/documentService.js';
import { actorHasPermission, synthesizeWorldContext, type WorldActor } from './resolver.js';
import { BOOKSHELF_CONFIG_ID, type DocumentsBrowseEntry, type ResolvedBook } from './types.js';

/** A `documentsConfig.listFolderContents` row, loosely typed at this boundary. */
interface DocumentListRow {
  id: number | null;
  kind: 'parent' | 'folder' | 'file';
  name: string;
  fileType?: string;
  sizeBytes?: number | null;
  modifiedAt?: string;
}

async function listFolder(actor: WorldActor, folderId: number | null): Promise<DocumentListRow[]> {
  const config = getConfig(BOOKSHELF_CONFIG_ID);
  if (!config) {
    throw new Error(`No registered config '${BOOKSHELF_CONFIG_ID}'`);
  }
  if (!actorHasPermission(actor, config.requirePermission)) {
    throw new Error(`Access denied: requires ${config.requirePermission}`);
  }
  if (!actorHasPermission(actor, config.services.list?.requirePermission)) {
    throw new Error(`Access denied: requires ${config.services.list?.requirePermission}`);
  }

  const ctx = synthesizeWorldContext(actor, { folderId });
  const call = config.services.list;
  const fn = call.service[call.method];
  if (typeof fn !== 'function') {
    throw new Error(`Service method '${call.method}' not found`);
  }

  const params = call.params ? await call.params(ctx) : undefined;
  const result = params !== undefined ? await fn(params) : await fn();
  return Array.isArray(result) ? (result as DocumentListRow[]) : [];
}

/** One book per direct subfolder of `folderId` (or of the root when `null`). */
export async function resolveShelfBooks(actor: WorldActor, folderId: number | null): Promise<ResolvedBook[]> {
  const rows = await listFolder(actor, folderId);
  return rows
    .filter((r) => r.kind === 'folder' && r.id != null)
    .map((r) => ({ id: r.id as number, label: r.name }));
}

/**
 * One level of the file-explorer modal: every folder and file directly
 * inside `folderId`, plus a display breadcrumb. The synthetic `..` row
 * `documentsConfig` adds for the terminal's up-navigation is dropped — the
 * modal owns its own breadcrumb stack client-side and never asks to go up
 * past the book it was opened from.
 */
export async function browseDocumentsFolder(
  actor: WorldActor,
  folderId: number | null,
): Promise<{ breadcrumb: string; entries: DocumentsBrowseEntry[] }> {
  const [rows, breadcrumb] = await Promise.all([
    listFolder(actor, folderId),
    getBreadcrumbPath({ userId: actor.userId, folderId }),
  ]);

  const entries: DocumentsBrowseEntry[] = rows
    .filter((r) => r.kind !== 'parent' && r.id != null)
    .map((r) => ({
      id: r.id as number,
      kind: r.kind as 'folder' | 'file',
      name: r.name,
      fileType: r.fileType ?? '',
      sizeBytes: r.sizeBytes ?? null,
      modifiedAt: r.modifiedAt ?? '',
    }));

  return { breadcrumb, entries };
}
