/**
 * Service bindings — a rack in the server room bound to as500-docs or vLLM.
 *
 * Phase 1 resolves the *identity* of the service only: it validates the key
 * against the ingest monitor's own component registry so a typo in a binding
 * surfaces immediately, and reports the component's label.
 *
 * Live health is deliberately not probed here. `monitor/probes.ts` exposes
 * `probeAll()`, which health-checks every component at once and needs a queue
 * snapshot — far too heavy to run per object, per resolve, per connected
 * client. Phase 3 subscribes the world to the monitor's existing 2.5s snapshot
 * broadcast instead, which is where that telemetry already lives.
 */

import { COMPONENTS } from '../monitor/config.js';

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
  return { status: 'unprobed', detail: `${component.label} — ${component.subtitle}` };
}
