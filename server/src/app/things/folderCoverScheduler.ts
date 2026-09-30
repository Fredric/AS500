// Periodic check + "run now" for folder box-art covers. No queue, no lease
// protocol, no GPU worker — regenerateFolderCover() is cheap enough (real
// PNGs, real code, no model) to just call directly. See folderCoverService.ts.

import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '../../core/db/index.js';
import { myThings, thingFolders } from '../db/schema.js';
import { regenerateFolderCover } from '../services/folderCoverService.js';

/**
 * One tick of the periodic scheduler: every folder with at least one
 * sprite-bearing thing gets checked for staleness and rebuilt if needed.
 * Cheap and safe to call often — regenerateFolderCover itself no-ops when
 * nothing changed.
 */
export async function checkFoldersForCoverRefresh(): Promise<void> {
  const folders = await db
    .selectDistinct({ folder_id: myThings.folder_id, user_id: myThings.user_id })
    .from(myThings)
    .where(and(isNotNull(myThings.folder_id), isNotNull(myThings.processed_path)));

  for (const folder of folders) {
    if (folder.folder_id === null) continue;
    try {
      await regenerateFolderCover({ folderId: folder.folder_id, userId: folder.user_id });
    } catch (err) {
      console.error(`[folder-cover] regenerate failed for folder ${folder.folder_id}:`, err);
    }
  }
}

/** The CRUDTable "Regenerate now" action: forces a rebuild regardless of
 *  whether the folder's signature actually changed. Takes only `folderId` —
 *  the folder's own owner is looked up here rather than trusted from the
 *  caller, since the admin session invoking this may not be that owner. */
export async function runFolderCoverNow(params: { folderId: number }): Promise<void> {
  const [folder] = await db
    .select({ id: thingFolders.id, user_id: thingFolders.user_id })
    .from(thingFolders)
    .where(eq(thingFolders.id, params.folderId));
  if (!folder) throw new Error('Folder not found');

  const regenerated = await regenerateFolderCover({
    folderId: folder.id,
    userId: folder.user_id,
    force: true,
  });
  if (!regenerated) throw new Error('Folder has no things with a generated sprite yet');
}

export interface FolderCoverListRow {
  id: number;
  name: string;
  hasCover: boolean;
  itemCount: number;
  updatedAt: string;
}

/** Admin listing (folderCoversConfig): every folder that has at least one
 *  sprite-bearing thing, so "Regenerate now" always has something to act on. */
export async function listFolderCovers(): Promise<FolderCoverListRow[]> {
  const counts = await db
    .select({ folder_id: myThings.folder_id, count: sql<number>`count(*)`.as('count') })
    .from(myThings)
    .where(and(isNotNull(myThings.folder_id), isNotNull(myThings.processed_path)))
    .groupBy(myThings.folder_id);

  const countByFolder = new Map(counts.map((c) => [c.folder_id, Number(c.count)]));
  if (countByFolder.size === 0) return [];

  const folders = await db
    .select({
      id: thingFolders.id,
      name: thingFolders.name,
      cover_path: thingFolders.cover_path,
      updated_at: thingFolders.updated_at,
    })
    .from(thingFolders)
    .orderBy(desc(thingFolders.updated_at));

  return folders
    .filter((f) => countByFolder.has(f.id))
    .map((f) => ({
      id: f.id,
      name: f.name,
      hasCover: Boolean(f.cover_path),
      itemCount: countByFolder.get(f.id) ?? 0,
      updatedAt: f.updated_at.toISOString(),
    }));
}

export async function readFolderCover(id: number): Promise<FolderCoverListRow | null> {
  const rows = await listFolderCovers();
  return rows.find((r) => r.id === id) ?? null;
}
