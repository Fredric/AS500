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
