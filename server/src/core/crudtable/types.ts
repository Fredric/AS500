// CRUDTable Type Definitions
// Declarative config system for auto-generated CRUD screens

import type { FieldType } from '../dsl/types.js';

// Boolean expression: static or context-evaluated
export type BoolExpr = boolean | ((context: CRUDContext) => boolean);

// Validator: returns error message string or null if valid
export type Validator = (context: CRUDContext) => string | null;

// CRUDContext - runtime state for a CRUDTable screen
export interface CRUDContext {
  records: Record<string, unknown>[];
  selection: Record<string, unknown>[];
  values: Record<string, string>;
  input: Record<string, unknown>;
  user: string | null;
  formMode: 'create' | 'edit' | null;
  editRecord: Record<string, unknown> | null;
  pendingDeleteRecord: Record<string, unknown> | null;
  pageOffset: number;
  /** Current form page (0-based). Only used when config.formPageSize is set. */
  formPage: number;
  datasources: Record<string, Record<string, unknown>[]>;
}

// Service call: wires a config action to a service method
export interface ServiceCall {
  service: Record<string, Function>;
  method: string;
  params?: (context: CRUDContext) => unknown | Promise<unknown>;
  requirePermission?: string; // Optional permission key required to execute this operation
}

// Datasource: lookup data for select-like fields
export interface DatasourceConfig {
  service: Record<string, Function>;
  method: string;
  params?: (context: CRUDContext) => unknown;
  valueField: string;
  displayField: string;
}

// Field config: defines one logical field across list + form
export interface FieldConfig {
  field: string;
  label: string;
  length: number;
  type?: FieldType;

  staticOptions?: Array<{ value: string; display: string }>;
  datasource?: DatasourceConfig;

  form?: {
    type?: FieldType;
    visible?: BoolExpr;
    disabled?: BoolExpr;
    required?: BoolExpr;
    uppercase?: boolean;
    validators?: Validator[];
    hint?: string;
    formValue?: (ctx: CRUDContext, rawValue: unknown) => string;
  };

  column?: {
    width?: number;
    align?: 'left' | 'right' | 'center';
    cellRenderer?: (
      ctx: CRUDContext,
      record: Record<string, unknown>,
      datasource?: Record<string, unknown>[]
    ) => string;
  };

  /**
   * MCP (Model Context Protocol) tuning for this field when the parent config
   * exposes operations to external agents. Ignored entirely when the parent
   * has no `mcp` block. See {@link MCPConfig} for the opt-in shape.
   */
  mcp?: {
    /** Agent-facing description; falls back to `label` when absent. */
    description?: string;
    /**
     * Hide this field from every generated MCP tool schema (both input and
     * output). Use for internal identifiers, audit columns, or derived
     * display-only fields that should not be set or surfaced to agents.
     */
    exclude?: boolean;
  };
}

// Action config: custom non-CRUD actions on records
export interface ActionConfig {
  label: string;
  scope: 'global' | 'record' | 'bulk';

  service: Record<string, Function>;
  method: string;
  params?: (context: CRUDContext) => unknown;

  visible?: BoolExpr;

  confirm?: {
    message: string | ((context: CRUDContext) => string);
  };
}

// OpenUI config: navigation to another CRUDTable screen
export interface OpenUIConfig {
  id: string;
  mapContext: (parentContext: CRUDContext) => Partial<CRUDContext>;
}

// Custom F-key handler for list screen
export interface ListKeyConfig {
  label: string;
  handler: (ctx: CRUDContext) => Promise<void>;
}

