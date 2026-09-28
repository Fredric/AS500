/**
 * Ingest Monitor — one My Things / as500-images job, with generate timing.
 */

import { ago, duration } from '../format';
import type { ThingJobRow } from '../types';

const STAGES = ['queued', 'downloading', 'generating', 'uploading'] as const;

function stageState(job: ThingJobRow, id: (typeof STAGES)[number]): 'pending' | 'active' | 'done' | 'error' {
  if (job.state === 'failed' && (job.stage === id || (id === 'queued' && !job.stage))) return 'error';
  if (job.state === 'completed') return 'done';
  if (job.state === 'queued') return id === 'queued' ? 'active' : 'pending';
  const current = job.stage ?? 'downloading';
  const curIdx = STAGES.indexOf(current as (typeof STAGES)[number]);
  const idx = STAGES.indexOf(id);
  if (idx < 0) return 'pending';
  if (idx < curIdx) return 'done';
  if (idx === curIdx) return 'active';
  return 'pending';
}

function liveElapsed(job: ThingJobRow): number | null {
  if (job.finishedAt && job.durationSec != null) return job.durationSec;
  if (job.startedAt) return (Date.now() - new Date(job.startedAt).getTime()) / 1000;
  return job.durationSec;
}

export default function ThingJobCard({ job }: { job: ThingJobRow }) {
  const stateClass = ['queued', 'processing', 'completed', 'failed'].includes(job.state)
    ? job.state
    : 'queued';

  return (
    <div className={`mon-job ${stateClass}`}>
      <div className="mon-job-head">
        <span className={`mon-badge ${stateClass}`}>{job.state}</span>
        {job.stalled && <span className="mon-badge stalled">stalled</span>}
        <span className="mon-job-name" title={job.thingName ?? undefined}>
          {job.thingName ?? `thing #${job.thingId}`}
        </span>
        <span className="mon-job-meta">
          <span>thing #{job.thingId}</span>
          <span>user {job.userId}</span>
          {job.workingSize && <span>{job.workingSize}</span>}
          {job.backend && <span>{job.backend}</span>}
        </span>
      </div>

      <div className="mon-track">
        {STAGES.map((id) => (
          <span key={id} className={`mon-track-seg ${stageState(job, id)}`} title={id} />
        ))}
      </div>
      <div className="mon-track-labels">
        {STAGES.map((id) => (
          <span key={id} className={stageState(job, id)}>
            {id}
          </span>
        ))}
      </div>

      <div className="mon-job-stage">
        <span>
          <strong>{job.stage ?? job.state}</strong>
          {job.progress != null ? ` — ${job.progress}%` : ''}
        </span>
      </div>

      <div className="mon-job-counts">
        <span>
          generate <b>{duration(job.generateSec)}</b>
        </span>
        <span>
          job <b>{duration(job.jobSec)}</b>
        </span>
        <span>
          wall <b>{duration(liveElapsed(job))}</b>
        </span>
        <span>
          attempts <b>{job.attempts}</b>
        </span>
        <span>
          {job.finishedAt ? `finished ${ago(job.finishedAt)}` : `created ${ago(job.createdAt)}`}
        </span>
        {job.lockedBy && <span>runner {job.lockedBy}</span>}
      </div>

      {job.error && <div className="mon-job-error">{job.error}</div>}
    </div>
  );
}
