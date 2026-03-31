import type { Session, ClientRequest, ScreenResponse } from '../types/index.js';
import { buildLoginScreen } from './login.js';
import { buildTimeRegScreen } from './timeReg.js';
import { buildUserMgmtScreen } from './userMgmt.js';
import { initTimeRegV2Context } from '../configs/timeRegV2.js';
import { revokeAllUserTokens } from '../services/auth.js';

// Import DSL
import {
    defineScreen,
    render,
    header,
    text,
    menu,
} from '../dsl/index.js';

// ============================================
// Screen Definitions (Logical)
// ============================================

// Regular user menu
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
            { option: 7, label: 'Time conf (V2)' },
        ], {
            row: 17,
            col: 24,
            length: 1,
        }),
    ],
    statusLine: 'F3=Sign off   F5=Refresh',
    defaultCursor: 'selection',
});

// Admin user menu (includes user management option)
const ADMIN_MENU_SCREEN = defineScreen('MAIN_MENU', {
    elements: [
        // Standard header with system name, date/time, and user
        header({ system: 'AS500 SYSTEM', title: 'MAIN MENU', showDateTime: true, showUser: true }),

        // Instructions
        text(6, 8, 'Select one of the following:'),

        // Menu options (including admin option 90)
        menu(8, 13, [
            { option: 1, label: 'Customer maintenance' },
            { option: 2, label: 'Order entry' },
            { option: 3, label: 'Inventory management' },
            { option: 4, label: 'Reports' },
            { option: 5, label: 'System utilities' },
            { option: 6, label: 'Time registration' },
            { option: 7, label: 'Time registration (V2)' },
            { option: 90, label: 'User management' },
        ], {
            row: 17,
            col: 24,
            length: 2,
        }),
    ],
    statusLine: 'F3=Sign off   F5=Refresh',
    defaultCursor: 'selection',
});

// ============================================
// Screen Builder (uses DSL renderer)
// ============================================

export function mainMenuScreen(session: Session): Omit<ScreenResponse, 'sessionId'> {
    // Select screen definition based on admin status
    const screenDef = session.isAdmin ? ADMIN_MENU_SCREEN : MAIN_MENU_SCREEN;

    const result = render(screenDef, {}, {
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

export async function handleMainMenu(
    session: Session,
    request: ClientRequest
): Promise<ScreenResponse> {
    const base = { sessionId: session.id };

    // Handle F3 - Sign off
    if (request.key === 'F3') {
        const userId = session.viserId;

        session.authenticated = false;
        session.isAdmin = false;
        session.viserId = null;
        session.username = null;
        session.currentScreen = 'LOGIN';
        session.screenStack = [];
        session.context = {};

        // Revoke all long-lived auth tokens for this user
        if (userId) {
            await revokeAllUserTokens(userId);
        }

        return {
            ...buildLoginScreen('Signed off successfully', 'info'),
            ...base,
            authToken: null, // Signal client to clear the auth token cookie
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

        // Valid options: 1-7 for all users, 90 for admins
        const validOptions = [1, 2, 3, 4, 5, 6, 7];
        if (session.isAdmin) {
            validOptions.push(90);
        }

        if (!validOptions.includes(option) || isNaN(option)) {
            const optionRange = session.isAdmin ? '1-7, 90' : '1-7';
            return {
                ...mainMenuScreen(session),
                ...base,
                message: `Invalid selection. Enter ${optionRange}`,
                messageType: 'error',
                bell: true,
            };
        }

        // Option 90 - User management (admin only)
        if (option === 90 && session.isAdmin) {
            session.screenStack.push('MAIN_MENU');
            session.currentScreen = 'USER_MGMT';

            return {
                ...(await buildUserMgmtScreen(session)),
                ...base,
            };
        }

        // Option 7 - Time registration V2 (CRUDTable)
        if (option === 7) {
            session.screenStack.push('MAIN_MENU');
            session.currentScreen = 'CRUD_TIMEREG_V2';
            await initTimeRegV2Context(session);

            // Let the CRUDTable router handle the screen build
            const { buildListScreen } = await import('../crudtable/runtime.js');
            const { getConfig } = await import('../crudtable/registry.js');
            const config = getConfig('timereg_v2')!;

            return {
                ...(await buildListScreen(config, session)),
                ...base,
            };
        }

        // Option 6 - Time registration
        if (option === 6) {
            session.screenStack.push('MAIN_MENU');
            session.currentScreen = 'TIME_REG';
            // Initialize with today's date
            session.context.timeRegDate = new Date().toISOString().split('T')[0];

            return {
                ...(await buildTimeRegScreen(session)),
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
