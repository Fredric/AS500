/** World runtime — environment resolution. Mirrors `monitor/config.ts`. */

function env(name: string, fallback = ''): string {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : fallback;
}

export const WORLD_PORT = Number(env('WORLD_PORT', '3006'));
export const WORLD_ENABLED = env('WORLD_ENABLED', 'true') !== 'false';
export const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/** How often presence is rebroadcast to a space, in ms. */
export const PRESENCE_TICK_MS = Math.max(100, Number(env('WORLD_PRESENCE_MS', '250')));

/** Drop an actor whose socket went quiet for this long. */
export const PRESENCE_TIMEOUT_MS = Math.max(5_000, Number(env('WORLD_PRESENCE_TIMEOUT_MS', '30000')));
