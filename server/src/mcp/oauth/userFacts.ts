// Tiny helper — pulls the `is_admin` flag for a user id.
//
// Kept in its own file so `mcp/index.ts` can dynamic-import it without
// pulling all of `services/auth.ts` into the OAuth path (which would drag
// in the classic terminal-session login machinery, defeating the deliberate
// isolation of the MCP auth surface).

import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';

/** Returns the user's `is_admin` flag; false if the user id is not found. */
export async function isAdminForUser(userId: number): Promise<boolean> {
  if (!Number.isFinite(userId) || userId <= 0) return false;
  const rows = await db
    .select({ is_admin: users.is_admin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.is_admin ?? false;
}
