/**
 * Collapsible list of source citations grouped by manual.
 * Each citation is a clickable link that opens ManualPageModal.
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

  // Group by manual
  const byManual = new Map<string, { title: string; pages: DocsSource[] }>();
  for (const src of sources) {
    if (!byManual.has(src.manual_id)) {
      byManual.set(src.manual_id, { title: src.manual_title, pages: [] });
    }
    byManual.get(src.manual_id)!.pages.push(src);
  }

  const manualCount = byManual.size;
  const pageCount = sources.length;

  return (
    <>
      <div className="src-panel">
        <button
          className={`src-panel-toggle${open ? ' src-panel-toggle--open' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="src-panel-arrow">{open ? '▾' : '▸'}</span>
          {pageCount} SOURCE PAGE{pageCount !== 1 ? 'S' : ''}
          {manualCount > 1 ? ` FROM ${manualCount} MANUALS` : ` — ${sources[0]?.manual_title}`}
        </button>

        {open && (
          <div className="src-panel-body">
            {Array.from(byManual.entries()).map(([mid, { title, pages }]) => (
              <div key={mid} className="src-panel-manual-group">
                {manualCount > 1 && (
                  <div className="src-panel-manual-label">{title}</div>
                )}
                <ul className="src-panel-list">
                  {pages.map((src, i) => {
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
              </div>
            ))}
          </div>
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
