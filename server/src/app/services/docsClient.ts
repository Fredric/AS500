// DEPRECATED — legacy manual RAG pre-injection.
//
// This file is no longer imported by chatService.ts.  The agent now retrieves
// document context via MCP knowledge_* tools (Phase 6 cutover).
// Kept for reference; remove alongside manuals* tables in a future cleanup.
//
// Original purpose: fetch manual excerpts, inject as system message, return
// DocsSource[] for ManualSourcePanel.  ManualSourcePanel citation phase 2 is
// tracked in Phase 7.

export interface DocsImageRef {
  image_id: string;
  page_number: number | null;
  caption: string | null;
}

export interface DocsSource {
  manual_id: string;
  manual_title: string;
  manufacturer: string;
  model: string;
  year: number | null;
  page_start: number | null;
  page_end: number | null;
  section: string | null;
  images: DocsImageRef[];
}

export interface DocsContextResult {
  /** Formatted text ready to inject as a system message; null if no relevant results. */
  context: string | null;
  /** Structured sources with image refs for the chat UI. */
  sources: DocsSource[];
}

interface DocsImageRefRaw {
  image_id: string;
  page_number: number | null;
  caption: string | null;
}

interface DocsSearchResult {
  chunk_id: string;
  score: number;
  page_start: number | null;
  page_end: number | null;
  section_path: string[] | null;
  heading: string | null;
  image_refs: DocsImageRefRaw[];
  citation: {
    chunk_id: string;
    manual_id: string;
    manual_title: string;
    manufacturer: string;
    model: string;
    year: number | null;
    page_start: number | null;
    page_end: number | null;
  };
}

interface DocsCitation {
  manual_title: string;
  manufacturer: string;
  model: string;
  year: number | null;
  page_start: number | null;
}

interface DocsSearchResponse {
  query: string;
  total: number;
  results: DocsSearchResult[];
  answer_context_blocks: string[];
  citations: DocsCitation[];
}

interface ManualListItem {
  manual_id: string;
  title: string;
  manufacturer: string;
  model: string;
  year: number | null;
  /** Lowercase keywords derived from manufacturer + model words. */
  keywords: string[];
}

const DOCS_API_URL = process.env.DOCS_API_URL?.replace(/\/$/, '') ?? '';
const DOCS_MIN_SCORE = parseFloat(process.env.DOCS_MIN_SCORE ?? '0.25');
const DOCS_TOP_K = 4;  // After reranking, 4 tight results are enough — all of them contributed
const DOCS_TIMEOUT_MS = 45_000;

// ── Manual list cache ─────────────────────────────────────────────────────────
// Loaded once on first request and reused thereafter.

let _manualsCache: ManualListItem[] | null = null;
let _manualsCacheAt = 0;
const MANUALS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

async function getManuals(): Promise<ManualListItem[]> {
  const now = Date.now();
  if (_manualsCache && now - _manualsCacheAt < MANUALS_CACHE_TTL_MS) return _manualsCache;

  try {
    const res = await fetch(`${DOCS_API_URL}/manuals`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return _manualsCache ?? [];
    const data = (await res.json()) as { manuals: { manual_id: string; title: string; manufacturer: string; model: string; year: number | null }[] };

    _manualsCache = data.manuals.map((m) => ({
      ...m,
      keywords: buildKeywords(m.manufacturer, m.model, m.title),
    }));
    _manualsCacheAt = now;
    return _manualsCache;
  } catch {
    return _manualsCache ?? [];
  }
}

const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'for', 'and', 'or', 'in', 'on', 'at', 'to', 'de', 'service', 'manual', 'workshop']);

