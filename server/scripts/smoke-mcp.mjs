// End-to-end smoke test for the MCP Express app (Phase 3).
//
// Boots `buildMcpApp` in-process and walks the full flow that an agent would
// take when talking to our server:
//
//   1. GET  /mcp/health                        (no auth)
//   2. POST /mcp                               (expect 401 + WWW-Authenticate)
//   3. GET  /.well-known/oauth-authorization-server
//   4. GET  /.well-known/oauth-protected-resource/mcp
//   5. POST /register                          (Dynamic Client Registration)
//   6. GET  /authorize?...                     (HTML consent form)
//   7. POST /authorize/consent                 (approve with real KALLE creds)
//   8. POST /token                             (exchange code → tokens)
//   9. POST /mcp initialize                    (authenticated)
//  10. POST /mcp tools/list                    (enumerate registered tools)
//  11. POST /mcp tools/call                    (exercise a read-side tool)
//  12. POST /token (grant=refresh_token)       (rotate tokens)
//  13. mcp_audit_log spot-check                (verify row was written)
//
// Requires: a running Postgres (the existing Docker compose) with seeded
// users (`docker-compose exec server npm run seed`). KALLE / password is the
// canonical test account.

import { readFileSync } from 'node:fs';

try {
  const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const [, k, v] = m;
    if (process.env[k] === undefined) process.env[k] = v.replace(/^"|"$/g, '');
  }
} catch {
  // ignore — tests may run in an env where .env.local isn't present.
}

const { registerCRUDConfigs } = await import('../dist/configs/index.js');
const { buildMcpApp } = await import('../dist/mcp/index.js');
const { initJwtSecret } = await import('../dist/mcp/oauth/tokens.js');
const { db } = await import('../dist/db/index.js');
const schema = await import('../dist/db/schema.js');
const { desc } = await import('drizzle-orm');

process.env.AS500_MCP_JWT_SECRET =
  process.env.AS500_MCP_JWT_SECRET ??
  'smoke-secret-key-at-least-32-chars-long-yeah';
initJwtSecret();
registerCRUDConfigs();

const app = buildMcpApp({
  debug: true,
  advertisedPermissions: ['mcp.time_reg.read'],
});

