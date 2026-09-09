/**
 * Prints a condensed ingest-monitor snapshot to the terminal.
 *
 * Usage: node server/scripts/monitor-snapshot.mjs [baseUrl]
 * Default base URL: http://localhost:3005
 */

const base = (process.argv[2] ?? 'http://localhost:3005').replace(/\/$/, '');

const res = await fetch(`${base}/api/snapshot`);
if (!res.ok) {
  console.error(`GET ${base}/api/snapshot -> HTTP ${res.status}`);
  process.exit(1);
}
const s = await res.json();

const pad = (v, n) => String(v ?? '').padEnd(n);

console.log(`overall: ${s.overall}   snapshot: ${s.ts}   poll: ${s.pollMs}ms`);

console.log('\nCOMPONENTS');
for (const c of s.components) {
  console.log(
    `  ${pad(c.id, 14)} ${pad(c.health, 9)} ${pad(c.latencyMs != null ? c.latencyMs + 'ms' : '-', 8)} ` +
      `${c.detail}${c.container ? `   [${c.container.name} ${c.container.state}]` : ''}`,
  );
  if (c.error) console.log(`  ${' '.repeat(14)} err: ${c.error.slice(0, 120)}`);
}

console.log('\nQUEUE');
console.log(`  available: ${s.queue.available}${s.queue.error ? ` (${s.queue.error})` : ''}`);
console.log(`  counts:    ${JSON.stringify(s.queue.counts)}`);
console.log(`  items:     ${JSON.stringify(s.queue.itemStatus)}`);
console.log(`  totals:    ${JSON.stringify(s.queue.totals)}`);
console.log(`  throughput:${JSON.stringify(s.queue.throughput)}`);
console.log(`  jobs:      ${s.queue.jobs.length}`);
for (const j of s.queue.jobs.slice(0, 6)) {
  console.log(
    `    ${pad(j.state, 11)} ${pad(j.stage, 10)} ${pad(j.progressPct + '%', 5)} ` +
      `pages=${pad(j.pageCount, 4)} chunks=${pad(j.chunkCount, 5)} ${j.documentName ?? 'item#' + j.documentItemId}`,
  );
}

console.log('\nGPU');
console.log(`  source: ${s.gpu.source}   used: ${s.gpu.memoryUsedMb ?? '-'} MB`);
for (const c of s.gpu.consumers) console.log(`    ${pad(c.label, 44)} ${c.vramMb ?? '-'} MB  ${c.detail}`);

console.log('\nLOG SOURCES');
for (const l of s.logSources) {
  console.log(
    `  ${pad(l.key, 14)} ${pad(l.kind, 7)} avail=${pad(l.available, 6)} ` +
      `err=${pad(l.errorCount, 4)} warn=${pad(l.warnCount, 4)} ${l.detail}`,
  );
}

if (s.warnings.length) {
  console.log('\nWARNINGS');
  for (const w of s.warnings) console.log(`  - ${w}`);
}
