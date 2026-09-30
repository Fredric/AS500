// Job queue for Thing image generation.
//
// Postgres-native, following the pattern proven in as500-docs' worker
// (SELECT ... FOR UPDATE SKIP LOCKED wrapped in an UPDATE), with three
// additions that file lacks: a `stage` column so progress does not have to be
// reconstructed from log scraping, a bounded `max_attempts`, and a real lease
// rather than a fixed global timeout.
//
// There is no in-process worker. Jobs are served over HTTP to the as500-images
// worker running on a GPU machine; see api/lease.ts.

import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '../../core/db/index.js';
import { myThings, thingJobs, jobRunners } from '../db/schema.js';
import { currentQwenParams, QWEN_PROCESSOR } from './qwenDefaults.js';
import { currentDescribeParams, DESCRIBE_PROCESSOR } from './describeDefaults.js';
import { applyDescribeResult, setThingProcessedImage, setThingStatus } from '../services/thingService.js';
import { emitThingsChanged } from './events.js';

/**
 * How long a runner may be silent before we treat it as gone. Runners poll for
 * work continuously, so an idle poll is itself the heartbeat — 90s is several
 * missed polls, not a tight race.
 */
const RUNNER_STALE_MS = 90_000;

const DEFAULT_LEASE_SECONDS = 180;
const MAX_LEASE_SECONDS = 1800;

export interface ClaimedJob {
  id: string;
  thingId: number;
  userId: number;
  processor: string;
  params: Record<string, unknown>;
  attempts: number;
  leaseExpiresAt: string;
}

// ============================================
// Enqueue
// ============================================

/**
 * Queue sprite generation for a Thing. The generation parameters are read once
 * here and written into the job, so editing the defaults later never rewrites
 * the history of Things already generated.
 */
export async function enqueueQwenJob(params: {
  thingId: number;
  userId: number;
  seed?: number;
}): Promise<string> {
  const qwen = currentQwenParams();
  const seed = params.seed ?? Math.floor(Math.random() * 2 ** 48);
  const jobId = randomUUID();

  await db.insert(thingJobs).values({
    id: jobId,
    thing_id: params.thingId,
    user_id: params.userId,
    processor: QWEN_PROCESSOR,
    params: { ...qwen, seed },
  });

  await db
    .update(myThings)
    .set({
      status: 'processing',
      stage: 'queued',
      progress: 0,
      blocked_reason: null,
      prompt: qwen.prompt,
      seed,
      model: qwen.model,
      updated_at: new Date(),
    })
    .where(eq(myThings.id, params.thingId));

  emitThingsChanged(params.userId);
  return jobId;
}

/**
 * Queue object-info extraction for a Thing, independent of sprite
 * generation. Callable on any Thing that has a source photo — including one
 * that already has a `ready` sprite and a previous description — so a better
 * model can be re-run later without touching the sprite at all.
 */
export async function enqueueDescribeJob(params: {
  thingId: number;
  userId: number;
}): Promise<string> {
  const describe = currentDescribeParams();
  const jobId = randomUUID();

  await db.insert(thingJobs).values({
    id: jobId,
    thing_id: params.thingId,
    user_id: params.userId,
    processor: DESCRIBE_PROCESSOR,
    params: { ...describe },
  });

  return jobId;
}

// ============================================
// Runner registry
// ============================================

export async function touchRunner(params: {
  runnerId: string;
  capabilities: string[];
  version?: string | null;
}): Promise<void> {
  await db
    .insert(jobRunners)
    .values({
      id: params.runnerId,
      capabilities: params.capabilities,
      version: params.version ?? null,
      last_seen_at: new Date(),
    })
    .onConflictDoUpdate({
      target: jobRunners.id,
      set: {
        capabilities: params.capabilities,
        version: params.version ?? null,
        last_seen_at: new Date(),
      },
    });
}

