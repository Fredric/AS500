// EXPORT_IMPORT Screen - Export and Import Time Data
// AS400-style data transfer screen

import type { Session, ClientRequest, ScreenResponse } from '../types/index.js';
import { mainMenuScreen } from './mainMenu.js';
import {
  defineScreen,
  render,
  header,
  text,
  field,
  form,
} from '../dsl/index.js';
import { exportTimeData, importTimeData } from '../services/exportImport.js';

// ============================================
// Screen Definition (Logical)
// ============================================

const EXPORT_IMPORT_SCREEN = defineScreen('EXPORT_IMPORT', {
  elements: [
    header({ system: 'AS500 SYSTEM', title: 'EXPORT/IMPORT TIME DATA', showDateTime: true, showUser: true }),

    text(6, 8, 'Select function:'),
    text(8, 12, '1. Export time data to CSV'),
    text(9, 12, '2. Import time data from CSV'),

    form(11, [
      ['Selection . . . . :', field('selection', 1, 'numeric', { required: true })],
    ], { labelCol: 12, fieldCol: 34 }),

    text(15, 8, 'Note: Export creates a CSV file with all your time entries.'),
    text(16, 8, '      Import reads CSV file and adds entries to your data.'),
    text(17, 8, '      Import format must match export format exactly.'),
  ],
  statusLine: 'F3=Exit  F12=Cancel',
  defaultCursor: 'selection',
});

// Export result screen
const EXPORT_RESULT_SCREEN = defineScreen('EXPORT_RESULT', {
  elements: [
    header({ system: 'AS500 SYSTEM', title: 'EXPORT RESULT', showDateTime: true, showUser: true }),

    text(6, 8, 'Export completed successfully!'),
    text(8, 8, 'CSV data is ready for download.'),
    text(9, 8, 'Copy the data below and save to a file.'),

    text(11, 2, '═'.repeat(78)),
  ],
  statusLine: 'F3=Exit  F12=Back',
});

// Import form screen
const IMPORT_FORM_SCREEN = defineScreen('IMPORT_FORM', {
  elements: [
    header({ system: 'AS500 SYSTEM', title: 'IMPORT TIME DATA', showDateTime: true, showUser: true }),

    text(6, 8, 'Paste CSV data below and press ENTER to import.'),
    text(7, 8, 'The data must be in the same format as the export.'),

    text(9, 2, 'CSV Data:'),
    // We'll use a large text field for CSV input
    form(10, [
      ['', field('csv_data', 70, 'alpha', { required: true })],
    ], { labelCol: 2, fieldCol: 2 }),
  ],
  statusLine: 'F3=Exit  F12=Cancel',
  defaultCursor: 'csv_data',
});

// Import result screen  
const IMPORT_RESULT_SCREEN = defineScreen('IMPORT_RESULT', {
  elements: [
    header({ system: 'AS500 SYSTEM', title: 'IMPORT RESULT', showDateTime: true, showUser: true }),
  ],
  statusLine: 'F3=Exit  F12=Back',
});

// ============================================
// Screen Builders
// ============================================

export function buildExportImportScreen(
  session: Session,
  message: string | null = null,
  messageType: 'info' | 'warning' | 'error' | null = null
): Omit<ScreenResponse, 'sessionId'> {
  return render(EXPORT_IMPORT_SCREEN, {}, {
    message,
    messageType,
    user: session.username || 'UNKNOWN',
  });
}

export function buildExportResultScreen(
  session: Session,
  csvData: string
): Omit<ScreenResponse, 'sessionId'> {
  const result = render(EXPORT_RESULT_SCREEN, {}, {
    user: session.username || 'UNKNOWN',
  });

  // Add CSV data to screen starting at row 12
  const rows = [...result.rows];
  const csvLines = csvData.split('\n');
  
  // Display first 10 lines of CSV in the screen
  for (let i = 0; i < Math.min(csvLines.length, 10); i++) {
    const line = csvLines[i].substring(0, 78); // Truncate to screen width
    rows[12 + i] = '  ' + line.padEnd(78, ' ');
  }
  
  if (csvLines.length > 10) {
    rows[22] = '  (... ' + (csvLines.length - 10) + ' more lines ...)'.padEnd(80, ' ');
  }

  return {
    ...result,
    rows,
    message: `Export complete: ${csvLines.length - 1} data rows`,
    messageType: 'info',
  };
}

export function buildImportFormScreen(
  session: Session,
  message: string | null = null,
  messageType: 'info' | 'warning' | 'error' | null = null
): Omit<ScreenResponse, 'sessionId'> {
  return render(IMPORT_FORM_SCREEN, {}, {
    message,
    messageType,
    user: session.username || 'UNKNOWN',
  });
}

