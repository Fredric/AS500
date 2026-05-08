import { v4 as uuidv4 } from 'uuid';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { Session } from '../types/index.js';

// In-memory session store
const sessions = new Map<string, Session>();

// Session timeout in milliseconds (15 minutes)
const SESSION_TIMEOUT = 15 * 60 * 1000;

// Session persistence for development
const PERSIST_SESSIONS = true;
const SESSIONS_FILE = join(process.cwd(), 'data', 'sessions.json');

// Debounce session saves to avoid excessive file writes
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 500; // Wait 500ms after last change before saving

// Session data structure for persistence (Date -> string)
interface PersistedSession {
  id: string;
  viserId: number | null;
  username: string | null;
  authenticated: boolean;
  isAdmin: boolean;
  userRole: string | null;
  currentScreen: string;
  screenStack: string[];
  context: Record<string, unknown>;
  lastActivity: string; // ISO string
  // permissions is intentionally NOT persisted — Set doesn't serialize; reloaded from DB on resume
}

// Load sessions from file on startup
function loadSessions(): void {
  if (!PERSIST_SESSIONS || !existsSync(SESSIONS_FILE)) {
    return;
  }

  try {
    const data = readFileSync(SESSIONS_FILE, 'utf-8');
    const persisted: PersistedSession[] = JSON.parse(data);
    const now = new Date();

    for (const p of persisted) {
      const lastActivity = new Date(p.lastActivity);
      const elapsed = now.getTime() - lastActivity.getTime();

      // Only restore non-expired sessions
      if (elapsed < SESSION_TIMEOUT) {
        const session: Session = {
          id: p.id,
          viserId: p.viserId,
          username: p.username,
          authenticated: p.authenticated,
          isAdmin: p.isAdmin ?? false,
          userRole: (p.userRole as Session['userRole']) ?? null,
          permissions: null, // always reloaded from DB on first request after restore
          currentScreen: p.currentScreen,
          screenStack: p.screenStack,
          context: p.context,
          lastActivity,
        };
        sessions.set(session.id, session);
      }
    }

    if (persisted.length > 0) {
      console.log(`Loaded ${sessions.size} session(s) from disk`);
    }
  } catch (error) {
    console.warn('Failed to load sessions from disk:', error);
  }
}

// Save sessions to file (with debouncing)
function saveSessions(immediate: boolean = false): void {
  if (!PERSIST_SESSIONS) {
    return;
  }

  // Clear existing timeout if debouncing
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }

  const doSave = () => {
    try {
      const persisted: PersistedSession[] = Array.from(sessions.values()).map((s) => ({
        id: s.id,
        viserId: s.viserId,
        username: s.username,
        authenticated: s.authenticated,
        isAdmin: s.isAdmin,
        userRole: s.userRole,
        currentScreen: s.currentScreen,
        screenStack: s.screenStack,
        context: s.context,
        lastActivity: s.lastActivity.toISOString(),
      }));

      // Ensure data directory exists
      try {
        mkdirSync(dirname(SESSIONS_FILE), { recursive: true });
      } catch {
        // Directory might already exist
      }

      writeFileSync(SESSIONS_FILE, JSON.stringify(persisted, null, 2), 'utf-8');
    } catch (error) {
      console.warn('Failed to save sessions to disk:', error);
    }
  };

  if (immediate) {
    doSave();
  } else {
    // Debounce: wait a bit before saving
    saveTimeout = setTimeout(doSave, SAVE_DEBOUNCE_MS);
  }
}

// Load sessions on module initialization
loadSessions();

export function createSession(): Session {
  const session: Session = {
    id: uuidv4(),
    viserId: null,
    username: null,
    authenticated: false,
    isAdmin: false,
    userRole: null,
    permissions: null,
    currentScreen: 'LOGIN',
    screenStack: [],
    context: {},
    lastActivity: new Date(),
  };

  sessions.set(session.id, session);
  saveSessions(); // Persist on creation
  return session;
}

export function getSession(sessionId: string): Session | null {
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
    session.isAdmin = false;
    session.userRole = null;
    session.permissions = null;
    session.viserId = null;
    session.username = null;
    session.currentScreen = 'LOGIN';
    session.screenStack = [];
    session.context = {};
  }

  // Update last activity
  session.lastActivity = now;
  saveSessions(); // Persist on access (debounced)

  return session;
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
  saveSessions(); // Persist on deletion
}

// Clean up expired sessions periodically
setInterval(() => {
  const now = new Date();
  let changed = false;
  for (const [id, session] of sessions) {
    const elapsed = now.getTime() - session.lastActivity.getTime();
    if (elapsed > SESSION_TIMEOUT * 2) {
      sessions.delete(id);
      changed = true;
    }
  }
  if (changed) {
    saveSessions();
  }
}, 60000); // Every minute

// Export function to manually save sessions (useful for updates)
export function persistSessions(immediate: boolean = true): void {
  saveSessions(immediate);
}
