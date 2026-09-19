// Bearer-authenticated multipart upload for My Documents.
//
// Mounted at POST /api/documents/upload on the MCP Express app (port 3002),
// *before* the generic CRUD REST router. Same JWT Bearer tokens as the rest
// of `/api`, same `saveUploadedFile` path as the terminal session uploader.
// Phone photos always land in a root My Documents folder named INCOMING;
// that folder row is created on first upload if it is missing.

import type { Request, RequestHandler, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import multer from 'multer';
import { ensureIncomingFolder, saveUploadedFile } from '../services/documentService.js';
import { PERMISSIONS, loadUserPermissions } from '../../core/services/access.js';
import { isAdminForUser } from '../../core/mcp/oauth/userFacts.js';
import { apiCallRateLimiter } from '../../core/utils/rateLimiter.js';
import { writeAuditRow } from '../../core/mcp/audit.js';
import type { McpCallUser } from '../../core/mcp/contextSynth.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function rateLimit(req: Request, res: Response, next: () => void): void {
  const key = req.auth?.clientId ?? req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  if (apiCallRateLimiter.check(`api:${key}`)) {
    next();
    return;
  }
  res.setHeader('Retry-After', '60');
  res.status(429).json({
    error: { code: 'rate_limited', message: 'Rate limit exceeded' },
  });
}

async function resolveUser(req: Request): Promise<McpCallUser> {
  const auth = req.auth!;
  const extra = auth.extra as { userId?: unknown; username?: unknown; jti?: unknown } | undefined;
  const userId = Number(extra?.userId ?? NaN);
  const username = String(extra?.username ?? '');
  const jtiRaw = extra?.jti;

  const [isAdmin, permissions] = await Promise.all([
    isAdminForUser(userId),
    loadUserPermissions(userId),
  ]);

  return {
    userId,
    username,
    isAdmin,
    permissions: permissions as Set<string>,
    clientId: auth.clientId,
    jti: typeof jtiRaw === 'string' ? jtiRaw : undefined,
  };
}

export function buildDocumentsUploadRouter(bearerAuth: RequestHandler): Router {
  const router = createRouter();

  router.post(
    '/upload',
    bearerAuth,
    rateLimit,
    (req: Request, res: Response, next: () => void) => {
      upload.single('file')(req, res, (err: unknown) => {
        if (err) {
          const message = err instanceof Error ? err.message : 'Upload failed';
          res.status(400).json({ error: { code: 'upload_failed', message } });
          return;
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      const startedAtMs = Date.now();
      let user: McpCallUser | undefined;

      try {
        user = await resolveUser(req);
        if (!Number.isFinite(user.userId) || user.userId <= 0) {
          res.status(401).json({ error: { code: 'unauthenticated', message: 'Invalid token' } });
          return;
        }

        if (!user.isAdmin && !user.permissions.has(PERMISSIONS.DOCUMENTS_WRITE)) {
          res.status(403).json({
            error: { code: 'permission_denied', message: 'Upload not permitted' },
          });
          void writeAuditRow({
            configId: 'documents',
            toolName: 'REST:documents.upload',
            op: 'create',
            user,
            input: { hasFile: Boolean(req.file) },
            result: {
              content: [],
              isError: true,
              structuredContent: { error: { code: 'permission_denied' } },
            },
            startedAtMs,
            source: 'api',
            ip_address: req.ip ?? null,
          });
          return;
        }

        const file = req.file;
        if (!file) {
          res.status(400).json({
            error: { code: 'validation_failed', message: 'No file uploaded' },
          });
          return;
        }

        const folderId = await ensureIncomingFolder(user.userId);

        const record = await saveUploadedFile({
          userId: user.userId,
          folderId,
          originalFilename: file.originalname,
          buffer: file.buffer,
        });

        res.status(201).json({
          ok: true,
          file: {
            id: record.id,
            name: record.name,
            fileType: record.fileType,
          },
        });

        void writeAuditRow({
          configId: 'documents',
          toolName: 'REST:documents.upload',
          op: 'create',
          user,
          input: { name: file.originalname, folderId, size: file.size },
          result: { content: [], isError: false },
          startedAtMs,
          source: 'api',
          ip_address: req.ip ?? null,
        });
      } catch (error) {
        const code = (error as { code?: string }).code === 'validation_failed'
          ? 'validation_failed'
          : 'upload_failed';
        const message = error instanceof Error ? error.message : 'Upload failed';
        res.status(400).json({ error: { code, message } });
        if (user) {
          void writeAuditRow({
            configId: 'documents',
            toolName: 'REST:documents.upload',
            op: 'create',
            user,
            input: {},
            result: {
              content: [],
              isError: true,
              structuredContent: { error: { code } },
            },
            startedAtMs,
            source: 'api',
            ip_address: req.ip ?? null,
          });
        }
      }
    },
  );

  return router;
}
