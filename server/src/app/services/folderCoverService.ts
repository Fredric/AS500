// Thing folder "box art": a deterministic composite of up to 9 of the
// folder's own thing sprites scattered over the same steel-pegboard texture
// already used behind a single Thing's sprite on its detail screen (see
// AS500-mobile's src/components/Pegboard.tsx — colors and dot pitch here are
// copied from it exactly).
//
// Deliberately not AI-generated: an earlier version asked Qwen Image to
// "place these items in a box," and being a generative model rather than a
// compositor, it duplicated items and invented ones that were never in the
// input. Real code placing the real sprite PNGs guarantees every item shown
// is a real item, exactly once — the only thing this feature actually needs.
//
// Cover files live under server/data/thing_folders/{userId}/{folderId}/,
// mirroring things' own server/data/things/{userId}/{thingId}/ tree.

import { createHash } from 'crypto';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import sharp from 'sharp';
import { db } from '../../core/db/index.js';
import { myThings, thingFolders } from '../db/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FOLDERS_ROOT = join(__dirname, '../../../data/thing_folders');

/** How many of a folder's most-recently-updated things get scattered onto
 *  its cover. Direct children only — a subfolder's things do not bubble up. */
const MAX_ITEMS = 9;

const CANVAS_SIZE = 800;
const PEGBOARD_FILL = '#D6D4CF';
const PEGBOARD_DOT = '#ADA9A1';
const PEGBOARD_PITCH = 20;
const PEGBOARD_DOT_RADIUS = 1.8;

export function folderCoverDirectory(userId: number, folderId: number): string {
  return join(FOLDERS_ROOT, String(userId), String(folderId));
}

export function coverPathFor(userId: number, folderId: number): string {
  return join(folderCoverDirectory(userId, folderId), 'cover.png');
}

export interface FolderCoverItem {
  id: number;
  processedPath: string;
  updatedAt: Date;
}

/**
 * The up to `MAX_ITEMS` things that make up a folder's cover: direct
 * children only, most recently updated first, and only ones that actually
 * have a sprite yet — a Thing still generating its own sprite isn't ready to
 * show up on the pegboard.
 */
export async function selectRecentThingsForFolder(folderId: number): Promise<FolderCoverItem[]> {
  const rows = await db
    .select({ id: myThings.id, processed_path: myThings.processed_path, updated_at: myThings.updated_at })
    .from(myThings)
    .where(and(eq(myThings.folder_id, folderId), isNotNull(myThings.processed_path)))
    .orderBy(desc(myThings.updated_at))
    .limit(MAX_ITEMS);

  return rows.map((r) => ({
    id: r.id,
    processedPath: r.processed_path as string,
    updatedAt: r.updated_at,
  }));
}

/** Fingerprint of exactly which things (and which version of each) a cover
 *  was or would be built from. A changed folder — a thing added, removed, or
 *  re-generated — changes this, which is how the scheduler detects "stale"
 *  without a separate change-tracking table. */
export function computeFolderCoverSignature(items: FolderCoverItem[]): string {
  const basis = items.map((i) => `${i.id}:${i.updatedAt.getTime()}`).join(',');
  return createHash('sha256').update(basis).digest('hex');
}

export interface FolderCoverRow {
  id: number;
  user_id: number;
  name: string;
  cover_path: string | null;
  cover_mime: string | null;
  cover_signature: string | null;
}

export async function getFolderCoverRow(folderId: number): Promise<FolderCoverRow | null> {
  const [row] = await db
    .select({
      id: thingFolders.id,
      user_id: thingFolders.user_id,
      name: thingFolders.name,
      cover_path: thingFolders.cover_path,
      cover_mime: thingFolders.cover_mime,
      cover_signature: thingFolders.cover_signature,
    })
    .from(thingFolders)
    .where(eq(thingFolders.id, folderId));
  return row ?? null;
}

async function setFolderCover(params: {
  folderId: number;
  userId: number;
  buffer: Buffer;
  width: number;
  height: number;
  signature: string;
}): Promise<void> {
  const absolutePath = coverPathFor(params.userId, params.folderId);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, params.buffer);

  await db
    .update(thingFolders)
    .set({
      cover_path: absolutePath,
      cover_mime: 'image/png',
      cover_width: params.width,
      cover_height: params.height,
      cover_signature: params.signature,
      updated_at: new Date(),
    })
    .where(eq(thingFolders.id, params.folderId));
}