/**
 * Relation — a parent→child navigation on the edit form of a CRUDTable.
 *
 * A relation adds a **single-key shortcut** to the parent record's edit form
 * that jumps straight into the list screen of another (child) `CRUDTableConfig`,
 * scoped to the currently edited parent record. It is the declarative answer to
 * "from a motorcycle's edit form, press M to see that bike's mods".
 *
 * ## Runtime contract
 *
 * When the user presses `actionKey` while the form is in `formMode === 'edit'`
 * and `editRecord` is populated, the runtime:
 *
 * 1. Looks up the target config via `registry.getConfig(targetConfigId)`; if
 *    missing, the keypress is ignored (no error surfaced).
 * 2. Calls `mapInput(editRecord)` and stores the result in
 *    `session.context['crud_' + targetConfigId + '_input']`. The child list's
 *    `services.list.params(ctx)` reads this via `ctx.input` — so whatever
 *    scoping key the child expects (e.g. `motorcycleId`) must be produced here.
 * 3. Pushes the parent's **form** screen ID onto `session.screenStack` so
 *    Esc / F3 / F12 from the child list (or from the child's own form) returns
 *    to the parent form in its current state.
 * 4. Sets `session.currentScreen` to the child's list screen and renders it.
 *
 * Relations are **only active in edit mode** — never on the create form
 * (where `editRecord` is `null`). The relation appears in the form status bar
 * as `K=Label` (e.g. `M=Mods`) and in the `navigation.form.actions` metadata
 * sent to the client, so the client can bind the key.
 *
 * ## Requirements on the child config
 *
 * - It must be registered in `server/src/configs/index.ts`.
 * - Its `services.list.params(ctx)` must read scoping from `ctx.input` using
 *   the same keys produced by `mapInput`.
 * - Its create/update/delete service `params` should echo the scoping keys back
 *   into the mutation so orphaned rows can't be created (see `modsConfig.ts`).
 * - Typically use `listHeader(ctx)` to show the parent label on the child list,
 *   reading a `*Label` key produced by `mapInput` (e.g. `motorcycleLabel`).
 *
 * ## Example
 *
 * ```ts
 * // In motorcyclesConfig:
 * relations: [
 *   {
 *     label: 'Mods',
 *     actionKey: 'M',
 *     targetConfigId: 'mods',
 *     mapInput: (rec) => ({
 *       motorcycleId: rec.id,
 *       motorcycleLabel: `${rec.brand} ${rec.model} ${rec.year}`,
 *     }),
 *   },
 * ]
 *
 * // In modsConfig:
 * services: {
 *   list: {
 *     service: modsService,
 *     method: 'listMods',
 *     params: (ctx) => ({ motorcycleId: ctx.input.motorcycleId as number }),
 *   },
 *   // create/update/delete also echo motorcycleId from ctx.input
 * }
 * ```
 *
 * See `server/src/configs/motorcyclesConfig.ts` (parent with two relations) and
 * `server/src/configs/modsConfig.ts` + `servicesPerformedConfig.ts` (scoped
 * children) for the canonical example.
 */
export interface RelationConfig {
  /** Label rendered in the parent form's status bar, e.g. `'Mods'`. */
  label: string;

  /**
   * Single-character hotkey pressed on the parent form to open the child list.
   * Compared case-insensitively against `request.key`. Conventionally uppercase
   * (`'M'`, `'S'`). Must not collide with a form field's key handling or with
   * `F3`/`F12`/`Esc` (reserved for Back) or `Enter` (reserved for Submit).
   */
  actionKey: string;

  /**
   * `id` of the child `CRUDTableConfig` (lowercase-snake, e.g. `'mods'`). The
   * runtime resolves this via `getConfig(targetConfigId)` at keypress time; an
   * unknown id silently no-ops.
   */
  targetConfigId: string;

  /**
   * Project the parent `editRecord` into the input context that will be seeded
   * on the child as `ctx.input`. The returned object is stored verbatim at
   * `session.context['crud_' + targetConfigId + '_input']`. At minimum include
   * the foreign-key needed by the child's list/create/update/delete params; a
   * human-readable label (e.g. `motorcycleLabel`) is conventional so the child
   * `listHeader` can show it.
   */
  mapInput: (ctx: CRUDContext) => Record<string, unknown>;
}

/**
 * Per-operation override inside {@link MCPConfig.operations}. When a bare
 * `true` is not enough (e.g. you want to tighten the permission or reword the
 * description for agents), pass this object instead.
 */
export interface MCPOperationOverride {
  /** Per-op description override. Falls back to {@link MCPConfig.description}. */
  description?: string;
  /**
   * Additional permission required to invoke this operation over MCP, **on
   * top of** any permission on `CRUDTableConfig.requirePermission` and
   * `ServiceCall.requirePermission`. All three are re-checked on every MCP
   * tool call.
   */
  requirePermission?: string;
}