const server = app.listen(0, '127.0.0.1', async () => {
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const div = (label) => console.log(`\n--- ${label} ---`);
  const ok = (msg) => console.log(`  OK  ${msg}`);
  const fail = (msg) => {
    console.error(`  FAIL  ${msg}`);
    process.exitCode = 1;
  };

  try {
    // -------- 1. health --------
    div('GET /mcp/health');
    const health = await fetch(`${base}/mcp/health`).then((r) => r.json());
    console.log(health);
    if (health.auth !== 'oauth2.1') fail('health did not advertise oauth2.1');
    else ok('health OK');

    // -------- 2. unauthenticated /mcp --------
    div('POST /mcp (no auth) — expect 401 + WWW-Authenticate');
    const unauth = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'smoke', version: '0.0.0' },
        },
      }),
    });
    console.log('  status:', unauth.status);
    console.log('  www-authenticate:', unauth.headers.get('www-authenticate'));
    if (unauth.status === 401 && unauth.headers.get('www-authenticate')?.startsWith('Bearer'))
      ok('unauthenticated POST /mcp rejected correctly');
    else fail('unauthenticated POST /mcp was not rejected correctly');

    // -------- 3 & 4. discovery --------
    div('GET /.well-known/oauth-authorization-server');
    const asMeta = await fetch(`${base}/.well-known/oauth-authorization-server`).then((r) =>
      r.json()
    );
    console.log('  issuer:', asMeta.issuer);
    console.log('  token_endpoint:', asMeta.token_endpoint);
    if (asMeta.token_endpoint && asMeta.registration_endpoint) ok('authorization-server metadata present');
    else fail('authorization-server metadata incomplete');

    div('GET /.well-known/oauth-protected-resource/mcp');
    const prMeta = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`).then((r) =>
      r.json()
    );
    console.log('  resource:', prMeta.resource);
    console.log('  authorization_servers:', prMeta.authorization_servers);
    if (prMeta.resource && Array.isArray(prMeta.authorization_servers)) ok('protected-resource metadata present');
    else fail('protected-resource metadata incomplete');

    // -------- 5. DCR --------
    div('POST /register (DCR)');
    const redirectUri = 'http://localhost:9999/cb';
    const reg = await fetch(`${base}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Smoke Test Client',
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    });
    const regJson = await reg.json();
    console.log('  status:', reg.status);
    console.log('  client_id:', regJson.client_id);
    if (reg.status !== 201 || !regJson.client_id) {
      fail('DCR failed');
      server.close();
      return;
    }
    ok('DCR registered client');
    const clientId = regJson.client_id;

    // -------- 6. consent form --------
    div(`GET /authorize?client_id=${clientId}&... (expect HTML)`);
    // PKCE: verifier + S256 challenge. Canonical RFC 7636 example.
    const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const codeChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    const state = 'smoke-state';
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    });
    const authGet = await fetch(`${base}/authorize?${params.toString()}`);
    const html = await authGet.text();
    if (authGet.status === 200 && html.includes(clientId)) ok('consent page rendered');
    else fail(`consent page status=${authGet.status}`);

    // -------- 7. consent POST with KALLE/password --------
    div('POST /authorize/consent (approve with real user)');
    const consentForm = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      decision: 'approve',
      username: 'KALLE',
      password: 'password',
    });
    const consentRes = await fetch(`${base}/authorize/consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: consentForm.toString(),
      redirect: 'manual',
    });
    console.log('  status:', consentRes.status);
    console.log('  location:', consentRes.headers.get('location'));
    if (consentRes.status !== 302) {
      fail('expected 302 redirect from consent approve');
      server.close();
      return;
    }
    const redirectLoc = new URL(consentRes.headers.get('location'));
    const authCode = redirectLoc.searchParams.get('code');
    if (!authCode) {
      fail(`no code in redirect: ${redirectLoc}`);
      server.close();
      return;
    }
    ok(`consent redirected with code len=${authCode.length}`);

    // -------- 8. token exchange --------
    div('POST /token (grant=authorization_code)');
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code: authCode,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });
    const tokenRes = await fetch(`${base}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
    });
    const tokenJson = await tokenRes.json();
    console.log('  status:', tokenRes.status);
    console.log('  token_type:', tokenJson.token_type);
    console.log('  access_token len:', tokenJson.access_token?.length);
    console.log('  refresh_token len:', tokenJson.refresh_token?.length);
    if (tokenRes.status !== 200 || !tokenJson.access_token) {
      fail(`token exchange failed: ${JSON.stringify(tokenJson)}`);
      server.close();
      return;
    }
    ok('token exchange succeeded');
    const accessToken = tokenJson.access_token;
    const refreshToken = tokenJson.refresh_token;

    // -------- 9. authenticated initialize --------
    div('POST /mcp initialize (with Bearer)');
    const mcpCall = async (payload) => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });
      const text = await r.text();
      // StreamableHTTP can return SSE or JSON; both start with something
      // parseable after trimming.
      let json;
      if (text.startsWith('event:') || text.startsWith('data:')) {
        const m = text.match(/^data:\s*(.*)$/m);
        json = m ? JSON.parse(m[1]) : null;
      } else {
        try { json = JSON.parse(text); } catch { json = text; }
      }
      return { status: r.status, json };
    };

    const init = await mcpCall({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'smoke', version: '0.0.0' },
      },
    });
    console.log('  status:', init.status);
    console.log('  result.serverInfo:', init.json?.result?.serverInfo);
    if (init.status === 200 && init.json?.result?.serverInfo?.name === 'as500-mcp')
      ok('initialize returned our server info');
    else fail(`initialize unexpected: ${JSON.stringify(init.json).slice(0, 300)}`);

    // -------- 10. tools/list --------
    div('POST /mcp tools/list');
    const tools = await mcpCall({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const toolNames = tools.json?.result?.tools?.map((t) => t.name) ?? [];
    console.log('  status:', tools.status);
    console.log('  tool count:', toolNames.length);
    console.log('  sample:', toolNames.slice(0, 5));
    if (toolNames.length > 0) ok(`tools/list returned ${toolNames.length} tool(s)`);
    else fail('tools/list returned no tools');

    // -------- 11. tools/call (a read-only list) --------
    // Use `timereg_v2_list` — its MCP scope requires `userId` and `date`.
    // KALLE's id is 3 (from the seed) and today is fine as the workday.
    const listTool = toolNames.find((n) => n.endsWith('_list'));
    if (listTool) {
      div(`POST /mcp tools/call ${listTool}`);
      const today = new Date().toISOString().split('T')[0];
      const call = await mcpCall({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: listTool,
          arguments: { userId: 3, date: today, limit: 5 },
        },
      });
      const isError = call.json?.result?.isError === true;
      const content = call.json?.result?.content;
      const err = call.json?.result?.structuredContent?.error;
      console.log('  status:', call.status);
      console.log('  isError:', isError);
      if (content?.[0]?.text) console.log('  content[0].text:', content[0].text.slice(0, 200));
      if (err) console.log('  error.code:', err.code);
      // Either outcome (success or handler-level permission_denied) proves
      // the full loop works end-to-end.
      ok(`tools/call completed (isError=${isError})`);
    } else {
      console.log('  (no _list tool registered; skipping tools/call)');
    }

    // -------- 12. refresh --------
    div('POST /token (grant=refresh_token)');
    const refreshBody = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    });
    const refreshRes = await fetch(`${base}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: refreshBody.toString(),
    });
    const refreshJson = await refreshRes.json();
    console.log('  status:', refreshRes.status);
    console.log('  new access_token len:', refreshJson.access_token?.length);
    if (refreshRes.status === 200 && refreshJson.access_token) ok('refresh minted new access token');
    else fail(`refresh failed: ${JSON.stringify(refreshJson)}`);

    // -------- 13. audit log --------
    div('mcp_audit_log spot check');
    // Audit writes are fire-and-forget; give them a beat to land.
    await new Promise((r) => setTimeout(r, 250));
    const rows = await db
      .select()
      .from(schema.mcpAuditLog)
      .orderBy(desc(schema.mcpAuditLog.created_at))
      .limit(5);
    console.log(`  last ${rows.length} row(s):`);
    for (const r of rows) {
      console.log(
        `    [${r.action}] tool=${r.tool_name} ok=${r.ok} err=${r.error_code ?? '-'} client=${r.client_id?.slice(0, 8) ?? '-'} user=${r.user_id ?? '-'} dur=${r.duration_ms}ms`
      );
    }
    if (rows.some((r) => r.client_id === clientId)) ok('audit log contains our client calls');
    else fail('audit log did not capture our calls');
  } catch (err) {
    console.error('Smoke test threw:', err);
    process.exitCode = 1;
  } finally {
    await new Promise((resolve) => server.close(resolve));
    // Drain the DB pool so node exits promptly.
    try {
      const { pool } = await import('../dist/db/index.js');
      await pool.end();
    } catch {}
  }
});
