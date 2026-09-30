// HTTP surface for My Things, mounted at /api/things on the MCP Express app
// (port 3002), before the generic CRUD REST router.
//
// Two audiences share this router:
//   - the phone and other clients: upload, status, image bytes
//   - the as500-images GPU worker: the /jobs/* lease protocol
//
// The CRUDTable config is registered as `my_things`, so the generated REST
// routes live at /api/my_things and cannot collide with anything here.

import type { Request, RequestHandler, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import multer from 'multer';
import { PERMISSIONS } from '../../../core/services/access.js';
import { apiCallRateLimiter } from '../../../core/utils/rateLimiter.js';
import { writeAuditRow } from '../../../core/mcp/audit.js';
import type { McpCallUser } from '../../../core/mcp/contextSynth.js';
import { createThingFromUpload, getThingRow, listActiveThings } from '../../services/thingService.js';
import { getFolderCoverRow } from '../../services/folderCoverService.js';
import {
  LeaseError,
  claimJob,
  completeDescribeJob,
  completeJob,
  enqueueDescribeJob,
  enqueueQwenJob,
  failJob,
  getJobById,
  getThingStatus,
  heartbeatJob,
  touchRunner,
} from '../jobQueue.js';
import { authorize, deny, parseId, routeParam } from './apiHelpers.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const MAX_WAIT_SECONDS = 30;
const POLL_INTERVAL_MS = 400;

function rateLimit(req: Request, res: Response, next: () => void): void {
  const key = req.auth?.clientId ?? req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  if (apiCallRateLimiter.check(`api:${key}`)) {
    next();
    return;
  }
  res.setHeader('Retry-After', '60');
  res.status(429).json({ error: { code: 'rate_limited', message: 'Rate limit exceeded' } });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function buildThingsRouter(bearerAuth: RequestHandler): Router {
  const router = createRouter();

  // Folder box-art cover — deterministic composite, no GPU worker involved.
  // See folderCoverService.ts.
  router.get('/folders/:id/cover', bearerAuth, async (req: Request, res: Response) => {
    try {
      const user = await authorize(req, res, PERMISSIONS.THINGS_READ);
      if (!user) return;

      const id = parseId(req.params.id);
      if (id === null) {
        deny(res, 400, 'validation_failed', 'Invalid id');
        return;
      }

      const folder = await getFolderCoverRow(id);
      if (!folder || folder.user_id !== user.userId) {
        deny(res, 404, 'not_found', 'Folder not found');
        return;
      }
      if (!folder.cover_path) {
        deny(res, 404, 'not_found', 'No cover generated yet');
        return;
      }

      const info = await stat(folder.cover_path).catch(() => null);
      if (!info) {
        deny(res, 404, 'not_found', 'Cover image missing on disk');
        return;
      }

      res.setHeader('Content-Type', folder.cover_mime ?? 'image/png');
      res.setHeader('Content-Length', String(info.size));
      res.setHeader('Cache-Control', 'private, max-age=60');
      createReadStream(folder.cover_path).pipe(res);
    } catch (error) {
      deny(res, 500, 'internal', error instanceof Error ? error.message : 'Cover fetch failed');
    }
  });

  // ==========================================
  // Worker lease protocol
  // ==========================================
  //
  // Registered before the /:id routes. These are the only endpoints the GPU
  // worker uses; it never touches the database and never receives inbound
  // connections, so it works over a VPN, a hotspot, or behind NAT.

  router.post('/jobs/claim', bearerAuth, rateLimit, async (req: Request, res: Response) => {
    try {
      const user = await authorize(req, res, PERMISSIONS.THING_JOB_RUN);
      if (!user) return;

      const body = req.body as {
        runnerId?: unknown;
        capabilities?: unknown;
        leaseSeconds?: unknown;
        version?: unknown;
      };
      const runnerId = typeof body.runnerId === 'string' ? body.runnerId.trim() : '';
      const capabilities = Array.isArray(body.capabilities)
        ? body.capabilities.filter((c): c is string => typeof c === 'string')
        : [];

      if (!runnerId || capabilities.length === 0) {
        deny(res, 400, 'validation_failed', 'runnerId and a non-empty capabilities array are required');
        return;
      }

      // An idle poll is itself the heartbeat — this is how the phone can tell
      // "queued, worker is alive" from "queued, nothing is listening".
      await touchRunner({
        runnerId,
        capabilities,
        version: typeof body.version === 'string' ? body.version : null,
      });

      const job = await claimJob({
        runnerId,
        capabilities,
        leaseSeconds: typeof body.leaseSeconds === 'number' ? body.leaseSeconds : undefined,
      });

      if (!job) {
        res.status(204).end();
        return;
      }

      res.json({ job });
    } catch (error) {
      deny(res, 500, 'internal', error instanceof Error ? error.message : 'Claim failed');
    }
  });

  router.get('/jobs/:jobId/input', bearerAuth, async (req: Request, res: Response) => {
    try {
      const user = await authorize(req, res, PERMISSIONS.THING_JOB_RUN);
      if (!user) return;

      const runnerId = String(req.query.runnerId ?? '');
      if (!runnerId) {
        deny(res, 400, 'validation_failed', 'runnerId query param is required');
        return;
      }

      // Authorised by the held lease, not by the file's owner: the worker is a
      // service account and never impersonates the user whose photo it reads.
      const jobId = routeParam(req.params.jobId);
      await heartbeatJob({
        jobId,
        runnerId,
        stage: 'downloading',
        progress: 8,
      });

      const job = await getJobById(jobId);
      if (!job) {
        deny(res, 404, 'not_found', 'Job not found');
        return;
      }

      const thing = await getThingRow({ id: job.thing_id, userId: job.user_id });
      if (!thing?.source_path) {
        deny(res, 404, 'not_found', 'Thing has no source image');
        return;
      }

      const info = await stat(thing.source_path).catch(() => null);
      if (!info) {
        deny(res, 404, 'not_found', 'Source image missing on disk');
        return;
      }

      res.setHeader('Content-Type', thing.source_mime ?? 'application/octet-stream');
      res.setHeader('Content-Length', String(info.size));
      createReadStream(thing.source_path).pipe(res);
    } catch (error) {
      if (error instanceof LeaseError) {
        deny(res, 409, 'lease_lost', error.message);
        return;
      }
      deny(res, 500, 'internal', error instanceof Error ? error.message : 'Input fetch failed');
    }
  });

  router.post('/jobs/:jobId/heartbeat', bearerAuth, async (req: Request, res: Response) => {
    try {
      const user = await authorize(req, res, PERMISSIONS.THING_JOB_RUN);
      if (!user) return;

      const body = req.body as {
        runnerId?: unknown;
        stage?: unknown;
        progress?: unknown;
        leaseSeconds?: unknown;
      };
      const runnerId = typeof body.runnerId === 'string' ? body.runnerId : '';
      if (!runnerId) {
        deny(res, 400, 'validation_failed', 'runnerId is required');
        return;
      }

      const result = await heartbeatJob({
        jobId: routeParam(req.params.jobId),
        runnerId,
        stage: typeof body.stage === 'string' ? body.stage : null,
        progress: typeof body.progress === 'number' ? body.progress : null,
        leaseSeconds: typeof body.leaseSeconds === 'number' ? body.leaseSeconds : undefined,
      });

      res.json(result);
    } catch (error) {
      if (error instanceof LeaseError) {
        deny(res, 409, 'lease_lost', error.message);
        return;
      }
      deny(res, 500, 'internal', error instanceof Error ? error.message : 'Heartbeat failed');
    }
  });

  router.post(
    '/jobs/:jobId/complete',
    bearerAuth,
    (req: Request, res: Response, next: () => void) => {
      upload.single('file')(req, res, (err: unknown) => {
        if (err) {
          const message = err instanceof Error ? err.message : 'Upload failed';
          deny(res, 400, 'upload_failed', message);
          return;
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      const startedAtMs = Date.now();
      let user: McpCallUser | undefined;
      try {
        const resolved = await authorize(req, res, PERMISSIONS.THING_JOB_RUN);
        if (!resolved) return;
        user = resolved;

        const runnerId = String(req.body?.runnerId ?? '');
        if (!runnerId) {
          deny(res, 400, 'validation_failed', 'runnerId is required');
          return;
        }
        if (!req.file) {
          deny(res, 400, 'validation_failed', 'No image uploaded');
          return;
        }

        let parsed: Record<string, unknown> = {};
        if (typeof req.body?.result === 'string' && req.body.result.trim() !== '') {
          try {
            parsed = JSON.parse(req.body.result) as Record<string, unknown>;
          } catch {
            deny(res, 400, 'validation_failed', 'result must be valid JSON');
            return;
          }
        }

        const width = typeof parsed.width === 'number' ? parsed.width : null;
        const height = typeof parsed.height === 'number' ? parsed.height : null;

        const { thingId } = await completeJob({
          jobId: routeParam(req.params.jobId),
          runnerId,
          buffer: req.file.buffer,
          width,
          height,
          result: parsed,
        });

        res.json({ ok: true, thingId });

        void writeAuditRow({
          configId: 'my_things',
          toolName: 'REST:my_things.generate',
          op: 'update',
          user,
          input: { jobId: req.params.jobId, runnerId, bytes: req.file.size },
          result: { content: [], isError: false },
          startedAtMs,
          source: 'api',
          ip_address: req.ip ?? null,
        });
      } catch (error) {
        if (error instanceof LeaseError) {
          deny(res, 409, 'lease_lost', error.message);
          return;
        }
        deny(res, 500, 'internal', error instanceof Error ? error.message : 'Complete failed');
      }
    },
  );

  // JSON-only, unlike /complete: a description job never produces an image,
  // so there is nothing for multer to parse and no reason to require it.
  router.post('/jobs/:jobId/complete-describe', bearerAuth, async (req: Request, res: Response) => {
    try {
      const user = await authorize(req, res, PERMISSIONS.THING_JOB_RUN);
      if (!user) return;

      const body = req.body as { runnerId?: unknown; result?: unknown };
      const runnerId = typeof body.runnerId === 'string' ? body.runnerId : '';
      if (!runnerId) {
        deny(res, 400, 'validation_failed', 'runnerId is required');
        return;
      }

      const result =
        body.result !== null && typeof body.result === 'object' && !Array.isArray(body.result)
          ? (body.result as Record<string, unknown>)
          : {};

      const { thingId } = await completeDescribeJob({
        jobId: routeParam(req.params.jobId),
        runnerId,
        result,
      });

      res.json({ ok: true, thingId });
    } catch (error) {
      if (error instanceof LeaseError) {
        deny(res, 409, 'lease_lost', error.message);
        return;
      }
      deny(res, 500, 'internal', error instanceof Error ? error.message : 'Complete failed');
    }
  });

  router.post('/jobs/:jobId/fail', bearerAuth, async (req: Request, res: Response) => {
    try {
      const user = await authorize(req, res, PERMISSIONS.THING_JOB_RUN);
      if (!user) return;

      const body = req.body as {
        runnerId?: unknown;
        error?: unknown;
        traceback?: unknown;
      };
      const runnerId = typeof body.runnerId === 'string' ? body.runnerId : '';
      if (!runnerId) {
        deny(res, 400, 'validation_failed', 'runnerId is required');
        return;
      }

      const result = await failJob({
        jobId: routeParam(req.params.jobId),
        runnerId,
        error: typeof body.error === 'string' ? body.error : 'Unknown worker error',
        traceback: typeof body.traceback === 'string' ? body.traceback : null,
      });

      res.json(result);
    } catch (error) {
      if (error instanceof LeaseError) {
        deny(res, 409, 'lease_lost', error.message);
        return;
      }
      deny(res, 500, 'internal', error instanceof Error ? error.message : 'Fail report failed');
    }
  });

  // ==========================================
  // Client surface
  // ==========================================

  router.post(
    '/upload',
    bearerAuth,
    rateLimit,
    (req: Request, res: Response, next: () => void) => {
      upload.single('file')(req, res, (err: unknown) => {
        if (err) {
          const message = err instanceof Error ? err.message : 'Upload failed';
          deny(res, 400, 'upload_failed', message);
          return;
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      const startedAtMs = Date.now();
      let user: McpCallUser | undefined;

      try {
        const resolved = await authorize(req, res, PERMISSIONS.THINGS_WRITE);
        if (!resolved) return;
        user = resolved;

        if (!req.file) {
          deny(res, 400, 'validation_failed', 'No file uploaded');
          return;
        }

        const body = req.body as Record<string, unknown>;
        const description = typeof body.description === 'string' ? body.description.trim() : '';
        // The photo's filename is not the Thing's name. Blank means "unnamed":
        // it is stored as a placeholder and filled in from the description job.
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const category = typeof body.category === 'string' && body.category.trim() !== ''
          ? body.category.trim()
          : null;
        // Multipart fields arrive as strings; '' (root, explicitly chosen) and
        // "not sent" (root, field omitted) both mean no folder.
        const folderIdRaw = typeof body.folderId === 'string' ? body.folderId.trim() : '';
        const folderId = folderIdRaw === '' ? null : Number(folderIdRaw);
        if (folderIdRaw !== '' && !Number.isInteger(folderId)) {
          deny(res, 400, 'validation_failed', 'folderId must be an integer');
          return;
        }

        const thing = await createThingFromUpload({
          userId: user.userId,
          name,
          description: description === '' ? null : description,
          category,
          folderId,
          originalFilename: req.file.originalname,
          buffer: req.file.buffer,
        });

        await enqueueQwenJob({ thingId: thing.id, userId: user.userId });
        await enqueueDescribeJob({ thingId: thing.id, userId: user.userId });

        res.status(201).json({
          ok: true,
          thingId: thing.id,
          name: thing.name,
          status: 'processing',
        });

        void writeAuditRow({
          configId: 'my_things',
          toolName: 'REST:my_things.upload',
          op: 'create',
          user,
          input: { hasName: name !== '', hasDescription: description !== '', size: req.file.size },
          result: { content: [], isError: false },
          startedAtMs,
          source: 'api',
          ip_address: req.ip ?? null,
        });
      } catch (error) {
        const code = (error as { code?: string }).code === 'validation_failed'
          ? 'validation_failed'
          : 'upload_failed';
        deny(res, 400, code, error instanceof Error ? error.message : 'Upload failed');
      }
    },
  );

  router.get('/', bearerAuth, async (req: Request, res: Response) => {
    try {
      const user = await authorize(req, res, PERMISSIONS.THINGS_READ);
      if (!user) return;

      const status = typeof req.query.status === 'string' ? req.query.status : '';
      if (status !== 'active') {
        deny(res, 400, 'validation_failed', 'Pass ?status=active to list unfinished things');
        return;
      }

      const rows = await listActiveThings(user.userId);
      res.json({ records: rows });
    } catch (error) {
      deny(res, 500, 'internal', error instanceof Error ? error.message : 'List failed');
    }
  });

  router.get('/:id/status', bearerAuth, async (req: Request, res: Response) => {
    try {
      const user = await authorize(req, res, PERMISSIONS.THINGS_READ);
      if (!user) return;

      const id = parseId(req.params.id);
      if (id === null) {
        deny(res, 400, 'validation_failed', 'Invalid id');
        return;
      }

      const first = await getThingStatus({ thingId: id, userId: user.userId });
      if (!first) {
        deny(res, 404, 'not_found', 'Thing not found');
        return;
      }

      const waitSeconds = Math.min(Number(req.query.wait ?? 0) || 0, MAX_WAIT_SECONDS);
      if (waitSeconds <= 0 || isTerminal(first.status)) {
        res.json(first);
        return;
      }

      // Long poll by re-reading rather than subscribing to a change feed: the
      // read is a single indexed row, and one connection per client per
      // ~25 seconds is far cheaper than the 2s poll it replaces. The endpoint
      // contract would be identical if this were ever swapped for a feed.
      const deadline = Date.now() + waitSeconds * 1000;
      const signature = statusSignature(first);
      let aborted = false;
      req.on('close', () => {
        aborted = true;
      });

      while (Date.now() < deadline && !aborted) {
        await sleep(POLL_INTERVAL_MS);
        const next = await getThingStatus({ thingId: id, userId: user.userId });
        if (!next) break;
        if (statusSignature(next) !== signature) {
          if (!aborted) res.json(next);
          return;
        }
      }

      if (!aborted) {
        const latest = await getThingStatus({ thingId: id, userId: user.userId });
        res.json(latest ?? first);
      }
    } catch (error) {
      deny(res, 500, 'internal', error instanceof Error ? error.message : 'Status failed');
    }
  });

  router.get('/:id/image/:which', bearerAuth, async (req: Request, res: Response) => {
    try {
      const user = await authorize(req, res, PERMISSIONS.THINGS_READ);
      if (!user) return;

      const id = parseId(req.params.id);
      if (id === null) {
        deny(res, 400, 'validation_failed', 'Invalid id');
        return;
      }

      const which = routeParam(req.params.which);
      if (which !== 'source' && which !== 'processed') {
        deny(res, 404, 'not_found', 'Unknown image');
        return;
      }

      const thing = await getThingRow({ id, userId: user.userId });
      if (!thing) {
        deny(res, 404, 'not_found', 'Thing not found');
        return;
      }

      const path = which === 'source' ? thing.source_path : thing.processed_path;
      const mime = which === 'source' ? thing.source_mime : thing.processed_mime;
      if (!path) {
        deny(res, 404, 'not_found', `No ${which} image yet`);
        return;
      }

      const info = await stat(path).catch(() => null);
      if (!info) {
        deny(res, 404, 'not_found', 'Image missing on disk');
        return;
      }

      res.setHeader('Content-Type', mime ?? 'application/octet-stream');
      res.setHeader('Content-Length', String(info.size));
      res.setHeader('Cache-Control', 'private, max-age=60');
      createReadStream(path).pipe(res);
    } catch (error) {
      deny(res, 500, 'internal', error instanceof Error ? error.message : 'Image fetch failed');
    }
  });

  router.post('/:id/regenerate', bearerAuth, rateLimit, async (req: Request, res: Response) => {
    try {
      const user = await authorize(req, res, PERMISSIONS.THINGS_WRITE);
      if (!user) return;

      const id = parseId(req.params.id);
      if (id === null) {
        deny(res, 400, 'validation_failed', 'Invalid id');
        return;
      }

      const thing = await getThingRow({ id, userId: user.userId });
      if (!thing) {
        deny(res, 404, 'not_found', 'Thing not found');
        return;
      }
      if (!thing.source_path) {
        deny(res, 400, 'validation_failed', 'Thing has no source image to regenerate from');
        return;
      }

      const seedRaw = (req.body as { seed?: unknown } | undefined)?.seed;
      const jobId = await enqueueQwenJob({
        thingId: id,
        userId: user.userId,
        seed: typeof seedRaw === 'number' ? seedRaw : undefined,
      });

      res.status(202).json({ ok: true, thingId: id, jobId });
    } catch (error) {
      deny(res, 500, 'internal', error instanceof Error ? error.message : 'Regenerate failed');
    }
  });

  // Independent of /regenerate: reruns just the object-info extraction, e.g.
  // once a newer vision model is in place, without touching the sprite.
  router.post('/:id/describe', bearerAuth, rateLimit, async (req: Request, res: Response) => {
    try {
      const user = await authorize(req, res, PERMISSIONS.THINGS_WRITE);
      if (!user) return;

      const id = parseId(req.params.id);
      if (id === null) {
        deny(res, 400, 'validation_failed', 'Invalid id');
        return;
      }

      const thing = await getThingRow({ id, userId: user.userId });
      if (!thing) {
        deny(res, 404, 'not_found', 'Thing not found');
        return;
      }
      if (!thing.source_path) {
        deny(res, 400, 'validation_failed', 'Thing has no source image to describe');
        return;
      }

      const jobId = await enqueueDescribeJob({ thingId: id, userId: user.userId });

      res.status(202).json({ ok: true, thingId: id, jobId });
    } catch (error) {
      deny(res, 500, 'internal', error instanceof Error ? error.message : 'Describe failed');
    }
  });

  return router;
}

function isTerminal(status: string): boolean {
  return status === 'ready' || status === 'failed';
}

function statusSignature(view: { status: string; stage: string | null; progress: number | null }): string {
  return `${view.status}|${view.stage ?? ''}|${view.progress ?? ''}`;
}
