import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { mkdir, rm, writeFile } from 'fs/promises';
import { dirname, extname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { db } from '../../core/db/index.js';
import { documentFolders, documentItems } from '../db/schema.js';

const DOCS_API_URL = (process.env.DOCS_API_URL ?? '').replace(/\/$/, '');
const DOCS_INGEST_KEY = process.env.DOCS_INGEST_KEY ?? '';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DOCUMENTS_ROOT = join(__dirname, '../../../data/documents');

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg']);
const PDF_EXTENSIONS = new Set(['pdf']);

export type DocumentEntryKind = 'parent' | 'folder' | 'file';

export interface DocumentListEntry {
  id: number | null;
  kind: DocumentEntryKind;
  name: string;
  description: string;
  entryType: string;
  fileType: string;
  sizeBytes: number | null;
  modifiedAt: string;
  parentFolderId: number | null;
}

export interface DetectedFileType {
  fileType: string;
  extension: string;
  mimeType: string;
}

export function detectFileType(filename: string): DetectedFileType {
  const extension = extname(filename).slice(1).toLowerCase();
  if (PDF_EXTENSIONS.has(extension)) {
    return { fileType: 'pdf', extension, mimeType: 'application/pdf' };
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    const mimeType = extension === 'jpg' || extension === 'jpeg'
      ? 'image/jpeg'
      : extension === 'svg'
        ? 'image/svg+xml'
        : `image/${extension === 'jpg' ? 'jpeg' : extension}`;
    return { fileType: 'image', extension, mimeType };
  }
  return {
    fileType: 'other',
    extension,
    mimeType: 'application/octet-stream',
  };
}

export function isAllowedUpload(filename: string): boolean {
  const { fileType } = detectFileType(filename);
  return fileType === 'pdf' || fileType === 'image';
}

function formatTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 16).replace('T', ' ');
}

async function getFolderForUser(userId: number, folderId: number) {
  const [folder] = await db
    .select()
    .from(documentFolders)
    .where(and(eq(documentFolders.id, folderId), eq(documentFolders.user_id, userId)));
  return folder ?? null;
}

async function buildBreadcrumb(userId: number, folderId: number | null): Promise<string> {
  if (folderId === null) return '/';

  const parts: string[] = [];
  let currentId: number | null = folderId;

  while (currentId !== null) {
    const folder = await getFolderForUser(userId, currentId);
    if (!folder) break;
    parts.unshift(folder.name);
    currentId = folder.parent_id;
  }

  return parts.length > 0 ? `/${parts.join('/')}` : '/';
}

export async function getBreadcrumbPath(params: {
  userId: number;
  folderId: number | null;
}): Promise<string> {
  return buildBreadcrumb(params.userId, params.folderId);
}

export async function getParentFolderId(params: {
  userId: number;
  folderId: number;
}): Promise<number | null> {
  const folder = await getFolderForUser(params.userId, params.folderId);
  if (!folder) throw new Error('Folder not found');
  return folder.parent_id;
}

export async function listFolderContents(params: {
  userId: number;
  folderId: number | null;
}): Promise<DocumentListEntry[]> {
  const { userId, folderId } = params;
  const entries: DocumentListEntry[] = [];

  if (folderId !== null) {
    const currentFolder = await getFolderForUser(userId, folderId);
    if (!currentFolder) {
      throw new Error('Folder not found');
    }

    entries.push({
      id: null,
      kind: 'parent',
      name: '..',
      description: '',
      entryType: 'Parent',
      fileType: '',
      sizeBytes: null,
      modifiedAt: '',
      parentFolderId: currentFolder.parent_id,
    });
  }

  const folderRows = await db
    .select()
    .from(documentFolders)
    .where(
      and(
        eq(documentFolders.user_id, userId),
        folderId === null
          ? isNull(documentFolders.parent_id)
          : eq(documentFolders.parent_id, folderId),
      ),
    )
    .orderBy(documentFolders.name);

  for (const folder of folderRows) {
    entries.push({
      id: folder.id,
      kind: 'folder',
      name: folder.name,
      description: folder.description ?? '',
      entryType: 'Folder',
      fileType: '',
      sizeBytes: null,
      modifiedAt: formatTimestamp(folder.updated_at),
      parentFolderId: folder.parent_id,
    });
  }

  const itemCondition = folderId === null
    ? and(eq(documentItems.user_id, userId), isNull(documentItems.folder_id))
    : and(eq(documentItems.user_id, userId), eq(documentItems.folder_id, folderId));

  const itemRows = await db
    .select()
    .from(documentItems)
    .where(itemCondition)
    .orderBy(documentItems.name);

  for (const item of itemRows) {
    entries.push({
      id: item.id,
      kind: 'file',
      name: item.name,
      description: item.description ?? '',
      entryType: item.file_type.toUpperCase(),
      fileType: item.file_type,
      sizeBytes: item.size_bytes,
      modifiedAt: formatTimestamp(item.updated_at),
      parentFolderId: item.folder_id,
    });
  }

  return entries;
}

