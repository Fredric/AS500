// CRUDTable Runtime Engine
// Builds and handles list + form screens from declarative config

import type { Session, ClientRequest, ScreenResponse, ListNavigation } from '../types/index.js';
import type { CRUDTableConfig, CRUDContext, BoolExpr, FieldConfig } from './types.js';
import { listScreenId, formScreenId, getConfig } from './registry.js';
import { loadContext, saveContext, clearContext } from './context.js';
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

const LIST_PAGE_SIZE = 12;
const LIST_START_ROW = 7;

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

  // Build option hints line
  const optionHints: string[] = [];
  if (config.services.update) optionHints.push('2=Edit');
  if (config.services.delete) optionHints.push('4=Delete');

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
        display[fieldKey] = fc.column.cellRenderer(record, crudCtx.datasources[fieldKey]);
      } else {
        display[fieldKey] = record[fc.field] ?? '';
      }
    }
    return display;
  });

  // Build navigation metadata
  const pageData = records.slice(crudCtx.pageOffset, crudCtx.pageOffset + LIST_PAGE_SIZE);
  const dataRowCount = pageData.length;

  // Determine primary action for keyboard navigation
  let primaryAction = '';
  if (config.navigation?.primaryAction === 'open' && config.openUI) {
    primaryAction = '9';
  } else if (config.navigation?.primaryAction === 'edit' && config.services.update) {
    primaryAction = '2';
  } else if (config.services.update) {
    primaryAction = '2';
  } else if (config.openUI) {
    primaryAction = '9';
  }

  // Build shortcut list for keyboard navigation
  const navShortcuts: ListNavigation['shortcuts'] = [];
  if (config.services.delete) {
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
  if (primaryAction === '2') shortcutHints.push('Enter=Edit');
  else if (primaryAction === '9') shortcutHints.push('Enter=Open');
  if (config.services.delete) shortcutHints.push('D=Delete');
  if (config.navigation?.shortcuts) {
    for (const s of config.navigation.shortcuts) {
      shortcutHints.push(`${String(s.key).toUpperCase()}=${s.label}`);
    }
  }

  const fKeyParts: string[] = ['F3=Exit'];
  if (config.services.create) fKeyParts.push('F6=Create');
  if (config.listKeys) {
    for (const [key, keyConfig] of Object.entries(config.listKeys)) {
      fKeyParts.push(`${key}=${keyConfig.label}`);
    }
  }
  fKeyParts.push('F12=Cancel');

  const statusParts = [...shortcutHints, ...fKeyParts];

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
    statusLine: statusParts.join('  '),
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
    crudCtx.formMode = 'create';
    crudCtx.editRecord = null;
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
    await keyConfig.handler(crudCtx, session);
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

      // Option 2 - Edit
      if (opt === '2' && config.services.update) {
        crudCtx.formMode = 'edit';
        crudCtx.editRecord = records[i];
        crudCtx.selection = [records[i]];
        saveContext(session, config.id, crudCtx);

        session.screenStack.push(listScreenId(config.id));
        session.currentScreen = formScreenId(config.id);

        return {
          ...(await buildFormScreen(config, session)),
          ...base,
        };
      }

      // Option 4 - Delete
      if (opt === '4' && config.services.delete) {
        try {
          crudCtx.selection = [records[i]];
          const deleteParams = config.services.delete.params?.(crudCtx);
          await callService(config.services.delete.service, config.services.delete.method, deleteParams);

          crudCtx.selection = [];
          saveContext(session, config.id, crudCtx);

          return {
            ...(await buildListScreen(config, session, 'Record deleted', 'info')),
            ...base,
            fieldValues: {},
          };
        } catch (error) {
          console.error('CRUDTable delete error:', error);
          return {
            ...(await buildListScreen(config, session, 'Failed to delete record', 'error')),
            ...base,
          };
        }
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
    : `EDIT ${config.title.toUpperCase()}`;

  // Build field values
  let fieldValues: Record<string, string> = {};

  if (isCreate && config.getInitialValues) {
    fieldValues = config.getInitialValues(crudCtx);
  } else if (!isCreate && crudCtx.editRecord) {
    // Pre-populate from edit record
    for (const fieldKey of config.formBuilder) {
      const fc = config.fieldConfigs[fieldKey];
      if (!fc) continue;
      const val = crudCtx.editRecord[fc.field];
      fieldValues[fc.field] = val !== null && val !== undefined ? String(val) : '';
    }
  }

  // Build form rows from formBuilder
  const formRows: Array<[string, FieldDef]> = [];
  let firstFieldName: string | undefined;

  for (const fieldKey of config.formBuilder) {
    const fc = config.fieldConfigs[fieldKey];
    if (!fc) continue;

    // Evaluate visibility
    if (fc.form?.visible !== undefined && !evalBool(fc.form.visible, crudCtx, true)) {
      continue;
    }

    const isDisabled = evalBool(fc.form?.disabled, crudCtx, false);
    const isRequired = evalBool(fc.form?.required, crudCtx, false);
    const fieldType = isDisabled ? 'readonly' as const : (fc.form?.type ?? fc.type ?? 'alpha' as const);

    const fieldDef = field(fc.field, fc.length, fieldType, {
      required: isRequired,
      uppercase: fc.form?.uppercase,
    });

    // Build label with dots for AS/400 style
    const labelText = `${fc.label} . . . :`;
    formRows.push([labelText, fieldDef]);

    if (!firstFieldName && !isDisabled) {
      firstFieldName = fc.field;
    }
  }

  // Build hint text elements positioned after form fields
  const hintElements = [];
  let hintRowIndex = 0;
  for (const fieldKey of config.formBuilder) {
    const fc = config.fieldConfigs[fieldKey];
    if (!fc) continue;
    if (fc.form?.visible !== undefined && !evalBool(fc.form.visible, crudCtx, true)) continue;

    if (fc.form?.hint) {
      const hintCol = 30 + fc.length + 2; // fieldCol + field length + gap
      hintElements.push(text(7 + hintRowIndex, hintCol, fc.form.hint));
    }
    hintRowIndex++;
  }

  const screenId = formScreenId(config.id);
  const screenDef = defineScreen(screenId, {
    elements: [
      header({ system: 'AS500 SYSTEM', title, showDateTime: true, showUser: true }),
      form(7, formRows, { labelCol: 8, fieldCol: 30 }),
      ...hintElements,
    ],
    statusLine: 'F3=Exit  F12=Cancel',
    defaultCursor: firstFieldName,
  });

  const result = render(screenDef, fieldValues, {
    message,
    messageType,
    user: session.username || 'UNKNOWN',
  });

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
  };
}