/**
 * A scoping parameter that agents must pass with every tool call for a
 * parent-scoped config. The runtime copies these values into the synthesized
 * `CRUDContext.input` before validators and service `params` run — mirroring
 * the keys a {@link RelationConfig}'s `mapInput` would emit in the in-process
 * UI flow.
 *
 * Example for `modsConfig` (scoped by its parent motorcycle):
 * ```ts
 * scope: [{
 *   name: 'motorcycleId',
 *   type: 'number',
 *   required: true,
 *   description: 'ID of the parent motorcycle whose mods to operate on.',
 * }]
 * ```
 *
 * ## Server-injected params (`injectFromAuth`)
 *
 * When `injectFromAuth` is set, the param is **never exposed in the tool
 * schema** — agents cannot supply it. Instead the MCP runtime injects the
 * value from the authenticated caller (`McpCallUser`) before
 * `synthesizeContext` runs, so `ctx.input[name]` is always the authenticated
 * user's own value. This is the correct pattern for `userId` on any config
 * that must be scoped to the calling user:
 *
 * ```ts
 * scope: [{
 *   name: 'userId',
 *   type: 'number',
 *   required: true,
 *   description: 'Injected from the OAuth token — not a tool input.',
 *   injectFromAuth: 'userId',
 * }]
 * ```
 *
 * The service `params` function continues to read `ctx.input.userId as number`
 * unchanged; the only difference is where the value originates.
 */
export interface MCPScopeParam {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  /** Agent-facing description. Should be specific — agents rely on it. */
  description: string;
  /**
   * When present, this param is **omitted from the generated tool schema** and
   * its value is automatically injected from the authenticated caller. Only
   * `'userId'` is supported today; the union can be widened as needed.
   *
   * - `'userId'` → injected from `McpCallUser.userId` (the integer id that
   *   corresponds to `auth_tokens.user_id` for the active OAuth session).
   */
  injectFromAuth?: 'userId';
}

/**
 * MCP (Model Context Protocol) exposure block for a {@link CRUDTableConfig}.
 *
 * **Presence of this block is the opt-in signal.** A config without `mcp` is
 * never exposed over MCP regardless of any other setting. Within the block,
 * each entry in `operations` is a second, per-operation opt-in: only explicit
 * `true` (or an override object) causes a tool to be generated.
 *
 * The MCP runtime re-checks AS500 RBAC on every tool call — `requirePermission`
 * on the config, on each referenced `ServiceCall`, and any override here —
 * before invoking the underlying service.
 */
export interface MCPConfig {
  /** Agent-facing short name. Defaults to `config.id` when absent. */
  name?: string;

  /**
   * **Required** free-form description shown to agents whenever any operation
   * is exposed. This is the single most important field for tool discovery —
   * write it for an LLM that has never seen your system.
   */
  description: string;

  /**
   * Per-operation opt-in. A missing key or `false` means "not exposed".
   * `true` means "exposed with defaults". An {@link MCPOperationOverride}
   * object means "exposed with these overrides".
   *
   * `read` additionally requires `services.read` to be defined on the parent
   * config; the registry will refuse to load otherwise.
   */
  operations: {
    list?: boolean | MCPOperationOverride;
    read?: boolean | MCPOperationOverride;
    create?: boolean | MCPOperationOverride;
    update?: boolean | MCPOperationOverride;
    delete?: boolean | MCPOperationOverride;
  };

  /**
   * Scoping keys the caller must provide as tool parameters. Injected into
   * `ctx.input` before validators and service params run. See
   * {@link MCPScopeParam}.
   */
  scope?: MCPScopeParam[];

  /** Optional per-config rate-limit override. Both sides default from env. */
  rateLimit?: {
    readsPerMin?: number;
    writesPerMin?: number;
  };
}

/**
 * Per-operation override inside {@link APIConfig.operations}. Mirrors
 * {@link MCPOperationOverride} for the REST API layer.
 */
export interface APIOperationConfig {
  description?: string;
  requirePermission?: string;
}

