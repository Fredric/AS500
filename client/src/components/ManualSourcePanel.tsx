/**
 * Collapsible panel showing the workshop manual source pages that were used
 * to answer a question — images with citations.
 */

import { useState } from 'react';
import type { DocsSource } from '../types/aiChat';

interface Props {
  sources: DocsSource[];
}

export default function ManualSourcePanel({ sources }: Props) {
  const [open, setOpen] = useState(false);

  // Only show if there are sources with images
  const withImages = sources.filter((s) => s.images.length > 0);
  const totalImages = withImages.reduce((n, s) => n + s.images.length, 0);
  if (withImages.length === 0) return null;

  const label = `${totalImages} SOURCE IMAGE${totalImages !== 1 ? 'S' : ''}`;

  return (
    <div className="src-panel">
      <button
        className={`src-panel-toggle${open ? ' src-panel-toggle--open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="src-panel-arrow">{open ? '▾' : '▸'}</span>
        {label}
      </button>

      {open && (
        <div className="src-panel-body">
          {withImages.map((src, si) => (
            <div key={si} className="src-panel-source">
              <div className="src-panel-citation">
                <span className="src-panel-manual">{src.manual_title}</span>
                {(src.page_start != null) && (
                  <span className="src-panel-page">
                    {src.page_start === src.page_end
                      ? `p.${src.page_start}`
                      : `pp.${src.page_start}–${src.page_end}`}
                  </span>
                )}
                {src.section && (
                  <span className="src-panel-section">§ {src.section}</span>
                )}
              </div>
              <div className="src-panel-images">
                {src.images.map((img) => (
                  <div key={img.image_id} className="src-panel-img-wrap">
                    <img
                      src={`/docs-images/${img.image_id}`}
                      alt={img.caption ?? `Manual image p.${img.page_number ?? '?'}`}
                      className="src-panel-img"
                      loading="lazy"
                    />
                    {img.caption && (
                      <div className="src-panel-img-caption">{img.caption}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
