import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  timestamp,
  date,
  unique,
  index,
  customType,
  jsonb,
  bigint,
} from 'drizzle-orm/pg-core';
import { users } from '../../core/db/schema.js';

/** pgvector column — dimension defaults to 768 (Ollama nomic-embed-text on VPS). */
export const embeddingVector = customType<{ data: number[]; driverData: string }>({
  dataType(config?: unknown) {
    const dimensions = (config as { dimensions?: number } | undefined)?.dimensions ?? 768;
    return `vector(${dimensions})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    if (typeof value !== 'string') return [];
    const trimmed = value.replace(/^\[|\]$/g, '');
    return trimmed ? trimmed.split(',').map(Number) : [];
  },
});

export const days = pgTable('days', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id').notNull().references(() => users.id),
  workday: date('workday', { mode: 'string' }).notNull(),
  daysum: numeric('daysum', { precision: 5, scale: 2 }).default('0').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('days_user_id_workday_unique').on(table.user_id, table.workday),
]);

export const dayItems = pgTable('day_items', {
  id: serial('id').primaryKey(),
  day_id: integer('day_id').notNull().references(() => days.id, { onDelete: 'cascade' }),
  start_hour: text('start_hour').notNull(),
  end_hour: text('end_hour').notNull(),
  jiratask: text('jiratask'),
  description: text('description'),
  rowsum: numeric('rowsum', { precision: 5, scale: 2 }).default('0').notNull(),
  sort_order: integer('sort_order').default(0).notNull(),
});

export const motorcycles = pgTable('motorcycles', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  brand: text('brand').notNull(),
  model: text('model').notNull(),
  year: integer('year').notNull(),
  purchase_date: date('purchase_date', { mode: 'string' }),
  sell_date: date('sell_date', { mode: 'string' }),
  cost: numeric('cost', { precision: 10, scale: 2 }),
  nickname: text('nickname'),
  odometer_km: integer('odometer_km'),
  engine_cc: integer('engine_cc'),
  color: text('color'),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_motorcycles_user_id').on(table.user_id),
]);

export const mods = pgTable('mods', {
  id: serial('id').primaryKey(),
  motorcycle_id: integer('motorcycle_id').notNull().references(() => motorcycles.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  category: text('category'),
  cost: numeric('cost', { precision: 10, scale: 2 }),
  installed_date: date('installed_date', { mode: 'string' }),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_mods_motorcycle_id').on(t.motorcycle_id),
]);

export const servicesPerformed = pgTable('services_performed', {
  id: serial('id').primaryKey(),
  motorcycle_id: integer('motorcycle_id').notNull().references(() => motorcycles.id, { onDelete: 'cascade' }),
  service_type: text('service_type').notNull(),
  service_date: date('service_date', { mode: 'string' }).notNull(),
  odometer_km: integer('odometer_km'),
  cost: numeric('cost', { precision: 10, scale: 2 }),
  shop: text('shop'),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_services_performed_motorcycle_id').on(t.motorcycle_id),
]);

export const documentFolders = pgTable('document_folders', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  parent_id: integer('parent_id'),
  name: text('name').notNull(),
  description: text('description'),
  notes: text('notes'),
  ai_summary: text('ai_summary'),
  title_embedding: embeddingVector('title_embedding'),
  description_embedding: embeddingVector('description_embedding'),
  ai_summary_embedding: embeddingVector('ai_summary_embedding'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_document_folders_user_id').on(t.user_id),
  index('idx_document_folders_parent_id').on(t.parent_id),
]);

export const documentItems = pgTable('document_items', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  folder_id: integer('folder_id').references(() => documentFolders.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  file_type: text('file_type').notNull(),
  mime_type: text('mime_type'),
  extension: text('extension'),
  storage_path: text('storage_path').notNull(),
  original_filename: text('original_filename').notNull(),
  size_bytes: integer('size_bytes').notNull(),
  ai_summary: text('ai_summary'),
  content_hash: text('content_hash'),
  ingest_status: text('ingest_status').default('pending'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_document_items_user_id').on(t.user_id),
  index('idx_document_items_folder_id').on(t.folder_id),
  index('idx_document_items_content_hash').on(t.content_hash),
]);

// ============================================
// My Things — photographed objects turned into isometric sprites
// ============================================
//
// A Thing owns its own files under server/data/things/{userId}/{thingId}/,
// deliberately outside My Documents: the source photo is raw material for a
// generation, not a document the user filed.
//
// Thing folders are organizational only, for now — a separate tree from
// document_folders (a Thing is deliberately not a document). `folder_id` is
// `set null` on folder delete rather than cascading: a folder is scaffolding,
// the sprite inside it is not disposable. `parent_id` is a plain int with no
// FK, matching document_folders — self-references are enforced in code, not
// the schema, so a folder's own subtree can be deleted without ordering games.

export const thingFolders = pgTable('thing_folders', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  parent_id: integer('parent_id'),
  name: text('name').notNull(),

  // "Box art": a Qwen Image 2.1 composite of this folder's own empty-box
  // reference plus up to 9 of its things' sprites. Generated by a scheduled
  // job (folder_jobs below), never uploaded directly.
  cover_path: text('cover_path'),
  cover_mime: text('cover_mime'),
  cover_width: integer('cover_width'),
  cover_height: integer('cover_height'),
  // Fingerprint of the exact thing-ids + updated_at values the current cover
  // was built from. The scheduler recomputes this on every tick and only
  // enqueues a regen when it no longer matches — i.e. the folder's contents
  // actually changed since the cover was last generated.
  cover_signature: text('cover_signature'),

  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_thing_folders_user_id').on(t.user_id),
  index('idx_thing_folders_parent_id').on(t.parent_id),
]);

export const myThings = pgTable('my_things', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  folder_id: integer('folder_id').references(() => thingFolders.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category'),

  source_path: text('source_path'),
  source_mime: text('source_mime'),
  source_width: integer('source_width'),
  source_height: integer('source_height'),

  processed_path: text('processed_path'),
  processed_mime: text('processed_mime'),
  processed_width: integer('processed_width'),
  processed_height: integer('processed_height'),

  status: text('status').default('draft').notNull(),
  // Rolled up from the active job so a status poll is one indexed row read.
  stage: text('stage'),
  progress: integer('progress'),
  blocked_reason: text('blocked_reason'),

  // Snapshotted at enqueue time, never read back from config: an old Thing
  // must keep recording the prompt that actually produced it.
  prompt: text('prompt'),
  seed: bigint('seed', { mode: 'number' }),
  model: text('model'),

  metadata: jsonb('metadata'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_my_things_user_id').on(t.user_id),
  index('idx_my_things_status').on(t.status),
  index('idx_my_things_folder_id').on(t.folder_id),
]);

export const thingJobs = pgTable('thing_jobs', {
  id: text('id').primaryKey(),
  thing_id: integer('thing_id').notNull().references(() => myThings.id, { onDelete: 'cascade' }),
  user_id: integer('user_id').notNull(),
  processor: text('processor').notNull(),
  params: jsonb('params'),

  state: text('state').default('queued').notNull(),
  stage: text('stage'),
  progress: integer('progress'),

  attempts: integer('attempts').default(0).notNull(),
  max_attempts: integer('max_attempts').default(3).notNull(),
  error: text('error'),
  traceback: text('traceback'),
  result: jsonb('result'),

  locked_by: text('locked_by'),
  locked_at: timestamp('locked_at', { withTimezone: true }),
  lease_expires_at: timestamp('lease_expires_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  started_at: timestamp('started_at', { withTimezone: true }),
  finished_at: timestamp('finished_at', { withTimezone: true }),
}, (t) => [
  index('idx_thing_jobs_state_created').on(t.state, t.created_at),
  index('idx_thing_jobs_thing_id').on(t.thing_id),
]);

export const jobRunners = pgTable('job_runners', {
  id: text('id').primaryKey(),
  capabilities: text('capabilities').array(),
  version: text('version'),
  last_seen_at: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
});

export const documentChunks = pgTable('document_chunks', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  document_item_id: integer('document_item_id').notNull().references(() => documentItems.id, { onDelete: 'cascade' }),
  folder_id: integer('folder_id').references(() => documentFolders.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  embedding: embeddingVector('embedding').notNull(),
  node_path: text('node_path').notNull(),
  node_description: text('node_description'),
  document_title: text('document_title').notNull(),
  document_description: text('document_description'),
  page_number: integer('page_number'),
  page_end: integer('page_end'),
  section_title: text('section_title'),
  content_type: text('content_type'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_document_chunks_user_id').on(t.user_id),
  index('idx_document_chunks_folder_id').on(t.folder_id),
  index('idx_document_chunks_document_item_id').on(t.document_item_id),
]);
