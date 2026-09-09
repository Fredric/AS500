/**
 * Per-type vertical extent, in the same room units `layout.ts`'s `FOOTPRINT`
 * already uses for width/depth — the 3D view reuses `layoutThings()`
 * verbatim for X/Z placement, this is only the missing third dimension.
 */
const HEIGHT_FOR_TYPE: Record<string, number> = {
  desk: 0.9,
  workstation: 1.2,
  cabinet: 1.8,
  drawer: 0.9,
  shelf: 1.8,
  bookshelf: 1.9,
  rack: 2.0,
  box: 0.8,
  board: 1.4,
  postit: 0.05,
  album: 0.3,
  door: 2.1,
  plant: 1.1,
};

export function heightFor(type: string): number {
  return HEIGHT_FOR_TYPE[type] ?? 1.0;
}

/**
 * A real model per type is a later increment, not this pass (primitives now,
 * per the plan) — this lookup exists so that swap touches one table, not
 * `ThingMesh.tsx`'s structure. `null` for every type today means "draw the
 * primitive box".
 */
export const MODEL_FOR_TYPE: Record<string, string | null> = {};
