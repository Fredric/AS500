/**
 * Manual page preview modal.
 * Displays extracted images and properly rendered markdown content.
 * Styled as a clean, white technical document.
 */

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { DocsSource } from '../types/aiChat';

interface PageData {
  manual_title: string;
  manufacturer: string;
  model: string;
  year: number | null;
  page_number: number;
  translated_text: string | null;
  markdown: string | null;
  raw_text: string | null;
  images: { image_id: string; file_path: string | null; caption: string | null }[];
}

interface Props {
  source: DocsSource;
  pageNumber: number;
  onClose: () => void;
}

export default function ManualPageModal({ source, pageNumber, onClose }: Props) {
  const [page, setPage] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setPage(null);

    fetch(`/docs-pages/${source.manual_id}/${pageNumber}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<PageData>;
      })
      .then((data) => { setPage(data); setLoading(false); })
      .catch((e) => { setError(String(e)); setLoading(false); });
  }, [source.manual_id, pageNumber]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const pageLabel =
    source.page_start === source.page_end || source.page_end == null
      ? `p. ${pageNumber}`
      : `pp. ${source.page_start}–${source.page_end}`;

  const text = page?.translated_text || page?.markdown || page?.raw_text || null;

  return (
    <div className="mpm-overlay" onClick={onClose}>
      <div className="mpm" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">

        {/* ── Header bar ──────────────────────────────────────────────────── */}
        <div className="mpm-header">
          <div className="mpm-header-meta">
            <span className="mpm-header-title">{source.manual_title}</span>
            <span className="mpm-header-divider">·</span>
            <span className="mpm-header-page">{pageLabel}</span>
            {source.section && (
              <>
                <span className="mpm-header-divider">·</span>
                <span className="mpm-header-section">{source.section}</span>
              </>
            )}
          </div>
          <button className="mpm-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* ── Document body ───────────────────────────────────────────────── */}
        <div className="mpm-body">
          {loading && <div className="mpm-state">Loading…</div>}
          {error   && <div className="mpm-state mpm-state--error">Could not load page: {error}</div>}

          {page && (
            <div className="mpm-doc">

              {/* Images */}
              {page.images.length > 0 && (
                <div className="mpm-images">
                  {page.images.map((img) => (
                    <figure key={img.image_id} className="mpm-figure">
                      <img
                        src={`/docs-images/${img.image_id}`}
                        alt={img.caption || `Page ${pageNumber} illustration`}
                        className="mpm-img"
                      />
                      {img.caption && (
                        <figcaption className="mpm-caption">{img.caption}</figcaption>
                      )}
                    </figure>
                  ))}
                </div>
              )}

              {/* Markdown content */}
              {text ? (
                <div className="mpm-markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {text}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="mpm-state">No text content available for this page.</div>
              )}

            </div>
          )}
        </div>

      </div>
    </div>
  );
}
