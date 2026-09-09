/**
 * World schema — the spatial topology layer.
 *
 * Two tables only. They describe WHERE things are and WHAT they are a view of.
 * They never hold a copy of application data: a drawer bound to a document
 * folder stores the binding, not the documents. See `resolver.ts`.
 *
 * Merged into the Drizzle instance in `core/db/index.ts` alongside the core and
 * app schemas, and listed in `server/drizzle.config.ts` so migrations pick it up.
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  serial,
  text,
  integer,
  varchar,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from '../../core/db/schema.js';

/**
 * A room, floor, or any bounded place. `key` is the stable URL-safe handle the
 * world API is addressed by (`GET /api/space/:key`).
 */
export const worldSpaces = pgTable('world_spaces', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  /** Free-form category: 'office' | 'server_room' | 'archive' | … */
  kind: varchar('kind', { length: 32 }).default('office').notNull(),
  /** Renderer hints for the space itself: extents, grid size, wall colour. */
  layout: jsonb('layout'),
  owner_user_id: integer('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * An object in a space, or inside another object.
 *
 * `parent_thing_id` is the FURNITURE tree (a drawer is in a desk) — deliberately
 * NOT the data tree (`document_folders.parent_id`). The two must never be
 * merged: furniture is arranged by people, data hierarchy is navigated. A
 * thing's `binding` is a mount point onto the data tree, exactly like a Unix
 * mount. See the plan's "Two hierarchies that must never be merged".
 *
 * `transform` is a renderer HINT, never authoritative. The server owns
 * containment (`parent_thing_id`, `slot`, `zone`); it does not own physics.
 * Deliberately left as a plain integer rather than a self-referencing FK, both
 * to avoid a circular Drizzle type and to match `document_folders.parent_id`.
 */
export const worldThings = pgTable('world_things', {
  id: serial('id').primaryKey(),
  space_id: integer('space_id').notNull().references(() => worldSpaces.id, { onDelete: 'cascade' }),
  parent_thing_id: integer('parent_thing_id'),
  /** 'desk' | 'cabinet' | 'drawer' | 'workstation' | 'board' | 'postit' | 'box' | 'rack' | 'door' */
  type: varchar('type', { length: 32 }).notNull(),
  label: text('label').notNull(),
  /** Named position inside the parent thing: 'drawer_1', 'desktop_left', 'wall_north'. */
  slot: varchar('slot', { length: 48 }),
  /** Coarse area of the space: 'north_east', 'server_room'. */
  zone: varchar('zone', { length: 48 }),
  /** Renderer hint: { x, y, rot, scale }. Not validated, not authoritative. */
  transform: jsonb('transform'),
  /** A {@link import('../types.js').ThingBinding} — what this object is a view of. */
  binding: jsonb('binding'),
  owner_user_id: integer('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  /** 'private' = owner only, 'shared' = any authenticated user, 'public' = same for now. */
  visibility: varchar('visibility', { length: 16 }).default('shared').notNull(),
  sort_order: integer('sort_order').default(0).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_world_things_space_id').on(t.space_id),
  index('idx_world_things_parent_id').on(t.parent_thing_id),
  // One thing per slot within a parent — stops two objects occupying one drawer bay.
  uniqueIndex('idx_world_things_parent_slot')
    .on(t.parent_thing_id, t.slot)
    .where(sql`${t.parent_thing_id} IS NOT NULL AND ${t.slot} IS NOT NULL`),
]);