/**
 * REST API exposure block for a {@link CRUDTableConfig}.
 *
 * Presence of this block is the opt-in signal. A config without `api` is never
 * exposed via REST. Routes are mounted at `/api/{name ?? id}[/{id}]` on the
 * MCP Express app (port 3002). Auth uses the same OAuth 2.1 Bearer tokens as MCP.
 *
 * RBAC is enforced identically to MCP: config.requirePermission →
 * services[op].requirePermission → api.operations[op].requirePermission.
 *
 * Scope params with `injectFromAuth` are server-injected from the Bearer token
 * and never accepted from the request — same pattern as {@link MCPScopeParam}.
 */
export interface APIConfig {
  /**
   * URL path segment for this resource. Defaults to `config.id` when absent.
   * Must be URL-safe (lowercase-snake recommended).
   */
  name?: string;

  description?: string;

  operations?: {
    list?:   boolean | APIOperationConfig;
    read?:   boolean | APIOperationConfig;
    create?: boolean | APIOperationConfig;
    update?: boolean | APIOperationConfig;
    delete?: boolean | APIOperationConfig;
  };

  /** Scope params injected into `ctx.input` for every request. Params with
   * `injectFromAuth` are server-injected — never accepted from callers. */
  scope?: MCPScopeParam[];
}

// Main CRUDTable config
export interface CRUDTableConfig {
  id: string;
  title: string;

  requireAuth?: boolean;
  requirePermission?: string; // Permission key required to access this screen at all

  services: {
    list: ServiceCall;
    /**
     * Fetch a single record by primary key. Required for `mcp.operations.read`
     * and — when present — used by the MCP runtime to resolve `editRecord` for
     * update and `selection[0]` for delete calls.
     *
     * Contract: `params` receives a synthesized `CRUDContext` where
     * `ctx.input.id` is the primary-key value supplied by the caller. The
     * method must return the full record object or `null` when not found.
     */
    read?: ServiceCall;
    create?: ServiceCall;
    update?: ServiceCall;
    delete?: ServiceCall;
  };

  getInitialValues?: (context: CRUDContext) => Record<string, string>;

  fieldConfigs: Record<string, FieldConfig>;

  columnBuilder: string[];
  formBuilder: string[];
  /**
   * Max fields shown per form page. When set, the form shows this many fields
   * at a time and F7/F8 navigate between pages. 0 or absent = show all fields.
   */
  formPageSize?: number;

  actions?: Record<string, ActionConfig>;

  openUI?: OpenUIConfig;

  // Extension points for domain-specific behavior
  listKeys?: Record<string, ListKeyConfig>;
  listHeader?: (context: CRUDContext) => Array<{ row: number; col: number; content: string }>;

  // Keyboard navigation config for the list screen
  navigation?: {
    primaryAction?: 'edit' | 'open'; // Defaults to 'edit' if update service exists
    shortcuts?: Array<{ key: string; option: string | number; label: string }>;
  };

  /**
   * Parent→child navigations exposed as hotkeys on the **edit form** (never on
   * the create form). Each entry binds one key (e.g. `'M'`) to jump to another
   * registered CRUDTable's list, scoped via `mapInput(editRecord)` → `ctx.input`.
   *
   * The runtime pushes the current form screen onto `session.screenStack`
   * before navigating, so Esc returns to the parent form in place. See
   * {@link RelationConfig} for the full contract and
   * `server/src/configs/motorcyclesConfig.ts` for the canonical example.
   */
  relations?: RelationConfig[];

  /**
   * Opt this config into the remote MCP server, exposing one tool per enabled
   * operation (`<id>.list`, `<id>.read`, etc.). Absent = not exposed at all.
   *
   * See {@link MCPConfig} for the full shape. The registry validates at load
   * time that any exposed operation has a corresponding `ServiceCall` on
   * `services` and that `mcp.description` is present.
   */
  mcp?: MCPConfig;

  /**
   * Opt this config into the REST API layer, exposing CRUD endpoints at
   * `/api/{api.name ?? id}[/{id}]`. Absent = not exposed at all.
   *
   * See {@link APIConfig} for the full shape. The registry validates at load
   * time that any enabled operation has a corresponding `ServiceCall` on
   * `services`.
   */
  api?: APIConfig;
}