export async function readDocumentEntry(params: {
  userId: number;
  kind: DocumentEntryKind;
  id: number;
}): Promise<Record<string, unknown>> {
  if (params.kind === 'folder') {
    const folder = await getFolderForUser(params.userId, params.id);
    if (!folder) throw new Error('Folder not found');
    return {
      id: folder.id,
      kind: 'folder',
      name: folder.name,
      description: folder.description ?? '',
      entryType: 'Folder',
      fileType: '',
      sizeBytes: null,
      modifiedAt: formatTimestamp(folder.updated_at),
    };
  }

  const [item] = await db
    .select()
    .from(documentItems)
    .where(and(eq(documentItems.id, params.id), eq(documentItems.user_id, params.userId)));

  if (!item) throw new Error('File not found');

  return {
    id: item.id,
    kind: 'file',
    name: item.name,
    description: item.description ?? '',
    entryType: item.file_type.toUpperCase(),
    fileType: item.file_type,
    sizeBytes: item.size_bytes,
    modifiedAt: formatTimestamp(item.updated_at),
  };
}

export async function createFolder(params: {
  userId: number;
  folderId: number | null;
  name: string;
}): Promise<Record<string, unknown>> {
  const trimmed = params.name.trim();
  if (!trimmed) throw new Error('Folder name is required');

  if (params.folderId !== null) {
    const parent = await getFolderForUser(params.userId, params.folderId);
    if (!parent) throw new Error('Parent folder not found');
  }

  const [folder] = await db
    .insert(documentFolders)
    .values({
      user_id: params.userId,
      parent_id: params.folderId,
      name: trimmed,
    })
    .returning();

  refreshFolderEmbedding(folder.id, params.userId).catch(() => {});

  return {
    id: folder.id,
    kind: 'folder',
    name: folder.name,
    entryType: 'Folder',
    fileType: '',
    sizeBytes: null,
    modifiedAt: formatTimestamp(folder.updated_at),
  };
}

function validateEntryName(name: string, entryKind: 'folder' | 'file'): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error(entryKind === 'folder' ? 'Folder name is required' : 'File name is required');
  }
  if (/[\\/]/.test(trimmed)) {
    throw new Error('Name cannot contain / or \\');
  }
  return trimmed;
}

function normalizeDescription(description: string | null | undefined): string | null {
  const trimmed = description?.trim() ?? '';
  return trimmed || null;
}

async function assertUniqueFileNameInFolder(params: {
  userId: number;
  folderId: number | null;
  name: string;
  excludeItemId?: number;
}): Promise<void> {
  const folderCondition = params.folderId === null
    ? isNull(documentItems.folder_id)
    : eq(documentItems.folder_id, params.folderId);

  const conditions = [
    eq(documentItems.user_id, params.userId),
    eq(documentItems.name, params.name),
    folderCondition,
  ];
  if (params.excludeItemId !== undefined) {
    conditions.push(ne(documentItems.id, params.excludeItemId));
  }

  const [existing] = await db
    .select({ id: documentItems.id })
    .from(documentItems)
    .where(and(...conditions))
    .limit(1);

  if (existing) {
    throw new Error('A file with this name already exists in this folder');
  }
}

export async function renameDocumentEntry(params: {
  userId: number;
  kind: DocumentEntryKind;
  id: number;
  name: string;
  description?: string | null;
}): Promise<Record<string, unknown>> {
  if (params.kind === 'parent') {
    throw new Error('Cannot rename parent navigation row');
  }

  const description = normalizeDescription(params.description);

  if (params.kind === 'folder') {
    const trimmed = validateEntryName(params.name, 'folder');

    const [folder] = await db
      .update(documentFolders)
      .set({ name: trimmed, description, updated_at: sql`now()` })
      .where(and(eq(documentFolders.id, params.id), eq(documentFolders.user_id, params.userId)))
      .returning();

    if (!folder) throw new Error('Folder not found');

    refreshFolderEmbedding(folder.id, params.userId).catch(() => {});

    return {
      id: folder.id,
      kind: 'folder',
      name: folder.name,
      description: folder.description ?? '',
      entryType: 'Folder',
      fileType: '',
      sizeBytes: null,
      modifiedAt: formatTimestamp(folder.updated_at),
    };
  }

  const trimmed = validateEntryName(params.name, 'file');

  const [existing] = await db
    .select()
    .from(documentItems)
    .where(and(eq(documentItems.id, params.id), eq(documentItems.user_id, params.userId)));

  if (!existing) throw new Error('File not found');

  await assertUniqueFileNameInFolder({
    userId: params.userId,
    folderId: existing.folder_id,
    name: trimmed,
    excludeItemId: params.id,
  });

  const [item] = await db
    .update(documentItems)
    .set({ name: trimmed, description, updated_at: sql`now()` })
    .where(and(eq(documentItems.id, params.id), eq(documentItems.user_id, params.userId)))
    .returning();

  return {
    id: item.id,
    kind: 'file',
    name: item.name,
    description: item.description ?? '',
    entryType: item.file_type.toUpperCase(),
    fileType: item.file_type,
    sizeBytes: item.size_bytes,
    modifiedAt: formatTimestamp(item.updated_at),
  };
}

