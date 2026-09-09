/**
 * Ingest Monitor — live log console.
 *
 * One tab per log source. The server tails every source continuously, so the
 * error and warning counts on the tabs are accurate before a tab is ever opened.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { clock } from '../format';
import type { LogLine, LogSourceInfo } from '../types';

interface Props {
  sources: LogSourceInfo[];
  active: string | null;
  lines: LogLine[];
  onSelect: (source: string) => void;
}

function highlight(text: string, needle: string) {
  if (!needle) return text;
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + needle.length)}</mark>
      {text.slice(idx + needle.length)}
    </>
  );
}

export default function LogConsole({ sources, active, lines, onSelect }: Props) {
  const [filter, setFilter] = useState('');
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const viewRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return lines.filter((l) => {
      if (problemsOnly && l.level !== 'error' && l.level !== 'warn') return false;
      if (needle && !l.text.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [lines, filter, problemsOnly]);

  useEffect(() => {
    if (!autoScroll || !viewRef.current) return;
    viewRef.current.scrollTop = viewRef.current.scrollHeight;
  }, [visible.length, autoScroll, active]);

  const activeSource = sources.find((s) => s.key === active);

  return (
    <div className="mon-logs">
      <div className="mon-log-tabs">
        {sources.map((s) => (
          <button
            key={s.key}
            className={`mon-log-tab${s.key === active ? ' active' : ''}${s.available ? '' : ' unavailable'}`}
            onClick={() => onSelect(s.key)}
            title={s.detail}
          >
            <span className={`mon-led ${s.available ? 'up' : 'down'}`} />
            {s.label}
            {s.errorCount > 0 && <span className="mon-log-tab-count">{s.errorCount}</span>}
            {s.errorCount === 0 && s.warnCount > 0 && (
              <span className="mon-log-tab-count warn">{s.warnCount}</span>
            )}
          </button>
        ))}
      </div>

      <div className="mon-panel" style={{ borderTopLeftRadius: 0 }}>
        <div className="mon-log-toolbar">
          <input
            className="mon-log-filter"
            placeholder="filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <label className="mon-log-check">
            <input
              type="checkbox"
              checked={problemsOnly}
              onChange={(e) => setProblemsOnly(e.target.checked)}
            />
            errors + warnings only
          </label>
          <label className="mon-log-check">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            follow
          </label>
          <span style={{ marginLeft: 'auto' }}>
            {visible.length} / {lines.length} lines
            {activeSource ? ` · ${activeSource.detail}` : ''}
          </span>
        </div>

        <div className="mon-log-view" ref={viewRef}>
          {visible.length === 0 ? (
            <div className="mon-empty">
              {activeSource && !activeSource.available
                ? activeSource.kind === 'file'
                  ? `Log file not readable — ${activeSource.detail}`
                  : `No container attached — ${activeSource.detail}`
                : lines.length === 0
                  ? 'Waiting for output…'
                  : 'No lines match the current filter.'}
            </div>
          ) : (
            visible.map((l) => (
              <div className={`mon-log-line ${l.level}`} key={`${l.seq}-${l.ts}`}>
                <span className="mon-log-ts">{clock(l.ts)}</span>
                <span className="mon-log-lvl">{l.level.toUpperCase()}</span>
                <span className="mon-log-text">{highlight(l.text, filter.trim())}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
