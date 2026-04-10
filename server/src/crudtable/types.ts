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
  pageOffset: number;
  datasources: Record<string, Record<string, unknown>[]>;
}

// Service call: wires a config action to a service method
export interface ServiceCall {
  service: Record<string, Function>;
  method: string;
  params?: (context: CRUDContext) => unknown;
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

  datasource?: DatasourceConfig;

  form?: {
    type?: FieldType;
    visible?: BoolExpr;
    disabled?: BoolExpr;
    required?: BoolExpr;
    uppercase?: boolean;
    validators?: Validator[];
    hint?: string;
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

// Main CRUDTable config
export interface CRUDTableConfig {
  id: string;
  title: string;

  requireAuth?: boolean;
  requireAdmin?: boolean;

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
}
