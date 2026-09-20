/**
 * File-explorer modal for a bookshelf's books.
 *
 * Opens rooted at one book (a subfolder) and can descend through its own
 * subfolders to any depth — `document_folders` has no move/reparent
 * operation anywhere in AS500, so the tree has no cycles and no depth limit
 * is needed. Navigation never goes above the book it was opened from: the
 * breadcrumb is a local stack seeded at the book, folder rows push onto it,
 * and a breadcrumb click truncates back to that point — the server is never
 * asked to go "up," only ever for folder ids this component already showed.
 *
 * The parent must remount this component (`key={rootFolderId}`) when a
 * different book is opened while one is already showing, so the breadcrumb
 * stack resets instead of carrying over from the previous book.
 */

import { useEffect, useRef, useState } from 'react';
import type { DocumentsBrowseEntry } from '../types';
import type { DocumentsBrowseLevel } from '../useWorldSocket';

interface Crumb {
  folderId: number;
  name: string;
}

interface Props {
  rootFolderId: number;
  rootLabel: string;
  browse: DocumentsBrowseLevel | null;
  error: string | null;
  onNavigate: (folderId: number) => void;
  onClose: () => void;
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentsBrowserModal({ rootFolderId, rootLabel, browse, error, onNavigate, onClose }: Props) {
  const [stack, setStack] = useState<Crumb[]>([{ folderId: rootFolderId, name: rootLabel }]);
  const current = stack[stack.length - 1];

  // Ask for the current level whenever the stack's top changes — including
  // on mount, so opening a book fetches its contents immediately.
  const requestedRef = useRef<number | null>(null);
  useEffect(() => {
    if (requestedRef.current === current.folderId) return;
    requestedRef.current = current.folderId;
    onNavigate(current.folderId);
  }, [current.folderId, onNavigate]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function descend(entry: DocumentsBrowseEntry) {
    if (entry.kind !== 'folder') return;
    setStack((prev) => [...prev, { folderId: entry.id, name: entry.name }]);
  }

  function jumpTo(index: number) {
    setStack((prev) => prev.slice(0, index + 1));
  }

  // browse can be stale (the previous level, while the new one is in flight)
  // or for a different folder than the one currently selected.
  const level = browse && browse.folderId === current.folderId ? browse : null;
  const folders = level?.entries.filter((e) => e.kind === 'folder') ?? [];
  const files = level?.entries.filter((e) => e.kind === 'file') ?? [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal__head">
          <nav className="modal__breadcrumb" aria-label="Folder path">
            {stack.map((crumb, i) => (
              <span key={crumb.folderId}>
                {i > 0 && <span className="modal__breadcrumb-sep">/</span>}
                {i === stack.length - 1 ? (
                  <span className="modal__crumb modal__crumb--current">{crumb.name}</span>
                ) : (
                  <button type="button" className="modal__crumb" onClick={() => jumpTo(i)}>
                    {crumb.name}
                  </button>
                )}
              </span>
            ))}
          </nav>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="modal__body">
          {error && <p className="modal__error">{error}</p>}

          {!level && !error && <p className="modal__empty">Loading…</p>}

          {level && folders.length === 0 && files.length === 0 && (
            <p className="modal__empty">This folder is empty.</p>
          )}

          {folders.length > 0 && (
            <ul className="modal__list">
              {folders.map((entry) => (
                <li key={entry.id}>
                  <button type="button" className="modal__row modal__row--folder" onClick={() => descend(entry)}>
                    <span className="modal__row-icon">▸</span>
                    <span className="modal__row-name">{entry.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {files.length > 0 && (
            <ul className="modal__list">
              {files.map((entry) => (
                <li key={entry.id} className="modal__row modal__row--file">
                  <span className="modal__row-name">{entry.name}</span>
                  <span className="modal__row-meta">{entry.fileType}</span>
                  <span className="modal__row-meta">{formatSize(entry.sizeBytes)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
