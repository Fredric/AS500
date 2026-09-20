/**
 * Agent presence — an AI agent appears as an occupant purely from its own
 * activity, with no connection of its own.
 *
 * `{ kind: 'agent' }` bindings resolved to `access: 'ok'` from Phase 1 onward
 * and nothing else — the agent never actually showed up in the room, even
 * while it was mid-conversation running real MCP tool calls under the user's
 * own RBAC (`mintMcpAccessTokenForUser`, `client_id: 'as500-ai'`). This
 * module derives an amber avatar from that same audit trail: `presence.ts`'s
 * `byConnection` map is keyed by an opaque `symbol`, not a real WebSocket, so
 * a synthetic per-agent symbol works exactly like a real connection's. The
 * existing tick loop (`world/index.ts`'s `tick()`) already rebroadcasts every
 * occupied space's presence list every 250ms regardless of why it changed —
 * nothing here needs to actively push an update, only keep the map current
 * and sweep it when activity stops.
 */

import { onAuditEvent, type AuditEventArgs } from '../core/audit/writer.js';
import { AI_AGENT_CLIENT_ID } from '../core/mcp/mintSessionToken.js';
import { findAgentThings } from './services/worldService.js';
import * as presence from './presence.js';

/** The default entry pose the human ENTER_SPACE handler also uses. */
const DEFAULT_POSE = { x: 12, y: 8, rot: 0 };

/** One synthetic presence connection per (userId, thingId) pair, plus its last-activity time. */
const conns = new Map<string, symbol>();
const lastActive = new Map<string, number>();

function key(userId: number, thingId: number): string {
  return `${userId}:${thingId}`;
}

/**
 * Fed every audit event system-wide via `onAuditEvent()` — cheaply filters
 * to agent-driven MCP/API activity before doing any work, so the far more
 * frequent terminal CRUD/login events cost one comparison and return.
 */
export async function noteAuditActivity(event: AuditEventArgs): Promise<void> {
  if (event.client_id !== AI_AGENT_CLIENT_ID || event.user_id == null) return;

  const userId = event.user_id;
  const things = await findAgentThings(userId);
  const now = Date.now();

  for (const thing of things) {
    const k = key(userId, thing.id);
    let conn = conns.get(k);
    if (!conn) {
      conn = Symbol(`agent:${k}`);
      conns.set(k, conn);
    }

    const pose = thing.transform ? { x: thing.transform.x, y: thing.transform.y, rot: thing.transform.rot ?? 0 } : DEFAULT_POSE;
    presence.enter(conn, {
      actorId: userId,
      username: event.username ?? `user ${userId}`,
      kind: 'agent',
      spaceKey: thing.spaceKey,
      atThingId: thing.id,
      pose,
      activity: 'typing',
      since: new Date(now).toISOString(),
    });
    lastActive.set(k, now);
  }
}

/**
 * Called from `world/index.ts`'s existing `tick()` — one new line, not a
 * second timer. An agent presence has no socket to time out on its own, only
 * this last-activity timestamp.
 */
export function sweepStaleAgents(timeoutMs: number): void {
  const now = Date.now();
  for (const [k, last] of [...lastActive]) {
    if (now - last <= timeoutMs) continue;
    const conn = conns.get(k);
    if (conn) presence.leave(conn);
    conns.delete(k);
    lastActive.delete(k);
  }
}

/** Starts listening to the audit feed. Returns the unsubscribe function. */
export function startAgentPresenceTracking(): () => void {
  return onAuditEvent((event) => { void noteAuditActivity(event); });
}
