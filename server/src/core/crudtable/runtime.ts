// CRUDTable Runtime Engine
// Builds and handles list + form screens from declarative config

import type { Session, ClientRequest, ScreenResponse, ListNavigation } from '../types/index.js';
import type { CRUDTableConfig, CRUDContext, BoolExpr, FieldConfig, ServiceCall } from './types.js';
import { listScreenId, formScreenId, deleteConfirmScreenId, getConfig } from './registry.js';
import { loadContext, saveContext, clearContext } from './context.js';
import { hasPermission } from '../services/access.js';
import {
  defineScreen,
  render,
  header,
  text,
  subfile,
  form,
  field,
} from '../dsl/index.js';
import type { SubfileColumnDef, FieldDef } from '../dsl/types.js';
import { writeAuditEvent } from '../audit/writer.js';

const LIST_PAGE_SIZE = 12;
const LIST_START_ROW = 7;

// Check if a session has permission to execute a service call
function checkServicePermission(session: Session, svc: ServiceCall | undefined): boolean {
  if (!svc?.requirePermission) return true;

  return hasPermission(session, svc.requirePermission);
}

// Evaluate a BoolExpr
function evalBool(expr: BoolExpr | undefined, context: CRUDContext, defaultValue: boolean): boolean {
  if (expr === undefined) return defaultValue;
  if (typeof expr === 'boolean') return expr;
  return expr(context);
}

// Execute a service call
async function callService(
  service: Record<string, Function>,
  method: string,
  params?: unknown
): Promise<unknown> {
  const fn = service[method];
  if (!fn) throw new Error(`Service method '${method}' not found`);
  if (params !== undefined) {
    return await fn(params);
  }
  return await fn();
}

// Load datasources (cached in context)
async function loadDatasources(config: CRUDTableConfig, crudCtx: CRUDContext): Promise<void> {
  for (const [fieldKey, fieldConfig] of Object.entries(config.fieldConfigs)) {
    if (fieldConfig.datasource && !crudCtx.datasources[fieldKey]) {
      const ds = fieldConfig.datasource;
      const params = ds.params?.(crudCtx);
      const result = await callService(ds.service, ds.method, params);
      crudCtx.datasources[fieldKey] = result as Record<string, unknown>[];
    }
  }
}

// ============================================
// LIST SCREEN
// ============================================

