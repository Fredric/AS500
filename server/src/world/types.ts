/**
 * World types — the contract shared by the resolver, the :3006 runtime, the
 * Office Layout CRUD screens, and the floorplan client.
 *
 * The client mirrors the wire types in `client/src/world/types.ts`; keep the two
 * in step (same arrangement as `server/src/monitor/types.ts`).
 */

// ============================================
// Bindings — what an object in the room IS
// ============================================

/**
 * A Thing is, by default, a *view* onto something that already exists in AS500.
 * The world stores the binding; it never stores a copy of the bound data.
 *
 * `crud` is the workhorse: it names a registered `CRUDTableConfig` by id plus
 * the scope its `services.list.params(ctx)` expects. Resolution therefore goes
 * through `getConfig()` and the config's own service — the identical path the
 * terminal, MCP and REST take — so `config.requirePermission` gates the object
 * with no world-specific access-control code.
 */
export type ThingBinding =
  /** A collection: a drawer of documents, a shelf of motorcycles. */
  | { kind: 'crud'; configId: string; scope?: Record<string, unknown> }
  /** One specific record: a single file on the desk. */
  | { kind: 'record'; configId: string; recordId: string | number }
  /** A computer running AS500. Phase 3 streams its screen; Phase 1 shows occupancy. */
  | { kind: 'workstation' }
  /** A machine in the server room, health-probed by the ingest monitor. */
  | { kind: 'service'; serviceKey: string }
  /** An agent's seat. */
  | { kind: 'agent'; userId: number }
  /** Owns its own payload (post-it, whiteboard). Phase 2. */
  | { kind: 'none' };

export type ThingBindingKind = ThingBinding['kind'];

export const THING_BINDING_KINDS: ThingBindingKind[] = [
  'crud', 'record', 'workstation', 'service', 'agent', 'none',
];

/** Object types the renderers know how to draw. Additive — unknown types draw as a crate. */
export const THING_TYPES = [
  'desk', 'cabinet', 'drawer', 'shelf', 'bookshelf', 'box', 'workstation',
  'board', 'postit', 'album', 'rack', 'door', 'plant',
] as const;

export type ThingType = (typeof THING_TYPES)[number];

/**
 * The one config a `'bookshelf'` may bind to. `'bookshelf'` is a distinct type
 * from the generic `'shelf'` specifically so this constraint is new furniture,
 * not a retroactive rule on furniture that already existed with no such limit
 * (`seedOffice.ts` places a plain `type:'shelf'` bound to `motorcycles`).
 */
export const BOOKSHELF_CONFIG_ID = 'documents';

// ============================================
// Persisted shape
// ============================================

export interface Transform {
  x: number;
  y: number;
  rot?: number;
  scale?: number;
}

export interface WorldSpaceRow {
  id: number;
  key: string;
  name: string;
  kind: string;
  layout: { width?: number; height?: number; grid?: number } | null;
  ownerUserId: number | null;
}

export interface WorldThingRow {
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
}

// ============================================
// Resolved shape — what a renderer receives
// ============================================

/**
 * The outcome of resolving a Thing's binding for one actor.
 *
 * `access` is the important field. A Thing the actor may not open is still
 * returned, marked `denied`, with no contents: **you see the cabinet, you just
 * cannot open it**. Omitting it entirely would leak the absence of the object
 * and make the room's furniture depend on who is looking.
 */
export type ResolvedAccess = 'ok' | 'denied' | 'unbound' | 'error';

export interface ResolvedContents {
  /** Total records behind this object, when the binding resolves to a collection. */
  count: number;
  /** A small display slice — never the whole table. */
  preview: Array<{ id: string | number | null; label: string }>;
  /** True when `count` exceeds the preview length. */
  truncated: boolean;
}

/**
 * One subfolder of a bookshelf's bound folder, rendered as a book.
 *
 * Never a `world_things` row: derived live from `document_folders` on every
 * resolve, exactly like `ResolvedContents.preview` — a bookshelf is a lens,
 * not a cache. See `documentsShelf.ts`.
 */
export interface ResolvedBook {
  id: number;
  label: string;
}

/**
 * The payload of a `type: 'postit'`/`'board'` thing — Phase 2's "objects that
 * own data" class. `null` means the thing has never been written to yet (a
 * blank post-it), not an error.
 */
export interface ResolvedNote {
  body: string;
  color: string;
  updatedAt: string;
}

export interface ResolvedThing extends WorldThingRow {
  access: ResolvedAccess;
  /** Human-readable reason when `access` is not `ok`. Safe to show in a UI. */
  reason: string | null;
  /** Populated only when `access === 'ok'` and the binding yields a collection. */
  contents: ResolvedContents | null;
  /** Populated for `kind: 'service'` bindings — health from the ingest monitor probes. */
  service: { status: string; detail: string | null } | null;
  /** Populated only for `type: 'bookshelf'` things whose binding resolved `ok`. */
  books: ResolvedBook[] | null;
  /** Populated only for `type: 'postit'`/`'board'` things — `null` body means never written. */
  note: ResolvedNote | null;
  /** Child things (the furniture tree), already resolved. */
  children: ResolvedThing[];
}

export interface ResolvedScene {
  space: WorldSpaceRow;
  things: ResolvedThing[];
  /** Server clock, so a client can show staleness. */
  ts: string;
}

// ============================================
// Presence — never persisted
// ============================================

export interface Presence {
  actorId: number;
  username: string;
  kind: 'human' | 'agent';
  spaceKey: string;
  /** Thing the actor is at or seated at, when any. */
  atThingId: number | null;
  pose: { x: number; y: number; rot: number };
  activity: 'idle' | 'walking' | 'reading' | 'typing';
  since: string;
}

// ============================================
// Wire protocol (:3006 /ws)
// ============================================

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
  /** A book (or a folder inside one) was clicked in the file-explorer modal. */
  | { type: 'BROWSE_DOCUMENTS_FOLDER'; folderId: number | null }
  /** The graphical client's textarea for a postit/board is not CRUDTable-driven. */
  | { type: 'SET_NOTE'; thingId: number; body: string; color?: string }
  | { type: 'REFRESH' }
  | { type: 'PING' };

export type WorldServerMessage =
  /** Full scene. Sent on join and after any structural change. */
  | { type: 'SCENE'; scene: ResolvedScene }
  /** One thing's resolution changed (contents count, service health). */
  | { type: 'THING_CHANGED'; thing: ResolvedThing }
  /** Everyone currently in the space, including the recipient. */
  | { type: 'PRESENCE'; spaceKey: string; actors: Presence[] }
  /** Reply to OPEN_THING — the resolved object on its own. */
  | { type: 'THING_OPENED'; thing: ResolvedThing }
  /** Reply to BROWSE_DOCUMENTS_FOLDER — one level of the file-explorer modal. */
  | { type: 'DOCUMENTS_FOLDER'; folderId: number | null; breadcrumb: string; entries: DocumentsBrowseEntry[] }
  | { type: 'ERROR'; message: string }
  | { type: 'PONG' };
