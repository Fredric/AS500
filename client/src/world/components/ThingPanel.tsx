/**
 * Inspector for one object.
 *
 * The important line here is "Bound to". It says which AS500 config the object
 * is a view of and with what scope — the same binding the terminal follows when
 * you press Enter on that row. If this panel and the green screen ever disagree,
 * the model is wrong, so the binding is shown verbatim rather than prettified.
 */

import type { ResolvedThing } from '../types';

interface Props {
  thing: ResolvedThing;
  onClose: () => void;
  onSelect: (thing: ResolvedThing) => void;
}

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

export default function ThingPanel({ thing, onClose, onSelect }: Props) {
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
