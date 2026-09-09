/**
 * Ingest Monitor — document inspector.
 *
 * A full-screen overlay showing everything the pipeline produced for one
 * document: the AI summary, every chunk with its embedding state, the per-page
 * markdown Docling emitted, extracted images and tables, job history, and a
 * live search probe against the real as500-docs retrieval path.
 *
 * Markdown is shown as raw text on purpose — when tuning extraction you need to
 * see what was actually stored, not a prettified rendering of it.
 */

import { useEffect, useState } from 'react';
import { ago, bytes, clock, duration } from '../format';
import { monitorAssetUrl } from '../useMonitorSocket';
import type { ChunkRow, DocumentDetail, SearchOutcome } from '../types';

type Tab = 'summary' | 'chunks' | 'pages' | 'images' | 'tables' | 'search' | 'jobs';

interface Props {
  itemId: number;
  detail: DocumentDetail | null;
  loading: boolean;
  error: string | null;
  search: SearchOutcome | null;
  searchBusy: boolean;
  onSearch: (query: string, userId: number, topK?: number) => void;
  onClose: () => void;
}

export default function DocumentInspector({
  itemId,
  detail,
  loading,
  error,
  search,
  searchBusy,
  onSearch,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>('summary');
  const [query, setQuery] = useState('');

  // Reset the view when the user drills into a different document.
  useEffect(() => {
    setTab('summary');
    setQuery('');
  }, [itemId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (error) {
    return (
      <Shell title={`item #${itemId}`} onClose={onClose}>
        <div className="mon-warning">{error}</div>
      </Shell>
    );
  }

  if (!detail) {
    return (
      <Shell title={`item #${itemId}`} onClose={onClose}>
        <div className="mon-empty">{loading ? 'Reading artefacts…' : 'No data.'}</div>
      </Shell>
    );
  }

  const { item, chunks, pages, images, tables, jobs, warnings } = detail;
  const originalUrl = monitorAssetUrl(item.originalUrl);

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'summary', label: 'Summary' },
    { id: 'chunks', label: 'Chunks', count: chunks.length },
    { id: 'pages', label: 'Pages', count: pages.length },
    { id: 'images', label: 'Images', count: images.length },
    { id: 'tables', label: 'Tables', count: tables.length },
    { id: 'search', label: 'Search' },
    { id: 'jobs', label: 'Jobs', count: jobs.length },
  ];

  return (
    <Shell title={item.name} subtitle={item.folderPath} onClose={onClose}>
      <div className="mon-insp-meta">
        <span className={`mon-badge ${item.ingestStatus === 'ready' ? 'completed' : 'queued'}`}>
          {item.ingestStatus}
        </span>
        <span>item #{item.id}</span>
        <span>user {item.userId}</span>
        <span>{item.fileType ?? '?'}</span>
        <span>{bytes(item.sizeBytes)}</span>
        <span>
          {item.embeddedCount}/{item.chunkCount} chunks embedded
        </span>
        <span>updated {ago(item.updatedAt)}</span>
        {item.lastJobDurationSec != null && <span>ingest {duration(item.lastJobDurationSec)}</span>}
        {originalUrl && (
          <a className="mon-btn" href={originalUrl} target="_blank" rel="noreferrer">
            Open original
          </a>
        )}
      </div>

      {warnings.length > 0 && (
        <div className="mon-warnings">
          {warnings.map((w) => (
            <div className="mon-warning" key={w}>
              {w}
            </div>
          ))}
        </div>
      )}

      <div className="mon-log-tabs mon-insp-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`mon-log-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.count != null && <span className="mon-insp-tab-count">{t.count}</span>}
          </button>
        ))}
      </div>

      <div className="mon-insp-body">
        {tab === 'summary' && (
          <>
            <Section
              title="AI summary"
              hint="Ollama, from the first 5 chunks. Read by knowledge_get_document; never embedded or searched."
            >
              {item.aiSummary ? (
                <pre className="mon-insp-pre">{item.aiSummary}</pre>
              ) : (
                <div className="mon-empty">No summary was generated for this document.</div>
              )}
            </Section>

            <Section title="Record">
              <div className="mon-insp-kv">
                <Row label="storage_path" value={item.storagePath ?? '—'} />
                <Row label="mime_type" value={item.mimeType ?? '—'} />
                <Row label="content_hash" value={item.contentHash ?? '—'} />
                <Row label="folder_id" value={String(item.folderId ?? '—')} />
                <Row label="created_at" value={item.createdAt ? clock(item.createdAt) : '—'} />
                <Row label="updated_at" value={item.updatedAt ? clock(item.updatedAt) : '—'} />
                <Row
                  label="embedding dims"
                  value={
                    [...new Set(chunks.map((c) => c.embeddingDims).filter(Boolean))].join(', ') || '—'
                  }
                />
                <Row
                  label="total chunk text"
                  value={`${chunks.reduce((n, c) => n + c.charCount, 0).toLocaleString()} chars`}
                />
              </div>
            </Section>
          </>
        )}

        {tab === 'chunks' &&
          (chunks.length === 0 ? (
            <div className="mon-empty">
              No chunks. Nothing about this document can ever be retrieved by the agent.
            </div>
          ) : (
            chunks.map((c) => <Chunk chunk={c} key={c.id} />)
          ))}

        {tab === 'pages' &&
          (pages.length === 0 ? (
            <div className="mon-empty">No per-page markdown was stored for this document.</div>
          ) : (
            pages.map((p) => (
              <Section
                key={p.pageNumber}
                title={`Page ${p.pageNumber}`}
                hint={`${p.rawTextLength.toLocaleString()} chars of raw text`}
              >
                <pre className="mon-insp-pre">{p.markdown ?? '(no markdown)'}</pre>
              </Section>
            ))
          ))}

        {tab === 'images' &&
          (images.length === 0 ? (
            <div className="mon-empty">Docling extracted no images from this document.</div>
          ) : (
            <div className="mon-insp-images">
              {images.map((im) => {
                const url = monitorAssetUrl(im.url);
                return (
                  <div className="mon-insp-image" key={im.id}>
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer">
                        <img src={url} alt={im.caption ?? `image ${im.id}`} loading="lazy" />
                      </a>
                    ) : (
                      <div className="mon-insp-image-missing">
                        not readable — mount <code>../as500-docs/storage</code> into the server
                        container
                      </div>
                    )}
                    <div className="mon-insp-image-meta">
                      <span>#{im.id}</span>
                      <span>page {im.pageNumber ?? '?'}</span>
                      {im.linkedChunkId && <span>chunk {im.linkedChunkId}</span>}
                    </div>
                    {im.caption && <div className="mon-insp-caption">{im.caption}</div>}
                    <code className="mon-insp-path">{im.filePath}</code>
                  </div>
                );
              })}
            </div>
          ))}

        {tab === 'tables' &&
          (tables.length === 0 ? (
            <div className="mon-empty">No tables were extracted.</div>
          ) : (
            tables.map((t) => (
              <Section
                key={t.id}
                title={`Table #${t.id}`}
                hint={`page ${t.pageNumber ?? '?'}${t.linkedChunkId ? ` · chunk ${t.linkedChunkId}` : ''}`}
              >
                <pre className="mon-insp-pre">{t.markdown ?? '(empty)'}</pre>
              </Section>
            ))
          ))}

        {tab === 'search' && (
          <SearchTab
            userId={item.userId}
            itemId={item.id}
            query={query}
            setQuery={setQuery}
            busy={searchBusy}
            result={search}
            onSearch={onSearch}
          />
        )}

        {tab === 'jobs' &&
          (jobs.length === 0 ? (
            <div className="mon-empty">This document was never enqueued for ingestion.</div>
          ) : (
            <div className="mon-insp-kv">
              {jobs.map((j) => (
                <div className="mon-insp-job" key={j.id}>
                  <span className={`mon-badge ${j.state}`}>{j.state}</span>
                  <span>attempt {j.attempts}</span>
                  <span>{duration(j.durationSec)}</span>
                  <span>{j.finishedAt ? clock(j.finishedAt) : 'unfinished'}</span>
                  {j.lockedBy && <span>lock {j.lockedBy}</span>}
                  <code className="mon-insp-path">{j.id}</code>
                  {j.error && <div className="mon-job-error">{j.error}</div>}
                  {j.traceback && <Traceback text={j.traceback} />}
                </div>
              ))}
            </div>
          ))}
      </div>
    </Shell>
  );
}

