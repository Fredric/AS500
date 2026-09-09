/**
 * Wire types for the virtual office.
 *
 * Mirrors `server/src/world/types.ts` — keep the two in step, same arrangement
 * as `client/src/monitor/types.ts` mirrors `server/src/monitor/types.ts`.
 */

export type ThingBinding =
  | { kind: 'crud'; configId: string; scope?: Record<string, unknown> }
  | { kind: 'record'; configId: string; recordId: string | number }
  | { kind: 'workstation' }
  | { kind: 'service'; serviceKey: string }
  | { kind: 'agent'; userId: number }
  | { kind: 'none' };

export type ResolvedAccess = 'ok' | 'denied' | 'unbound' | 'error';

export interface Transform {
  x: number;
  y: number;
  rot?: number;
  scale?: number;
}

export interface ResolvedContents {
  count: number;
  preview: Array<{ id: string | number | null; label: string }>;
  truncated: boolean;
}

/** One subfolder of a bookshelf's bound folder, rendered as a book. */
export interface ResolvedBook {
  id: number;
  label: string;
}

/** The payload of a `type: 'postit'`/`'board'` thing. `null` body = never written. */
export interface ResolvedNote {
  body: string;
  color: string;
  updatedAt: string;
}

export interface ResolvedThing {
  id: number;
  spaceId: number;
  parentThingId: number | null;
  type: string;
  label: string;
  slot: string | null;
  zone: string | null;
  transform: Transform | null;
  binding: ThingBinding | null;
  ownerUserId: number | null;
  visibility: string;
  sortOrder: number;
  access: ResolvedAccess;
  reason: string | null;
  contents: ResolvedContents | null;
  service: { status: string; detail: string | null } | null;
  /** Populated only for `type: 'bookshelf'` things whose binding resolved ok. */
  books: ResolvedBook[] | null;
  /** Populated only for `type: 'postit'`/`'board'` things — `null` body means never written. */
  note: ResolvedNote | null;
  children: ResolvedThing[];
}

export interface WorldSpace {
  id: number;
  key: string;
  name: string;
  kind: string;
  layout: { width?: number; height?: number; grid?: number } | null;
  ownerUserId: number | null;
}

export interface ResolvedScene {
  space: WorldSpace;
  things: ResolvedThing[];
  ts: string;
}

export interface Presence {
  actorId: number;
  username: string;
  kind: 'human' | 'agent';
  spaceKey: string;
  atThingId: number | null;
  pose: { x: number; y: number; rot: number };
  activity: 'idle' | 'walking' | 'reading' | 'typing';
  since: string;
}

/** One row in a bookshelf's file-explorer modal — a folder or a file. */
export interface DocumentsBrowseEntry {
  id: number;
  kind: 'folder' | 'file';
  name: string;
  fileType: string;
  sizeBytes: number | null;
  modifiedAt: string;
}

export type WorldClientMessage =
  | { type: 'ENTER_SPACE'; spaceKey: string }
  | { type: 'LEAVE_SPACE' }
  | { type: 'MOVE'; pose: { x: number; y: number; rot: number }; atThingId?: number | null }
  | { type: 'OPEN_THING'; thingId: number }
  | { type: 'BROWSE_DOCUMENTS_FOLDER'; folderId: number | null }
  | { type: 'SET_NOTE'; thingId: number; body: string; color?: string }
  | { type: 'REFRESH' }
  | { type: 'PING' };

export type WorldServerMessage =
  | { type: 'SCENE'; scene: ResolvedScene }
  | { type: 'THING_CHANGED'; thing: ResolvedThing }
  | { type: 'PRESENCE'; spaceKey: string; actors: Presence[] }
  | { type: 'THING_OPENED'; thing: ResolvedThing }
  | { type: 'DOCUMENTS_FOLDER'; folderId: number | null; breadcrumb: string; entries: DocumentsBrowseEntry[] }
  | { type: 'ERROR'; message: string }
  | { type: 'PONG' };
