import { and, eq, isNull, sql } from 'drizzle-orm';
import { mkdir, rm, writeFile } from 'fs/promises';
import { dirname, extname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { db } from '../../core/db/index.js';
import { documentFolders, documentItems } from '../db/schema.js';

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

export async function updateFolder(params: {
  userId: number;
  kind: DocumentEntryKind;
  id: number;
  name: string;
}): Promise<Record<string, unknown>> {
  if (params.kind !== 'folder') {
    throw new Error('Only folders can be renamed');
  }

  const trimmed = params.name.trim();
  if (!trimmed) throw new Error('Folder name is required');

  const [folder] = await db
    .update(documentFolders)
    .set({ name: trimmed, updated_at: sql`now()` })
    .where(and(eq(documentFolders.id, params.id), eq(documentFolders.user_id, params.userId)))
    .returning();

  if (!folder) throw new Error('Folder not found');

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