/* ── Pieces ──────────────────────────────────────────────────────────────── */

/**
 * Job errors are often useless on their own: Docling wraps every pipeline
 * exception as `RuntimeError("Pipeline VlmPipeline failed")` and the worker
 * stores only `str(exc)`. The traceback still holds the real `__cause__` chain,
 * and Python prints causes before the exception that wrapped them — so the
 * first exception line in the traceback is the deepest, most specific one.
 */
function rootCause(traceback: string): string | null {
  const match = traceback
    .split('\n')
    .find((line) => /^\s*[\w.]+(Error|Exception|Exit)\b.*?: /.test(line));
  return match ? match.trim() : null;
}

function Traceback({ text }: { text: string }) {
  const cause = rootCause(text);
  return (
    <details className="mon-insp-trace">
      <summary>
        {cause ? (
          <>
            root cause: <strong>{cause}</strong>
          </>
        ) : (
          'full traceback'
        )}
      </summary>
      <pre>{text}</pre>
    </details>
  );
}

function Shell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mon-insp-backdrop" onClick={onClose}>
      <div className="mon-insp" onClick={(e) => e.stopPropagation()}>
        <div className="mon-insp-head">
          <div className="mon-insp-title">
            <h2>{title}</h2>
            {subtitle && <span>{subtitle}</span>}
          </div>
          <button className="mon-btn" onClick={onClose}>
            Close (Esc)
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mon-insp-section">
      <div className="mon-insp-section-head">
        <span className="mon-panel-title">{title}</span>
        {hint && <span className="mon-panel-sub">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="mon-fact">
      <span className="mon-fact-label">{label}</span>
      <span className="mon-fact-value" title={value}>
        {value}
      </span>
    </div>
  );
}

