import type { Session, ClientRequest, ScreenResponse } from '../types/index.js';
import { buildLoginScreen } from './login.js';
import { buildTimeRegScreen } from './timeReg.js';
import { buildBackupMgmtScreen } from './backupMgmt.js';

// Import DSL
import {
    defineScreen,
    render,
    header,
    text,
    menu,
} from '../dsl/index.js';

// ============================================
// Screen Definition (Logical)
// ============================================

const MAIN_MENU_SCREEN = defineScreen('MAIN_MENU', {
    elements: [
        // Standard header with system name, date/time, and user
        header({ system: 'AS500 SYSTEM', title: 'MAIN MENU', showDateTime: true, showUser: true }),

        // Instructions
        text(6, 8, 'Select one of the following:'),

        // Menu options
        menu(8, 13, [
            { option: 1, label: 'Customer maintenance' },
            { option: 2, label: 'Order entry' },
            { option: 3, label: 'Inventory management' },
            { option: 4, label: 'Reports' },
            { option: 5, label: 'System utilities' },
            { option: 6, label: 'Time registration' },
            { option: 7, label: 'Backup management' },
        ], {
            row: 17,
            col: 24,
            length: 1,
        }),
    ],
    statusLine: 'F3=Sign off   F5=Refresh',
    defaultCursor: 'selection',
});

// ============================================
// Screen Builder (uses DSL renderer)
// ============================================

export function mainMenuScreen(session: Session): Omit<ScreenResponse, 'sessionId'> {
    const result = render(MAIN_MENU_SCREEN, {}, {
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

// ============================================
// Screen Handler (Business Logic)
// ============================================

export function handleMainMenu(
    session: Session,
    request: ClientRequest
): ScreenResponse {
    const base = { sessionId: session.id };

    // Handle F3 - Sign off
    if (request.key === 'F3') {
        session.authenticated = false;
        session.viserId = null;
        session.username = null;
        session.currentScreen = 'LOGIN';
        session.screenStack = [];
        session.context = {};

        return {
            ...buildLoginScreen('Signed off successfully', 'info'),
            ...base,
        };
    }

    // Handle F5 - Refresh
    if (request.key === 'F5') {
        return {
            ...mainMenuScreen(session),
            ...base,
        };
    }

    // Handle ENTER - Menu selection
    if (request.key === 'ENTER') {
        // Get selection by field name (client sends input keyed by field name)
        const selection = request.input['selection'] || '';

        if (!selection) {
            return {
                ...mainMenuScreen(session),
                ...base,
                message: 'Please enter a selection',
                messageType: 'error',
                bell: true,
            };
        }

        const option = parseInt(selection, 10);

        if (option < 1 || option > 7 || isNaN(option)) {
            return {
                ...mainMenuScreen(session),
                ...base,
                message: 'Invalid selection. Enter 1-7',
                messageType: 'error',
                bell: true,
            };
        }

        // Option 6 - Time registration
        if (option === 6) {
            session.screenStack.push('MAIN_MENU');
            session.currentScreen = 'TIME_REG';
            // Initialize with today's date
            session.context.timeRegDate = new Date().toISOString().split('T')[0];

            return {
                ...buildTimeRegScreen(session),
                ...base,
            };
        }

        // Option 7 - Backup management
        if (option === 7) {
            session.screenStack.push('MAIN_MENU');
            session.currentScreen = 'BACKUP_MGMT';

            return {
                ...buildBackupMgmtScreen(session),
                ...base,
            };
        }

        // Other options not yet implemented
        const optionNames = [
            '',
            'Customer maintenance',
            'Order entry',
            'Inventory management',
            'Reports',
            'System utilities',
        ];

        return {
            ...mainMenuScreen(session),
            ...base,
            message: `${optionNames[option]} - Not yet implemented`,
            messageType: 'info',
        };
    }

    // Default - just show the menu
    return {
        ...mainMenuScreen(session),
        ...base,
    };
}
