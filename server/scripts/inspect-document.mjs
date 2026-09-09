/**
 * Inspects everything the ingestion pipeline produced for one document.
 *
 * Usage (from the repo root):
 *   node server/scripts/inspect-document.mjs 29
 *   node server/scripts/inspect-document.mjs vacc
 *   node server/scripts/inspect-document.mjs 29 --full
 *   node server/scripts/inspect-document.mjs 29 --search "when does it expire"
 *
 * Arguments:
 *   <id|name>    Numeric document_items.id, or a case-insensitive name fragment.
 *   --full       Print complete chunk text instead of a 200-character preview.
 *   --pages      Also print the extracted per-page markdown.
 *   --search Q   Run Q through the as500-docs hybrid search as this document's owner.
 *
 * Environment:
 *   DATABASE_URL  defaults to postgresql://as500:as500@localhost:5433/as500
 *   DOCS_API_URL  defaults to http://localhost:8080
 */

import pg from 'pg';

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const full = args.includes('--full');
const withPages = args.includes('--pages');
const searchIdx = args.indexOf('--search');
const searchQuery = searchIdx !== -1 ? args[searchIdx + 1] : null;

if (!target) {
  console.error('usage: node server/scripts/inspect-document.mjs <id|name> [--full] [--pages] [--search "query"]');
  process.exit(1);
}

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://as500:as500@localhost:5433/as500';
const DOCS_API_URL = (process.env.DOCS_API_URL ?? 'http://localhost:8080').replace(/\/$/, '');

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });

const rule = (label) => console.log(`\n${'─'.repeat(4)} ${label} ${'─'.repeat(Math.max(0, 72 - label.length))}`);

/** Walks document_folders.parent_id up to the root to rebuild the breadcrumb. */
async function breadcrumb(folderId) {
  if (folderId == null) return '(no folder)';
  const { rows } = await pool.query(
    `WITH RECURSIVE up AS (
       SELECT id, parent_id, name FROM document_folders WHERE id = $1
       UNION ALL
       SELECT f.id, f.parent_id, f.name FROM document_folders f JOIN up ON f.id = up.parent_id
     )
     SELECT name FROM up`,
    [folderId],
  );
  return '/' + rows.map((r) => r.name).reverse().join('/');
}

