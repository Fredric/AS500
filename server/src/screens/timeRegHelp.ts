import type { Session, ClientRequest, ScreenResponse } from '../types/index.js';
import { buildTimeRegScreen } from './timeReg.js';
import {
    defineScreen,
    render,
    header,
    text,
} from '../dsl/index.js';

// ============================================
// Screen Definition (Logical)
// ============================================

const TIME_REG_HELP_SCREEN = defineScreen('TIME_REG_HELP', {
    elements: [
        header({ system: 'AS500 SYSTEM', title: 'TIME REGISTRATION HELP', showDateTime: true, showUser: true }),
        text(6, 8, 'This is the time registration help screen'),
        text(8, 8, '2 = Edit time entry'),
        text(9, 8, '4 = Delete time entry'),

    ],
    statusLine: 'F3=Exit'

});

// ============================================
// Screen Builder
// ============================================

export function timeRegHelpScreen(session: Session,): Omit<ScreenResponse, 'sessionId'> {
    const result = render(TIME_REG_HELP_SCREEN, {}, {
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

export function handleTimeRegHelp(
    session: Session,
    request: ClientRequest
): ScreenResponse {
    const base = { sessionId: session.id };

    // F3 - Exit to main menu
    if (request.key === 'F3') {
        session.currentScreen = 'TIME_REG';
        session.screenStack = session.screenStack.filter(s => s !== 'TIME_REG_HELP');

        return {
            ...buildTimeRegScreen(session),
            ...base,
        };
    }

    return {
        ...timeRegHelpScreen(session),
        ...base,
    };
}