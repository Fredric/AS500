import {
  pgTable,
  pgEnum,
  serial,
  text,
  varchar,
  boolean,
  integer,
  numeric,
  timestamp,
  date,
  unique,
  index,
  uniqueIndex,
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

/**
 * `auth_tokens` stores both terminal-session tokens (the original AS500 login
 * flow) and MCP OAuth tokens. The `kind` discriminator tells them apart:
 *
 *  - `'as500'`        — classic terminal login tokens (pre-existing rows).
 *                        `token` is the primary session token; `access_token`
 *                        / `refresh_token` are the newer JWT-style pair.
 *  - `'mcp_authcode'` — short-lived one-time OAuth 2.1 authorization codes.
 *                        Uses `code_challenge` / `code_challenge_method`
 *                        (PKCE) and `redirect_uri` (must match on `/token`).
 *  - `'mcp_access'`   — MCP access JWT. `jti` carries the JWT's `jti` claim
 *                        so per-request revocation is a single indexed lookup.
 *  - `'mcp_refresh'`  — opaque MCP refresh token. Rotated on each refresh
 *                        grant by setting `revoked_at` on the old row.
 *
 * `client_id` is NULL for `'as500'` rows and FK-shaped (but left unreferenced
 * in the column itself to avoid coupling terminal login to `oauth_clients`)
 * for the MCP kinds.
 */
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
  kind: varchar('kind', { length: 20 }).default('as500').notNull(),
  client_id: varchar('client_id', { length: 64 }),
  jti: varchar('jti', { length: 64 }),
  code_challenge: varchar('code_challenge', { length: 128 }),
  code_challenge_method: varchar('code_challenge_method', { length: 8 }),
  redirect_uri: text('redirect_uri'),
}, (table) => [
  index('idx_auth_tokens_token').on(table.token),
  index('idx_auth_tokens_access_token').on(table.access_token).where(sql`${table.revoked_at} IS NULL`),
  index('idx_auth_tokens_refresh_token').on(table.refresh_token).where(sql`${table.revoked_at} IS NULL`),
  index('idx_auth_tokens_user_id').on(table.user_id),
  index('idx_auth_tokens_expires_at').on(table.expires_at),
  index('idx_auth_tokens_user_device').on(table.user_id, table.device_id).where(sql`${table.revoked_at} IS NULL`),
  // Per-request MCP revocation check: look up by (kind, jti) and ensure
  // revoked_at is NULL. Partial unique index keeps the hot path to one row.
  uniqueIndex('idx_auth_tokens_kind_jti').on(table.kind, table.jti).where(sql`${table.jti} IS NOT NULL`),
  index('idx_auth_tokens_client_id').on(table.client_id).where(sql`${table.client_id} IS NOT NULL`),
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

export const userPermissions = pgTable('user_permissions', {
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  permission_key: text('permission_key').notNull().references(() => permissions.key, { onDelete: 'cascade' }),
  granted: boolean('granted').default(true).notNull(),
}, (t) => [
  primaryKey({ columns: [t.user_id, t.permission_key] }),
]);

// ============================================
// MCP / OAuth 2.1 — Remote MCP server tables
// ============================================
//
// These tables back the `POST /mcp` endpoint and its OAuth 2.1 authorization
// flow. See `DOCS/MCP/` (once published) for the full protocol shape.
//
// - `oauth_clients`     Dynamically registered (RFC 7591) MCP client apps.
// - `oauth_consents`    Per-(user, client) remember-me consents so returning
//                       agents skip the consent checkbox.
// - `mcp_audit_log`     Append-only record of every tool call. Parameter
//                       values are NOT persisted (hash only) — avoids leaking
//                       PII/secrets on diagnostic reads.
//
// MCP-kind tokens live in `auth_tokens` via the `kind` discriminator. See the
// comment on `authTokens` above.

export const oauthClients = pgTable('oauth_clients', {
  // Random id issued at `/register` time. Not a serial: clients embed it in
  // subsequent requests, so a short stable string is friendlier.
  id: varchar('id', { length: 64 }).primaryKey(),
  // bcrypt hash. NULL for public clients (PKCE-only, no client auth).
  client_secret_hash: varchar('client_secret_hash', { length: 128 }),
  client_name: varchar('client_name', { length: 255 }).notNull(),
  // JSON-encoded string[] of allowed redirect URIs.
  redirect_uris: text('redirect_uris').notNull(),
  token_endpoint_auth_method: varchar('token_endpoint_auth_method', { length: 32 }).notNull(),
  registered_at: timestamp('registered_at', { withTimezone: true }).defaultNow().notNull(),
  // Verbatim RFC 7591 registration payload for audit / debugging.
  metadata: text('metadata'),
});

export const oauthConsents = pgTable('oauth_consents', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  client_id: varchar('client_id', { length: 64 }).notNull().references(() => oauthClients.id, { onDelete: 'cascade' }),
  scope: varchar('scope', { length: 255 }).notNull(),
  granted_at: timestamp('granted_at', { withTimezone: true }).defaultNow().notNull(),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
}, (t) => [
  // Fast "has this user already consented to this client+scope?" lookup on the
  // authorize path. Revoked consents still match — callers filter on revoked_at.
  index('idx_oauth_consents_user_client').on(t.user_id, t.client_id),
]);

export const mcpAuditLog = pgTable('mcp_audit_log', {
  id: serial('id').primaryKey(),
  // Not FK-referenced: audit rows must survive client/user deletion.
  client_id: varchar('client_id', { length: 64 }),
  user_id: integer('user_id'),
  tool_name: varchar('tool_name', { length: 128 }).notNull(),
  config_id: varchar('config_id', { length: 64 }).notNull(),
  // list | read | create | update | delete
  action: varchar('action', { length: 16 }).notNull(),
  // sha256 hex of the JSON-serialized params; lets us group identical calls
  // without persisting potentially-sensitive inputs.
  params_hash: varchar('params_hash', { length: 64 }).notNull(),
  ok: boolean('ok').notNull(),
  error_code: varchar('error_code', { length: 64 }),
  duration_ms: integer('duration_ms').notNull(),
  // 'mcp' = MCP tool call, 'api' = REST API call
  source: varchar('source', { length: 8 }).default('mcp').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_mcp_audit_log_created_at').on(t.created_at),
  index('idx_mcp_audit_log_client_id').on(t.client_id),
  index('idx_mcp_audit_log_user_id').on(t.user_id),
  index('idx_mcp_audit_log_config_id').on(t.config_id),
]);
