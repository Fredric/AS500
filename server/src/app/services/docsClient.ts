// as500-docs RAG client.
//
// Fetches relevant manual context for a user question and returns both:
//   - A pre-formatted system-message string for the AI agent.
//   - Structured source references (page images + citations) for the UI.
//
// Configuration (server/.env.local):
//   DOCS_API_URL=http://host.docker.internal:8080
//   DOCS_MIN_SCORE=0.25   (optional — chunks below this score are ignored)

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
  score: number;
  page_start: number | null;
  page_end: number | null;
  section_path: string[] | null;
  heading: string | null;
  image_refs: DocsImageRefRaw[];
  citation: {
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

const DOCS_API_URL = process.env.DOCS_API_URL?.replace(/\/$/, '') ?? '';
const DOCS_MIN_SCORE = parseFloat(process.env.DOCS_MIN_SCORE ?? '0.25');
const DOCS_TOP_K = 10;
const DOCS_TIMEOUT_MS = 45_000;

/**
 * Query the as500-docs /search endpoint and return both a formatted context
 * string and structured source references for the chat UI.
 *
 * Returns `{context: null, sources: []}` if:
 *   - DOCS_API_URL is not configured
 *   - The docs service is unreachable
 *   - No chunks meet the minimum relevance score
 */
export async function fetchDocsContext(question: string): Promise<DocsContextResult> {
  const empty: DocsContextResult = { context: null, sources: [] };
  if (!DOCS_API_URL) return empty;

  let data: DocsSearchResponse;

  try {
    const res = await fetch(`${DOCS_API_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: question, top_k: DOCS_TOP_K, rerank: true }),
      signal: AbortSignal.timeout(DOCS_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.warn(`[docs] search returned ${res.status} — skipping context injection`);
      return empty;
    }

    data = (await res.json()) as DocsSearchResponse;
  } catch (err) {
    console.warn('[docs] service unreachable:', (err as Error).message);
    return empty;
  }

  const topScore = data.results[0]?.score ?? 0;
  const relevant = data.results.filter((r) => r.score >= DOCS_MIN_SCORE);
  console.log(
    `[docs] query="${question.slice(0, 60)}" total=${data.total} topScore=${topScore.toFixed(3)} relevant=${relevant.length} threshold=${DOCS_MIN_SCORE}`,
  );

  if (relevant.length === 0 || data.answer_context_blocks.length === 0) return empty;

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
    'Relevant sections from the workshop manual:',
    '',
    blocks,
    '',
    `Source: ${citationLine}`,
  ].join('\n');

  // ── Structured sources (for the chat UI page-preview panel) ────────────────
  // Only surface sources from the dominant manual (highest total relevance
  // score). This prevents a less-relevant manual from polluting the source
  // panel when the answer clearly comes from one specific manual.
  const manualScore = new Map<string, number>();
  for (const r of relevant) {
    const mid = r.citation.manual_id;
    manualScore.set(mid, (manualScore.get(mid) ?? 0) + r.score);
  }
  const dominantManualId = [...manualScore.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const dominantResults = dominantManualId
    ? relevant.filter((r) => r.citation.manual_id === dominantManualId)
    : relevant;

  // Deduplicate by page range, collecting all images for each page.
  const sourceMap = new Map<string, DocsSource>();
  for (const r of dominantResults) {
    const key = `${r.citation.page_start ?? ''}::${r.citation.page_end ?? ''}`;
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
