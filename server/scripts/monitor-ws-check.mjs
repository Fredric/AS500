/**
 * Smoke-tests the ingest monitor WebSocket: connects, waits for a snapshot,
 * subscribes to a log source, and reports what arrived.
 *
 * Usage: node server/scripts/monitor-ws-check.mjs [wsUrl] [logSource]
 */

import { WebSocket } from 'ws';

const url = process.argv[2] ?? 'ws://localhost:3005/ws';
const source = process.argv[3] ?? 'docs-worker';

const ws = new WebSocket(url);
let gotSnapshot = false;

const timeout = setTimeout(() => {
  console.error(`timed out after 15s (snapshot received: ${gotSnapshot})`);
  process.exit(1);
}, 15000);

ws.on('open', () => {
  console.log(`connected to ${url}`);
  ws.send(JSON.stringify({ type: 'SUBSCRIBE_LOGS', source }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === 'SNAPSHOT') {
    if (gotSnapshot) return;
    gotSnapshot = true;
    const s = msg.snapshot;
    console.log(
      `SNAPSHOT overall=${s.overall} components=${s.components.length} ` +
        `jobs=${s.queue.jobs.length} logSources=${s.logSources.length}`,
    );
  } else if (msg.type === 'LOG_BATCH') {
    console.log(`LOG_BATCH source=${msg.source} replace=${msg.replace} lines=${msg.lines.length}`);
    for (const l of msg.lines.slice(-3)) {
      console.log(`  [${l.ts}] ${l.level.toUpperCase()} ${l.text.slice(0, 110)}`);
    }
    clearTimeout(timeout);
    ws.close();
    process.exit(0);
  } else {
    console.log(msg.type, msg.message ?? '');
  }
});

ws.on('error', (err) => {
  console.error('websocket error:', err.message);
  process.exit(1);
});
