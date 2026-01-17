import type { Session, ClientRequest, ScreenResponse, Field } from '../types/index.js';
import { buildLoginScreen } from './login.js';

const SCREEN_WIDTH = 80;

function padLine(line: string): string {
    return line.padEnd(SCREEN_WIDTH, ' ');
}

function getDateTime(): string {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toTimeString().slice(0, 5);
    return `${date}  ${time}`;
}

export function mainMenuScreen(session: Session): Omit<ScreenResponse, 'sessionId'> {
    const dateTime = getDateTime();
    const username = session.username || 'UNKNOWN';

    const rows: string[] = [];

    // Header
    rows.push(padLine(`  AS500 SYSTEM                                             ${dateTime}`));
    rows.push(padLine('═'.repeat(SCREEN_WIDTH)));
    rows.push(padLine(''));
    rows.push(padLine(`                          MAIN MENU                User: ${username}`));
    rows.push(padLine(''));
    rows.push(padLine(''));
    rows.push(padLine('        Select one of the following:'));
    rows.push(padLine(''));
    rows.push(padLine('             1. Customer maintenance'));
    rows.push(padLine('             2. Order entry'));
    rows.push(padLine('             3. Inventory management'));
    rows.push(padLine('             4. Reports'));
    rows.push(padLine('             5. System utilities'));
    rows.push(padLine(''));
    rows.push(padLine(''));
    rows.push(padLine(''));
    rows.push(padLine('        Selection: _'));
    rows.push(padLine(''));
    rows.push(padLine(''));
    rows.push(padLine(''));
    rows.push(padLine(''));
    rows.push(padLine(''));

    // Status line (row 23, 0-indexed = 22)
    rows.push(padLine(' F3=Sign off   F5=Refresh'));

    // Message line (row 24, 0-indexed = 23)
    rows.push(padLine(''));

    const fields: Field[] = [
        {
            row: 16,
            col: 20,
            length: 1,
            type: 'numeric',
            name: 'selection',
            required: true,
        },
    ];

    return {
        screenId: 'MAIN_MENU',
        cursor: { row: 16, col: 20 },
        rows,
        fields,
        message: null,
        messageType: null,
        statusLine: 'F3=Sign off   F5=Refresh',
        bell: false,
    };
}

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
        const selection = request.input['16,20'] || '';

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

        if (option < 1 || option > 5 || isNaN(option)) {
            return {
                ...mainMenuScreen(session),
                ...base,
                message: 'Invalid selection. Enter 1-5',
                messageType: 'error',
                bell: true,
            };
        }

        // For now, all options return "not implemented"
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
