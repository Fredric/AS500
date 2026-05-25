import {
  pgTable,
  pgEnum,
  serial,
  text,
  varchar,
  boolean,
  integer,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
  customType,
  jsonb,
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

// ============================================
// Unified Audit Log
// ============================================
//
// Append-only record of every security- and data-relevant event across ALL
// access surfaces: terminal UI, MCP tool calls, REST API, auth lifecycle,
// and WebSocket session events.
//
// Rows are never updated or deleted by application code.
// before_data / after_data hold JSONB snapshots for terminal CRUD ops.
// params_hash (sha256) is used for MCP/API calls to avoid storing PII.

export const auditLog = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  // 'auth' | 'crud' | 'mcp' | 'api' | 'session'
  event_type: varchar('event_type', { length: 16 }).notNull(),
  // e.g. 'login' | 'login_failed' | 'logout' | 'token_refresh' |
  //      'create' | 'update' | 'delete' | 'list' | 'read' |
  //      'connect' | 'disconnect' | 'resume' | 'expire'
  action: varchar('action', { length: 32 }).notNull(),
  // 'terminal' | 'mcp' | 'api'
  source: varchar('source', { length: 16 }).notNull(),
  // Not FK-referenced — audit rows must survive user deletion.
  user_id: integer('user_id'),
  // Denormalized for readability even after user deletion.
  username: varchar('username', { length: 64 }),
  client_id: varchar('client_id', { length: 64 }),
  config_id: varchar('config_id', { length: 64 }),
  record_id: varchar('record_id', { length: 128 }),
  ok: boolean('ok').notNull(),
  error_code: varchar('error_code', { length: 64 }),
  duration_ms: integer('duration_ms').notNull().default(0),
  ip_address: inet('ip_address'),
  user_agent: text('user_agent'),
  // Full record snapshot before and after the change (terminal CRUD only).
  // MCP/API calls use params_hash instead to avoid leaking PII.
  before_data: jsonb('before_data'),
  after_data: jsonb('after_data'),
  params_hash: varchar('params_hash', { length: 64 }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_audit_log_created_at').on(t.created_at),
  index('idx_audit_log_event_type').on(t.event_type),
  index('idx_audit_log_user_id').on(t.user_id).where(sql`${t.user_id} IS NOT NULL`),
  index('idx_audit_log_config_id').on(t.config_id).where(sql`${t.config_id} IS NOT NULL`),
  index('idx_audit_log_source').on(t.source),
]);

// ============================================
// AI Chat
// ============================================

export const aiChats = pgTable('ai_chats', {
  id: text('id').primaryKey(),                           // client-supplied uuid
  user_id: integer('user_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_ai_chats_user_id').on(t.user_id),
]);

export const aiMessages = pgTable('ai_messages', {
  id: serial('id').primaryKey(),
  chat_id: text('chat_id').notNull(),
  role: varchar('role', { length: 16 }).notNull(),       // 'user' | 'assistant'
  content: text('content').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_ai_messages_chat_id').on(t.chat_id),
]);