function pegboardSvg(size: number): Buffer {
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="dots" width="${PEGBOARD_PITCH}" height="${PEGBOARD_PITCH}" patternUnits="userSpaceOnUse">
          <circle cx="${PEGBOARD_PITCH / 2}" cy="${PEGBOARD_PITCH / 2}" r="${PEGBOARD_DOT_RADIUS}" fill="${PEGBOARD_DOT}" />
        </pattern>
      </defs>
      <rect width="${size}" height="${size}" fill="${PEGBOARD_FILL}" />
      <rect width="${size}" height="${size}" fill="url(#dots)" />
    </svg>`,
  );
}

/** mulberry32 — tiny deterministic PRNG. Seeded by folder id so a given
 *  folder's cluster layout stays put across regenerations (the items inside
 *  it are what should change, not the arrangement), while different folders
 *  don't all land in an identical pattern. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Nine loose cluster slots across the canvas — not a tidy grid, so it reads
 *  as items scattered on a pegboard rather than a spec sheet. Earlier slots
 *  are larger: the most-recently-updated things (slot 0, 1, …) read as the
 *  most prominent. Sized to fill most of the canvas and overlap a little —
 *  every sprite has a real transparent background, so overlap costs nothing
 *  visually and items staying legibly large matters more than keeping them
 *  fully apart. */
const SLOTS: Array<{ cx: number; cy: number; size: number }> = [
  { cx: 260, cy: 260, size: 340 },
  { cx: 560, cy: 220, size: 380 },
  { cx: 230, cy: 570, size: 320 },
  { cx: 580, cy: 580, size: 330 },
  { cx: 400, cy: 400, size: 300 },
  { cx: 130, cy: 400, size: 270 },
  { cx: 670, cy: 400, size: 270 },
  { cx: 400, cy: 170, size: 250 },
  { cx: 400, cy: 640, size: 250 },
];

async function compositeSprites(items: FolderCoverItem[], folderId: number): Promise<Buffer> {
  const rand = mulberry32(folderId);
  const overlays: Array<{ input: Buffer; left: number; top: number }> = [];

  for (let i = 0; i < items.length && i < SLOTS.length; i++) {
    const slot = SLOTS[i];
    const jitterX = Math.round((rand() - 0.5) * 30);
    const jitterY = Math.round((rand() - 0.5) * 30);
    const rotation = Math.round((rand() - 0.5) * 20); // +/-10 degrees

    const raw = await readFile(items[i].processedPath);
    // Sprites render with generous transparent padding around the object
    // itself (room for the isometric rotation), so without trimming that
    // padding first, "resize to fit the slot" mostly resizes empty space —
    // trim to the real content bounds, then the object itself fills the slot.
    const rotated = await sharp(raw)
      .ensureAlpha()
      .trim({ threshold: 10 })
      .resize(slot.size, slot.size, { fit: 'inside', withoutEnlargement: false })
      .rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer({ resolveWithObject: true });

    const { data, info } = rotated;
    const left = Math.round(slot.cx + jitterX - info.width / 2);
    const top = Math.round(slot.cy + jitterY - info.height / 2);
    overlays.push({ input: data, left: Math.max(0, left), top: Math.max(0, top) });
  }

  return sharp(pegboardSvg(CANVAS_SIZE))
    .composite(overlays)
    .png()
    .toBuffer();
}

/**
 * Rebuilds a folder's cover if its contents changed since the last one (or
 * always, with `force: true` — the admin "Regenerate now" action). No GPU,
 * no queue: compositing real PNGs is cheap enough to run synchronously,
 * whether called from the scheduler tick or on demand.
 *
 * Returns whether it actually regenerated anything.
 */
export async function regenerateFolderCover(params: {
  folderId: number;
  userId: number;
  force?: boolean;
}): Promise<boolean> {
  const items = await selectRecentThingsForFolder(params.folderId);

  if (items.length === 0) {
    // The folder had a cover and just lost its last (sprite-bearing) thing —
    // e.g. the thing was moved out or deleted. Without this, the stale
    // cover file/row just sits there forever: nothing else ever re-checks a
    // folder once it has zero qualifying things, since selectRecentThings
    // returning empty short-circuited every future call the same way.
    const current = await getFolderCoverRow(params.folderId);
    if (current?.cover_path) {
      await rm(current.cover_path, { force: true });
      await db
        .update(thingFolders)
        .set({ cover_path: null, cover_mime: null, cover_width: null, cover_height: null, cover_signature: null })
        .where(eq(thingFolders.id, params.folderId));
      return true;
    }
    return false;
  }

  const signature = computeFolderCoverSignature(items);

  if (!params.force) {
    const current = await getFolderCoverRow(params.folderId);
    if (current?.cover_signature === signature) return false;
  }

  const buffer = await compositeSprites(items, params.folderId);
  const meta = await sharp(buffer).metadata();

  await setFolderCover({
    folderId: params.folderId,
    userId: params.userId,
    buffer,
    width: meta.width ?? CANVAS_SIZE,
    height: meta.height ?? CANVAS_SIZE,
    signature,
  });

  return true;
}