function buildKeywords(manufacturer: string, model: string, title: string): string[] {
  const raw = `${manufacturer} ${model} ${title}`.toLowerCase();
  return [...new Set(
    raw.split(/[\s\-_/]+/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
  )];
}

/**
 * Detect which manual the query is about by matching keywords.
 * Returns the manual_id if exactly one manual matches strongly enough,
 * otherwise returns null (search all manuals).
 */
function detectManualId(query: string, manuals: ManualListItem[]): string | null {
  if (manuals.length === 0) return null;
  const q = query.toLowerCase();

  const scored = manuals.map((m) => {
    const hits = m.keywords.filter((kw) => q.includes(kw));
    return { manual_id: m.manual_id, title: m.title, hits: hits.length };
  });

  const best = scored.sort((a, b) => b.hits - a.hits)[0];
  if (!best || best.hits === 0) return null;

  // Only filter if one manual clearly leads (or is the only one with hits)
  const tied = scored.filter((s) => s.hits === best.hits);
  if (tied.length > 1) return null; // ambiguous

  console.log(`[docs] detected manual="${best.title}" (${best.hits} keyword hits)`);
  return best.manual_id;
}

function isManualInventoryQuestion(query: string): boolean {
  const q = query.toLowerCase();
  return /\b(manual|manuals|workshop manual|service manual|docs|documents)\b/.test(q)
    && /\b(have|available|access|list|which|what|show|know about)\b/.test(q);
}

function buildManualInventoryContext(manuals: ManualListItem[]): string {
  const list = manuals
    .map((m) => `- ${m.title} — ${m.manufacturer} ${m.model}${m.year ? ` (${m.year})` : ''}`)
    .join('\n');

  return [
    'WORKSHOP MANUAL AVAILABILITY CONTEXT.',
    'The following manuals are currently available in the AS500 manual database:',
    '',
    list || '- No manuals are currently available.',
    '',
    'If the user asks a technical question, ask which motorcycle/model they mean unless they already specified one.',
  ].join('\n');
}

/**
 * Query the as500-docs /search endpoint and return both a formatted context
 * string and structured source references for the chat UI.
 *
 * The search is automatically scoped to the most relevant manual based on
 * keywords in the query. Results never mix content from multiple manuals.
 *
 * Returns `{context: null, sources: []}` if:
 *   - DOCS_API_URL is not configured
 *   - The docs service is unreachable
 *   - No chunks meet the minimum relevance score
 */
export async function fetchDocsContext(question: string): Promise<DocsContextResult> {
  const empty: DocsContextResult = { context: null, sources: [] };
  if (!DOCS_API_URL) return empty;

  // Detect which manual to scope the search to
  const manuals = await getManuals();
  const manualId = detectManualId(question, manuals);

  // Questions like "do you have manuals?" should not run vector search; give
  // the agent an explicit inventory so it does not claim no manuals exist.
  if (!manualId && isManualInventoryQuestion(question)) {
    console.log(`[docs] manual inventory question — ${manuals.length} manuals available`);
    return { context: buildManualInventoryContext(manuals), sources: [] };
  }

  // If no manual was detected, skip docs lookup entirely — it's a general chat question
  if (!manualId) {
    console.log(`[docs] no manual detected for query="${question.slice(0, 60)}" — skipping docs lookup`);
    return empty;
  }

  let data: DocsSearchResponse;
  let citationChunkIds: Set<string> | null = null;

  try {
    const searchBody: Record<string, unknown> = { query: question, top_k: DOCS_TOP_K, rerank: true, manual_id: manualId };
    const citationsBody: Record<string, unknown> = { question, top_k: DOCS_TOP_K, manual_id: manualId, citations_only: true };

    // Run context search and reranked citation lookup in parallel
    const [searchRes, citationsRes] = await Promise.all([
      fetch(`${DOCS_API_URL}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchBody),
        signal: AbortSignal.timeout(DOCS_TIMEOUT_MS),
      }),
      fetch(`${DOCS_API_URL}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(citationsBody),
        signal: AbortSignal.timeout(DOCS_TIMEOUT_MS),
      }),
    ]);

    if (!searchRes.ok) {
      console.warn(`[docs] search returned ${searchRes.status} — skipping context injection`);
      return empty;
    }

    data = (await searchRes.json()) as DocsSearchResponse;

    // Extract chunk_ids from /ask citations to filter the sources panel
    if (citationsRes.ok) {
      const citationsData = (await citationsRes.json()) as { citations: { chunk_id: string }[] };
      citationChunkIds = new Set(citationsData.citations.map((c) => c.chunk_id));
      console.log(`[docs] citations_only returned ${citationChunkIds.size} chunks`);
    }
  } catch (err) {
    console.warn('[docs] service unreachable:', (err as Error).message);
    return empty;
  }

  const topScore = data.results[0]?.score ?? 0;
  const relevant = data.results.filter((r) => r.score >= DOCS_MIN_SCORE);
  console.log(
    `[docs] query="${question.slice(0, 60)}" manual=${manualId ?? 'all'} total=${data.total} topScore=${topScore.toFixed(3)} relevant=${relevant.length}`,
  );

  // ── Context text (for system message) ──────────────────────────────────────
  const blocks = data.answer_context_blocks
    .slice(0, relevant.length)
    .join('\n\n---\n\n');

  const citationLine = data.citations
    .slice(0, relevant.length)
    .map((c) => {
      const page = c.page_start != null ? ` p.${c.page_start}` : '';
      return `${c.manual_title}${page}`;
    })
    .filter((v, i, a) => a.indexOf(v) === i)
    .join('; ');

  const context = [
    'WORKSHOP MANUAL CONTEXT — answer ONLY from the sections below.',
    'If the specific value or procedure is not present in these sections, say:',
    '"I could not find that in the retrieved manual pages — please check the full manual."',
    'Do NOT use general knowledge or training data to fill in missing values.',
    '',
    blocks,
    '',
    `Source: ${citationLine}`,
  ].join('\n');

  // ── Structured sources (for the chat UI page-preview panel) ────────────────
  // If /ask citations_only returned chunk_ids, restrict sources to only those
  // chunks (the reranker's top picks). Otherwise fall back to all relevant results.
  const sourceResults = citationChunkIds
    ? relevant.filter((r) => citationChunkIds!.has(r.chunk_id))
    : relevant;

  const sourceMap = new Map<string, DocsSource>();
  for (const r of sourceResults) {
    const key = `${r.citation.manual_id}::${r.citation.page_start ?? ''}::${r.citation.page_end ?? ''}`;
    if (!sourceMap.has(key)) {
      const section = r.section_path?.length
        ? r.section_path.join(' › ')
        : (r.heading ?? null);
      sourceMap.set(key, {
        manual_id: r.citation.manual_id,
        manual_title: r.citation.manual_title,
        manufacturer: r.citation.manufacturer,
        model: r.citation.model,
        year: r.citation.year,
        page_start: r.citation.page_start,
        page_end: r.citation.page_end,
        section,
        images: [],
      });
    }
    const src = sourceMap.get(key)!;
    for (const img of (r.image_refs ?? [])) {
      if (!src.images.find((i) => i.image_id === img.image_id)) {
        src.images.push({
          image_id: img.image_id,
          page_number: img.page_number,
          caption: img.caption,
        });
      }
    }
  }

  const sources = Array.from(sourceMap.values());

  return { context, sources };
}
