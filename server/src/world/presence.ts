/**
 * Presence — who is in which room, and roughly where.
 *
 * Deliberately in-memory and never persisted, per the spatial model: the server
 * owns *containment* (`world_things.parent_thing_id`), not position. Poses are
 * relayed between clients so avatars move, but they are not validated, not
 * stored, and not authoritative. Nothing is lost when the process restarts —
 * everyone simply walks back in.
 *
 * Keyed by connection rather than by user so one person can be present from two
 * browsers without the second eviction the first.
 */

import type { Presence } from './types.js';

const byConnection = new Map<symbol, Presence>();

export function enter(conn: symbol, presence: Presence): void {
  byConnection.set(conn, presence);
}

export function leave(conn: symbol): Presence | null {
  const p = byConnection.get(conn) ?? null;
  byConnection.delete(conn);
  return p;
}

export function get(conn: symbol): Presence | null {
  return byConnection.get(conn) ?? null;
}

export function update(
  conn: symbol,
  patch: Partial<Pick<Presence, 'pose' | 'activity' | 'atThingId'>>,
): Presence | null {
  const current = byConnection.get(conn);
  if (!current) return null;
  const next: Presence = { ...current, ...patch };
  byConnection.set(conn, next);
  return next;
}

/** Everyone currently in one space. */
export function inSpace(spaceKey: string): Presence[] {
  const out: Presence[] = [];
  for (const p of byConnection.values()) {
    if (p.spaceKey === spaceKey) out.push(p);
  }
  return out;
}

/** Distinct space keys that currently have at least one occupant. */
export function occupiedSpaces(): string[] {
  return [...new Set([...byConnection.values()].map((p) => p.spaceKey))];
}

export function count(): number {
  return byConnection.size;
}
