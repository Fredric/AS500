// Tiny helper — checks whether a user has the 'admin' role.
//
// Kept in its own file so `mcp/index.ts` can dynamic-import it without
// pulling all of `services/auth.ts` into the OAuth path (which would drag
// in the classic terminal-session login machinery, defeating the deliberate
// isolation of the MCP auth surface).

import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';

/** Returns true if the user has role 'admin'; false if the user id is not found. */
export async function isAdminForUser(userId: number): Promise<boolean> {
  if (!Number.isFinite(userId) || userId <= 0) return false;
  const rows = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.role === 'admin';
}
