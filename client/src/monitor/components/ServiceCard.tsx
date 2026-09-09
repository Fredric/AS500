/** Ingest Monitor — one card per observable service. */

import { ago } from '../format';
import type { ComponentStatus } from '../types';

interface Props {
  component: ComponentStatus;
  /** Error count from the matching log source, shown as a button badge. */
  logErrors: number;
  onViewLogs: (source: string) => void;
}

export default function ServiceCard({ component: c, logErrors, onViewLogs }: Props) {
  return (
    <div className={`mon-service ${c.health}`}>
      <div className="mon-service-head">
        <span className={`mon-led ${c.health}`} />
        <span className="mon-service-name">{c.label}</span>
        {c.latencyMs != null && <span className="mon-service-latency">{c.latencyMs} ms</span>}
      </div>

      <span className="mon-service-sub">{c.subtitle}</span>
      <span className="mon-service-detail">{c.detail || '—'}</span>

      {c.facts.length > 0 && (
        <div className="mon-facts">
          {c.facts.map((f) => (
            <div className="mon-fact" key={f.label}>
              <span className="mon-fact-label">{f.label}</span>
              <span className={`mon-fact-value ${f.tone ?? ''}`} title={f.value}>
                {f.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {c.container && (
        <div className="mon-service-container">
          <span className={`mon-led ${c.container.state === 'running' ? 'up' : 'down'}`} />
          <code>{c.container.name}</code>
          <span>
            {c.container.state}
            {c.container.startedAt ? ` · ${ago(c.container.startedAt)}` : ''}
            {c.container.restartCount > 0 ? ` · ${c.container.restartCount} restarts` : ''}
          </span>
        </div>
      )}

      {c.error && (
        <div className="mon-job-error" style={{ maxHeight: 72 }}>
          {c.error}
        </div>
      )}

      {c.hint && c.health !== 'up' && <div className="mon-service-hint">{c.hint}</div>}

      {c.logSource && (
        <div className="mon-service-actions">
          <button className="mon-btn" onClick={() => onViewLogs(c.logSource!)}>
            Logs
            {logErrors > 0 && (
              <span className="mon-log-tab-count" style={{ marginLeft: 6 }}>
                {logErrors}
              </span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