/** True when some runner advertising this processor has polled recently. */
export async function isProcessorOnline(processor: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT 1
    FROM job_runners
    WHERE ${processor} = ANY(capabilities)
      AND last_seen_at > now() - (INTERVAL '1 millisecond' * ${RUNNER_STALE_MS})
    LIMIT 1
  `);
  return rows.rows.length > 0;
}

export async function lastSeenFor(processor: string): Promise<Date | null> {
  const rows = await db.execute<{ last_seen_at: Date }>(sql`
    SELECT max(last_seen_at) AS last_seen_at
    FROM job_runners
    WHERE ${processor} = ANY(capabilities)
  `);
  const value = rows.rows[0]?.last_seen_at;
  return value ? new Date(value) : null;
}

// ============================================
// Claim
// ============================================

/**
 * Retire jobs whose lease expired and which have no attempts left. Without
 * this they would be reclaimed forever. Called at the top of every claim, so
 * the worker's own polling drives the sweep — no separate timer.
 */
async function retireExhaustedJobs(): Promise<void> {
  const rows = await db.execute<{ thing_id: number; processor: string }>(sql`
    UPDATE thing_jobs
    SET state = 'failed',
        finished_at = now(),
        error = COALESCE(error, 'Lease expired and no attempts remaining')
    WHERE state = 'processing'
      AND lease_expires_at < now()
      AND attempts >= max_attempts
    RETURNING thing_id, processor
  `);

  for (const row of rows.rows) {
    // Describe jobs never drive the Thing's visible status — a Thing with a
    // ready sprite must not flip to `failed` because a description rerun
    // exhausted its attempts.
    if (row.processor !== QWEN_PROCESSOR) continue;
    await setThingStatus({
      thingId: row.thing_id,
      status: 'failed',
      stage: null,
      blockedReason: 'generation failed',
    });
  }
}

export async function getJobById(jobId: string): Promise<typeof thingJobs.$inferSelect | null> {
  const [job] = await db.select().from(thingJobs).where(eq(thingJobs.id, jobId));
  return job ?? null;
}

export async function claimJob(params: {
  runnerId: string;
  capabilities: string[];
  leaseSeconds?: number;
}): Promise<ClaimedJob | null> {
  await retireExhaustedJobs();

  const lease = Math.min(
    Math.max(params.leaseSeconds ?? DEFAULT_LEASE_SECONDS, 30),
    MAX_LEASE_SECONDS,
  );

  const rows = await db.execute<{
    id: string;
    thing_id: number;
    user_id: number;
    processor: string;
    params: Record<string, unknown>;
    attempts: number;
    lease_expires_at: string;
  }>(sql`
    UPDATE thing_jobs
    SET state            = 'processing',
        locked_by        = ${params.runnerId},
        locked_at        = now(),
        lease_expires_at = now() + (INTERVAL '1 second' * ${lease}),
        started_at       = COALESCE(started_at, now()),
        attempts         = attempts + 1
    WHERE id = (
      SELECT id FROM thing_jobs
      WHERE processor = ANY(ARRAY[${sql.join(
      params.capabilities.map((c) => sql`${c}`),
      sql`, `,
    )}]::text[])
        AND attempts < max_attempts
        AND (
          state = 'queued'
          OR (state = 'processing' AND lease_expires_at < now())
        )
      ORDER BY created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, thing_id, user_id, processor, params, attempts, lease_expires_at
  `);

  const row = rows.rows[0];
  if (!row) return null;

  if (row.processor === QWEN_PROCESSOR) {
    await setThingStatus({
      thingId: row.thing_id,
      status: 'processing',
      stage: 'starting',
      progress: 0,
      blockedReason: null,
    });
  }

  return {
    id: row.id,
    thingId: row.thing_id,
    userId: row.user_id,
    processor: row.processor,
    params: row.params ?? {},
    attempts: row.attempts,
    leaseExpiresAt: new Date(row.lease_expires_at).toISOString(),
  };
}

// ============================================
// Lease-holder operations
// ============================================

export class LeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LeaseError';
  }
}

/**
 * Load a job and assert the caller still owns its lease. Every worker-driven
 * mutation goes through this, so a runner whose lease was reclaimed mid-job
 * cannot overwrite the work of whoever picked it up next.
 */
async function requireLease(
  jobId: string,
  runnerId: string,
): Promise<typeof thingJobs.$inferSelect> {
  const [job] = await db.select().from(thingJobs).where(eq(thingJobs.id, jobId));
  if (!job) throw new LeaseError('Job not found');
  if (job.state !== 'processing') throw new LeaseError(`Job is ${job.state}, not processing`);
  if (job.locked_by !== runnerId) throw new LeaseError('Job is leased to another runner');
  if (job.lease_expires_at && job.lease_expires_at.getTime() < Date.now()) {
    throw new LeaseError('Lease expired');
  }
  return job;
}

export async function heartbeatJob(params: {
  jobId: string;
  runnerId: string;
  stage?: string | null;
  progress?: number | null;
  leaseSeconds?: number;
}): Promise<{ leaseExpiresAt: string }> {
  const job = await requireLease(params.jobId, params.runnerId);

  const lease = Math.min(
    Math.max(params.leaseSeconds ?? DEFAULT_LEASE_SECONDS, 30),
    MAX_LEASE_SECONDS,
  );

  const rows = await db.execute<{ lease_expires_at: string }>(sql`
    UPDATE thing_jobs
    SET stage            = ${params.stage ?? null},
        progress         = ${params.progress ?? null},
        lease_expires_at = now() + (INTERVAL '1 second' * ${lease})
    WHERE id = ${params.jobId}
    RETURNING lease_expires_at
  `);

  if (job.processor === QWEN_PROCESSOR) {
    await setThingStatus({
      thingId: job.thing_id,
      stage: params.stage ?? null,
      progress: params.progress ?? null,
    });
  }

  return { leaseExpiresAt: new Date(rows.rows[0].lease_expires_at).toISOString() };
}

export async function completeJob(params: {
  jobId: string;
  runnerId: string;
  buffer: Buffer;
  width: number | null;
  height: number | null;
  result: Record<string, unknown>;
}): Promise<{ thingId: number }> {
  const job = await requireLease(params.jobId, params.runnerId);

  await setThingProcessedImage({
    thingId: job.thing_id,
    userId: job.user_id,
    buffer: params.buffer,
    width: params.width,
    height: params.height,
  });

  await db
    .update(thingJobs)
    .set({
      state: 'completed',
      stage: null,
      progress: 100,
      error: null,
      traceback: null,
      result: params.result,
      finished_at: new Date(),
    })
    .where(eq(thingJobs.id, params.jobId));

  return { thingId: job.thing_id };
}

/**
 * Complete a description job. Deliberately separate from `completeJob`: it
 * never touches status/stage/progress or any file, only `myThings.metadata`,
 * and only when the worker's result actually looks like the expected shape —
 * an object-extraction failure is silently absent metadata, not a job error
 * (the worker already reports those failures via `fail`).
 */
export async function completeDescribeJob(params: {
  jobId: string;
  runnerId: string;
  result: Record<string, unknown>;
}): Promise<{ thingId: number }> {
  const job = await requireLease(params.jobId, params.runnerId);

  const mainObject = params.result.mainObject;
  if (mainObject !== null && typeof mainObject === 'object' && !Array.isArray(mainObject)) {
    await applyDescribeResult({
      thingId: job.thing_id,
      mainObject: mainObject as Record<string, unknown>,
    });
  }

  await db
    .update(thingJobs)
    .set({
      state: 'completed',
      stage: null,
      progress: 100,
      error: null,
      traceback: null,
      result: params.result,
      finished_at: new Date(),
    })
    .where(eq(thingJobs.id, params.jobId));

  return { thingId: job.thing_id };
}

export async function failJob(params: {
  jobId: string;
  runnerId: string;
  error: string;
  traceback?: string | null;
}): Promise<{ willRetry: boolean }> {
  const job = await requireLease(params.jobId, params.runnerId);
  const willRetry = job.attempts < job.max_attempts;

  if (willRetry) {
    // Back into the pool rather than terminal: a transient CUDA OOM or a
    // restarted worker should not cost the user their photo.
    await db
      .update(thingJobs)
      .set({
        state: 'queued',
        stage: null,
        progress: null,
        error: params.error,
        traceback: params.traceback ?? null,
        locked_by: null,
        locked_at: null,
        lease_expires_at: null,
      })
      .where(eq(thingJobs.id, params.jobId));

    if (job.processor === QWEN_PROCESSOR) {
      await setThingStatus({
        thingId: job.thing_id,
        status: 'processing',
        stage: 'retrying',
        progress: 0,
      });
    }
  } else {
    await db
      .update(thingJobs)
      .set({
        state: 'failed',
        error: params.error,
        traceback: params.traceback ?? null,
        finished_at: new Date(),
      })
      .where(eq(thingJobs.id, params.jobId));

    // A description job exhausting its retries is not a sprite failure — the
    // Thing keeps whatever status its sprite job already gave it.
    if (job.processor === QWEN_PROCESSOR) {
      await setThingStatus({
        thingId: job.thing_id,
        status: 'failed',
        stage: null,
        blockedReason: 'generation failed',
      });
    }
  }

  return { willRetry };
}

// ============================================
// Status
// ============================================

export interface ThingStatusView {
  id: number;
  name: string;
  status: string;
  stage: string | null;
  progress: number | null;
  blockedReason: string | null;
  hasProcessed: boolean;
  updatedAt: string;
  job: {
    id: string;
    state: string;
    attempts: number;
    maxAttempts: number;
    error: string | null;
  } | null;
}

/**
 * One row read plus, when something is actually waiting, a runner-freshness
 * check. "Queued" and "queued but nothing is listening" look identical to a
 * user otherwise, and the second one is the only case worth complaining about.
 */
export async function getThingStatus(params: {
  thingId: number;
  userId: number;
}): Promise<ThingStatusView | null> {
  const [thing] = await db
    .select()
    .from(myThings)
    .where(and(eq(myThings.id, params.thingId), eq(myThings.user_id, params.userId)));

  if (!thing) return null;

  // Filtered to the sprite processor: a describe job may be newer (e.g. a
  // manual rerun on an already-ready Thing), but the `job` field here is
  // consumed as sprite-generation progress, not a generic job log.
  const [job] = await db
    .select()
    .from(thingJobs)
    .where(and(eq(thingJobs.thing_id, thing.id), eq(thingJobs.processor, QWEN_PROCESSOR)))
    .orderBy(sql`created_at DESC`)
    .limit(1);

  let blockedReason = thing.blocked_reason;
  if (job && job.state === 'queued') {
    const online = await isProcessorOnline(job.processor);
    if (!online) {
      const seen = await lastSeenFor(job.processor);
      blockedReason = seen
        ? `waiting for GPU worker (last seen ${seen.toISOString()})`
        : 'waiting for GPU worker (never seen)';
    }
  }

  return {
    id: thing.id,
    name: thing.name,
    status: thing.status,
    stage: thing.stage,
    progress: thing.progress,
    blockedReason,
    hasProcessed: Boolean(thing.processed_path),
    updatedAt: thing.updated_at.toISOString(),
    job: job
      ? {
          id: job.id,
          state: job.state,
          attempts: job.attempts,
          maxAttempts: job.max_attempts,
          error: job.error,
        }
      : null,
  };
}
