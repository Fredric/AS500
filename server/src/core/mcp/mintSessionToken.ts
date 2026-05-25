// Mint a short-lived MCP JWT for an already-authenticated AS500 session user.
//
// Used by the AI chat service so MCP tool calls run under the real user's
// identity and RBAC — without a browser OAuth flow.
//
// Security contract:
//   - Only call this function AFTER verifying session.authenticated === true
//     and session.viserId is set.
//   - The returned JWT is passed to the AI Agent in metadata.mcpAccessToken.
//   - It must NOT be logged, stored in session, or returned to the browser.
//   - It expires in 1h and is revocable via jti in auth_tokens.
//
// Audit: tool calls made with these tokens appear in mcp_audit_log with
// client_id = 'as500-ai', separable from OAuth DCR clients.

import { issueAccessToken } from './oauth/tokens.js';
import { createRefreshToken } from './oauth/store.js';

export const AI_AGENT_CLIENT_ID = 'as500-ai';

/**
 * Issue a short-lived MCP JWT for `userId` using the first-party
 * `as500-ai` client id.
 *
 * Returns the signed JWT string — pass it directly to the AI Agent as
 * `metadata.mcpAccessToken`.
 */
export async function mintMcpAccessTokenForUser(
  userId: number,
  username: string,
): Promise<string> {
  const refreshToken = await createRefreshToken({
    userId,
    clientId: AI_AGENT_CLIENT_ID,
    scope: '',
  });

  const issued = await issueAccessToken({
    userId,
    username,
    clientId: AI_AGENT_CLIENT_ID,
    scopes: [],
    parentRefreshToken: refreshToken,
  });

  return issued.accessToken;
}
