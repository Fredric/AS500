/**
 * Service bindings — a rack in the server room bound to as500-docs or vLLM.
 *
 * Phase 1 resolved the *identity* of the service only: it validated the key
 * against the ingest monitor's own component registry so a typo in a binding
 * surfaces immediately, and reported the component's label.
 *
 * Phase 3 adds real health, by reading `monitor/index.ts`'s own snapshot
 * (`getLastSnapshot()`) rather than probing here — `monitor/probes.ts`'s
 * `probeAll()` health-checks every component at once and needs a queue
 * snapshot, far too heavy to run per object, per resolve, per connected
 * client. The monitor already does that work once, on its own timer, for its
 * own WebSocket clients; this just reads the result.
 */

import { COMPONENTS } from '../monitor/config.js';
import { getLastSnapshot } from '../monitor/index.js';

export interface ServiceStatus {
  status: string;
  detail: string | null;
}

/** Every service key a `{ kind: 'service' }` binding may name. */
export function knownServiceKeys(): string[] {
  return COMPONENTS.map((c) => c.id);
}

export async function probeStatusFor(serviceKey: string): Promise<ServiceStatus> {
  const component = COMPONENTS.find((c) => c.id === serviceKey);
  if (!component) {
    return { status: 'unknown', detail: `No such service '${serviceKey}'` };
  }

  // No snapshot yet — MONITOR_ENABLED=false, or the world booted before the
  // monitor's first poll completed. WORLD_ENABLED and MONITOR_ENABLED are
  // independent flags, so this must degrade to identity-only, not error.
  const snapshot = getLastSnapshot();
  const live = snapshot?.components.find((c) => c.id === serviceKey);
  if (!live) {
    return { status: 'unprobed', detail: `${component.label} — ${component.subtitle}` };
  }

  const latency = live.latencyMs != null ? ` (${live.latencyMs}ms)` : '';
  return { status: live.health, detail: `${live.detail}${latency}` };
}
