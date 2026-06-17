import type { IncomingMessage, ServerResponse } from 'http';
import multer from 'multer';
import { getSession } from '../../core/session/index.js';
import { hasPermission, PERMISSIONS } from '../../core/services/access.js';
import { saveUploadedFile } from '../services/documentService.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function isAllowedCorsOrigin(origin: string): boolean {
  if (IS_PRODUCTION) {
    return false;
  }
  try {
    const url = new URL(origin);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function corsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = req.headers.origin;
  if (!origin || !isAllowedCorsOrigin(origin)) {
    return {};
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
}

function readSessionId(req: IncomingMessage): string | null {
  const header = req.headers['x-as500-session'];
  if (typeof header === 'string' && header.trim()) return header.trim();

  const cookie = req.headers.cookie;
  if (!cookie) return null;
  const match = cookie.match(/(?:^|;\s*)as500_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function sendJson(req: IncomingMessage, res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders(req) });
  res.end(JSON.stringify(body));
}

export function handleDocumentsUpload(req: IncomingMessage, res: ServerResponse): void {
  const cors = corsHeaders(req);

  if (req.method === 'OPTIONS') {
    if (Object.keys(cors).length > 0) {
      res.writeHead(204, {
        ...cors,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'X-AS500-Session, Content-Type',
        'Access-Control-Max-Age': '86400',
      });
    } else {
      res.writeHead(204);
    }
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(req, res, 405, { error: { code: 'method_not_allowed', message: 'POST required' } });
    return;
  }

  const sessionId = readSessionId(req);
  if (!sessionId) {
    sendJson(req, res, 401, { error: { code: 'unauthenticated', message: 'Session required' } });
    return;
  }

  const session = getSession(sessionId);
  if (!session?.authenticated || session.viserId == null) {
    sendJson(req, res, 401, { error: { code: 'unauthenticated', message: 'Invalid session' } });
    return;
  }

  if (!hasPermission(session, PERMISSIONS.DOCUMENTS_WRITE)) {
    sendJson(req, res, 403, { error: { code: 'permission_denied', message: 'Upload not permitted' } });
    return;
  }

  upload.single('file')(req as never, res as never, async (err) => {
    if (err) {
      sendJson(req, res, 400, { error: { code: 'upload_failed', message: err.message } });
      return;
    }

    const file = (req as IncomingMessage & { file?: { originalname: string; buffer: Buffer } }).file;
    if (!file) {
      sendJson(req, res, 400, { error: { code: 'validation_failed', message: 'No file uploaded' } });
      return;
    }

    const input = (session.context.crud_documents_input ?? {}) as Record<string, unknown>;
    const folderId = (input.folderId as number | null | undefined) ?? null;

    try {
      const record = await saveUploadedFile({
        userId: session.viserId!,
        folderId,
        originalFilename: file.originalname,
        buffer: file.buffer,
      });

      sendJson(req, res, 201, {
        ok: true,
        file: {
          id: record.id,
          name: record.name,
          fileType: record.fileType,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      sendJson(req, res, 400, { error: { code: 'upload_failed', message } });
    }
  });
}
