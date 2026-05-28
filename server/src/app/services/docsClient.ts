// as500-docs RAG client.
//
// Fetches relevant manual context for a user question and returns
// pre-formatted system-message text ready to be injected before the
// agent call. Returns null when the docs service is unavailable, not
// configured, or no relevant content is found.
//
// Configuration (server/.env.local):
//   DOCS_API_URL=http://host.docker.internal:8080
//   DOCS_MIN_SCORE=0.25   (optional — chunks below this score are ignored)

interface DocsSearchResult {
  score: number;
  page_start: number | null;
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
 * Query the as500-docs /search endpoint and return a formatted system-message
 * string with the most relevant manual excerpts.
 *
 * Returns null if:
 *   - DOCS_API_URL is not configured
 *   - The docs service is unreachable
 *   - No chunks meet the minimum relevance score
 */
export async function fetchDocsContext(question: string): Promise<string | null> {
  if (!DOCS_API_URL) return null;

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
      return null;
    }

    data = (await res.json()) as DocsSearchResponse;
  } catch (err) {
    // Service is down or unreachable — fail silently so chat still works.
    console.warn('[docs] service unreachable:', (err as Error).message);
    return null;
  }

  // Filter blocks that have a strong enough match.
  const topScore = data.results[0]?.score ?? 0;
  const relevant = data.results.filter((r) => r.score >= DOCS_MIN_SCORE);
  console.log(
    `[docs] query="${question.slice(0, 60)}" total=${data.total} topScore=${topScore.toFixed(3)} relevant=${relevant.length} threshold=${DOCS_MIN_SCORE}`,
  );
  if (relevant.length === 0 || data.answer_context_blocks.length === 0) return null;

  // Take at most the top-k pre-formatted blocks.
  const blocks = data.answer_context_blocks
    .slice(0, relevant.length)
    .join('\n\n---\n\n');

  // Build a compact citation line, e.g. "CFMOTO 450 MT Service Manual 2024 p.34"
  const citationLine = data.citations
    .slice(0, relevant.length)
    .map((c) => {
      const page = c.page_start != null ? ` p.${c.page_start}` : '';
      return `${c.manual_title}${page}`;
    })
    .filter((v, i, a) => a.indexOf(v) === i) // deduplicate
    .join('; ');

  return [
    'Relevant excerpts from the workshop manual:',
    '',
    blocks,
    '',
    `Source: ${citationLine}`,
  ].join('\n');
}
