import { v4 as uuidv4 } from 'uuid';
// In-memory session store
const sessions = new Map();
// Session timeout in milliseconds (15 minutes)
const SESSION_TIMEOUT = 15 * 60 * 1000;
export function createSession() {
    const session = {
        id: uuidv4(),
        viserId: null,
        username: null,
        authenticated: false,
        currentScreen: 'LOGIN',
        screenStack: [],
        context: {},
        lastActivity: new Date(),
    };
    sessions.set(session.id, session);
    return session;
}
export function getSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
        return null;
    }
    // Check for timeout
    const now = new Date();
    const elapsed = now.getTime() - session.lastActivity.getTime();
    if (elapsed > SESSION_TIMEOUT) {
        // Session expired - reset to unauthenticated
        session.authenticated = false;
        session.viserId = null;
        session.username = null;
        session.currentScreen = 'LOGIN';
        session.screenStack = [];
        session.context = {};
    }
    // Update last activity
    session.lastActivity = now;
    return session;
}
export function deleteSession(sessionId) {
    sessions.delete(sessionId);
}
// Clean up expired sessions periodically
setInterval(() => {
    const now = new Date();
    for (const [id, session] of sessions) {
        const elapsed = now.getTime() - session.lastActivity.getTime();
        if (elapsed > SESSION_TIMEOUT * 2) {
            sessions.delete(id);
        }
    }
}, 60000); // Every minute
