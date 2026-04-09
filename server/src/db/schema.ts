import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  date,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  password_hash: text('password_hash').notNull(),
  full_name: text('full_name'),
  active: boolean('active').default(true).notNull(),
  is_admin: boolean('is_admin').default(false).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const days = pgTable('days', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id').notNull().references(() => users.id),
  workday: date('workday', { mode: 'string' }).notNull(),
  daysum: numeric('daysum', { precision: 5, scale: 2 }).default('0').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const dayItems = pgTable('day_items', {
  id: serial('id').primaryKey(),
  day_id: integer('day_id').notNull().references(() => days.id),
  start_hour: text('start_hour').notNull(),
  end_hour: text('end_hour').notNull(),
  jiratask: text('jiratask'),
  description: text('description'),
  rowsum: numeric('rowsum', { precision: 5, scale: 2 }).default('0').notNull(),
  sort_order: integer('sort_order').default(0).notNull(),
});

export const authTokens = pgTable('auth_tokens', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id').notNull().references(() => users.id),
  token: text('token').notNull().unique(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  access_token: text('access_token').unique(),
  refresh_token: text('refresh_token').unique(),
  access_expires_at: timestamp('access_expires_at', { withTimezone: true }),
  refresh_expires_at: timestamp('refresh_expires_at', { withTimezone: true }),
  device_id: text('device_id'),
  device_name: text('device_name'),
  user_agent: text('user_agent'),
  ip_address: text('ip_address'),
  last_used_at: timestamp('last_used_at', { withTimezone: true }).defaultNow(),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
});
