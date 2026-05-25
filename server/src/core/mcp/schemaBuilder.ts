// Config → Zod input-shape builder for MCP tools.
//
// The MCP SDK accepts a "raw zod shape" (Record<string, ZodType>) as a tool's
// input schema and handles JSON-Schema conversion internally. This module
// projects each `CRUDTableConfig` into one raw shape per enabled operation.
//
// Per-operation contract (section 3.2.4 of the spec):
//
//   list   →  { ...scope, limit?, offset?, filter? }
//   read   →  { ...scope, id }
//   create →  { ...scope, ...fields }
//   update →  { ...scope, id, ...fields }
//   delete →  { ...scope, id }
//
// Rules we inherit from FieldConfig:
//   - staticOptions → z.enum
//   - length        → z.string().max(length)
//   - type: 'numeric' → z.number()
//   - `mcp.exclude`  → field dropped entirely
//   - `mcp.description` or `label` → .describe(...)
//   - required      → inferred conservatively (see `isFieldRequired`)
//
// Datasource-backed fields are deliberately free-text in v1 (spec locked
// decision). Agents do their own lookups; we accept whatever they send.

import { z, type ZodType } from 'zod';
import type {
  CRUDTableConfig,
  FieldConfig,
  MCPScopeParam,
} from '../crudtable/types.js';

export type McpOp = 'list' | 'read' | 'create' | 'update' | 'delete';

export type ZodRawShape = Record<string, ZodType>;

// ============================================
// Scope → shape
// ============================================

function zodForScopeParam(p: MCPScopeParam): ZodType {
  let base: ZodType;
  switch (p.type) {
    case 'string':
      base = z.string();
      break;
    case 'number':
      base = z.number();
      break;
    case 'boolean':
      base = z.boolean();
      break;
  }
  base = base.describe(p.description);
  return p.required ? base : base.optional();
}

function scopeShape(config: CRUDTableConfig): ZodRawShape {
  const shape: ZodRawShape = {};
  for (const p of config.mcp?.scope ?? []) {
    // Server-injected params are never exposed in the tool schema — agents
    // cannot supply them. The value is populated from McpCallUser in
    // contextSynth.ts before service params run.
    if (p.injectFromAuth) continue;
    shape[p.name] = zodForScopeParam(p);
  }
  return shape;
}

// ============================================
// FieldConfig → shape (for create/update bodies)
// ============================================

/**
 * Conservative "is this field required for mutations?" heuristic.
 *
 * `form.required` may be a function of the CRUDContext — we can't evaluate it
 * without a real context, and a false negative (marking as optional when the
 * runtime would have required it) is safer than a false positive here: the
 * existing CRUDTable validators still run on the synthesized context and will
 * reject the call if the field really is required. A false *positive* would
 * make legitimate MCP calls fail with a schema error the agent can't fix.
 */
function isFieldRequired(field: FieldConfig): boolean {
  return field.form?.required === true;
}

function describe(field: FieldConfig): string {
  return field.mcp?.description ?? field.label;
}

function zodForField(field: FieldConfig): ZodType | null {
  if (field.mcp?.exclude) return null;

  let base: ZodType;
  if (field.staticOptions && field.staticOptions.length > 0) {
    const values = field.staticOptions.map((o) => o.value) as [string, ...string[]];
    base = z.enum(values);
  } else if (field.type === 'numeric') {
    // `length` for numeric fields bounds the digit count, not the value; we
    // enforce the numeric type and leave range validation to the underlying
    // CRUDTable validators.
    base = z.number();
  } else {
    base = z.string().max(field.length);
  }

  return base.describe(describe(field));
}

/**
 * Build the per-field portion of create/update input (everything that lives
 * on the form). Keyed by `field` as declared on the FieldConfig.
 */