export async function buildListScreen(
  config: CRUDTableConfig,
  session: Session,
  message?: string | null,
  messageType?: 'info' | 'warning' | 'error' | null
): Promise<Omit<ScreenResponse, 'sessionId'>> {
  const crudCtx = loadContext(session, config.id);

  // Load datasources
  await loadDatasources(config, crudCtx);

  // Fetch records
  const listParams = config.services.list.params?.(crudCtx);
  const records = await callService(
    config.services.list.service,
    config.services.list.method,
    listParams
  ) as Record<string, unknown>[];
  crudCtx.records = records;

  // Build subfile columns: Opt column + data columns from columnBuilder
  const columns: SubfileColumnDef[] = [
    { header: 'Opt', field: 'opt', width: 3, type: 'alpha' },
  ];

  for (const fieldKey of config.columnBuilder) {
    const fc = config.fieldConfigs[fieldKey];
    if (!fc) continue;

    columns.push({
      header: fc.label,
      key: fieldKey,
      width: fc.column?.width ?? fc.length,
      align: fc.column?.align,
    });
  }

  // Build option hints line (only show operations the user has permission for)
  const optionHints: string[] = [];
  if (config.services.update && checkServicePermission(session, config.services.update)) optionHints.push('2=Edit');
  if (config.services.delete && checkServicePermission(session, config.services.delete)) optionHints.push('4=Delete');

  // OpenUI gets option 9
  if (config.openUI) {
    optionHints.push('9=Open');
  }

  // Custom record actions get auto-numbered from 5 (skipping 9 if openUI exists)
  let actionNumber = 5;
  const actionOptionMap: Record<string, number> = {};
  if (config.actions) {
    for (const [actionKey, action] of Object.entries(config.actions)) {
      if (action.scope === 'record') {
        if (actionNumber === 9 && config.openUI) actionNumber = 10;
        actionOptionMap[actionKey] = actionNumber;
        optionHints.push(`${actionNumber}=${action.label}`);
        actionNumber++;
      }
    }
  }

  // Store action map in session for handler use
  session.context[`crud_${config.id}_actionMap`] = actionOptionMap;

  // Transform records for display using cellRenderers
  const displayRecords = records.map((record) => {
    const display: Record<string, unknown> = {};
    for (const fieldKey of config.columnBuilder) {
      const fc = config.fieldConfigs[fieldKey];
      if (!fc) continue;

      if (fc.column?.cellRenderer) {
        display[fieldKey] = fc.column.cellRenderer(crudCtx, record, crudCtx.datasources[fieldKey]);
      } else {
        display[fieldKey] = record[fc.field] ?? '';
      }
    }
    return display;
  });

  // Build navigation metadata
  const pageData = records.slice(crudCtx.pageOffset, crudCtx.pageOffset + LIST_PAGE_SIZE);
  const dataRowCount = pageData.length;

  // Determine primary action for keyboard navigation.
  // '2' (edit/view form) fires when there is either an update service OR a
  // non-empty formBuilder (e.g. read-only detail screens).
  const hasFormView = !!(config.services.update || config.formBuilder.length > 0);
  let primaryAction = '';
  if (config.navigation?.primaryAction === 'open' && config.openUI) {
    primaryAction = '9';
  } else if (config.navigation?.primaryAction === 'edit' && hasFormView) {
    primaryAction = '2';
  } else if (hasFormView) {
    primaryAction = '2';
  } else if (config.openUI) {
    primaryAction = '9';
  }

  // Build shortcut list for keyboard navigation
  const navShortcuts: ListNavigation['shortcuts'] = [];
  if (config.services.delete && checkServicePermission(session, config.services.delete)) {
    navShortcuts.push({ key: 'd', option: '4', label: 'Delete' });
  }
  if (config.navigation?.shortcuts) {
    for (const s of config.navigation.shortcuts) {
      navShortcuts.push({ key: String(s.key), option: String(s.option), label: s.label });
    }
  }
  // Add custom record action shortcuts (auto-numbered from 5)
  if (config.actions) {
    let actionNum = 5;
    for (const [, action] of Object.entries(config.actions)) {
      if (action.scope === 'record') {
        if (actionNum === 9 && config.openUI) actionNum = 10;
        navShortcuts.push({ key: String(actionNum), option: String(actionNum), label: action.label });
        actionNum++;
      }
    }
  }

  // Build status line with keyboard shortcut hints first, then F-keys
  const shortcutHints: string[] = [];
  if (primaryAction === '2') {
    shortcutHints.push(config.services.update ? 'Enter=Edit' : 'Enter=View');
  } else if (primaryAction === '9') {
    shortcutHints.push('Enter=Open');
  }
  if (config.services.delete && checkServicePermission(session, config.services.delete)) shortcutHints.push('D=Delete');
  if (config.navigation?.shortcuts) {
    for (const s of config.navigation.shortcuts) {
      shortcutHints.push(`${String(s.key).toUpperCase()}=${s.label}`);
    }
  }

  const fKeyParts: string[] = ['Esc=Exit'];
  if (config.services.create && checkServicePermission(session, config.services.create)) fKeyParts.push('N=New');
  if (config.listKeys) {
    const keyLabel: Record<string, string> = { F7: '←', F8: '→' };
    for (const [key, keyConfig] of Object.entries(config.listKeys)) {
      const displayKey = keyLabel[key] ?? key;
      fKeyParts.push(`${displayKey}=${keyConfig.label}`);
    }
  }

  // Build status line, truncating at 80 chars if needed
  const allParts = [...shortcutHints, ...fKeyParts];
  const statusParts: string[] = [];
  let statusLen = 0;
  for (const part of allParts) {
    const needed = statusLen === 0 ? part.length : 2 + part.length;
    if (statusLen + needed <= 80) {
      statusParts.push(part);
      statusLen += needed;
    } else {
      break;
    }
  }

  // Build dynamic header elements
  const headerElements = config.listHeader
    ? config.listHeader(crudCtx).map(h => text(h.row, h.col, h.content))
    : [];

  // Define screen
  const screenId = listScreenId(config.id);
  const screenDef = defineScreen(screenId, {
    elements: [
      header({ system: 'AS500 SYSTEM', title: config.title.toUpperCase(), showDateTime: true, showUser: true }),
      //text(5, 2, 'Type option and press Enter.'),
      //text(5, 32, optionHints.join('  ')),
      ...headerElements,
      subfile('data', LIST_START_ROW, LIST_PAGE_SIZE, columns),
    ],
    statusLine: statusParts.join('  ').substring(0, 80),
    defaultCursor: 'opt_0',
  });

  // Render
  const result = render(
    screenDef,
    { data: displayRecords, data_offset: crudCtx.pageOffset },
    { message, messageType, user: session.username || 'UNKNOWN' }
  );

  saveContext(session, config.id, crudCtx);

  // DATA_START_ROW: subfile header is at LIST_START_ROW, underline at +1, data starts at +2
  const DATA_START_ROW = LIST_START_ROW + 2;

  return {
    screenId: result.screenId,
    cursor: result.cursor,
    rows: result.rows,
    fields: result.fields,
    message: result.message,
    messageType: result.messageType,
    statusLine: result.statusLine,
    bell: result.bell,
    navigation: {
      type: 'list' as const,
      list: {
        dataStartRow: DATA_START_ROW,
        dataRowCount,
        totalRecords: records.length,
        pageOffset: crudCtx.pageOffset,
        hasMore: records.length > crudCtx.pageOffset + LIST_PAGE_SIZE,
        hasPrev: crudCtx.pageOffset > 0,
        optFieldPrefix: 'opt',
        primaryAction,
        shortcuts: navShortcuts,
      },
    },
  };
}