export async function handleForm(
  config: CRUDTableConfig,
  session: Session,
  request: ClientRequest
): Promise<ScreenResponse> {
  const base = { sessionId: session.id };
  const crudCtx = loadContext(session, config.id);

  // F3 or F12 - Cancel, return to list
  if (request.key === 'F3' || request.key === 'F12') {
    crudCtx.formMode = null;
    crudCtx.editRecord = null;
    saveContext(session, config.id, crudCtx);

    session.currentScreen = session.screenStack.pop() || listScreenId(config.id);

    return {
      ...(await buildListScreen(config, session)),
      ...base,
    };
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
    try {
      if (isCreate && config.services.create) {
        const createParams = config.services.create.params?.(crudCtx) ?? values;
        await callService(config.services.create.service, config.services.create.method, createParams);
      } else if (!isCreate && config.services.update) {
        const updateParams = config.services.update.params?.(crudCtx) ?? values;
        await callService(config.services.update.service, config.services.update.method, updateParams);
      }

      // Return to list with success message
      crudCtx.formMode = null;
      crudCtx.editRecord = null;
      crudCtx.values = {};
      saveContext(session, config.id, crudCtx);

      session.currentScreen = session.screenStack.pop() || listScreenId(config.id);

      const msg = isCreate ? 'Record created' : 'Record updated';
      return {
        ...(await buildListScreen(config, session, msg, 'info')),
        ...base,
      };
    } catch (error) {
      console.error('CRUDTable form submit error:', error);
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
// HELPERS
// ============================================

// Build the appropriate return screen when navigating back
async function buildReturnScreen(session: Session): Promise<Omit<ScreenResponse, 'sessionId'>> {
  // Import dynamically to avoid circular dependencies
  const currentScreen = session.currentScreen;

  // Check if returning to another CRUD screen
  const { getConfigByScreenId } = await import('./registry.js');
  const match = getConfigByScreenId(currentScreen);
  if (match) {
    if (match.mode === 'list') {
      return await buildListScreen(match.config, session);
    }
    return await buildFormScreen(match.config, session);
  }

  // For non-CRUD screens, we need the caller to handle this
  // Return a minimal response that the router will override
  const { buildLoginScreen } = await import('../screens/login.js');
  const { mainMenuScreen } = await import('../screens/mainMenu.js');

  if (currentScreen === 'MAIN_MENU' && session.authenticated) {
    return mainMenuScreen(session);
  }

  return buildLoginScreen();
}