function fieldBodyShape(config: CRUDTableConfig): {
  shape: ZodRawShape;
  required: Set<string>;
} {
  const shape: ZodRawShape = {};
  const required = new Set<string>();

  for (const name of config.formBuilder) {
    const fc = config.fieldConfigs[name];
    if (!fc) continue;
    const zt = zodForField(fc);
    if (!zt) continue;
    shape[name] = isFieldRequired(fc) ? zt : zt.optional();
    if (isFieldRequired(fc)) required.add(name);
  }

  return { shape, required };
}

// ============================================
// Primary-key parameter
// ============================================

/**
 * Every read/update/delete takes an `id` param. We expose it as `z.number()`
 * because every CRUDTable entity in this codebase uses a `serial` integer PK.
 * If a future config ships with a string PK we'll generalize this — but
 * guessing the PK type from config is more trouble than just fixing it when
 * the time comes.
 */
const idParam = z.number().int().describe('Primary key of the target record.');

// ============================================
// List parameters
// ============================================

/** Bounds from the spec decision: default 50, hard cap 500. */
export const LIST_LIMIT_DEFAULT = 50;
export const LIST_LIMIT_MAX = 500;

function listShape(config: CRUDTableConfig): ZodRawShape {
  return {
    ...scopeShape(config),
    limit: z
      .number()
      .int()
      .min(1)
      .max(LIST_LIMIT_MAX)
      .default(LIST_LIMIT_DEFAULT)
      .describe(
        `Max records to return (1..${LIST_LIMIT_MAX}). Defaults to ${LIST_LIMIT_DEFAULT}.`
      )
      .optional(),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe('0-based offset for pagination.')
      .optional(),
    filter: z
      .string()
      .describe(
        'Free-text filter. Interpretation is config-specific; some configs ' +
        'ignore this. Omit to list everything in scope.'
      )
      .optional(),
  };
}

// ============================================
// Public: build input shape for one operation
// ============================================

export function buildInputShape(
  config: CRUDTableConfig,
  op: McpOp
): ZodRawShape {
  const scope = scopeShape(config);

  switch (op) {
    case 'list':
      return listShape(config);

    case 'read':
      return { ...scope, id: idParam };

    case 'create': {
      const { shape } = fieldBodyShape(config);
      return { ...scope, ...shape };
    }

    case 'update': {
      const { shape } = fieldBodyShape(config);
      // For update, every field is optional — partial updates are the norm.
      // Clone into a fresh shape so we don't mutate create's result.
      const partial: ZodRawShape = {};
      for (const [k, v] of Object.entries(shape)) {
        partial[k] = v instanceof z.ZodOptional ? v : v.optional();
      }
      return { ...scope, id: idParam, ...partial };
    }

    case 'delete':
      return { ...scope, id: idParam };
  }
}

// ============================================
// Public: param-array → shape (for actions + standalone tools)
// ============================================

/**
 * Build a ZodRawShape from a raw {@link MCPScopeParam} array.
 *
 * Server-injected params (`injectFromAuth`) are excluded — agents cannot
 * supply them. All other params are mapped using the same rules as scope
 * params on CRUD tools.
 *
 * Used by the action and standalone-tool registration loops in `transport.ts`.
 */
export function buildParamInputShape(params: MCPScopeParam[]): ZodRawShape {
  const shape: ZodRawShape = {};
  for (const p of params) {
    if (p.injectFromAuth) continue;
    shape[p.name] = zodForScopeParam(p);
  }
  return shape;
}

// ============================================
// Public: tool name + description
// ============================================

export function toolName(configId: string, op: McpOp): string {
  return `${configId}_${op}`;
}

export function toolDescription(
  config: CRUDTableConfig,
  op: McpOp
): string {
  const mcp = config.mcp!;
  const opEntry = mcp.operations[op];
  const opOverride =
    typeof opEntry === 'object' && opEntry !== null ? opEntry.description : undefined;

  const verbPrefix: Record<McpOp, string> = {
    list: 'List',
    read: 'Read a single record from',
    create: 'Create a new record in',
    update: 'Update an existing record in',
    delete: 'Delete a record from',
  };

  return (
    opOverride ??
    `${verbPrefix[op]} ${config.title}. ${mcp.description}`
  );
}
