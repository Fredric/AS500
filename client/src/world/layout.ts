/**
 * Floorplan layout.
 *
 * `transform` on a thing is a renderer *hint*, and most objects will not have
 * one — nobody wants to type coordinates into a green screen to put a desk in a
 * room. So anything without a transform is auto-placed: grouped by `zone`, laid
 * out in rows within that zone's band. Placing an object is therefore a
 * one-field operation (`zone: north_east`) and it still lands somewhere sensible.
 *
 * The server never sees any of this. Position is presentation.
 */

import type { ResolvedThing } from './types';

export const ROOM_W = 24;
export const ROOM_H = 16;

export interface Placed {
  thing: ResolvedThing;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Rough footprint per object type, in room units. */
const FOOTPRINT: Record<string, [number, number]> = {
  desk: [4, 2.4],
  workstation: [2, 1.6],
  cabinet: [2.8, 3],
  drawer: [2, 1.2],
  shelf: [4, 1.2],
  rack: [2.8, 3.2],
  box: [1.6, 1.6],
  board: [4.4, 1],
  postit: [1, 1],
  album: [1.6, 1.2],
  door: [2, 0.6],
  plant: [1.2, 1.2],
};

function footprint(type: string): [number, number] {
  return FOOTPRINT[type] ?? [2, 1.6];
}

/** Anchor point for each named zone, as a fraction of the room. */
const ZONE_ANCHORS: Record<string, [number, number]> = {
  north_west: [0.06, 0.10], north: [0.38, 0.10], north_east: [0.68, 0.10],
  west:       [0.06, 0.42], centre: [0.38, 0.42], center: [0.38, 0.42],
  east:       [0.68, 0.42],
  south_west: [0.06, 0.74], south: [0.38, 0.74], south_east: [0.68, 0.74],
  server_room: [0.68, 0.74],
};

function anchorFor(zone: string | null, index: number): [number, number] {
  if (zone && ZONE_ANCHORS[zone]) return ZONE_ANCHORS[zone];
  // Unzoned objects get a stable band of their own rather than piling on 0,0.
  const anchors = Object.values(ZONE_ANCHORS);
  return anchors[index % anchors.length];
}

/**
 * Place the top level of a space. Children are not placed — they are shown
 * inside their parent's panel, because the furniture tree is containment, not
 * a second floor.
 */
export function layoutThings(things: ResolvedThing[]): Placed[] {
  const byZone = new Map<string, ResolvedThing[]>();
  for (const t of things) {
    const key = t.zone ?? '';
    const list = byZone.get(key);
    if (list) list.push(t);
    else byZone.set(key, [t]);
  }

  const placed: Placed[] = [];
  let zoneIndex = 0;

  for (const [zone, group] of byZone) {
    const [ax, ay] = anchorFor(zone || null, zoneIndex);
    zoneIndex += 1;

    let cursorX = ax * ROOM_W;
    let cursorY = ay * ROOM_H;
    let rowHeight = 0;
    const bandRight = Math.min(ROOM_W - 0.5, ax * ROOM_W + ROOM_W * 0.26);

    for (const thing of group) {
      const [w, h] = footprint(thing.type);

      // An explicit transform always wins — that is the whole point of the hint.
      if (thing.transform && Number.isFinite(thing.transform.x) && Number.isFinite(thing.transform.y)) {
        placed.push({ thing, x: clamp(thing.transform.x, 0, ROOM_W - w), y: clamp(thing.transform.y, 0, ROOM_H - h), w, h });
        continue;
      }

      if (cursorX + w > bandRight && cursorX > ax * ROOM_W) {
        cursorX = ax * ROOM_W;
        cursorY += rowHeight + 0.6;
        rowHeight = 0;
      }

      placed.push({
        thing,
        x: clamp(cursorX, 0, ROOM_W - w),
        y: clamp(cursorY, 0, ROOM_H - h),
        w,
        h,
      });

      cursorX += w + 0.6;
      rowHeight = Math.max(rowHeight, h);
    }
  }

  return placed;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
