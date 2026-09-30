/**
 * Phone presence — a signed-in AS500 mobile app appears in the office as an
 * occupant for as long as its `/api/events` socket is open.
 *
 * Same trick as `agentPresence.ts`: `presence.ts` is keyed by an opaque symbol,
 * not a real socket, so the phone's own connection id works as-is and the
 * existing tick loop broadcasts it with everyone else. Nothing here pushes.
 *
 * The socket only exists while the app is in the foreground (the app drops it
 * when backgrounded), so "present" means "app open". A phone that loses signal
 * disappears when the events server's heartbeat reaps the dead socket.
 *
 * Kept apart from `app/things/events.ts` through its listener registry, so the
 * office stays deletable without touching the phone's socket.
 */

import { PERMISSIONS, loadUserPermissions } from '../core/services/access.js';
import { isAdminForUser } from '../core/mcp/oauth/userFacts.js';
import { onPhoneConnection } from '../app/things/events.js';
import * as presence from './presence.js';
import { listSpaces } from './services/worldService.js';

/** Space phones appear in. Unset = the first space by name — the office. */
const MOBILE_SPACE = process.env.WORLD_MOBILE_SPACE?.trim() || null;

/** Sockets that are still open; guards the async lookups below against a
 *  phone that disconnected while we were resolving its space. */
const live = new Set<symbol>();

async function resolveSpaceKey(): Promise<string | null> {
  if (MOBILE_SPACE) return MOBILE_SPACE;
  const spaces = await listSpaces();
  const first = spaces[0]?.key;
  return typeof first === 'string' ? first : null;
}

/** Lay phones out along the top wall so they never sit on a human's avatar
 *  (which spawns mid-room). */
function phonePose(spaceKey: string): { x: number; y: number; rot: number } {
  const slot = presence.inSpace(spaceKey).filter((p) => p.kind === 'mobile').length;
  return { x: 2 + (slot % 10) * 1.6, y: 1.5 + Math.floor(slot / 10) * 1.6, rot: 0 };
}

export function startMobilePresenceTracking(): () => void {
  return onPhoneConnection({
    connected({ conn, userId, username }) {
      live.add(conn);
      void (async () => {
        const [isAdmin, permissions] = await Promise.all([isAdminForUser(userId), loadUserPermissions(userId)]);
        // Being visible in the office is a world:read matter, same as viewing it.
        if (!isAdmin && !(permissions as Set<string>).has(PERMISSIONS.WORLD_READ)) return;
        const spaceKey = await resolveSpaceKey();
        if (!spaceKey || !live.has(conn)) return;
        presence.enter(conn, {
          actorId: userId,
          username,
          kind: 'mobile',
          spaceKey,
          atThingId: null,
          pose: phonePose(spaceKey),
          activity: 'idle',
          status: 'browsing',
          since: new Date().toISOString(),
        });
      })().catch((err) => console.error('[world] mobile presence failed:', err));
    },
    status(conn, status) {
      presence.update(conn, { status });
    },
    disconnected(conn) {
      live.delete(conn);
      presence.leave(conn);
    },
  });
}
