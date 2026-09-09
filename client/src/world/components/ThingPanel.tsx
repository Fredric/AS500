/**
 * Inspector for one object.
 *
 * The important line here is "Bound to". It says which AS500 config the object
 * is a view of and with what scope — the same binding the terminal follows when
 * you press Enter on that row. If this panel and the green screen ever disagree,
 * the model is wrong, so the binding is shown verbatim rather than prettified.
 */

import { useState } from 'react';
import type { ResolvedBook, ResolvedThing } from '../types';

interface Props {
  thing: ResolvedThing;
  onClose: () => void;
  onSelect: (thing: ResolvedThing) => void;
  /** Open a book's file-explorer modal. Only relevant when `thing.books` is set. */
  onOpenBook: (book: ResolvedBook) => void;
  /** Write a postit/board's text. Only relevant when `thing.type` is one of those. */
  onSetNote: (thingId: number, body: string, color?: string) => void;
}

const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green'];

function describeBinding(thing: ResolvedThing): string {
  const b = thing.binding;
  if (!b || b.kind === 'none') return 'nothing — decoration, or owns its own contents';
  switch (b.kind) {
    case 'crud': {
      const scope = b.scope && Object.keys(b.scope).length
        ? Object.entries(b.scope).map(([k, v]) => `${k}=${String(v)}`).join(', ')
        : 'no scope';
      return `config "${b.configId}" (${scope})`;
    }
    case 'record':      return `config "${b.configId}", record ${b.recordId}`;
    case 'service':     return `service "${b.serviceKey}"`;
    case 'agent':       return `agent user ${b.userId}`;
    case 'workstation': return 'a workstation running AS500';
  }
}

export default function ThingPanel({ thing, onClose, onSelect, onOpenBook, onSetNote }: Props) {
  return (
    <aside className="panel">
      <header className="panel__head">
        <div>
          <h2>{thing.label}</h2>
          <p className="panel__sub">
            {thing.type}
            {thing.zone ? ` · ${thing.zone}` : ''}
            {thing.slot ? ` · slot ${thing.slot}` : ''}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close">×</button>
      </header>

      <dl className="panel__meta">
        <dt>Bound to</dt>
        <dd>{describeBinding(thing)}</dd>
        <dt>Access</dt>
        <dd className={`access access--${thing.access}`}>
          {thing.access}
          {thing.reason ? ` — ${thing.reason}` : ''}
        </dd>
      </dl>

      {thing.service && (
        <section className="panel__section">
          <h3>Service</h3>
          <p className="panel__note">
            {thing.service.status}
            {thing.service.detail ? ` — ${thing.service.detail}` : ''}
          </p>
        </section>
      )}

      {thing.access === 'denied' && (
        <section className="panel__section">
          <p className="panel__note">
            You can see this object but not open it. Its contents are gated by the
            same permission that gates the screen it is a view of.
          </p>
        </section>
      )}

      {thing.contents && (
        <section className="panel__section">
          <h3>
            Contents <span className="count">{thing.contents.count}</span>
          </h3>
          {thing.contents.count === 0 ? (
            <p className="panel__note">Empty.</p>
          ) : (
            <ul className="contents">
              {thing.contents.preview.map((row, i) => (
                <li key={`${row.id ?? i}`}>{row.label}</li>
              ))}
              {thing.contents.truncated && (
                <li className="contents__more">
                  … {thing.contents.count - thing.contents.preview.length} more
                </li>
              )}
            </ul>
          )}
        </section>
      )}

      {(thing.type === 'postit' || thing.type === 'board') && thing.access === 'ok' && (
        <NoteEditor thing={thing} onSetNote={onSetNote} />
      )}

      {thing.books !== null && (
        <section className="panel__section">
          <h3>
            Books <span className="count">{thing.books.length}</span>
          </h3>
          {/* The complete, always-legible list — the floorplan's book spines
              are the primary way in, but cap how many render individually,
              so this is also where an overflowing shelf's remaining books
              are reached. */}
          {thing.books.length === 0 ? (
            <p className="panel__note">No subfolders yet.</p>
          ) : (
            <ul className="children">
              {thing.books.map((book) => (
                <li key={book.id}>
                  <button type="button" onClick={() => onOpenBook(book)}>
                    <span className="children__label">{book.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {thing.children.length > 0 && (
        <section className="panel__section">
          <h3>
            Holds <span className="count">{thing.children.length}</span>
          </h3>
          <ul className="children">
            {thing.children.map((child) => (
              <li key={child.id}>
                <button type="button" onClick={() => onSelect(child)}>
                  <span className="children__label">{child.label}</span>
                  <span className="children__type">{child.type}</span>
                  {child.contents && <span className="children__count">{child.contents.count}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}

/**
 * The graphical editor for a `postit`/`board`'s text — not CRUDTable-driven
 * (the floorplan has no form renderer), so this writes through the world
 * socket's own `SET_NOTE` message instead. The terminal's own form (reached
 * via Enter on the same row → the `world_notes` config) stays the shorter,
 * single-line version — this textarea is the graphical ceiling, same split
 * the bookshelf modal makes for arbitrary-depth browsing.
 *
 * Local edit state, seeded from the resolved note and not re-synced from
 * later props — the parent remounts this (`key={thing.id}` on `ThingPanel`)
 * when the selection changes to a different object, so state never carries
 * over between two different notes.
 */
function NoteEditor({ thing, onSetNote }: { thing: ResolvedThing; onSetNote: Props['onSetNote'] }) {
  const [body, setBody] = useState(thing.note?.body ?? '');
  const [color, setColor] = useState(thing.note?.color ?? 'yellow');
  const dirty = body !== (thing.note?.body ?? '') || color !== (thing.note?.color ?? 'yellow');

  return (
    <section className="panel__section">
      <h3>Note</h3>
      <textarea
        className="note-editor__body"
        rows={5}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Nothing written yet…"
      />
      <div className="note-editor__row">
        <select value={color} onChange={(e) => setColor(e.target.value)}>
          {NOTE_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button type="button" disabled={!dirty} onClick={() => onSetNote(thing.id, body, color)}>
          Save
        </button>
      </div>
    </section>
  );
}
