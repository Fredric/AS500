// Idempotent GPU worker service account.
//
// Created on every server start (and by `npm run seed`) so the as500-images
// worker has a login without a manual SQL step. Role is `aiagent` so it does
// not inherit things:write / documents:write from the `user` defaults; the
// only extra grant is THING_JOB_RUN, which authorises the lease protocol.

import bcrypt from 'bcrypt';
import { and, eq } from 'drizzle-orm';
import { db } from '../../core/db/index.js';
import { users, userPermissions } from '../../core/db/schema.js';
import { PERMISSIONS } from '../../core/services/access.js';

const USERNAME = 'GPUWORKER';
const DEFAULT_PASSWORD = 'gpuworker';

export async function seedGpuWorkerAccount(): Promise<void> {
  const password = process.env.GPUWORKER_PASSWORD ?? DEFAULT_PASSWORD;

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, USERNAME));

  let userId: number;
  if (existing.length === 0) {
    const password_hash = await bcrypt.hash(password, 10);
    const [row] = await db
      .insert(users)
      .values({
        username: USERNAME,
        password_hash,
        full_name: 'GPU image worker',
        active: true,
        role: 'aiagent',
      })
      .returning({ id: users.id });
    userId = row.id;
    console.log(`Created service account ${USERNAME} (password from GPUWORKER_PASSWORD or default 'gpuworker')`);
  } else {
    userId = existing[0].id;
  }

  const grant = await db
    .select({ user_id: userPermissions.user_id })
    .from(userPermissions)
    .where(and(
      eq(userPermissions.user_id, userId),
      eq(userPermissions.permission_key, PERMISSIONS.THING_JOB_RUN),
    ));

  if (grant.length === 0) {
    await db.insert(userPermissions).values({
      user_id: userId,
      permission_key: PERMISSIONS.THING_JOB_RUN,
      granted: true,
    });
  }
}
