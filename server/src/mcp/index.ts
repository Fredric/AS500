// Express app factory for the remote MCP server.
//
// Endpoints mounted:
//
//   GET  /.well-known/oauth-authorization-server      (via mcpAuthRouter)
//   GET  /.well-known/oauth-protected-resource[/mcp]  (via mcpAuthRouter)
//   POST /register                                    (via mcpAuthRouter)
//   GET  /authorize                                   (via mcpAuthRouter,
//                                                      our provider renders
//                                                      the consent HTML)
//   POST /authorize/consent                           (this file — approves
//                                                      or denies the request)
//   POST /token                                       (via mcpAuthRouter)
//   POST /revoke                                      (via mcpAuthRouter)
//   POST /mcp                                         (authenticated — the
//                                                      MCP Streamable HTTP
//                                                      transport)
//   GET  /mcp/health                                  (no auth — liveness)
//
// Auth posture:
//   `/mcp` is now protected by `requireBearerAuth`. Unauthenticated calls
//   receive a 401 with a `WWW-Authenticate: Bearer resource_metadata="..."`
//   header per RFC 9728, pointing MCP clients at the protected-resource
//   metadata doc so they can discover how to authenticate.

import express, { type Express, type Request, type Response } from 'express';
import type { Server as HttpServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { buildMcpServer } from './transport.js';
import { buildAs500OAuthProvider, issueAuthorizationCodeAfterConsent } from './oauth/provider.js';
import { initJwtSecret } from './oauth/tokens.js';
import { hasLiveConsent, recordConsent } from './oauth/store.js';
import { mcpLogin } from './oauth/login.js';
import { loadUserPermissions } from '../services/access.js';
import { mcpCallRateLimiter } from '../utils/rateLimiter.js';
import type { McpCallUser } from './contextSynth.js';

export const DEFAULT_MCP_PORT = 3002;

// ============================================
// App factory
// ============================================

export interface McpAppOptions {
  /** Dev-mode error detail. Never enable in prod. */
  debug?: boolean;
  /**
   * Base URL of the MCP server as seen by external clients. Used as the
   * OAuth `issuer` and for the `resource_metadata` URL in 401 responses.
   * Defaults to `http://localhost:<MCP_PORT>` for dev.
   */
  issuerUrl?: URL;
  /**
   * Advertised permission keys on the consent page. Purely informational —
   * the real RBAC check runs per-call in `toolHandlers.ts`.
   */
  advertisedPermissions?: string[];
}

export function buildMcpApp(opts: McpAppOptions = {}): Express {
  const app = express();
  const issuerUrl =
    opts.issuerUrl ??
    new URL(`http://localhost:${process.env.MCP_PORT ?? DEFAULT_MCP_PORT}`);
  const resourceUrl = new URL('/mcp', issuerUrl);

  // JSON for `/mcp`, urlencoded for `/authorize/consent` (HTML forms).
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  // -------- OAuth provider + router --------
  const provider = buildAs500OAuthProvider({
    advertisedPermissions: opts.advertisedPermissions ?? [],
  });

  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl,
      resourceServerUrl: resourceUrl,
      resourceName: 'AS500 MCP Server',
      scopesSupported: [],
    })
  );

  // -------- POST /authorize/consent (custom — owned by this file) --------
  //
  // The provider's `authorize()` method renders an HTML form that POSTs here.
  // We authenticate the user, check the consent decision, issue the auth
  // code (if approved), and redirect back to the client's redirect_uri.
  app.post('/authorize/consent', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const clientId = body.client_id;
    const redirectUri = body.redirect_uri;
    const state = body.state ?? '';
    const scope = body.scope ?? '';
    const codeChallenge = body.code_challenge;
    const codeChallengeMethod = body.code_challenge_method;
    const decision = body.decision;
    const username = body.username ?? '';
    const password = body.password ?? '';
    const remember = body.remember === '1';

    // Minimum validation before we trust anything.
    if (!clientId || !redirectUri || !codeChallenge || !codeChallengeMethod) {
      res.status(400).send('Missing required consent-form parameters.');
      return;
    }

    const client = await provider.clientsStore.getClient(clientId);
    if (!client) {
      res.status(400).send('Unknown client.');
      return;
    }

    // The redirect_uri we send the user back to must be one the client
    // registered — never trust the form-posted value on its own.
    if (!client.redirect_uris.includes(redirectUri)) {
      res.status(400).send('Unregistered redirect_uri.');
      return;
    }

    if (decision === 'deny') {
      return redirectWithParams(res, redirectUri, {
        error: 'access_denied',
        error_description: 'User denied the authorization request.',
        state,
      });
    }

    // Approve path — authenticate the user.
    const loginResult = await mcpLogin(username, password);
    if (!loginResult.ok) {
      // Re-render the consent page with an error banner. Importing here
      // avoids a circular dep at module-load time.
      const { renderConsentPage } = await import('./oauth/consent.js');
      const errMsg =
        loginResult.reason === 'rate_limited'
          ? 'Too many login attempts. Please wait a minute and try again.'
          : loginResult.reason === 'inactive'
            ? 'Account is inactive.'
            : 'Invalid username or password.';
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(401).send(
        renderConsentPage({
          clientName: client.client_name ?? client.client_id,
          clientId: client.client_id,
          scope,
          state,
          redirectUri,
          responseType: 'code',
          codeChallenge,
          codeChallengeMethod,
          permissions: opts.advertisedPermissions ?? [],
          formAction: '/authorize/consent',
          errorMessage: errMsg,
          usernameAttempt: username,
        })
      );
      return;
    }

    const user = loginResult.user;

    // Record the consent if the user opted into remember-me. Don't block
    // authorization if the DB write fails — consent persistence is a nice
    // UX, not a security control.
    if (remember) {
      try {
        const already = await hasLiveConsent(user.id, clientId, scope);
        if (!already) {
          await recordConsent(user.id, clientId, scope);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[MCP] Failed to persist consent:', err);
      }
    }

    // Mint the authorization code and redirect back to the client.
    try {
      const code = await issueAuthorizationCodeAfterConsent({
        userId: user.id,
        clientId,
        scope,
        codeChallenge,
        codeChallengeMethod,
        redirectUri,
      });
      return redirectWithParams(res, redirectUri, { code, state });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[MCP] Failed to issue auth code:', err);
      return redirectWithParams(res, redirectUri, {
        error: 'server_error',
        error_description: 'Failed to issue authorization code.',
        state,
      });
    }
  });

  // -------- /mcp health (no auth) --------
  app.get('/mcp/health', (_req: Request, res: Response) => {
    res.json({ ok: true, auth: 'oauth2.1', phase: 3 });
  });

  // -------- /mcp protected endpoint --------
  const bearerAuth = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceUrl),
  });

  // Per-token rate limiter. Runs *after* bearer auth so we can key by
  // `req.auth.clientId`. If something slips through without auth, fall back
  // to the socket address — pathological, but safer than using a static key.
  const rateLimit = (req: Request, res: Response, next: () => void): void => {
    const key =
      req.auth?.clientId ?? req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    if (mcpCallRateLimiter.check(`mcp:${key}`)) {
      next();
      return;
    }
    // MCP clients expect JSON-RPC envelopes on `/mcp`, so shape the error
    // that way. Still emit a 429 so naive HTTP clients get a useful status.
    res.setHeader('Retry-After', '60');
    res.status(429).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Rate limit exceeded',
        data: { code: 'rate_limited', retryAfterSeconds: 60 },
      },
      id: null,
    });
  };

  const handleMcp = async (req: Request, res: Response): Promise<void> => {
    const auth = req.auth;
    if (!auth) {
      // Should be unreachable — `requireBearerAuth` rejects earlier — but
      // guard defensively so we don't silently fall through to ANONYMOUS_USER.
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    // Resolve the caller's effective permission set. Cached inside the
    // JWT lifetime would be nicer, but permissions change rarely and the
    // query is three cheap indexed selects.
    const userId = Number((auth.extra as { userId?: unknown } | undefined)?.userId ?? NaN);
    const username =
      String((auth.extra as { username?: unknown } | undefined)?.username ?? '');
    const jti = (auth.extra as { jti?: unknown } | undefined)?.jti;

    let user: McpCallUser;
    try {
      // We don't know isAdmin from the JWT — fetch it from users table.
      // This keeps admin status fresh even if it changes after token issue.
      const { isAdminForUser } = await import('./oauth/userFacts.js');
      const isAdmin = await isAdminForUser(userId);
      const permissions = await loadUserPermissions(userId, isAdmin);
      user = {
        userId,
        username,
        isAdmin,
        permissions: permissions as Set<string>,
        clientId: auth.clientId,
        jti: typeof jti === 'string' ? jti : undefined,
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[MCP] Failed to resolve user permissions:', err);
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Failed to resolve caller identity.' },
        id: null,
      });
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const { server } = buildMcpServer({ debug: opts.debug, user });

    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal error',
            ...(opts.debug && err instanceof Error ? { data: err.message } : {}),
          },
          id: null,
        });
      }
    }
  };

  app.post('/mcp', bearerAuth, rateLimit, handleMcp);

  const methodNotAllowed = (_req: Request, res: Response): void => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  };
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);

  return app;
}

// ============================================
// Start
// ============================================

export interface StartMcpServerOptions extends McpAppOptions {
  port?: number;
  host?: string;
}

export function startMcpServer(opts: StartMcpServerOptions = {}): HttpServer {
  initJwtSecret();

  const port = opts.port ?? DEFAULT_MCP_PORT;
  const host = opts.host ?? '0.0.0.0';
  const app = buildMcpApp(opts);

  const { toolCount, configCount } = buildMcpServer({ debug: opts.debug });

  const httpServer = app.listen(port, host, () => {
    console.log(
      `AS500 MCP server running on http://${host}:${port}/mcp ` +
        `— ${toolCount} tool(s) across ${configCount} config(s). ` +
        `OAuth 2.1 + DCR enabled.`
    );
  });

  return httpServer;
}

// ============================================
// Helpers
// ============================================

function redirectWithParams(
  res: Response,
  redirectUri: string,
  params: Record<string, string>
): void {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue;
    url.searchParams.set(k, v);
  }
  res.redirect(302, url.href);
}
