// Green-on-black HTML consent page for the MCP authorize flow.
//
// The MCP spec leaves the consent UX up to the server. We render a single
// form that asks the user to (a) sign in with their AS500 credentials and
// (b) grant the requesting client access. Both happen in one POST to
// `/authorize/consent` — the page never issues a separate login.
//
// Design choices:
//   - Plain static HTML, no framework. Zero bundling required to serve it.
//   - Matches the terminal aesthetic (green mono on black) so users
//     recognise it as part of AS500.
//   - All inputs HTML-escaped. An HTML injection in `client_name` would
//     otherwise be an XSS vector right next to the user's password field.
//   - No remote assets — fonts and styles are inline. This also keeps the
//     response CSP-friendly without us needing to set one explicitly.

export interface ConsentTemplateVars {
  clientName: string;
  clientId: string;
  scope: string;
  state?: string;
  redirectUri: string;
  responseType: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  /** Pre-fills the username input on retry. */
  usernameAttempt?: string;
  /** Optional error banner — rendered only when non-empty. */
  errorMessage?: string;
  /** Permission keys agents will obtain on the user's behalf. */
  permissions: string[];
  /** Where the form should POST. Typically `/authorize/consent`. */
  formAction: string;
}

/**
 * Minimal HTML escape — enough for attribute values and text nodes rendered
 * inside <body>. Not a substitute for a CSP but the attack surface here is
 * tiny (only server-controlled template variables land on the page).
 */
function esc(v: string | undefined | null): string {
  if (!v) return '';
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderConsentPage(v: ConsentTemplateVars): string {
  const error = v.errorMessage
    ? `<div class="error">${esc(v.errorMessage)}</div>`
    : '';

  const permsList = v.permissions.length
    ? v.permissions.map((p) => `<li>${esc(p)}</li>`).join('')
    : '<li class="muted">(No specific permissions — basic MCP access only.)</li>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Authorize ${esc(v.clientName)} — AS500</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { color-scheme: only dark; }
  html, body {
    background: #000;
    color: #33ff33;
    font-family: "Courier New", ui-monospace, monospace;
    font-size: 16px;
    line-height: 1.5;
    margin: 0; padding: 0;
  }
  .frame {
    max-width: 640px;
    margin: 48px auto;
    padding: 32px;
    border: 2px solid #33ff33;
    box-shadow: 0 0 16px rgba(51,255,51,0.4);
  }
  h1 {
    font-size: 20px;
    margin: 0 0 24px 0;
    text-transform: uppercase;
    letter-spacing: 2px;
    border-bottom: 1px solid #33ff33;
    padding-bottom: 8px;
  }
  .muted { color: #228822; }
  .client {
    background: rgba(51,255,51,0.08);
    padding: 12px;
    border-left: 3px solid #33ff33;
    margin-bottom: 24px;
  }
  .client .name { font-weight: bold; font-size: 18px; }
  .client .id { font-size: 12px; color: #228822; }
  .section { margin-bottom: 20px; }
  .section h2 {
    font-size: 14px;
    text-transform: uppercase;
    color: #33ff33;
    margin: 0 0 8px 0;
    letter-spacing: 1px;
  }
  ul.perms { margin: 0; padding-left: 20px; }
  ul.perms li { margin: 2px 0; }
  label { display: block; margin-bottom: 4px; color: #33ff33; }
  input[type="text"], input[type="password"] {
    width: 100%;
    box-sizing: border-box;
    background: #000;
    color: #33ff33;
    border: 1px solid #33ff33;
    padding: 10px;
    font-family: inherit;
    font-size: 16px;
    margin-bottom: 16px;
  }
  input[type="text"]:focus, input[type="password"]:focus {
    outline: none;
    box-shadow: 0 0 8px #33ff33;
  }
  .checkbox {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 16px 0;
  }
  .checkbox input { accent-color: #33ff33; width: 16px; height: 16px; }
  .actions { display: flex; gap: 12px; margin-top: 16px; }
  button {
    flex: 1;
    background: #000;
    color: #33ff33;
    border: 2px solid #33ff33;
    padding: 12px;
    font-family: inherit;
    font-size: 16px;
    text-transform: uppercase;
    letter-spacing: 2px;
    cursor: pointer;
  }
  button:hover { background: #33ff33; color: #000; }
  button.deny { color: #ff6666; border-color: #ff6666; }
  button.deny:hover { background: #ff6666; color: #000; }
  .error {
    background: #330000;
    color: #ff6666;
    border: 1px solid #ff6666;
    padding: 10px;
    margin-bottom: 16px;
  }
  .footer {
    margin-top: 24px;
    font-size: 12px;
    color: #228822;
    text-align: center;
  }
</style>
</head>
<body>
<div class="frame">
  <h1>AS500 — Authorize MCP Client</h1>

  ${error}

  <div class="client">
    <div class="name">${esc(v.clientName)}</div>
    <div class="id">client_id: ${esc(v.clientId)}</div>
  </div>

  <div class="section">
    <h2>Requested access</h2>
    <ul class="perms">${permsList}</ul>
  </div>

  <form method="POST" action="${esc(v.formAction)}" autocomplete="off">
    <input type="hidden" name="client_id" value="${esc(v.clientId)}">
    <input type="hidden" name="redirect_uri" value="${esc(v.redirectUri)}">
    <input type="hidden" name="response_type" value="${esc(v.responseType)}">
    <input type="hidden" name="scope" value="${esc(v.scope)}">
    <input type="hidden" name="state" value="${esc(v.state ?? '')}">
    <input type="hidden" name="code_challenge" value="${esc(v.codeChallenge)}">
    <input type="hidden" name="code_challenge_method" value="${esc(v.codeChallengeMethod)}">

    <div class="section">
      <h2>Sign in</h2>
      <label for="username">Username</label>
      <input id="username" name="username" type="text" autocapitalize="characters"
             autocomplete="username" value="${esc(v.usernameAttempt ?? '')}" required>

      <label for="password">Password</label>
      <input id="password" name="password" type="password"
             autocomplete="current-password" required>
    </div>

    <div class="checkbox">
      <input id="remember" name="remember" type="checkbox" value="1" checked>
      <label for="remember">Remember this consent on this account</label>
    </div>

    <div class="actions">
      <button type="submit" name="decision" value="deny" class="deny">Deny</button>
      <button type="submit" name="decision" value="approve">Approve</button>
    </div>
  </form>

  <div class="footer">
    Only approve clients you recognise. You can revoke access at any time
    from Settings.
  </div>
</div>
</body>
</html>`;
}
