/**
 * Collapsible list of source citations from the workshop manual.
 * Each citation is a clickable link that opens a full ManualPageModal.
 */

import { useState } from 'react';
import type { DocsSource } from '../types/aiChat';
import ManualPageModal from './ManualPageModal';

interface Props {
  sources: DocsSource[];
}

interface ModalTarget {
  source: DocsSource;
  pageNumber: number;
}

export default function ManualSourcePanel({ sources }: Props) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<ModalTarget | null>(null);

  if (sources.length === 0) return null;

  const totalPages = sources.length;

  return (
    <>
      <div className="src-panel">
        <button
          className={`src-panel-toggle${open ? ' src-panel-toggle--open' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="src-panel-arrow">{open ? '▾' : '▸'}</span>
          {totalPages} SOURCE PAGE{totalPages !== 1 ? 'S' : ''} — {sources[0]?.manual_title}
        </button>

        {open && (
          <ul className="src-panel-list">
            {sources.map((src, i) => {
              const pageNum = src.page_start ?? 0;
              const pageLabel =
                src.page_start === src.page_end || src.page_end == null
                  ? `p.${src.page_start}`
                  : `pp.${src.page_start}–${src.page_end}`;

              return (
                <li key={i} className="src-panel-item">
                  <button
                    className="src-panel-link"
                    onClick={() => setModal({ source: src, pageNumber: pageNum })}
                  >
                    <span className="src-panel-page-ref">{pageLabel}</span>
                    {src.section && (
                      <span className="src-panel-section">§ {src.section}</span>
                    )}
                    {src.images.length > 0 && (
                      <span className="src-panel-img-badge">{src.images.length} img</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {modal && (
        <ManualPageModal
          source={modal.source}
          pageNumber={modal.pageNumber}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
