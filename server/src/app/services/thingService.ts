// My Things service — photographed objects and their generated sprites.
//
// A Thing owns its files under server/data/things/{userId}/{thingId}/,
// deliberately outside My Documents. Nothing here writes to document_items.

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { mkdir, rm, writeFile } from 'fs/promises';
import { dirname, extname, join } from 'path';
import { fileURLToPath } from 'url';
import { db } from '../../core/db/index.js';
import { myThings, thingFolders } from '../db/schema.js';
import { regenerateFolderCover } from './folderCoverService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const THINGS_ROOT = join(__dirname, '../../../data/things');

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export type ThingStatus = 'draft' | 'processing' | 'ready' | 'failed';

export interface ThingRecord {
  id: number;
  user_id: number;
  name: string;
  description: string;
  category: string;
  status: string;
  stage: string;
  progress: number | null;
  blocked_reason: string;
  has_source: boolean;
  has_processed: boolean;
}

export function thingDirectory(userId: number, thingId: number): string {
  return join(THINGS_ROOT, String(userId), String(thingId));
}

/** Absolute paths are stored in the DB; this is only used when creating them. */
function sourcePathFor(userId: number, thingId: number, extension: string): string {
  return join(thingDirectory(userId, thingId), `source.${extension}`);
}

export function processedPathFor(userId: number, thingId: number): string {
  return join(thingDirectory(userId, thingId), 'processed.png');
}

function detectImage(filename: string): { extension: string; mimeType: string } {
  const extension = extname(filename).slice(1).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) {
    const err = new Error(
      `Unsupported image type '${extension || 'unknown'}'. Allowed: ${[...IMAGE_EXTENSIONS].join(', ')}`,
    );
    (err as { code?: string }).code = 'validation_failed';
    throw err;
  }
  return { extension, mimeType: MIME_BY_EXTENSION[extension] };
}

function shape(r: typeof myThings.$inferSelect): ThingRecord {
  return {
    id: r.id,
    user_id: r.user_id,
    name: r.name,
    description: r.description ?? '',
    category: r.category ?? '',
    status: r.status,
    stage: r.stage ?? '',
    progress: r.progress,
    blocked_reason: r.blocked_reason ?? '',
    has_source: Boolean(r.source_path),
    has_processed: Boolean(r.processed_path),
  };
}

// ============================================
// Folders — organizational only for now. A Thing's own tree, separate from
// document_folders: a captured object was never filed as a document. Later
// a folder is meant to render as a box in the virtual office; today it is
// just a grouping a user can move Things into and out of.
// ============================================

export type ThingEntryKind = 'parent' | 'folder' | 'thing';

export interface ThingListEntry {
  id: number | null;
  kind: ThingEntryKind;
  name: string;
  description: string;
  category: string;
  status: string;
  stage: string;
  progress: number | null;
  blockedReason: string;
  hasSource: boolean;
  hasProcessed: boolean;
  parentFolderId: number | null;
  /** Qwen3-VL's object-extraction result, from the `vision.qwen3vl_describe`
   *  job — see `jobQueue.ts#completeDescribeJob`. Absent until that job has
   *  run and produced a usable result. */
  mainObject: Record<string, unknown> | null;
  /** `kind: 'folder'` only — whether a box-art cover has been generated yet.
   *  See `folderCoverService.ts` / `folderCoverScheduler.ts`. */
  hasCover: boolean;
  /** `kind: 'folder'` only — changes whenever the cover is actually
   *  regenerated (it's the cover's own signature, not a general folder
   *  timestamp). The client uses it to know its cached image is stale and
   *  to bust local image caching that's otherwise keyed by a fixed path. */
  coverVersion: string | null;
}

function formatTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 16).replace('T', ' ');
}

function extractMainObject(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const mainObject = (metadata as Record<string, unknown>).mainObject;
  return mainObject && typeof mainObject === 'object' && !Array.isArray(mainObject)
    ? (mainObject as Record<string, unknown>)
    : null;
}

/** camelCase view of a `my_things` row, shared by the list, read and update
 *  entry points so a Thing looks the same wherever it is returned from. */
