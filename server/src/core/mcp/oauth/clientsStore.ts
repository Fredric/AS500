// OAuthRegisteredClientsStore implementation backed by the `oauth_clients`
// Postgres table via `store.ts`. Used by the MCP SDK's authorize and token
// handlers to look up clients by id and (optionally) register new ones via
// RFC 7591 Dynamic Client Registration.

import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { createClient, getClient } from './store.js';

/**
 * Sanity-clamp any caller-supplied metadata before we store it. Some fields
 * (grant types, token endpoint auth method) have a closed set of acceptable
 * values under MCP's OAuth 2.1 profile; anything else would be silently
 * ignored by the SDK anyway.
 */
const ALLOWED_AUTH_METHODS = new Set([
  'none', // public (PKCE-only) clients
  'client_secret_basic',
  'client_secret_post',
]);

const ALLOWED_GRANT_TYPES = new Set(['authorization_code', 'refresh_token']);

function pickAuthMethod(requested?: string): string {
  if (requested && ALLOWED_AUTH_METHODS.has(requested)) return requested;
  // Default per RFC 7591 §2: "client_secret_basic" if no method is provided.
  // But MCP clients are frequently public/native; if the caller didn't
  // ask for a method explicitly we still default to `client_secret_basic`
  // so DCR never issues an unauthenticated client by accident.
  return 'client_secret_basic';
}

function pickGrantTypes(requested?: string[]): string[] {
  const got = (requested ?? []).filter((g) => ALLOWED_GRANT_TYPES.has(g));
  if (got.length === 0) return ['authorization_code', 'refresh_token'];
  return got;
}

/**
 * Factory returns a plain object conforming to the SDK's
 * `OAuthRegisteredClientsStore` interface. The SDK calls `getClient()` on
 * every `/authorize` request and `registerClient()` on every `/register`
 * request; both are async.
 */
export function buildClientsStore(): OAuthRegisteredClientsStore {
  return {
    async getClient(clientId) {
      return getClient(clientId);
    },

    async registerClient(client) {
      try {
        // Inner block so we can log unexpected errors without polluting the
        // happy-path read. SDK wraps any thrown non-OAuthError in an opaque
        // 500, which makes diagnosing registration failures impossible
        // otherwise.
        const redirect_uris = client.redirect_uris ?? [];
        if (redirect_uris.length === 0) {
          throw new Error('At least one redirect_uri is required for dynamic registration.');
        }

        const auth_method = pickAuthMethod(client.token_endpoint_auth_method);
        const grant_types = pickGrantTypes(client.grant_types);

        // The SDK's DCR handler pre-generates both `client_id` and
        // `client_secret` and passes them in. We accept them verbatim and
        // persist the secret as a bcrypt hash. If the SDK did NOT pre-generate
        // them (bring-your-own-id scenarios), `createClient` will fall back
        // to locally generated values.
        const created = await createClient({
          id: (client as OAuthClientInformationFull).client_id,
          clientSecret: (client as OAuthClientInformationFull).client_secret,
          client_name: client.client_name ?? 'Unnamed MCP Client',
          redirect_uris,
          token_endpoint_auth_method: auth_method,
          rawMetadata: {
            grant_types,
            response_types: client.response_types ?? ['code'],
            scope: client.scope,
            contacts: client.contacts,
            client_uri: client.client_uri,
            logo_uri: client.logo_uri,
            tos_uri: client.tos_uri,
            policy_uri: client.policy_uri,
            software_id: client.software_id,
            software_version: client.software_version,
          },
        });

        // The SDK will pick up `client_secret` verbatim from the returned
        // object and include it in the one-time registration response.
        const result: OAuthClientInformationFull = {
          ...created,
          client_secret_expires_at: (client as OAuthClientInformationFull).client_secret_expires_at,
          grant_types,
          response_types: client.response_types ?? ['code'],
          scope: client.scope,
          contacts: client.contacts,
          client_uri: client.client_uri,
          logo_uri: client.logo_uri,
          tos_uri: client.tos_uri,
          policy_uri: client.policy_uri,
          software_id: client.software_id,
          software_version: client.software_version,
        };
        return result;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[MCP] registerClient failed:', err);
        throw err;
      }
    },
  };
}