export async function handleList(
  config: CRUDTableConfig,
  session: Session,
  request: ClientRequest
): Promise<ScreenResponse> {
  const base = { sessionId: session.id };
  const crudCtx = loadContext(session, config.id);

  // F3 - Exit to previous screen
  if (request.key === 'F3') {
    const prevScreen = session.screenStack.pop() || 'MAIN_MENU';
    session.currentScreen = prevScreen;
    clearContext(session, config.id);
    return { ...(await buildReturnScreen(session)), ...base };
  }

  // F12 - Cancel (same as F3)
  if (request.key === 'F12') {
    const prevScreen = session.screenStack.pop() || 'MAIN_MENU';
    session.currentScreen = prevScreen;
    clearContext(session, config.id);
    return { ...(await buildReturnScreen(session)), ...base };
  }

  // F6 - Create new record
  if (request.key === 'F6' && config.services.create) {
    if (!checkServicePermission(session, config.services.create)) {
      return {
        ...(await buildListScreen(config, session, 'Access denied: cannot create records', 'error')),
        ...base,
      };
    }
    crudCtx.formMode = 'create';
    crudCtx.editRecord = null;
    crudCtx.formPage = 0;
    saveContext(session, config.id, crudCtx);

    session.screenStack.push(listScreenId(config.id));
    session.currentScreen = formScreenId(config.id);

    return {
      ...(await buildFormScreen(config, session)),
      ...base,
    };
  }

  // PAGEDOWN
  if (request.key === 'PAGEDOWN') {
    const maxOffset = Math.max(0, crudCtx.records.length - LIST_PAGE_SIZE);
    crudCtx.pageOffset = Math.min(crudCtx.pageOffset + LIST_PAGE_SIZE, maxOffset);
    saveContext(session, config.id, crudCtx);

    return {
      ...(await buildListScreen(config, session)),
      ...base,
    };
  }

  // PAGEUP
  if (request.key === 'PAGEUP') {
    crudCtx.pageOffset = Math.max(0, crudCtx.pageOffset - LIST_PAGE_SIZE);
    saveContext(session, config.id, crudCtx);

    return {
      ...(await buildListScreen(config, session)),
      ...base,
    };
  }

  // Custom F-key handlers
  if (config.listKeys?.[request.key]) {
    const keyConfig = config.listKeys[request.key];
    await keyConfig.handler(crudCtx);
    saveContext(session, config.id, crudCtx);

    return {
      ...(await buildListScreen(config, session)),
      ...base,
    };
  }

  // ENTER - Process option selections
  if (request.key === 'ENTER') {
    const records = crudCtx.records;
    const actionMap = (session.context[`crud_${config.id}_actionMap`] as Record<string, number>) || {};

    // Reverse map: option number -> action key
    const reverseActionMap: Record<number, string> = {};
    for (const [actionKey, optNum] of Object.entries(actionMap)) {
      reverseActionMap[optNum] = actionKey;
    }

    for (let i = 0; i < records.length; i++) {
      const opt = request.input[`opt_${i}`]?.trim();
      if (!opt || opt === '') continue;

      const optNum = parseInt(opt, 10);

      // Option 2 - Edit (or view-only detail when no update service but formBuilder is defined)
      if (opt === '2' && (config.services.update || config.formBuilder.length > 0)) {
        if (config.services.update && !checkServicePermission(session, config.services.update)) {
          return {
            ...(await buildListScreen(config, session, 'Access denied: cannot edit records', 'error')),
            ...base,
          };
        }
        crudCtx.formMode = 'edit';
        crudCtx.editRecord = records[i];
        crudCtx.selection = [records[i]];
        crudCtx.formPage = 0;
        saveContext(session, config.id, crudCtx);

        session.screenStack.push(listScreenId(config.id));
        session.currentScreen = formScreenId(config.id);

        return {
          ...(await buildFormScreen(config, session)),
          ...base,
        };
      }

      // Option 4 - Delete (navigate to confirmation screen)
      if (opt === '4' && config.services.delete) {
        if (!checkServicePermission(session, config.services.delete)) {
          return {
            ...(await buildListScreen(config, session, 'Access denied: cannot delete records', 'error')),
            ...base,
          };
        }
        crudCtx.pendingDeleteRecord = records[i];
        crudCtx.selection = [records[i]];
        saveContext(session, config.id, crudCtx);

        session.screenStack.push(listScreenId(config.id));
        session.currentScreen = deleteConfirmScreenId(config.id);

        return {
          ...(await buildDeleteConfirmScreen(config, session)),
          ...base,
        };
      }

      // Option 9 - OpenUI
      if (opt === '9' && config.openUI) {
        const targetConfig = getConfig(config.openUI.id);
        if (targetConfig) {
          crudCtx.selection = [records[i]];
          const derivedCtx = config.openUI.mapContext(crudCtx);

          session.screenStack.push(listScreenId(config.id));
          const targetScreenId = listScreenId(targetConfig.id);
          session.currentScreen = targetScreenId;

          // Initialize target context with derived values
          if (derivedCtx.input) {
            session.context[`crud_${targetConfig.id}_input`] = derivedCtx.input;
          }

          saveContext(session, config.id, crudCtx);

          return {
            ...(await buildListScreen(targetConfig, session)),
            ...base,
          };
        }
      }

      // Custom record actions
      if (!isNaN(optNum) && reverseActionMap[optNum]) {
        const actionKey = reverseActionMap[optNum];
        const action = config.actions![actionKey];

        crudCtx.selection = [records[i]];
        try {
          const actionParams = action.params?.(crudCtx);
          await callService(action.service, action.method, actionParams);

          crudCtx.selection = [];
          saveContext(session, config.id, crudCtx);

          return {
            ...(await buildListScreen(config, session, `${action.label} completed`, 'info')),
            ...base,
            fieldValues: {},
          };
        } catch (error) {
          console.error(`CRUDTable action '${actionKey}' error:`, error);
          return {
            ...(await buildListScreen(config, session, `${action.label} failed`, 'error')),
            ...base,
          };
        }
      }

      // Invalid option
      return {
        ...(await buildListScreen(config, session, `Invalid option '${opt}'`, 'error')),
        ...base,
      };
    }

    // No option entered - refresh
    return {
      ...(await buildListScreen(config, session)),
      ...base,
    };
  }

  // Default - show screen
  return {
    ...(await buildListScreen(config, session)),
    ...base,
  };
}

