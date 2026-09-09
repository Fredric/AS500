/**
 * Smoke-tests the ingest monitor's document inspection protocol over WebSocket:
 * LIST_DOCUMENTS → OPEN_DOCUMENT → SEARCH, printing what came back.
 *
 * Usage:
 *   node server/scripts/monitor-inspect-check.mjs [itemId] [searchQuery] [wsUrl]
 *
 * With no itemId it inspects the most recently updated ready document.
 */

import { WebSocket } from 'ws';

const wantedId = process.argv[2] ? Number(process.argv[2]) : null;
const query = process.argv[3] ?? 'how many vaccine doses did I get';
const url = process.argv[4] ?? 'ws://localhost:3005/ws';

const ws = new WebSocket(url);
let itemId = wantedId;
let stage = 'list';

const timeout = setTimeout(() => {
  console.error(`timed out at stage "${stage}"`);
  process.exit(1);
}, 180_000);

function done(code) {
  clearTimeout(timeout);
  ws.close();
  process.exit(code);
}

ws.on('open', () => {
  console.log(`connected to ${url}`);
  ws.send(JSON.stringify({ type: 'LIST_DOCUMENTS' }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === 'DOCUMENT_LIST') {
    if (stage !== 'list') return;
    console.log(`\nDOCUMENT_LIST ${msg.documents.length} row(s)${msg.error ? ` error=${msg.error}` : ''}`);
    for (const d of msg.documents.slice(0, 10)) {
      console.log(
        `  ${String(d.id).padStart(3)} ${d.ingestStatus.padEnd(9)} ` +
          `${String(d.embeddedCount + '/' + d.chunkCount).padEnd(7)} ${d.folderPath}/${d.name}`,
      );
    }

    if (itemId == null) {
      const ready = msg.documents.find((d) => d.ingestStatus === 'ready' && d.chunkCount > 0);
      if (!ready) {
        console.error('no ready document with chunks to inspect');
        return done(2);
      }
      itemId = ready.id;
    }

    stage = 'detail';
    console.log(`\nopening item ${itemId}…`);
    ws.send(JSON.stringify({ type: 'OPEN_DOCUMENT', itemId }));
    return;
  }

  if (msg.type === 'DOCUMENT_DETAIL') {
    if (stage !== 'detail') return;
    if (msg.error || !msg.document) {
      console.error(`DOCUMENT_DETAIL error: ${msg.error}`);
      return done(3);
    }

    const d = msg.document;
    console.log(`\nDOCUMENT_DETAIL item ${d.item.id} "${d.item.name}"`);
    console.log(`  folder     ${d.item.folderPath}`);
    console.log(`  status     ${d.item.ingestStatus} · summary ${d.item.hasSummary ? 'yes' : 'no'}`);
    console.log(`  artefacts  chunks ${d.chunks.length} (vec ${d.item.embeddedCount}) · pages ${d.pages.length} · images ${d.images.length} · tables ${d.tables.length}`);
    console.log(`  original   ${d.item.originalUrl ?? '(not readable)'}`);
    console.log(`  warnings   ${d.warnings.length === 0 ? 'none' : ''}`);
    for (const w of d.warnings) console.log(`    ! ${w}`);
    for (const c of d.chunks.slice(0, 3)) {
      console.log(
        `    chunk #${c.id} p${c.pageNumber} ${c.charCount}ch ` +
          `${c.hasEmbedding ? `vec${c.embeddingDims}` : 'NO VECTOR'} :: ` +
          `${c.text.replace(/\s+/g, ' ').slice(0, 70)}…`,
      );
    }
    for (const i of d.images) console.log(`    image #${i.id} p${i.pageNumber} url=${i.url ?? 'NOT MOUNTED'}`);

    stage = 'search';
    console.log(`\nsearching "${query}" as user ${d.item.userId}…`);
    ws.send(JSON.stringify({ type: 'SEARCH', query, userId: d.item.userId, topK: 5 }));
    return;
  }

  if (msg.type === 'SEARCH_RESULT') {
    const r = msg.result;
    console.log(`\nSEARCH_RESULT ${r.total} hit(s) in ${r.tookMs}ms${r.error ? ` error=${r.error}` : ''}`);
    if (r.keywordDead) console.log('  ! keyword half contributed nothing (kw=0 on every hit)');
    for (const h of r.hits) {
      console.log(
        `  #${h.rank} chunk ${h.chunkId} item ${h.documentItemId} p${h.pageNumber} ` +
          `score ${h.score.toFixed(4)} (vec ${h.vecScore.toFixed(3)} / kw ${h.kwScore.toFixed(3)}) ` +
          `${h.documentTitle ?? ''}`,
      );
      console.log(`     ${h.text.replace(/\s+/g, ' ').slice(0, 100)}`);
    }
    console.log('');
    return done(r.error ? 4 : 0);
  }

  if (msg.type === 'ERROR') console.log(`ERROR ${msg.message}`);
});

ws.on('error', (err) => {
  console.error('websocket error:', err.message);
  process.exit(1);
});
