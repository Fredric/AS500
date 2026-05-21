// CRUDTable Context
// Maps CRUDContext to/from session.context with namespaced keys

import type { Session } from '../types/index.js';
import type { CRUDContext } from './types.js';

function key(configId: string, suffix: string): string {
  return `crud_${configId}_${suffix}`;
}

export function loadContext(session: Session, configId: string): CRUDContext {
  const ctx = session.context;
  return {
    records: (ctx[key(configId, 'records')] as Record<string, unknown>[]) || [],
    selection: (ctx[key(configId, 'selection')] as Record<string, unknown>[]) || [],
    values: (ctx[key(configId, 'values')] as Record<string, string>) || {},
    input: (ctx[key(configId, 'input')] as Record<string, unknown>) || {},
    user: session.username,
    formMode: (ctx[key(configId, 'formMode')] as CRUDContext['formMode']) || null,
    editRecord: (ctx[key(configId, 'editRecord')] as Record<string, unknown>) || null,
    pendingDeleteRecord: (ctx[key(configId, 'pendingDeleteRecord')] as Record<string, unknown>) || null,
    pageOffset: (ctx[key(configId, 'pageOffset')] as number) || 0,
    formPage: (ctx[key(configId, 'formPage')] as number) || 0,
    datasources: (ctx[key(configId, 'datasources')] as Record<string, Record<string, unknown>[]>) || {},
  };
}

export function saveContext(session: Session, configId: string, crudCtx: CRUDContext): void {
  const ctx = session.context;
  ctx[key(configId, 'records')] = crudCtx.records;
  ctx[key(configId, 'selection')] = crudCtx.selection;
  ctx[key(configId, 'values')] = crudCtx.values;
  ctx[key(configId, 'input')] = crudCtx.input;
  ctx[key(configId, 'formMode')] = crudCtx.formMode;
  ctx[key(configId, 'editRecord')] = crudCtx.editRecord;
  ctx[key(configId, 'pendingDeleteRecord')] = crudCtx.pendingDeleteRecord;
  ctx[key(configId, 'pageOffset')] = crudCtx.pageOffset;
  ctx[key(configId, 'formPage')] = crudCtx.formPage;
  ctx[key(configId, 'datasources')] = crudCtx.datasources;
}

export function clearContext(session: Session, configId: string): void {
  const prefix = `crud_${configId}_`;
  for (const k of Object.keys(session.context)) {
    if (k.startsWith(prefix)) {
      delete session.context[k];
    }
  }
}