function shapeThingEntry(r: typeof myThings.$inferSelect): Omit<ThingListEntry, 'kind'> {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? '',
    category: r.category ?? '',
    status: r.status,
    stage: r.stage ?? '',
    progress: r.progress,
    blockedReason: r.blocked_reason ?? '',
    hasSource: Boolean(r.source_path),
    hasProcessed: Boolean(r.processed_path),
    parentFolderId: r.folder_id,
    mainObject: extractMainObject(r.metadata),
    hasCover: false,
    coverVersion: null,
  };
}

async function getThingFolderForUser(userId: number, folderId: number) {
  const [folder] = await db
    .select()
    .from(thingFolders)
    .where(and(eq(thingFolders.id, folderId), eq(thingFolders.user_id, userId)));
  return folder ?? null;
}

export async function getParentThingFolderId(params: {
  userId: number;
  folderId: number;
}): Promise<number | null> {
  const folder = await getThingFolderForUser(params.userId, params.folderId);
  if (!folder) throw new Error('Folder not found');
  return folder.parent_id;
}

export async function getThingBreadcrumbPath(params: {
  userId: number;
  folderId: number | null;
}): Promise<string> {
  if (params.folderId === null) return '/';

  const parts: string[] = [];
  let currentId: number | null = params.folderId;

  while (currentId !== null) {
    const folder = await getThingFolderForUser(params.userId, currentId);
    if (!folder) break;
    parts.unshift(folder.name);
    currentId = folder.parent_id;
  }

  return parts.length > 0 ? `/${parts.join('/')}` : '/';
}

/** Every folder the user owns, with its full path — for the "move to folder"
 *  picker, where walking the tree one level at a time would be unusable. */
