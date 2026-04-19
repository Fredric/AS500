// CRUDTable Type Definitions
// Declarative config system for auto-generated CRUD screens

import type { Session } from '../types/index.js';
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
  datasources: Record<string, Record<string, unknown>[]>;
}

// Service call: wires a config action to a service method
export interface ServiceCall {
  service: Record<string, Function>;
  method: string;
  params?: (context: CRUDContext) => unknown;
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
    formValue?: (rawValue: unknown) => string;
  };

  column?: {
    width?: number;
    align?: 'left' | 'right' | 'center';
    cellRenderer?: (
      record: Record<string, unknown>,
      datasource?: Record<string, unknown>[]
    ) => string;
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
  handler: (context: CRUDContext, session: Session) => Promise<void>;
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
  mapInput: (editRecord: Record<string, unknown>) => Record<string, unknown>;
}

// Main CRUDTable config
export interface CRUDTableConfig {
  id: string;
  title: string;

  requireAuth?: boolean;
  requireAdmin?: boolean;
  requirePermission?: string; // Permission key required to access this screen at all

  services: {
    list: ServiceCall;
    create?: ServiceCall;
    update?: ServiceCall;
    delete?: ServiceCall;
  };

  getInitialValues?: (context: CRUDContext) => Record<string, string>;

  fieldConfigs: Record<string, FieldConfig>;

  columnBuilder: string[];
  formBuilder: string[];

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
}