// ============================================
// FORM SCREEN
// ============================================

export async function buildFormScreen(
  config: CRUDTableConfig,
  session: Session,
  message?: string | null,
  messageType?: 'info' | 'warning' | 'error' | null
): Promise<Omit<ScreenResponse, 'sessionId'>> {
  const crudCtx = loadContext(session, config.id);

  // Load datasources
  await loadDatasources(config, crudCtx);

  const isCreate = crudCtx.formMode === 'create';
  const title = isCreate
    ? `CREATE ${config.title.toUpperCase()}`
    : config.services.update
      ? `EDIT ${config.title.toUpperCase()}`
      : config.title.toUpperCase();

  // ---- Pagination setup ----
  const pageSize = config.formPageSize ?? 0;

  // Collect the full ordered list of visible field keys (across all pages)
  const visibleKeys = config.formBuilder.filter(k => {
    const fc = config.fieldConfigs[k];
    if (!fc) return false;
    if (fc.form?.visible !== undefined && !evalBool(fc.form.visible, crudCtx, true)) return false;
    return true;
  });

  const totalPages = pageSize > 0 ? Math.ceil(visibleKeys.length / pageSize) : 1;
  const currentPage = pageSize > 0
    ? Math.max(0, Math.min(crudCtx.formPage, totalPages - 1))
    : 0;
  const pageKeys = pageSize > 0
    ? visibleKeys.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
    : visibleKeys;

  // Build field values for ALL visible fields (needed so values persist across pages)
  let fieldValues: Record<string, string> = {};

  if (isCreate && config.getInitialValues) {
    fieldValues = config.getInitialValues(crudCtx);
  } else if (!isCreate && crudCtx.editRecord) {
    for (const fieldKey of visibleKeys) {
      const fc = config.fieldConfigs[fieldKey];
      if (!fc) continue;
      const val = crudCtx.editRecord[fc.field];
      if (fc.form?.formValue) {
        fieldValues[fc.field] = fc.form.formValue(crudCtx, val);
      } else {
        fieldValues[fc.field] = val !== null && val !== undefined ? String(val) : '';
      }
    }
    // Also merge any values saved from other pages
    for (const [k, v] of Object.entries(crudCtx.values)) {
      if (!(k in fieldValues)) fieldValues[k] = v;
    }
  }

  // Build form rows from the current page's keys only
  const formRows: Array<[string, FieldDef]> = [];
  let firstFieldName: string | undefined;

  for (const fieldKey of pageKeys) {
    const fc = config.fieldConfigs[fieldKey];
    if (!fc) continue;

    const isDisabled = evalBool(fc.form?.disabled, crudCtx, false);
    const isRequired = evalBool(fc.form?.required, crudCtx, false);
    const fieldType = isDisabled ? 'readonly' as const : (fc.form?.type ?? fc.type ?? 'alpha' as const);

    const fieldDef = field(fc.field, fc.length, fieldType, {
      required: isRequired,
      uppercase: fc.form?.uppercase,
    });

    const labelText = `${fc.label} . . . :`;
    formRows.push([labelText, fieldDef]);

    if (!firstFieldName && !isDisabled) {
      firstFieldName = fc.field;
    }
  }

  // Build hint elements for the current page's fields
  const hintElements = [];
  let hintRowIndex = 0;
  for (const fieldKey of pageKeys) {
    const fc = config.fieldConfigs[fieldKey];
    if (!fc) continue;
    if (fc.form?.hint) {
      const hintCol = 30 + fc.length + 2;
      hintElements.push(text(7 + hintRowIndex, hintCol, fc.form.hint));
    }
    hintRowIndex++;
  }

  // Page indicator element (row 5) — only shown when there are multiple pages
  const pageIndicatorElements = totalPages > 1
    ? [text(5, 2, `Page ${currentPage + 1} of ${totalPages}`)]
    : [];

  // Build status line: page nav + Esc=Back + relation hotkeys
  const statusParts: string[] = [];
  if (totalPages > 1) {
    if (currentPage > 0) statusParts.push('↑/F7=Prev');
    if (currentPage < totalPages - 1) statusParts.push('↓/F8=Next');
  }
  statusParts.push('Esc=Back');
  if (config.relations) {
    for (const rel of config.relations) {
      statusParts.push(`${rel.actionKey.toUpperCase()}=${rel.label}`);
    }
  }
  const formStatusLine = statusParts.join('  ');

  const screenId = formScreenId(config.id);
  const screenDef = defineScreen(screenId, {
    elements: [
      header({ system: 'AS500 SYSTEM', title, showDateTime: true, showUser: true }),
      ...pageIndicatorElements,
      form(7, formRows, { labelCol: 8, fieldCol: 30 }),
      ...hintElements,
    ],
    statusLine: formStatusLine,
    defaultCursor: firstFieldName,
  });

  const result = render(screenDef, fieldValues, {
    message,
    messageType,
    user: session.username || 'UNKNOWN',
  });

  // Attach dropdown options to rendered fields
  for (const renderedField of result.fields) {
    const fieldKey = config.formBuilder.find(k => config.fieldConfigs[k]?.field === renderedField.name);
    if (!fieldKey) continue;
    const fc = config.fieldConfigs[fieldKey];
    if (!fc) continue;

    if (fc.staticOptions) {
      renderedField.options = fc.staticOptions;
    } else if (fc.datasource && crudCtx.datasources[fieldKey]) {
      renderedField.options = crudCtx.datasources[fieldKey].map(row => ({
        value: String(row[fc.datasource!.valueField] ?? ''),
        display: String(row[fc.datasource!.displayField] ?? ''),
      }));
    }
  }

  // Build form navigation actions (Esc=Back + relation hotkeys)
  const formNavActions: Array<{ key: string; label: string }> = [
    { key: 'F3', label: 'Esc=Back' },
  ];
  if (config.relations) {
    for (const rel of config.relations) {
      formNavActions.push({
        key: rel.actionKey.toUpperCase(),
        label: `${rel.actionKey.toUpperCase()}=${rel.label}`,
      });
    }
  }

  saveContext(session, config.id, crudCtx);

  return {
    screenId: result.screenId,
    cursor: result.cursor,
    rows: result.rows,
    fields: result.fields,
    fieldValues: Object.keys(fieldValues).length > 0 ? fieldValues : undefined,
    message: result.message,
    messageType: result.messageType,
    statusLine: result.statusLine,
    bell: result.bell,
    navigation: {
      type: 'form' as const,
      form: { actions: formNavActions },
    },
  };
}

