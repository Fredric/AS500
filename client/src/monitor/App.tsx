/**
 * Ingest Monitor — dashboard root.
 *
 * A standalone admin page served at /ingestmonitor. It shares no state, routing
 * or styling with the AS500 terminal app; everything it shows arrives over its
 * own WebSocket from `server/src/monitor/`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import DocumentBrowser from './components/DocumentBrowser';
import DocumentInspector from './components/DocumentInspector';
import GpuPanel from './components/GpuPanel';
import JobCard from './components/JobCard';
import LogConsole from './components/LogConsole';
import PipelineFlow from './components/PipelineFlow';
import ServiceCard from './components/ServiceCard';
import { ago, duration } from './format';
import { useMonitorSocket } from './useMonitorSocket';
import type { ComponentGroup, ComponentStatus } from './types';

const POLL_CHOICES = [1000, 2500, 5000, 10000];

const GROUP_TITLES: Record<ComponentGroup, string> = {
  as500: 'AS500',
  ingest: 'Ingest (as500-docs)',
  inference: 'Inference',
  infra: 'Infrastructure',
};

export default function App() {
  const {
    connected,
    snapshot,
    error,
    lastUpdateAt,
    logs,
    logSource,
    watchLogSource,
    refresh,
    setPollMs,
    documents,
    documentsError,
    requestDocuments,
    openItemId,
    detail,
    detailLoading,
    detailError,
    openDocument,
    closeDocument,
    search,
    searchBusy,
    runSearch,
  } = useMonitorSocket();

  const [pollChoice, setPollChoice] = useState(2500);
  // Re-render on a timer so relative timestamps stay honest between snapshots.
  const [, setTick] = useState(0);
  // Suppresses the "unreachable" message during the initial connect handshake,
  // which would otherwise flash on every page load.
  const [graceElapsed, setGraceElapsed] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    const grace = setTimeout(() => setGraceElapsed(true), 2000);
    return () => {
      clearInterval(id);
      clearTimeout(grace);
    };
  }, []);

  // Default the console to the worker: it is where ingestion problems surface.
  useEffect(() => {
    if (!logSource && snapshot?.logSources.length) {
      const preferred =
        snapshot.logSources.find((s) => s.key === 'docs-worker' && s.available) ??
        snapshot.logSources.find((s) => s.available) ??
        snapshot.logSources[0];
      watchLogSource(preferred.key);
    }
  }, [snapshot, logSource, watchLogSource]);

  /**
   * Artefact totals are the cheapest signal that ingestion changed something.
   * Re-reading the browser (and any open inspector) off this fingerprint makes
   * chunks appear live during a run without polling the heavier queries.
   */
  const fingerprint = snapshot
    ? [
        snapshot.queue.totals.documents,
        snapshot.queue.totals.chunks,
        snapshot.queue.totals.embeddedChunks,
        snapshot.queue.totals.pages,
        snapshot.queue.totals.images,
        snapshot.queue.totals.tables,
        snapshot.queue.counts.processing,
        snapshot.queue.counts.failed,
      ].join(':')
    : '';

  const lastFingerprint = useRef('');

  useEffect(() => {
    if (!fingerprint || fingerprint === lastFingerprint.current) return;
    lastFingerprint.current = fingerprint;
    requestDocuments();
    if (openItemId != null) openDocument(openItemId);
  }, [fingerprint, openItemId, openDocument, requestDocuments]);

  const grouped = useMemo(() => {
    const groups = new Map<ComponentGroup, ComponentStatus[]>();
    for (const c of snapshot?.components ?? []) {
      const list = groups.get(c.group) ?? [];
      list.push(c);
      groups.set(c.group, list);
    }
    return groups;
  }, [snapshot]);

  if (!snapshot) {
    const settling = !graceElapsed;
    return (
      <div className="mon">
        <div className="mon-offline">
          <h2 style={settling ? { color: 'var(--mon-green)' } : undefined}>
            {settling
              ? 'CONNECTING…'
              : connected
                ? 'WAITING FOR FIRST SNAPSHOT'
                : 'MONITOR BACKEND UNREACHABLE'}
          </h2>
          {!settling && (
            <p>
              The dashboard talks to the monitor server on port <code>3005</code>. If this stays up,
              check that the AS500 server is running and that port 3005 is published:
              <br />
              <code>docker compose up -d server</code> then{' '}
              <code>curl http://localhost:3005/health</code>
            </p>
          )}
          {!settling && error && <p style={{ color: 'var(--mon-red)' }}>{error}</p>}
        </div>
      </div>
    );
  }

  const { queue, gpu } = snapshot;
  const activeJobs = queue.jobs.filter((j) => j.state === 'processing' || j.state === 'queued');
  const recentJobs = queue.jobs.filter((j) => j.state === 'completed' || j.state === 'failed');
  const failedJobs = recentJobs.filter((j) => j.state === 'failed');
  const staleMs = lastUpdateAt ? Date.now() - lastUpdateAt : null;
  const logErrorsBySource = new Map(snapshot.logSources.map((s) => [s.key, s.errorCount]));

  return (
    <div className="mon">
      <header className="mon-header">
        <div className="mon-brand">
          <h1>INGEST MONITOR</h1>
          <span>AS500 · hierarchical RAG</span>
        </div>

        <span className={`mon-overall ${snapshot.overall}`}>
          <span className={`mon-led ${snapshot.overall}`} />
          {snapshot.overall}
        </span>

        <div className="mon-header-spacer" />

        <div className="mon-header-meta">
          <span>
            <span className={`mon-led ${connected ? 'up' : 'down'}`} style={{ display: 'inline-block', marginRight: 6 }} />
            {connected ? 'live' : 'reconnecting…'}
          </span>
          <span>
            updated{' '}
            {staleMs != null && staleMs > snapshot.pollMs * 3 ? (
              <strong style={{ color: 'var(--mon-amber)' }}>{Math.round(staleMs / 1000)}s ago</strong>
            ) : (
              `${Math.round((staleMs ?? 0) / 1000)}s ago`
            )}
          </span>
          <span>server up {ago(snapshot.serverStartedAt).replace(' ago', '')}</span>

          <span className="mon-btn-group">
            {POLL_CHOICES.map((ms) => (
              <button
                key={ms}
                className={`mon-btn${pollChoice === ms ? ' active' : ''}`}
                onClick={() => {
                  setPollChoice(ms);
                  setPollMs(ms);
                }}
              >
                {ms / 1000}s
              </button>
            ))}
          </span>
          <button className="mon-btn" onClick={refresh}>
            Refresh
          </button>
        </div>
      </header>

      {(snapshot.warnings.length > 0 || error) && (
        <div className="mon-warnings">
          {error && <div className="mon-warning">{error}</div>}
          {snapshot.warnings.map((w) => (
            <div className="mon-warning" key={w}>
              {w}
            </div>
          ))}
        </div>
      )}

      <PipelineFlow snapshot={snapshot} />

      <div className="mon-grid">
        <div className="mon-col">
          <div className="mon-panel">
            <div className="mon-panel-head">
              <span className="mon-panel-title">Queue</span>
              <span className="mon-panel-sub">
                {queue.available
                  ? `avg ${duration(queue.throughput.avgDurationSec)} per document · ` +
                    `${queue.throughput.completedLast24h} done / ${queue.throughput.failedLast24h} failed in 24h`
                  : 'unavailable'}
              </span>
            </div>
            <div className="mon-panel-body">
              <div className="mon-stats">
                <div className={`mon-stat${queue.counts.queued > 0 ? ' warn' : ''}`}>
                  <div className="mon-stat-label">Queued</div>
                  <div className="mon-stat-value">{queue.counts.queued}</div>
                  <div className="mon-stat-foot">waiting for worker</div>
                </div>
                <div className={`mon-stat${queue.counts.processing > 0 ? ' hot' : ''}`}>
                  <div className="mon-stat-label">Processing</div>
                  <div className="mon-stat-value">{queue.counts.processing}</div>
                  <div className="mon-stat-foot">in flight now</div>
                </div>
                <div className="mon-stat">
                  <div className="mon-stat-label">Completed</div>
                  <div className="mon-stat-value">{queue.counts.completed}</div>
                  <div className="mon-stat-foot">{queue.throughput.completedLastHour} in last hour</div>
                </div>
                <div className={`mon-stat${queue.counts.failed > 0 ? ' bad' : ''}`}>
                  <div className="mon-stat-label">Failed</div>
                  <div className="mon-stat-value">{queue.counts.failed}</div>
                  <div className="mon-stat-foot">all time</div>
                </div>
                <div className="mon-stat">
                  <div className="mon-stat-label">Documents</div>
                  <div className="mon-stat-value">{queue.totals.documents}</div>
                  <div className="mon-stat-foot">
                    {Object.entries(queue.itemStatus)
                      .map(([k, v]) => `${v} ${k}`)
                      .join(' · ') || '—'}
                  </div>
                </div>
                <div className="mon-stat">
                  <div className="mon-stat-label">Chunks</div>
                  <div className="mon-stat-value">{queue.totals.chunks}</div>
                  <div className="mon-stat-foot">{queue.totals.embeddedChunks} embedded</div>
                </div>
                <div className="mon-stat">
                  <div className="mon-stat-label">Pages</div>
                  <div className="mon-stat-value">{queue.totals.pages}</div>
                  <div className="mon-stat-foot">
                    {queue.totals.images} images · {queue.totals.tables} tables
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mon-panel">
            <div className="mon-panel-head">
              <span className="mon-panel-title">In flight</span>
              <span className="mon-panel-sub">{activeJobs.length} active job(s)</span>
            </div>
            <div className="mon-panel-body">
              {activeJobs.length === 0 ? (
                <div className="mon-empty">
                  Nothing being ingested. Upload a PDF in My Documents, or{' '}
                  <code>POST /ingest</code> against as500-docs to enqueue one.
                </div>
              ) : (
                <div className="mon-jobs">
                  {activeJobs.map((j) => (
                    <JobCard job={j} key={j.id} onInspect={openDocument} />
                  ))}
                </div>
              )}
            </div>
          </div>

          <DocumentBrowser
            documents={documents}
            error={documentsError}
            activeId={openItemId}
            onOpen={openDocument}
            onRefresh={requestDocuments}
          />

          {failedJobs.length > 0 && (
            <div className="mon-panel">
              <div className="mon-panel-head">
                <span className="mon-panel-title">Failures</span>
                <span className="mon-panel-sub">{failedJobs.length} recent</span>
              </div>
              <div className="mon-panel-body">
                <div className="mon-jobs">
                  {failedJobs.map((j) => (
                    <JobCard job={j} key={j.id} onInspect={openDocument} />
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="mon-panel">
            <div className="mon-panel-head">
              <span className="mon-panel-title">Recent jobs</span>
              <span className="mon-panel-sub">newest first</span>
            </div>
            <div className="mon-panel-body">
              {recentJobs.length === 0 ? (
                <div className="mon-empty">No completed jobs yet.</div>
              ) : (
                <div className="mon-jobs">
                  {recentJobs
                    .filter((j) => j.state !== 'failed')
                    .slice(0, 12)
                    .map((j) => (
                      <JobCard job={j} key={j.id} onInspect={openDocument} />
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mon-col">
          {(['ingest', 'inference', 'as500', 'infra'] as ComponentGroup[]).map((group) => {
            const items = grouped.get(group) ?? [];
            if (items.length === 0) return null;
            return (
              <div className="mon-panel" key={group}>
                <div className="mon-panel-head">
                  <span className="mon-panel-title">{GROUP_TITLES[group]}</span>
                  <span className="mon-panel-sub">{items.length} component(s)</span>
                </div>
                <div className="mon-panel-body">
                  <div className="mon-services">
                    {items.map((c) => (
                      <ServiceCard
                        key={c.id}
                        component={c}
                        logErrors={c.logSource ? (logErrorsBySource.get(c.logSource) ?? 0) : 0}
                        onViewLogs={watchLogSource}
                      />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}

          <GpuPanel gpu={gpu} />
        </div>
      </div>

      <LogConsole
        sources={snapshot.logSources}
        active={logSource}
        lines={logs}
        onSelect={watchLogSource}
      />

      {openItemId != null && (
        <DocumentInspector
          itemId={openItemId}
          detail={detail}
          loading={detailLoading}
          error={detailError}
          search={search}
          searchBusy={searchBusy}
          onSearch={runSearch}
          onClose={closeDocument}
        />
      )}

      <footer className="mon-footer">
        <span>
          snapshot <code>{snapshot.ts}</code> · poll <code>{snapshot.pollMs}ms</code>
        </span>
        <span>
          raw JSON: <code>http://localhost:3005/api/snapshot</code> · documents:{' '}
          <code>/api/documents/:id</code>
        </span>
      </footer>
    </div>
  );
}
