/**
 * Ingest Monitor — document browser.
 *
 * The queue panels answer "did ingestion run?". This table is the way into the
 * other half of the question: pick a document and inspect what it produced.
 */

import { useMemo, useState } from 'react';
import { ago, bytes } from '../format';
import type { DocumentListRow } from '../types';

interface Props {
  documents: DocumentListRow[];
  error: string | null;
  activeId: number | null;
  onOpen: (itemId: number) => void;
  onRefresh: () => void;
}

type Filter = 'all' | 'ready' | 'problem' | 'pending';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'ready', label: 'Ready' },
  { id: 'problem', label: 'Problems' },
  { id: 'pending', label: 'Pending' },
];

/**
 * "Ready but unusable" is the failure mode that matters here: ingest_status says
 * ready while the artefacts that make a document retrievable are missing.
 */
function isProblem(d: DocumentListRow): boolean {
  if (d.lastJobState === 'failed' || d.ingestStatus === 'failed') return true;
  if (d.ingestStatus !== 'ready') return false;
  return d.chunkCount === 0 || d.embeddedCount < d.chunkCount || !d.hasSummary;
}

function statusClass(d: DocumentListRow): string {
  if (d.ingestStatus === 'failed' || d.lastJobState === 'failed') return 'failed';
  if (d.ingestStatus === 'ready') return isProblem(d) ? 'queued' : 'completed';
  if (d.ingestStatus === 'processing') return 'processing';
  return 'queued';
}

export default function DocumentBrowser({ documents, error, activeId, onOpen, onRefresh }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return documents.filter((d) => {
      if (needle && !`${d.name} ${d.folderPath}`.toLowerCase().includes(needle)) return false;
      if (filter === 'ready') return d.ingestStatus === 'ready' && !isProblem(d);
      if (filter === 'problem') return isProblem(d);
      if (filter === 'pending') return d.ingestStatus !== 'ready' && d.ingestStatus !== 'failed';
      return true;
    });
  }, [documents, filter, query]);

  const problems = useMemo(() => documents.filter(isProblem).length, [documents]);

  return (
    <div className="mon-panel">
      <div className="mon-panel-head">
        <span className="mon-panel-title">Documents</span>
        <span className="mon-panel-sub">
          {documents.length} total
          {problems > 0 && <span style={{ color: 'var(--mon-amber)' }}> · {problems} need attention</span>}
        </span>
      </div>

      <div className="mon-doc-toolbar">
        <input
          className="mon-log-filter"
          placeholder="filter by name or folder…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="mon-btn-group">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={`mon-btn${filter === f.id ? ' active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </span>
        <span className="mon-header-spacer" />
        <button className="mon-btn" onClick={onRefresh}>
          Reload
        </button>
      </div>

      <div className="mon-panel-body">
        {error && <div className="mon-warning">{error}</div>}

        {rows.length === 0 ? (
          <div className="mon-empty">
            {documents.length === 0
              ? 'No documents in the library yet. Upload a PDF from My Documents in the terminal.'
              : 'No documents match this filter.'}
          </div>
        ) : (
          <div className="mon-doc-table">
            <div className="mon-doc-row head">
              <span>Document</span>
              <span>Chunks</span>
              <span>Pages</span>
              <span>Media</span>
              <span>Size</span>
              <span>Updated</span>
            </div>

            {rows.map((d) => {
              const vectorGap = d.chunkCount > 0 && d.embeddedCount < d.chunkCount;
              return (
                <button
                  key={d.id}
                  className={`mon-doc-row${activeId === d.id ? ' active' : ''}`}
                  onClick={() => onOpen(d.id)}
                  title={`${d.folderPath}/${d.name} — click to inspect`}
                >
                  <span className="mon-doc-name-cell">
                    <span className={`mon-badge ${statusClass(d)}`}>{d.ingestStatus}</span>
                    <span className="mon-doc-name">{d.name}</span>
                    <span className="mon-doc-path">{d.folderPath}</span>
                  </span>

                  <span className={vectorGap ? 'bad' : d.chunkCount === 0 ? 'muted' : ''}>
                    {d.chunkCount === 0 ? '—' : `${d.embeddedCount}/${d.chunkCount}`}
                  </span>
                  <span className={d.pageCount === 0 ? 'muted' : ''}>{d.pageCount || '—'}</span>
                  <span className={d.imageCount + d.tableCount === 0 ? 'muted' : ''}>
                    {d.imageCount + d.tableCount === 0
                      ? '—'
                      : `${d.imageCount}i ${d.tableCount}t`}
                  </span>
                  <span className="muted">{bytes(d.sizeBytes)}</span>
                  <span className="muted">{ago(d.updatedAt)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