export async function handleForm(
  config: CRUDTableConfig,
  session: Session,
  request: ClientRequest
): Promise<ScreenResponse> {
  const base = { sessionId: session.id };
  const crudCtx = loadContext(session, config.id);

  // Relation hotkeys — only available when editing an existing record
  if (config.relations && crudCtx.formMode === 'edit' && crudCtx.editRecord) {
    for (const rel of config.relations) {
      if (request.key === rel.actionKey || request.key === rel.actionKey.toUpperCase()) {
        const targetConfig = getConfig(rel.targetConfigId);
        if (targetConfig) {
          session.context[`crud_${rel.targetConfigId}_input`] = rel.mapInput(crudCtx);
          session.screenStack.push(formScreenId(config.id));
          session.currentScreen = listScreenId(rel.targetConfigId);
          saveContext(session, config.id, crudCtx);
          return { ...(await buildListScreen(targetConfig, session)), ...base };
        }
      }
    }
  }

  // F3 or F12 - Cancel, return to list
  if (request.key === 'F3' || request.key === 'F12') {
    crudCtx.formMode = null;
    crudCtx.editRecord = null;
    crudCtx.formPage = 0;
    saveContext(session, config.id, crudCtx);

    session.currentScreen = session.screenStack.pop() || listScreenId(config.id);

    return {
      ...(await buildListScreen(config, session)),
      ...base,
    };
  }

  // F7 / F8 / ArrowUp / ArrowDown — previous / next form page (only active when formPageSize is set)
  if (request.key === 'F7' || request.key === 'F8' || request.key === 'ArrowUp' || request.key === 'ArrowDown') {
    const pageSize = config.formPageSize ?? 0;
    if (pageSize > 0) {
      // Save any editable values entered on this page before navigating
      for (const fieldKey of config.formBuilder) {
        const fc = config.fieldConfigs[fieldKey];
        if (!fc) continue;
        if (fc.form?.visible !== undefined && !evalBool(fc.form.visible, crudCtx, true)) continue;
        if (evalBool(fc.form?.disabled, crudCtx, false)) continue;
        const v = request.input[fc.field];
        if (v !== undefined) crudCtx.values[fc.field] = String(v).trim();
      }

      const visibleCount = config.formBuilder.filter(k => {
        const fc = config.fieldConfigs[k];
        if (!fc) return false;
        if (fc.form?.visible !== undefined && !evalBool(fc.form.visible, crudCtx, true)) return false;
        return true;
      }).length;
      const totalPages = Math.ceil(visibleCount / pageSize);

      if (request.key === 'F7' || request.key === 'ArrowUp') {
        crudCtx.formPage = Math.max(0, crudCtx.formPage - 1);
      } else {
        crudCtx.formPage = Math.min(totalPages - 1, crudCtx.formPage + 1);
      }
      saveContext(session, config.id, crudCtx);
      return { ...(await buildFormScreen(config, session)), ...base };
    }
  }

  // ENTER - Submit form
  if (request.key === 'ENTER') {
    const isCreate = crudCtx.formMode === 'create';

    // Collect values from request.input
    const values: Record<string, string> = {};
    for (const fieldKey of config.formBuilder) {
      const fc = config.fieldConfigs[fieldKey];
      if (!fc) continue;

      // Skip invisible/disabled fields
      if (fc.form?.visible !== undefined && !evalBool(fc.form.visible, crudCtx, true)) continue;
      if (evalBool(fc.form?.disabled, crudCtx, false)) continue;

      values[fc.field] = request.input[fc.field]?.trim() ?? '';
    }

    crudCtx.values = values;

    // Run required checks
    for (const fieldKey of config.formBuilder) {
      const fc = config.fieldConfigs[fieldKey];
      if (!fc) continue;

      if (fc.form?.visible !== undefined && !evalBool(fc.form.visible, crudCtx, true)) continue;
      if (evalBool(fc.form?.disabled, crudCtx, false)) continue;

      const isRequired = evalBool(fc.form?.required, crudCtx, false);
      if (isRequired && !values[fc.field]) {
        return {
          ...(await buildFormScreen(config, session, `${fc.label} is required`, 'error')),
          ...base,
        };
      }
    }

    // Run custom validators
    for (const fieldKey of config.formBuilder) {
      const fc = config.fieldConfigs[fieldKey];
      if (!fc?.form?.validators) continue;

      if (fc.form?.visible !== undefined && !evalBool(fc.form.visible, crudCtx, true)) continue;
      if (evalBool(fc.form?.disabled, crudCtx, false)) continue;

      for (const validator of fc.form.validators) {
        const error = validator(crudCtx);
        if (error) {
          return {
            ...(await buildFormScreen(config, session, error, 'error')),
            ...base,
          };
        }
      }
    }

    // Call create or update service
    const opStart = Date.now();
    try {
      if (isCreate && config.services.create) {
        if (!checkServicePermission(session, config.services.create)) {
          return {
            ...(await buildFormScreen(config, session, 'Access denied: cannot create records', 'error')),
            ...base,
          };
        }
        const createParams = (await config.services.create.params?.(crudCtx)) ?? values;
        await callService(config.services.create.service, config.services.create.method, createParams);
        void writeAuditEvent({
          event_type: 'crud',
          action: 'create',
          source: 'terminal',
          user_id: session.viserId ?? null,
          username: session.username ?? null,
          config_id: config.id,
          ok: true,
          duration_ms: Date.now() - opStart,
          after_data: createParams as Record<string, unknown>,
        });
      } else if (!isCreate && config.services.update) {
        if (!checkServicePermission(session, config.services.update)) {
          return {
            ...(await buildFormScreen(config, session, 'Access denied: cannot edit records', 'error')),
            ...base,
          };
        }
        const updateParams = config.services.update.params?.(crudCtx) ?? values;
        const beforeSnap = crudCtx.editRecord ? { ...crudCtx.editRecord } as Record<string, unknown> : null;
        await callService(config.services.update.service, config.services.update.method, updateParams);
        void writeAuditEvent({
          event_type: 'crud',
          action: 'update',
          source: 'terminal',
          user_id: session.viserId ?? null,
          username: session.username ?? null,
          config_id: config.id,
          record_id: beforeSnap?.id != null ? String(beforeSnap.id) : null,
          ok: true,
          duration_ms: Date.now() - opStart,
          before_data: beforeSnap,
          after_data: updateParams as Record<string, unknown>,
        });
      }

      // Return to list — show success message only when a service actually ran
      crudCtx.formMode = null;
      crudCtx.editRecord = null;
      crudCtx.values = {};
      saveContext(session, config.id, crudCtx);

      session.currentScreen = session.screenStack.pop() || listScreenId(config.id);

      const didRun = (isCreate && !!config.services.create) || (!isCreate && !!config.services.update);
      const msg = didRun ? (isCreate ? 'Record created' : 'Record updated') : null;
      return {
        ...(await buildListScreen(config, session, msg, msg ? 'info' : null)),
        ...base,
      };
    } catch (error) {
      console.error('CRUDTable form submit error:', error);
      const isCreate2 = crudCtx.formMode === 'create';
      void writeAuditEvent({
        event_type: 'crud',
        action: isCreate2 ? 'create' : 'update',
        source: 'terminal',
        user_id: session.viserId ?? null,
        username: session.username ?? null,
        config_id: config.id,
        ok: false,
        error_code: error instanceof Error ? error.message.substring(0, 64) : 'unknown',
        duration_ms: Date.now() - opStart,
      });
      const fallback = isCreate ? 'Error creating record' : 'Error updating record';
      const msg = error instanceof Error ? error.message : fallback;
      return {
        ...(await buildFormScreen(config, session, msg, 'error')),
        ...base,
      };
    }
  }

  // Default - show form
  return {
    ...(await buildFormScreen(config, session)),
    ...base,
  };
}

