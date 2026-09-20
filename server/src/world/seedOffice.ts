/**
 * Seed a demo office — one command instead of a dozen green-screen steps.
 *
 *   cd server && npm run seed:office
 *   npm run seed:office -- --user KALLE --space my_office --reset
 *
 * Goes through `worldService`, so every object is validated exactly as the
 * terminal, MCP and REST paths validate it — this seeds the same way a person
 * would, it does not write rows behind the model's back.
 *
 * The documents drawer binds to whichever folder the user already owns; if they
 * have none it is skipped with a note rather than binding to something that
 * cannot resolve.
 */

import { and, asc, eq } from 'drizzle-orm';
import { db } from '../core/db/index.js';
import { users } from '../core/db/schema.js';
import { documentFolders } from '../app/db/schema.js';
import { worldSpaces } from './db/schema.js';
import {
  createSpace,
  createThing,
  deleteSpace,
  getSpaceByKey,
} from './services/worldService.js';
import { createNote } from './services/notesService.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split('=').slice(1).join('=');
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const USERNAME = arg('user', 'FREDRIC');
const SPACE_KEY = arg('space', 'main_office');
const RESET = process.argv.includes('--reset');

async function main(): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.username, USERNAME.toUpperCase()));
  if (!user) throw new Error(`No user '${USERNAME}' — run \`npm run seed\` first.`);

  const existing = await getSpaceByKey(SPACE_KEY);
  if (existing) {
    if (!RESET) {
      console.log(`Space '${SPACE_KEY}' already exists (id ${existing.id}). Pass --reset to rebuild it.`);
      return;
    }
    // Objects cascade from the space, so this clears the room in one step.
    await deleteSpace({ id: existing.id });
    console.log(`Removed the existing '${SPACE_KEY}'.`);
  }

  const space = await createSpace({
    userId: user.id,
    key: SPACE_KEY,
    name: 'Main Office',
    kind: 'office',
  });
  const spaceId = space.id as number;
  console.log(`Created space '${SPACE_KEY}' (id ${spaceId}) for ${user.username}.`);

  const place = (fields: Record<string, unknown>) =>
    createThing({
      userId: user.id,
      spaceId,
      bindingKind: 'none',
      type: 'box',
      label: 'Object',
      ...fields,
    } as Parameters<typeof createThing>[0]);

  const desk = await place({ label: `${user.username}'s Desk`, type: 'desk', zone: 'north_east' });

  await place({
    label: 'Workstation', type: 'workstation', zone: 'north_east',
    bindingKind: 'workstation',
  });

  await place({
    label: 'Garage Shelf', type: 'shelf', zone: 'west',
    bindingKind: 'crud', bindingTarget: 'motorcycles',
  });

  await place({
    label: 'Ingest Rack', type: 'rack', zone: 'server_room',
    bindingKind: 'service', bindingTarget: 'docs-api',
  });

  // Bind a drawer in the desk to a folder the user actually owns.
  const [folder] = await db
    .select({ id: documentFolders.id, name: documentFolders.name })
    .from(documentFolders)
    .where(and(eq(documentFolders.user_id, user.id)))
    .orderBy(asc(documentFolders.id))
    .limit(1);

  if (folder) {
    await createThing({
      userId: user.id,
      spaceId,
      parentThingId: desk.id as number,
      label: folder.name,
      type: 'drawer',
      slot: 'drawer_1',
      bindingKind: 'crud',
      bindingTarget: 'documents',
      bindingScope: `folderId=${folder.id}`,
    });
    console.log(`Put a drawer in the desk bound to folder '${folder.name}' (id ${folder.id}).`);
  } else {
    console.log(
      `${user.username} has no document folders, so the desk has no bound drawer.\n` +
      `Create one under My Documents, then re-run with --reset.`,
    );
  }

  // A bookshelf at the root of My Documents — one book per top-level folder,
  // derived live. Bound to root (no scope), so it works even with zero
  // folders (an empty shelf) rather than needing the same real-folder lookup
  // the drawer above does.
  await place({
    label: 'Documents Shelf', type: 'bookshelf', zone: 'north_east',
    bindingKind: 'crud', bindingTarget: 'documents',
  });
  console.log(`Put a bookshelf at the root of My Documents.`);

  // A post-it — Phase 2's "objects that own data" class. Bound kind:'none'
  // (the seed's own default), it owns a world_notes row keyed by its own
  // thing id rather than binding to anything, so its text is written after
  // placement, not at create time.
  const welcomeNote = await place({ label: 'Welcome Note', type: 'postit', zone: 'north_east' });
  await createNote({ userId: user.id, thingId: welcomeNote.id as number, body: 'Welcome to the office!', color: 'yellow' });
  console.log(`Pinned a welcome post-it.`);

  const total = await db.select({ id: worldSpaces.id }).from(worldSpaces);
  console.log(`\nDone. ${total.length} space(s). Open http://localhost:5173/office`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('seed-office failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