async function main() {
  const isId = /^\d+$/.test(target);
  const { rows: items } = await pool.query(
    isId
      ? `SELECT * FROM document_items WHERE id = $1`
      : `SELECT * FROM document_items WHERE name ILIKE '%' || $1 || '%' ORDER BY id DESC`,
    [target],
  );

  if (items.length === 0) {
    console.error(`No document_items row matches "${target}".`);
    process.exit(2);
  }
  if (items.length > 1) {
    console.log(`${items.length} documents match "${target}":`);
    for (const i of items) console.log(`  ${i.id}  ${i.ingest_status.padEnd(10)} ${i.name}`);
    console.log('\nRe-run with a specific id.');
    return;
  }

  const item = items[0];

  rule('DOCUMENT');
  console.log(`  id             ${item.id}`);
  console.log(`  name           ${item.name}`);
  console.log(`  owner          user_id ${item.user_id}`);
  console.log(`  folder         ${await breadcrumb(item.folder_id)}  (folder_id ${item.folder_id})`);
  console.log(`  type           ${item.file_type} · ${item.mime_type ?? '?'} · ${item.size_bytes} bytes`);
  console.log(`  storage_path   ${item.storage_path}`);
  console.log(`  ingest_status  ${item.ingest_status}`);
  console.log(`  content_hash   ${item.content_hash ?? '(none)'}`);
  console.log(`  updated_at     ${item.updated_at?.toISOString?.() ?? item.updated_at}`);

  rule('AI SUMMARY');
  console.log(item.ai_summary ? `  ${item.ai_summary.replace(/\n/g, '\n  ')}` : '  (none generated)');

  rule('INGESTION JOBS');
  const { rows: jobs } = await pool.query(
    `SELECT id, state, attempts, created_at, started_at, finished_at, locked_by, error,
            ROUND(EXTRACT(EPOCH FROM (finished_at - started_at))) AS secs
     FROM document_ingestion_jobs WHERE document_item_id = $1 ORDER BY created_at`,
    [item.id],
  );
  if (jobs.length === 0) console.log('  (none — this document was never enqueued)');
  for (const j of jobs) {
    console.log(
      `  ${j.state.padEnd(10)} attempt ${j.attempts}  ${j.secs != null ? `${j.secs}s` : '—'}  ` +
        `${j.finished_at?.toISOString?.() ?? 'unfinished'}  ${j.id}`,
    );
    if (j.error) console.log(`             error: ${j.error.split('\n')[0]}`);
  }

  rule('ARTEFACTS');
  const { rows: counts } = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM document_chunks WHERE document_item_id = $1) AS chunks,
       (SELECT COUNT(*)::int FROM document_chunks WHERE document_item_id = $1 AND embedding IS NOT NULL) AS embedded,
       (SELECT COUNT(*)::int FROM document_pages  WHERE document_item_id = $1) AS pages,
       (SELECT COUNT(*)::int FROM document_images WHERE document_item_id = $1) AS images,
       (SELECT COUNT(*)::int FROM document_tables WHERE document_item_id = $1) AS tables`,
    [item.id],
  );
  const c = counts[0];
  console.log(`  chunks ${c.chunks}  (embedded ${c.embedded})   pages ${c.pages}   images ${c.images}   tables ${c.tables}`);
  if (c.chunks > 0 && c.embedded < c.chunks) {
    console.log(`  WARNING: ${c.chunks - c.embedded} chunk(s) have no embedding and will never be retrieved.`);
  }

  rule(`CHUNKS (${c.chunks})`);
  const { rows: chunks } = await pool.query(
    `SELECT id, page_number, page_end, section_title, content_type, node_path,
            LENGTH(text) AS text_len, text,
            (embedding IS NOT NULL) AS has_vec
     FROM document_chunks WHERE document_item_id = $1
     ORDER BY page_number NULLS FIRST, id`,
    [item.id],
  );
  for (const ch of chunks) {
    console.log(
      `\n  #${ch.id}  page ${ch.page_number ?? '?'}${ch.page_end && ch.page_end !== ch.page_number ? `-${ch.page_end}` : ''}  ` +
        `${ch.content_type ?? 'text'}  ${ch.text_len} chars  vector:${ch.has_vec ? 'yes' : 'MISSING'}`,
    );
    console.log(`     node_path     ${ch.node_path}`);
    console.log(`     section_title ${ch.section_title ?? '—'}`);
    const body = full ? ch.text : ch.text.slice(0, 200) + (ch.text.length > 200 ? ' …' : '');
    console.log(`     ${body.replace(/\n/g, '\n     ')}`);
  }

  if (withPages) {
    rule(`PAGES (${c.pages})`);
    const { rows: pages } = await pool.query(
      `SELECT page_number, LENGTH(raw_text) AS raw_len, markdown
       FROM document_pages WHERE document_item_id = $1 ORDER BY page_number`,
      [item.id],
    );
    for (const p of pages) {
      console.log(`\n  page ${p.page_number}  (raw_text ${p.raw_len ?? 0} chars)`);
      console.log(`  ${(p.markdown ?? '(no markdown)').replace(/\n/g, '\n  ')}`);
    }
  }

  if (c.images > 0) {
    rule(`IMAGES (${c.images})`);
    const { rows: images } = await pool.query(
      `SELECT id, page_number, file_path, caption FROM document_images
       WHERE document_item_id = $1 ORDER BY page_number, id`,
      [item.id],
    );
    for (const im of images) {
      console.log(`  #${im.id} page ${im.page_number ?? '?'}  ${im.file_path ?? '(no file)'}`);
      if (im.caption) console.log(`        caption: ${im.caption}`);
    }
    console.log(`\n  Files live under as500-docs storage/, i.e. ../as500-docs/${(images[0].file_path ?? '').replace(/^\/app\//, '')}`);
  }

  if (searchQuery) {
    rule(`SEARCH "${searchQuery}"`);
    try {
      const res = await fetch(`${DOCS_API_URL}/search/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery, user_id: item.user_id, top_k: 5 }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        console.log(`  HTTP ${res.status} from ${DOCS_API_URL}/search/documents`);
      } else {
        const data = await res.json();
        console.log(`  ${data.total} result(s) — note: rows are returned in rerank order, "score" is the pre-rerank hybrid score.\n`);
        for (const [i, r] of data.results.entries()) {
          const mine = r.document_item_id === item.id ? '<-- this document' : '';
          console.log(
            `  ${i + 1}. chunk ${r.chunk_id}  score ${r.score.toFixed(4)} ` +
              `(vec ${r.vec_score.toFixed(3)} / kw ${r.kw_score.toFixed(3)})  ` +
              `item ${r.document_item_id} p${r.page_number}  ${r.document_title} ${mine}`,
          );
          console.log(`     ${r.text.replace(/\s+/g, ' ').slice(0, 160)}`);
        }
      }
    } catch (err) {
      console.log(`  search failed: ${err.message}`);
      console.log(`  (is as500-docs running? curl ${DOCS_API_URL}/healthz)`);
    }
  }

  console.log('');
}

try {
  await main();
} finally {
  await pool.end();
}