// ============================================
// DELETE CONFIRMATION SCREEN
// ============================================

export async function buildDeleteConfirmScreen(
  config: CRUDTableConfig,
  session: Session,
  message?: string | null,
  messageType?: 'info' | 'warning' | 'error' | null
): Promise<Omit<ScreenResponse, 'sessionId'>> {
  const crudCtx = loadContext(session, config.id);

  // Build a summary of the record fields for display
  const CONFIRM_SCREEN_LEFT_MARGIN = 10;
  const CONFIRM_LINE_MAX_LENGTH = 80 - CONFIRM_SCREEN_LEFT_MARGIN;
  const recordTextElements = [];
  const record = crudCtx.pendingDeleteRecord ?? {};
  let displayRow = 9;
  for (const fieldKey of config.columnBuilder) {
    const fc = config.fieldConfigs[fieldKey];
    if (!fc) continue;
    const val = record[fc.field] ?? '';
    const lineContent = `${fc.label} . . . : ${String(val)}`.substring(0, CONFIRM_LINE_MAX_LENGTH);
    recordTextElements.push(text(displayRow, CONFIRM_SCREEN_LEFT_MARGIN, lineContent));
    displayRow++;
    if (displayRow > 17) break;
  }

  const screenId = deleteConfirmScreenId(config.id);
  const screenDef = defineScreen(screenId, {
    elements: [
      header({ system: 'AS500 SYSTEM', title: `CONFIRM DELETE - ${config.title.toUpperCase()}`, showDateTime: true, showUser: true }),
      text(7, 2, 'The following record will be permanently deleted:'),
      ...recordTextElements,
      text(19, 2, 'Type Y to confirm, or press Esc / F3 / F12 to cancel.'),
      form(20, [['Confirm delete . . :', field('confirm', 1, 'alpha', { uppercase: true })]], { labelCol: 2, fieldCol: 22 }),
    ],
    statusLine: 'Y=Confirm  Esc=Cancel  F3=Cancel  F12=Cancel',
    defaultCursor: 'confirm',
  });

  const result = render(screenDef, {}, {
    message,
    messageType,
    user: session.username || 'UNKNOWN',
  });

  return {
    screenId: result.screenId,
    cursor: result.cursor,
    rows: result.rows,
    fields: result.fields,
    message: result.message,
    messageType: result.messageType,
    statusLine: result.statusLine,
    bell: result.bell,
  };
}