export function buildImportResultScreen(
  session: Session,
  daysImported: number,
  itemsImported: number,
  errors: string[]
): Omit<ScreenResponse, 'sessionId'> {
  const result = render(IMPORT_RESULT_SCREEN, {}, {
    user: session.username || 'UNKNOWN',
  });

  const rows = [...result.rows];
  
  let rowNum = 6;
  
  if (errors.length === 0) {
    rows[rowNum++] = '  Import completed successfully!'.padEnd(80, ' ');
    rows[rowNum++] = ''.padEnd(80, ' ');
    rows[rowNum++] = `  Days processed: ${daysImported}`.padEnd(80, ' ');
    rows[rowNum++] = `  Items imported: ${itemsImported}`.padEnd(80, ' ');
  } else {
    rows[rowNum++] = '  Import completed with errors:'.padEnd(80, ' ');
    rows[rowNum++] = ''.padEnd(80, ' ');
    rows[rowNum++] = `  Days processed: ${daysImported}`.padEnd(80, ' ');
    rows[rowNum++] = `  Items imported: ${itemsImported}`.padEnd(80, ' ');
    rows[rowNum++] = `  Errors: ${errors.length}`.padEnd(80, ' ');
    rows[rowNum++] = ''.padEnd(80, ' ');
    rows[rowNum++] = '  Error details:'.padEnd(80, ' ');
    rows[rowNum++] = '  ─────────────'.padEnd(80, ' ');
    
    // Show first 10 errors
    for (let i = 0; i < Math.min(errors.length, 10) && rowNum < 22; i++) {
      const err = errors[i].substring(0, 76);
      rows[rowNum++] = '  ' + err.padEnd(78, ' ');
    }
    
    if (errors.length > 10) {
      rows[rowNum++] = `  (... ${errors.length - 10} more errors ...)`.padEnd(80, ' ');
    }
  }

  return {
    ...result,
    rows,
    message: errors.length === 0 ? 'Import successful' : 'Import completed with errors',
    messageType: errors.length === 0 ? 'info' : 'warning',
  };
}

// ============================================
// Screen Handler
// ============================================

export function handleExportImport(
  session: Session,
  request: ClientRequest
): ScreenResponse {
  const base = { sessionId: session.id };

  // Determine current sub-screen from context
  const subScreen = (session.context.exportImportSubScreen as string) || 'main';

  // F3 - Exit to main menu (from any sub-screen)
  if (request.key === 'F3') {
    session.currentScreen = 'MAIN_MENU';
    session.screenStack = session.screenStack.filter(s => s !== 'EXPORT_IMPORT');
    delete session.context.exportImportSubScreen;
    delete session.context.exportData;

    return {
      ...mainMenuScreen(session),
      ...base,
    };
  }

  // F12 - Cancel/Back
  if (request.key === 'F12') {
    if (subScreen === 'main') {
      // From main screen, go back to menu
      session.currentScreen = 'MAIN_MENU';
      session.screenStack = session.screenStack.filter(s => s !== 'EXPORT_IMPORT');
      delete session.context.exportImportSubScreen;
      delete session.context.exportData;

      return {
        ...mainMenuScreen(session),
        ...base,
      };
    } else {
      // From sub-screens, go back to main
      session.context.exportImportSubScreen = 'main';
      delete session.context.exportData;

      return {
        ...buildExportImportScreen(session),
        ...base,
      };
    }
  }

  // Handle based on sub-screen
  switch (subScreen) {
    case 'main':
      return handleMainScreen(session, request, base);
    
    case 'export_result':
      return handleExportResultScreen(session, request, base);
    
    case 'import_form':
      return handleImportFormScreen(session, request, base);
    
    case 'import_result':
      return handleImportResultScreen(session, request, base);
    
    default:
      session.context.exportImportSubScreen = 'main';
      return {
        ...buildExportImportScreen(session),
        ...base,
      };
  }
}

// Handle main selection screen
function handleMainScreen(
  session: Session,
  request: ClientRequest,
  base: { sessionId: string }
): ScreenResponse {
  if (request.key === 'ENTER') {
    const selection = request.input['selection']?.trim();

    if (!selection) {
      return {
        ...buildExportImportScreen(session, 'Please enter a selection', 'error'),
        ...base,
        bell: true,
      };
    }

    const option = parseInt(selection, 10);

    if (option === 1) {
      // Export
      const userId = session.viserId!;
      const csvData = exportTimeData(userId);
      
      session.context.exportData = csvData;
      session.context.exportImportSubScreen = 'export_result';

      return {
        ...buildExportResultScreen(session, csvData),
        ...base,
      };
    }

    if (option === 2) {
      // Import
      session.context.exportImportSubScreen = 'import_form';

      return {
        ...buildImportFormScreen(session),
        ...base,
      };
    }

    return {
      ...buildExportImportScreen(session, 'Invalid selection. Enter 1 or 2', 'error'),
      ...base,
      bell: true,
    };
  }

  return {
    ...buildExportImportScreen(session),
    ...base,
  };
}

// Handle export result screen
function handleExportResultScreen(
  session: Session,
  request: ClientRequest,
  base: { sessionId: string }
): ScreenResponse {
  // On any key, show the full CSV data in message or go back
  // For now, just allow F12/F3 to navigate away
  return {
    ...buildExportResultScreen(session, session.context.exportData as string),
    ...base,
  };
}

// Handle import form screen
function handleImportFormScreen(
  session: Session,
  request: ClientRequest,
  base: { sessionId: string }
): ScreenResponse {
  if (request.key === 'ENTER') {
    const csvData = request.input['csv_data']?.trim();

    if (!csvData) {
      return {
        ...buildImportFormScreen(session, 'Please enter CSV data', 'error'),
        ...base,
        bell: true,
      };
    }

    // Perform import
    const userId = session.viserId!;
    const result = importTimeData(userId, csvData);

    // Store result in context
    session.context.importResult = result;
    session.context.exportImportSubScreen = 'import_result';

    return {
      ...buildImportResultScreen(session, result.daysImported, result.itemsImported, result.errors),
      ...base,
    };
  }

  return {
    ...buildImportFormScreen(session),
    ...base,
  };
}

// Handle import result screen
function handleImportResultScreen(
  session: Session,
  request: ClientRequest,
  base: { sessionId: string }
): ScreenResponse {
  // Just display results, F12/F3 to navigate away
  const result = session.context.importResult as any;
  return {
    ...buildImportResultScreen(session, result.daysImported, result.itemsImported, result.errors),
    ...base,
  };
}