export async function listThingFolderPaths(params: {
  userId: number;
}): Promise<Array<{ id: number; path: string }>> {
  const rows = await db
    .select({
      id: thingFolders.id,
      parent_id: thingFolders.parent_id,
      name: thingFolders.name,
    })
    .from(thingFolders)
    .where(eq(thingFolders.user_id, params.userId));

  const byId = new Map(rows.map((r) => [r.id, r]));

  function pathOf(id: number): string {
    const parts: string[] = [];
    const seen = new Set<number>(); // guards a parent_id cycle
    let current = byId.get(id);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      parts.unshift(current.name);
      current = current.parent_id === null ? undefined : byId.get(current.parent_id);
    }
    return `/${parts.join('/')}`;
  }

  return rows
    .map((r) => ({ id: r.id, path: pathOf(r.id) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function listThingFolderContents(params: {
  userId: number;
  folderId: number | null;
}): Promise<ThingListEntry[]> {
  const { userId, folderId } = params;
  const entries: ThingListEntry[] = [];

  if (folderId !== null) {
    const current = await getThingFolderForUser(userId, folderId);
    if (!current) throw new Error('Folder not found');

    entries.push({
      id: null,
      kind: 'parent',
      name: '..',
      description: '',
      category: '',
      status: '',
      stage: '',
      progress: null,
      blockedReason: '',
      hasSource: false,
      hasProcessed: false,
      parentFolderId: current.parent_id,
      mainObject: null,
      hasCover: false,
      coverVersion: null,
    });
  }

  const folderRows = await db
    .select()
    .from(thingFolders)
    .where(
      and(
        eq(thingFolders.user_id, userId),
        folderId === null ? isNull(thingFolders.parent_id) : eq(thingFolders.parent_id, folderId),
      ),
    )
    .orderBy(thingFolders.name);

  for (const folder of folderRows) {
    entries.push({
      id: folder.id,
      kind: 'folder',
      name: folder.name,
      description: '',
      category: '',
      status: '',
      stage: '',
      progress: null,
      blockedReason: '',
      hasSource: false,
      hasProcessed: false,
      parentFolderId: folder.parent_id,
      mainObject: null,
      hasCover: Boolean(folder.cover_path),
      coverVersion: folder.cover_signature,
    });
  }

  const thingCondition = folderId === null
    ? and(eq(myThings.user_id, userId), isNull(myThings.folder_id))
    : and(eq(myThings.user_id, userId), eq(myThings.folder_id, folderId));

  const thingRows = await db
    .select()
    .from(myThings)
    .where(thingCondition)
    .orderBy(desc(myThings.created_at));

  for (const thing of thingRows) {
    entries.push({ ...shapeThingEntry(thing), kind: 'thing' });
  }

  return entries;
}

export async function readThingEntry(params: {
  userId: number;
  kind: ThingEntryKind;
  id: number;
}): Promise<Record<string, unknown>> {
  if (params.kind === 'folder') {
    const folder = await getThingFolderForUser(params.userId, params.id);
    if (!folder) throw new Error('Folder not found');
    return {
      id: folder.id,
      kind: 'folder',
      name: folder.name,
      modifiedAt: formatTimestamp(folder.updated_at),
    };
  }

  const [thing] = await db
    .select()
    .from(myThings)
    .where(and(eq(myThings.id, params.id), eq(myThings.user_id, params.userId)));
  if (!thing) throw new Error('Thing not found');

  return { ...shapeThingEntry(thing), kind: 'thing' };
}

function validateFolderName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Folder name is required');
  if (/[\\/]/.test(trimmed)) throw new Error('Name cannot contain / or \\');
  return trimmed;
}

export async function createThingFolder(params: {
  userId: number;
  folderId: number | null;
  name: string;
}): Promise<Record<string, unknown>> {
  const trimmed = validateFolderName(params.name);

  if (params.folderId !== null) {
    const parent = await getThingFolderForUser(params.userId, params.folderId);
    if (!parent) throw new Error('Parent folder not found');
  }

  const [folder] = await db
    .insert(thingFolders)
    .values({ user_id: params.userId, parent_id: params.folderId, name: trimmed })
    .returning();

  return { id: folder.id, kind: 'folder', name: folder.name, modifiedAt: formatTimestamp(folder.updated_at) };
}

/**
 * Renames a folder, or updates a Thing's name/description/category and
 * (optionally) which folder it lives in — the single "move" operation, since
 * the CRUDTable engine only has one `update` slot per config.
 */
export async function updateThingEntry(params: {
  userId: number;
  kind: ThingEntryKind;
  id: number;
  name: string;
  description?: string | null;
  category?: string | null;
  /** undefined = leave alone, null = move to root, number = move into that folder. */
  folderId?: number | null;
}): Promise<Record<string, unknown>> {
  if (params.kind === 'parent') throw new Error('Cannot update parent navigation row');

  if (params.kind === 'folder') {
    const trimmed = validateFolderName(params.name);
    const [folder] = await db
      .update(thingFolders)
      .set({ name: trimmed, updated_at: sql`now()` })
      .where(and(eq(thingFolders.id, params.id), eq(thingFolders.user_id, params.userId)))
      .returning();
    if (!folder) throw new Error('Folder not found');
    return { id: folder.id, kind: 'folder', name: folder.name, modifiedAt: formatTimestamp(folder.updated_at) };
  }

  if (!params.name || params.name.trim() === '') throw new Error('Name is required');

  if (params.folderId !== undefined && params.folderId !== null) {
    const target = await getThingFolderForUser(params.userId, params.folderId);
    if (!target) throw new Error('Target folder not found');
  }

  // Needed only to know which folder(s) a move affects — the update itself
  // doesn't report the pre-move value.
  const [existing] = await db
    .select({ folder_id: myThings.folder_id })
    .from(myThings)
    .where(and(eq(myThings.id, params.id), eq(myThings.user_id, params.userId)));
  const oldFolderId = existing?.folder_id ?? null;

  const patch: Record<string, unknown> = {
    name: params.name.trim(),
    description: params.description ?? null,
    category: params.category ?? null,
    updated_at: new Date(),
  };
  if (params.folderId !== undefined) patch.folder_id = params.folderId;

  const [row] = await db
    .update(myThings)
    .set(patch)
    .where(and(eq(myThings.id, params.id), eq(myThings.user_id, params.userId)))
    .returning();
  if (!row) throw new Error('Thing not found or not owned by you');

  // A move affects both ends: the folder the thing left and the one it
  // landed in. Fire-and-forget, same as the delete path — don't make the
  // move wait on a cover rebuild.
  if (params.folderId !== undefined && params.folderId !== oldFolderId) {
    const affectedFolderIds = [oldFolderId, params.folderId].filter(
      (id): id is number => id !== null,
    );
    for (const folderId of affectedFolderIds) {
      void regenerateFolderCover({ folderId, userId: params.userId }).catch((err) => {
        console.error(`[folder-cover] regenerate after move failed for folder ${folderId}:`, err);
      });
    }
  }

  return { ...shapeThingEntry(row), kind: 'thing' };
}

async function thingFolderSubtreeIds(userId: number, folderId: number): Promise<number[]> {
  const ids = [folderId];
  const children = await db
    .select({ id: thingFolders.id })
    .from(thingFolders)
    .where(and(eq(thingFolders.user_id, userId), eq(thingFolders.parent_id, folderId)));
  for (const child of children) {
    ids.push(...(await thingFolderSubtreeIds(userId, child.id)));
  }
  return ids;
}

/** Deleting a folder never deletes the Things inside it — it refuses if the
 *  folder (or any subfolder) still holds any, so a capture is never lost to
 *  organizational cleanup. Move things out first. */
export async function deleteThingEntry(params: {
  userId: number;
  kind: ThingEntryKind;
  id: number;
}): Promise<void> {
  if (params.kind === 'parent') throw new Error('Cannot delete parent navigation row');

  if (params.kind === 'folder') {
    const ids = await thingFolderSubtreeIds(params.userId, params.id);
    const [holds] = await db
      .select({ id: myThings.id })
      .from(myThings)
      .where(and(eq(myThings.user_id, params.userId), inArray(myThings.folder_id, ids)))
      .limit(1);
    if (holds) throw new Error('Move the things out of this folder before deleting it');

    await db
      .delete(thingFolders)
      .where(and(eq(thingFolders.user_id, params.userId), inArray(thingFolders.id, ids)));
    return;
  }

  await deleteThing({ id: params.id, userId: params.userId });
}

// ============================================
// CRUD — used by the CRUDTable config, MCP and REST
// ============================================

export async function listActiveThings(userId: number): Promise<Record<string, unknown>[]> {
  const rows = await db
    .select()
    .from(myThings)
    .where(and(eq(myThings.user_id, userId), inArray(myThings.status, ['draft', 'processing'])))
    .orderBy(desc(myThings.created_at));

  return rows.map(shape) as unknown as Record<string, unknown>[];
}

export async function listThings(params: { userId: number }): Promise<Record<string, unknown>[]> {
  const rows = await db
    .select()
    .from(myThings)
    .where(eq(myThings.user_id, params.userId))
    .orderBy(desc(myThings.created_at));

  return rows.map(shape) as unknown as Record<string, unknown>[];
}

export async function readThing(
  params: { id: number; userId: number },
): Promise<Record<string, unknown> | null> {
  const [r] = await db
    .select()
    .from(myThings)
    .where(and(eq(myThings.id, params.id), eq(myThings.user_id, params.userId)));

  return r ? (shape(r) as unknown as Record<string, unknown>) : null;
}

export async function createThing(params: {
  userId: number;
  name: string;
  description: string | null;
  category: string | null;
}): Promise<Record<string, unknown>> {
  if (!params.name || params.name.trim() === '') {
    throw new Error('Name is required');
  }

  const [row] = await db
    .insert(myThings)
    .values({
      user_id: params.userId,
      name: params.name.trim(),
      description: params.description,
      category: params.category,
      status: 'draft',
    })
    .returning();

  return shape(row) as unknown as Record<string, unknown>;
}

export async function updateThing(params: {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  category: string | null;
}): Promise<Record<string, unknown>> {
  if (!params.name || params.name.trim() === '') {
    throw new Error('Name is required');
  }

  const [row] = await db
    .update(myThings)
    .set({
      name: params.name.trim(),
      description: params.description,
      category: params.category,
      updated_at: new Date(),
    })
    .where(and(eq(myThings.id, params.id), eq(myThings.user_id, params.userId)))
    .returning();

  if (!row) throw new Error('Thing not found or not owned by you');
  return shape(row) as unknown as Record<string, unknown>;
}

export async function deleteThing(params: { id: number; userId: number }): Promise<void> {
  const rows = await db
    .delete(myThings)
    .where(and(eq(myThings.id, params.id), eq(myThings.user_id, params.userId)))
    .returning({ id: myThings.id, folder_id: myThings.folder_id });

  if (rows.length === 0) throw new Error('Thing not found or not owned by you');

  // Files last: a failed unlink must not leave a row pointing at nothing.
  // thing_jobs rows go with the row itself via ON DELETE CASCADE.
  await rm(thingDirectory(params.userId, params.id), { recursive: true, force: true });

  // Don't make the delete wait on a cover rebuild — the folder's item set
  // just changed, so the next check will see a different signature and
  // regenerate; this just does it immediately instead of on the next
  // scheduler tick (up to 5 minutes later).
  const folderId = rows[0].folder_id;
  if (folderId !== null) {
    void regenerateFolderCover({ folderId, userId: params.userId }).catch((err) => {
      console.error(`[folder-cover] regenerate after delete failed for folder ${folderId}:`, err);
    });
  }
}

// ============================================
// Upload — create a Thing from a captured photo
// ============================================

export async function createThingFromUpload(params: {
  userId: number;
  name: string;
  description: string | null;
  category: string | null;
  /** Folder to file the new Thing in, chosen on the phone before upload. */
  folderId?: number | null;
  originalFilename: string;
  buffer: Buffer;
}): Promise<{ id: number; name: string; status: string }> {
  const { extension, mimeType } = detectImage(params.originalFilename);

  if (params.folderId != null) {
    const folder = await getThingFolderForUser(params.userId, params.folderId);
    if (!folder) {
      const err = new Error('Folder not found');
      (err as { code?: string }).code = 'validation_failed';
      throw err;
    }
  }

  // The row is inserted first because the storage path contains the id —
  // the Thing is what owns the directory, not the other way round.
  const [row] = await db
    .insert(myThings)
    .values({
      user_id: params.userId,
      folder_id: params.folderId ?? null,
      name: params.name.trim() || 'Untitled',
      description: params.description,
      category: params.category,
      status: 'draft',
      source_mime: mimeType,
    })
    .returning();

  const absolutePath = sourcePathFor(params.userId, row.id, extension);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, params.buffer);

  const [updated] = await db
    .update(myThings)
    .set({ source_path: absolutePath, updated_at: new Date() })
    .where(eq(myThings.id, row.id))
    .returning();

  return { id: updated.id, name: updated.name, status: updated.status };
}

// ============================================
// Status — written by the job queue, read by the phone
// ============================================

export async function setThingStatus(params: {
  thingId: number;
  status?: ThingStatus;
  stage?: string | null;
  progress?: number | null;
  blockedReason?: string | null;
}): Promise<void> {
  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (params.status !== undefined) patch.status = params.status;
  if (params.stage !== undefined) patch.stage = params.stage;
  if (params.progress !== undefined) patch.progress = params.progress;
  if (params.blockedReason !== undefined) patch.blocked_reason = params.blockedReason;

  await db.update(myThings).set(patch).where(eq(myThings.id, params.thingId));
}

export async function setThingProcessedImage(params: {
  thingId: number;
  userId: number;
  buffer: Buffer;
  width: number | null;
  height: number | null;
}): Promise<void> {
  const absolutePath = processedPathFor(params.userId, params.thingId);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, params.buffer);

  await db
    .update(myThings)
    .set({
      processed_path: absolutePath,
      processed_mime: 'image/png',
      processed_width: params.width,
      processed_height: params.height,
      status: 'ready',
      stage: null,
      progress: 100,
      blocked_reason: null,
      updated_at: new Date(),
    })
    .where(eq(myThings.id, params.thingId));
}

/**
 * Merge object-extraction results into a Thing's metadata. Deliberately the
 * only thing this touches — status/stage/progress belong to the sprite job's
 * lifecycle, not the description job's, so a description rerun never makes a
 * `ready` Thing look busy again.
 */
export async function setThingMetadata(params: {
  thingId: number;
  metadata: Record<string, unknown>;
}): Promise<void> {
  await db
    .update(myThings)
    .set({ metadata: params.metadata, updated_at: new Date() })
    .where(eq(myThings.id, params.thingId));
}

/** Raw row including absolute file paths — for the byte-serving routes only. */
export async function getThingRow(params: {
  id: number;
  userId: number;
}): Promise<typeof myThings.$inferSelect | null> {
  const [r] = await db
    .select()
    .from(myThings)
    .where(and(eq(myThings.id, params.id), eq(myThings.user_id, params.userId)));
  return r ?? null;
}