export async function handleDeleteConfirm(
  config: CRUDTableConfig,
  session: Session,
  request: ClientRequest
): Promise<ScreenResponse> {
  const base = { sessionId: session.id };
  const crudCtx = loadContext(session, config.id);

  // F3, F12, or Escape - cancel and return to list
  if (request.key === 'F3' || request.key === 'F12' || request.key === 'ESCAPE') {
    crudCtx.pendingDeleteRecord = null;
    crudCtx.selection = [];
    saveContext(session, config.id, crudCtx);

    session.currentScreen = session.screenStack.pop() || listScreenId(config.id);

    return {
      ...(await buildListScreen(config, session, 'Delete cancelled', 'info')),
      ...base,
    };
  }

  // ENTER - check confirmation value
  if (request.key === 'ENTER') {
    const confirmValue = (request.input['confirm'] ?? '').trim().toUpperCase();

    if (confirmValue !== 'Y') {
      // Not confirmed - return to list
      crudCtx.pendingDeleteRecord = null;
      crudCtx.selection = [];
      saveContext(session, config.id, crudCtx);

      session.currentScreen = session.screenStack.pop() || listScreenId(config.id);

      return {
        ...(await buildListScreen(config, session, 'Delete cancelled', 'info')),
        ...base,
      };
    }

    // Confirmed - perform deletion
    if (!config.services.delete) {
      crudCtx.pendingDeleteRecord = null;
      crudCtx.selection = [];
      saveContext(session, config.id, crudCtx);

      session.currentScreen = session.screenStack.pop() || listScreenId(config.id);

      return {
        ...(await buildListScreen(config, session, 'Delete not configured', 'error')),
        ...base,
      };
    }

    const deleteStart = Date.now();
    const deletedRecord = crudCtx.pendingDeleteRecord ? { ...crudCtx.pendingDeleteRecord } as Record<string, unknown> : null;
    try {
      const deleteParams = config.services.delete.params?.(crudCtx);
      await callService(config.services.delete.service, config.services.delete.method, deleteParams);

      void writeAuditEvent({
        event_type: 'crud',
        action: 'delete',
        source: 'terminal',
        user_id: session.viserId ?? null,
        username: session.username ?? null,
        config_id: config.id,
        record_id: deletedRecord?.id != null ? String(deletedRecord.id) : null,
        ok: true,
        duration_ms: Date.now() - deleteStart,
        before_data: deletedRecord,
      });

      crudCtx.pendingDeleteRecord = null;
      crudCtx.selection = [];
      saveContext(session, config.id, crudCtx);

      session.currentScreen = session.screenStack.pop() || listScreenId(config.id);

      return {
        ...(await buildListScreen(config, session, 'Record deleted', 'info')),
        ...base,
        fieldValues: {},
      };
    } catch (error) {
      console.error('CRUDTable delete error:', error);
      void writeAuditEvent({
        event_type: 'crud',
        action: 'delete',
        source: 'terminal',
        user_id: session.viserId ?? null,
        username: session.username ?? null,
        config_id: config.id,
        record_id: deletedRecord?.id != null ? String(deletedRecord.id) : null,
        ok: false,
        error_code: error instanceof Error ? error.message.substring(0, 64) : 'unknown',
        duration_ms: Date.now() - deleteStart,
        before_data: deletedRecord,
      });
      return {
        ...(await buildDeleteConfirmScreen(config, session, 'Failed to delete record', 'error')),
        ...base,
      };
    }
  }

  // Default - show confirm screen
  return {
    ...(await buildDeleteConfirmScreen(config, session)),
    ...base,
  };
}



// Build the appropriate return screen when navigating back
async function buildReturnScreen(session: Session): Promise<Omit<ScreenResponse, 'sessionId'>> {
  const currentScreen = session.currentScreen;

  // Check CRUD screens first
  const { getConfigByScreenId } = await import('./registry.js');
  const match = getConfigByScreenId(currentScreen);
  if (match) {
    if (match.mode === 'list') {
      return await buildListScreen(match.config, session);
    }
    if (match.mode === 'confirm_delete') {
      return await buildDeleteConfirmScreen(match.config, session);
    }
    return await buildFormScreen(match.config, session);
  }

  // Check menu screens (MAIN_MENU and MENU_*)
  if (currentScreen === 'MAIN_MENU' || currentScreen.startsWith('MENU_')) {
    if (session.authenticated) {
      const { getMenuNodeByScreenId, buildMenuScreen } = await import('../menus/menuRuntime.js');
      const menuNode = getMenuNodeByScreenId(currentScreen);
      if (menuNode) return buildMenuScreen(menuNode, session);
    }
  }

  return (await import('../screens/login.js')).buildLoginScreen();
}
