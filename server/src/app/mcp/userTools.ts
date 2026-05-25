// Standalone MCP tools — user info (Option B example).
//
// Registers a `user_info` tool group with a single tool:
//
//   user_info_get_me  — returns the authenticated user's own profile
//
// The tool requires no input from the agent: userId is injected from the
// Bearer token so agents can only ever query their own profile.
//
// No special permission is required beyond being authenticated — any valid
// OAuth Bearer token can call this tool.

import { eq } from 'drizzle-orm';
import { db } from '../../core/db/index.js';
import { users } from '../../core/db/schema.js';
import { registerMcpTools } from '../../core/mcp/toolRegistry.js';

registerMcpTools({
  id: 'user_info',
  name: 'User Info',
  description:
    'Read-only access to the authenticated user\'s own AS500 profile. ' +
    'Returns public identity fields (no password hash or sensitive data).',

  tools: [
    {
      name: 'get_me',
      description:
        'Return the profile of the currently authenticated user: ' +
        'id, username, full name, role, and account status. ' +
        'No input required — identity is derived from the Bearer token.',
      params: [
        {
          name: 'userId',
          type: 'number',
          required: true,
          description: 'Automatically injected from the OAuth token — not a tool input.',
          injectFromAuth: 'userId',
        },
      ],
      handler: async ({ userId }) => {
        const rows = await db
          .select({
            id: users.id,
            username: users.username,
            full_name: users.full_name,
            active: users.active,
            role: users.role,
            created_at: users.created_at,
          })
          .from(users)
          .where(eq(users.id, userId as number));

        if (!rows[0]) {
          return { error: 'User not found.' };
        }

        return { user: rows[0] };
      },
    },
  ],
});
