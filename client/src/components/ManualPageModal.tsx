/**
 * Full-screen modal showing a synthetic preview of one manual page:
 * rendered markdown text + all extracted images from that page.
 */

import { useEffect, useState } from 'react';
import type { DocsSource } from '../types/aiChat';

interface PageData {
  manual_title: string;
  manufacturer: string;
  model: string;
  year: number | null;
  page_number: number;
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

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const pageLabel =
    source.page_start === source.page_end
      ? `p.${pageNumber}`
      : `pp.${source.page_start}–${source.page_end}`;

  const text = page?.markdown || page?.raw_text || null;

  return (
    <div className="mpmodal-overlay" onClick={onClose}>
      <div className="mpmodal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {/* Header */}
        <div className="mpmodal-header">
          <div className="mpmodal-title">
            <span className="mpmodal-manual">{source.manual_title}</span>
            <span className="mpmodal-page">{pageLabel}</span>
            {source.section && (
              <span className="mpmodal-section">§ {source.section}</span>
            )}
          </div>
          <button className="mpmodal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Body */}
        <div className="mpmodal-body">
          {loading && <div className="mpmodal-status">Loading page…</div>}
          {error && <div className="mpmodal-status mpmodal-error">Error: {error}</div>}

          {page && (
            <div className="mpmodal-content">
              {/* Images at the top */}
              {page.images.length > 0 && (
                <div className="mpmodal-images">
                  {page.images.map((img) => (
                    <figure key={img.image_id} className="mpmodal-figure">
                      <img
                        src={`/docs-images/${img.image_id}`}
                        alt={img.caption ?? `Page ${pageNumber} image`}
                        className="mpmodal-img"
                      />
                      {img.caption && (
                        <figcaption className="mpmodal-caption">{img.caption}</figcaption>
                      )}
                    </figure>
                  ))}
                </div>
              )}

              {/* Page text */}
              {text ? (
                <pre className="mpmodal-text">{text}</pre>
              ) : (
                <div className="mpmodal-status">No text content extracted for this page.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
