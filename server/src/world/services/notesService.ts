/**
 * Notes service — the payload behind a `type: 'postit'`/`'board'` thing.
 *
 * Unlike `worldService.ts` (placement only, never touches bound data), this
 * module owns real data: one `world_notes` row per thing. It is still reached
 * the same way every other AS500 data lives — a plain service behind a
 * registered `CRUDTableConfig` (`notesConfig.ts`) — so `resolver.ts` can read
 * it through `getConfig()` exactly like a bound `crud` binding, and MCP/REST
 * get it for free.
 */

import { eq } from 'drizzle-orm';
import { db } from '../../core/db/index.js';
import { worldNotes } from '../db/schema.js';

function toRow(r: typeof worldNotes.$inferSelect): Record<string, unknown> {
  return {
    id: r.id,
    thingId: r.thing_id,
    body: r.body,
    color: r.color,
    updatedAt: r.updated_at.toISOString(),
  };
}

/** Scoped by thingId, like `documentService.listFolderContents` is by folderId — 0 or 1 row. */
export async function listNotes(p: { thingId: number }): Promise<Record<string, unknown>[]> {
  const rows = await db.select().from(worldNotes).where(eq(worldNotes.thing_id, p.thingId));
  return rows.map(toRow);
}

export async function readNote(p: { thingId: number }): Promise<Record<string, unknown> | null> {
  const [r] = await db.select().from(worldNotes).where(eq(worldNotes.thing_id, p.thingId));
  return r ? toRow(r) : null;
}

export interface NoteWriteParams {
  userId: number;
  thingId: number;
  body: string;
  color?: string;
}

const COLORS = ['yellow', 'pink', 'blue', 'green'];

function normaliseColor(c: string | undefined): string {
  const v = (c ?? '').trim().toLowerCase();
  return COLORS.includes(v) ? v : 'yellow';
}

export async function createNote(p: NoteWriteParams): Promise<Record<string, unknown>> {
  const [row] = await db
    .insert(worldNotes)
    .values({
      thing_id: p.thingId,
      body: p.body ?? '',
      color: normaliseColor(p.color),
      updated_by_user_id: p.userId,
    })
    .returning();
  return toRow(row);
}

/** Upserts by thingId — a graphical edit on a never-written postit has no row to update yet. */
export async function updateNote(p: NoteWriteParams): Promise<Record<string, unknown>> {
  const existing = await readNote({ thingId: p.thingId });
  if (!existing) return createNote(p);

  const [row] = await db
    .update(worldNotes)
    .set({ body: p.body ?? '', color: normaliseColor(p.color), updated_by_user_id: p.userId, updated_at: new Date() })
    .where(eq(worldNotes.thing_id, p.thingId))
    .returning();
  return toRow(row);
}
