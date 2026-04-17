import {
  pgTable,
  pgEnum,
  serial,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  date,
  unique,
  index,
  primaryKey,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const userRoleEnum = pgEnum('user_role', ['user', 'superuser', 'aiagent', 'admin']);

const inet = customType<{ data: string }>({
  dataType() {
    return 'inet';
  },
});

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  password_hash: text('password_hash').notNull(),
  full_name: text('full_name'),
  active: boolean('active').default(true).notNull(),
  is_admin: boolean('is_admin').default(false).notNull(),
  role: userRoleEnum('role').default('user').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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

export const authTokens = pgTable('auth_tokens', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  ip_address: inet('ip_address'),
  last_used_at: timestamp('last_used_at', { withTimezone: true }).defaultNow(),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [
  index('idx_auth_tokens_token').on(table.token),
  index('idx_auth_tokens_access_token').on(table.access_token).where(sql`${table.revoked_at} IS NULL`),
  index('idx_auth_tokens_refresh_token').on(table.refresh_token).where(sql`${table.revoked_at} IS NULL`),
  index('idx_auth_tokens_user_id').on(table.user_id),
  index('idx_auth_tokens_expires_at').on(table.expires_at),
  index('idx_auth_tokens_user_device').on(table.user_id, table.device_id).where(sql`${table.revoked_at} IS NULL`),
]);

// ============================================
// RBAC — Groups, Permissions, Role mappings
// ============================================

export const groups = pgTable('groups', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const userGroups = pgTable('user_groups', {
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  group_id: integer('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.user_id, t.group_id] }),
]);

export const permissions = pgTable('permissions', {
  key: text('key').primaryKey(),
  description: text('description').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const rolePermissions = pgTable('role_permissions', {
  role: userRoleEnum('role').notNull(),
  permission_key: text('permission_key').notNull().references(() => permissions.key, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.role, t.permission_key] }),
]);

export const groupPermissions = pgTable('group_permissions', {
  group_id: integer('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  permission_key: text('permission_key').notNull().references(() => permissions.key, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.group_id, t.permission_key] }),
]);

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

export const userPermissions = pgTable('user_permissions', {
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  permission_key: text('permission_key').notNull().references(() => permissions.key, { onDelete: 'cascade' }),
  granted: boolean('granted').default(true).notNull(),
}, (t) => [
  primaryKey({ columns: [t.user_id, t.permission_key] }),
]);