async function deleteFolderRecursive(userId: number, folderId: number): Promise<void> {
  const childFolders = await db
    .select({ id: documentFolders.id })
    .from(documentFolders)
    .where(and(eq(documentFolders.user_id, userId), eq(documentFolders.parent_id, folderId)));

  for (const child of childFolders) {
    await deleteFolderRecursive(userId, child.id);
  }

  const items = await db
    .select()
    .from(documentItems)
    .where(and(eq(documentItems.user_id, userId), eq(documentItems.folder_id, folderId)));

  for (const item of items) {
    await rm(item.storage_path, { force: true });
    await db.delete(documentItems).where(eq(documentItems.id, item.id));
  }

  await db
    .delete(documentFolders)
    .where(and(eq(documentFolders.id, folderId), eq(documentFolders.user_id, userId)));
}

export async function deleteDocumentEntry(params: {
  userId: number;
  kind: DocumentEntryKind;
  id: number;
}): Promise<void> {
  if (params.kind === 'parent') {
    throw new Error('Cannot delete parent navigation row');
  }

  if (params.kind === 'folder') {
    await deleteFolderRecursive(params.userId, params.id);
    return;
  }

  const [item] = await db
    .select()
    .from(documentItems)
    .where(and(eq(documentItems.id, params.id), eq(documentItems.user_id, params.userId)));

  if (!item) throw new Error('File not found');

  await rm(item.storage_path, { force: true });
  await db.delete(documentItems).where(eq(documentItems.id, item.id));
}

function userStorageDir(userId: number): string {
  return join(DOCUMENTS_ROOT, String(userId));
}

export async function saveUploadedFile(params: {
  userId: number;
  folderId: number | null;
  originalFilename: string;
  buffer: Buffer;
}): Promise<Record<string, unknown>> {
  if (!isAllowedUpload(params.originalFilename)) {
    throw new Error('Only PDF and image files are supported');
  }

  if (params.folderId !== null) {
    const parent = await getFolderForUser(params.userId, params.folderId);
    if (!parent) throw new Error('Folder not found');
  }

  const detected = detectFileType(params.originalFilename);
  const baseName = params.originalFilename.replace(/\.[^.]+$/, '').trim() || 'document';

  await assertUniqueFileNameInFolder({
    userId: params.userId,
    folderId: params.folderId,
    name: baseName,
  });

  const safeBase = baseName.replace(/[^\w.-]+/g, '_').slice(0, 80);
  const storageFileName = `${randomUUID()}-${safeBase}.${detected.extension || 'bin'}`;
  const relativePath = join(String(params.userId), storageFileName);
  const absolutePath = join(DOCUMENTS_ROOT, relativePath);

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, params.buffer);

  const [item] = await db
    .insert(documentItems)
    .values({
      user_id: params.userId,
      folder_id: params.folderId,
      name: baseName,
      file_type: detected.fileType,
      mime_type: detected.mimeType,
      extension: detected.extension,
      storage_path: absolutePath,
      original_filename: params.originalFilename,
      size_bytes: params.buffer.length,
    })
    .returning();

  if (detected.fileType === 'pdf' || detected.fileType === 'image') {
    enqueueIngest({ documentItemId: item.id, userId: params.userId }).catch(() => {});
  }

  return {
    id: item.id,
    kind: 'file',
    name: item.name,
    entryType: item.file_type.toUpperCase(),
    fileType: item.file_type,
    sizeBytes: item.size_bytes,
    modifiedAt: formatTimestamp(item.updated_at),
  };
}

/**
 * Fire-and-forget: ask as500-docs to regenerate ai_summary_embedding for a folder.
 * Called after createFolder and renameDocumentEntry so knowledge_find_nodes can
 * route to the folder before any documents are ingested into it.
 * No-op when DOCS_API_URL is not configured.
 */
async function refreshFolderEmbedding(folderId: number, userId: number): Promise<void> {
  if (!DOCS_API_URL) return;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (DOCS_INGEST_KEY) headers['X-Docs-Ingest-Key'] = DOCS_INGEST_KEY;

  const res = await fetch(`${DOCS_API_URL}/folders/refresh-embedding`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ folder_id: folderId, user_id: userId }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`as500-docs /folders/refresh-embedding returned ${res.status}: ${text}`);
  }
}

/**
 * Enqueue a document_items file for ingestion by as500-docs worker.
 * Sets ingest_status to 'processing' on success, leaves 'pending' on failure.
 * No-op when DOCS_API_URL is not configured.
 */
export async function enqueueIngest(params: {
  documentItemId: number;
  userId: number;
}): Promise<void> {
  if (!DOCS_API_URL) return;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (DOCS_INGEST_KEY) headers['X-Docs-Ingest-Key'] = DOCS_INGEST_KEY;

  const res = await fetch(`${DOCS_API_URL}/ingest`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ document_item_id: params.documentItemId, user_id: params.userId }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`as500-docs /ingest returned ${res.status}: ${text}`);
  }

  await db
    .update(documentItems)
    .set({ ingest_status: 'processing', updated_at: sql`now()` })
    .where(eq(documentItems.id, params.documentItemId));
}
