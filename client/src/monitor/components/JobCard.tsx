/**
 * Ingest Monitor — one ingestion job with its stage track.
 *
 * The track has one segment per pipeline stage, so a stalled document shows
 * exactly where it stopped rather than a single opaque percentage.
 */

import { ago, bytes, duration } from '../format';
import type { JobRow } from '../types';

interface Props {
  job: JobRow;
  /** Opens the document inspector for this job's document, when available. */
  onInspect?: (itemId: number) => void;
}

export default function JobCard({ job, onInspect }: Props) {
  const stateClass = ['queued', 'processing', 'completed', 'failed'].includes(job.state)
    ? job.state
    : 'queued';
  const currentStage = job.stages.find((s) => s.id === job.stage);

  return (
    <div className={`mon-job ${stateClass}`}>
      <div className="mon-job-head">
        <span className={`mon-badge ${stateClass}`}>{job.state}</span>
        {job.stalled && <span className="mon-badge stalled">stalled</span>}
        <span className="mon-job-name" title={job.documentName ?? undefined}>
          {job.documentName ?? `item #${job.documentItemId}`}
        </span>
        <span className="mon-job-meta">
          {job.folderName && <span>/{job.folderName}</span>}
          <span>{job.fileType ?? '?'}</span>
          <span>{bytes(job.sizeBytes)}</span>
          <span>item #{job.documentItemId}</span>
          <span>user {job.userId}</span>
        </span>
        {onInspect && (
          <>
            <span className="mon-header-spacer" />
            <button className="mon-btn" onClick={() => onInspect(job.documentItemId)}>
              Inspect
            </button>
          </>
        )}
      </div>

      <div className="mon-track">
        {job.stages.map((s) => (
          <span key={s.id} className={`mon-track-seg ${s.state}`} title={`${s.label}: ${s.detail}`} />
        ))}
      </div>
      <div className="mon-track-labels">
        {job.stages.map((s) => (
          <span key={s.id} className={s.state}>
            {s.label}
          </span>
        ))}
      </div>

      <div className="mon-job-stage">
        <span>
          <strong>{currentStage?.label ?? job.stage}</strong>
          {currentStage?.detail ? ` — ${currentStage.detail}` : ''}
        </span>
        <span>{job.progressPct}%</span>
      </div>

      <div className="mon-job-counts">
        <span>
          pages <b>{job.pageCount}</b>
        </span>
        <span>
          chunks <b>{job.chunkCount}</b>
        </span>
        <span>
          vectors <b>{job.embeddedCount}</b>
        </span>
        <span>
          images <b>{job.imageCount}</b>
        </span>
        <span>
          tables <b>{job.tableCount}</b>
        </span>
        <span>
          elapsed <b>{duration(job.durationSec)}</b>
        </span>
        <span>
          attempts <b>{job.attempts}</b>
        </span>
        <span>
          {job.finishedAt ? `finished ${ago(job.finishedAt)}` : `created ${ago(job.createdAt)}`}
        </span>
        {job.lockedBy && <span>lock {job.lockedBy}</span>}
        {job.ingestStatus && <span>item status {job.ingestStatus}</span>}
      </div>

      {job.error && <div className="mon-job-error">{job.error}</div>}
    </div>
  );
}