function Chunk({ chunk }: { chunk: ChunkRow }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(chunk.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className={`mon-insp-chunk${chunk.hasEmbedding ? '' : ' novec'}`}>
      <div className="mon-insp-chunk-head">
        <span className="mon-insp-chunk-id">#{chunk.id}</span>
        <span>
          page {chunk.pageNumber ?? '?'}
          {chunk.pageEnd && chunk.pageEnd !== chunk.pageNumber ? `–${chunk.pageEnd}` : ''}
        </span>
        <span>{chunk.contentType ?? 'text'}</span>
        <span>{chunk.charCount.toLocaleString()} chars</span>
        <span className={chunk.hasEmbedding ? 'ok' : 'bad'}>
          {chunk.hasEmbedding ? `vector ${chunk.embeddingDims ?? '?'}d` : 'NO VECTOR'}
        </span>
        <span className="mon-header-spacer" />
        <button className="mon-btn" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <div className="mon-insp-chunk-path">
        <code>{chunk.nodePath ?? '(no node_path)'}</code>
        {chunk.sectionTitle && <span>§ {chunk.sectionTitle}</span>}
      </div>

      <pre className="mon-insp-pre">{chunk.text || '(empty)'}</pre>
    </div>
  );
}

function SearchTab({
  userId,
  itemId,
  query,
  setQuery,
  busy,
  result,
  onSearch,
}: {
  userId: number;
  itemId: number;
  query: string;
  setQuery: (v: string) => void;
  busy: boolean;
  result: SearchOutcome | null;
  onSearch: (query: string, userId: number, topK?: number) => void;
}) {
  const run = () => onSearch(query, userId);

  return (
    <>
      <div className="mon-insp-search-bar">
        <input
          className="mon-log-filter"
          style={{ flex: 1, minWidth: 240 }}
          placeholder="ask something this document should answer…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') run();
          }}
        />
        <button className="mon-btn active" onClick={run} disabled={busy || !query.trim()}>
          {busy ? 'Searching…' : 'Search'}
        </button>
        <span className="mon-panel-sub">as user {userId}, via as500-docs hybrid search</span>
      </div>

      {!result && !busy && (
        <div className="mon-empty">
          Runs the real retrieval path the AI agent uses, scoped to this document's owner. Results
          from other documents are shown too — that is how you spot the wrong one winning.
        </div>
      )}

      {result?.error && <div className="mon-warning">{result.error}</div>}

      {result && !result.error && (
        <>
          <div className="mon-insp-search-meta">
            {result.total} result(s) in {result.tookMs}ms · ordered by reranker; <code>score</code> is
            the pre-rerank hybrid score
          </div>

          {result.keywordDead && (
            <div className="mon-warning">
              Every hit scored 0 on the keyword half — retrieval was vector-only for this query.
              as500-docs uses <code>plainto_tsquery</code>, which requires every query term to appear
              in the chunk text, so one unmatched word silences BM25 entirely.
            </div>
          )}

          {result.hits.map((h) => (
            <div
              className={`mon-insp-hit${h.documentItemId === itemId ? ' mine' : ''}`}
              key={h.chunkId}
            >
              <div className="mon-insp-hit-head">
                <span className="mon-insp-hit-rank">#{h.rank}</span>
                <span className="mon-insp-chunk-id">chunk {h.chunkId}</span>
                <span>
                  score <b>{h.score.toFixed(4)}</b>
                </span>
                <span className={h.vecScore > 0 ? 'ok' : 'muted'}>vec {h.vecScore.toFixed(3)}</span>
                <span className={h.kwScore > 0 ? 'ok' : 'bad'}>kw {h.kwScore.toFixed(3)}</span>
                <span className="mon-header-spacer" />
                {h.documentItemId === itemId ? (
                  <span className="mon-badge processing">this document</span>
                ) : (
                  <span className="mon-panel-sub">
                    {h.documentTitle ?? `item ${h.documentItemId}`}
                  </span>
                )}
              </div>
              <div className="mon-insp-chunk-path">
                <code>{h.nodePath ?? '—'}</code>
                <span>page {h.pageNumber ?? '?'}</span>
                {h.sectionTitle && <span>§ {h.sectionTitle}</span>}
              </div>
              <pre className="mon-insp-pre short">{h.text}</pre>
            </div>
          ))}
        </>
      )}
    </>
  );
}
