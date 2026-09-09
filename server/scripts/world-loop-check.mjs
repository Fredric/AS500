/**
 * World loop smoke test.
 *
 * Drives the real terminal WebSocket protocol to prove the Phase 1 acceptance
 * property: a drawer placed in the office and bound to a CRUDTable config opens,
 * from the green screen, into that config's list scoped exactly as the binding
 * says — and the world server resolves the identical binding over HTTP.
 *
 * Three clients, one binding, one getConfig() call. If the terminal and the
 * world server ever disagree, this test is what says so.
 *
 *   node scripts/world-loop-check.mjs
 *
 * Env: AS500_URL (ws://localhost:3001), WORLD_URL (http://localhost:3006),
 *      API_URL (http://localhost:3002), AS500_USER, AS500_PASS.
 */

import WebSocket from 'ws';

const AS500_URL = process.env.AS500_URL ?? 'ws://127.0.0.1:3001';
const WORLD_URL = process.env.WORLD_URL ?? 'http://127.0.0.1:3006';
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:3002';
const USER = process.env.AS500_USER ?? 'FREDRIC';
const PASS = process.env.AS500_PASS ?? 'fredric';
const SPACE_KEY = process.env.WORLD_SPACE ?? 'main_office';

let failures = 0;

function check(label, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

// ---------------------------------------------------------------------------
// Terminal driver
// ---------------------------------------------------------------------------

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(AS500_URL);
    const queue = [];
    const waiters = [];

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type) return; // PONG / AI_CHAT_* — not screen updates
      const waiter = waiters.shift();
      if (waiter) waiter(msg);
      else queue.push(msg);
    });
    ws.on('error', reject);
    ws.on('open', () => resolve({
      ws,
      next: () => new Promise((res) => {
        const queued = queue.shift();
        if (queued) res(queued);
        else waiters.push(res);
      }),
      send(payload) {
        ws.send(JSON.stringify({ cursor: { row: 0, col: 0 }, input: {}, ...payload }));
      },
    }));
  });
}

const text = (screen) => screen.rows.join('\n');

/** Row index of the menu option whose label contains `label`. */
function menuOption(screen, label) {
  for (const row of screen.rows) {
    const m = row.match(/^\s*(\d+)\.\s+(.*?)\s*$/);
    if (m && m[2].toLowerCase().includes(label.toLowerCase())) return m[1];
  }
  return null;
}

/**
 * Page-relative index of the list row containing `label`.
 * `navigation.list.dataStartRow` tells us where the data begins, so this does
 * not depend on how the screen happens to be laid out.
 */
function listRow(screen, label) {
  const nav = screen.navigation?.list;
  if (!nav) return null;
  for (let i = 0; i < nav.dataRowCount; i++) {
    if ((screen.rows[nav.dataStartRow + i] ?? '').toLowerCase().includes(label.toLowerCase())) return i;
  }
  return null;
}

async function main() {
  console.log(`\nAS500 world loop check — ${AS500_URL}\n`);

  // --- terminal end -------------------------------------------------------
  const term = await connect();
  term.send({ sessionId: null, screenId: '', key: 'CONNECT' });
  let screen = await term.next();
  const sessionId = screen.sessionId;
  check('reached LOGIN', screen.screenId === 'LOGIN', screen.screenId);

  term.send({ sessionId, screenId: 'LOGIN', key: 'ENTER', input: { username: USER, password: PASS } });
  screen = await term.next();
  check('signed on', screen.screenId === 'MAIN_MENU', screen.screenId);

  const officeOpt = menuOption(screen, 'Virtual Office');
  check('main menu offers Virtual Office', officeOpt !== null);
  if (!officeOpt) return finish();

  term.send({ sessionId, screenId: 'MAIN_MENU', key: 'ENTER', input: { selection: officeOpt } });
  screen = await term.next();
  check('entered the office menu', screen.screenId === 'MENU_OFFICE', screen.screenId);

  const spacesOpt = menuOption(screen, 'Spaces');
  term.send({ sessionId, screenId: screen.screenId, key: 'ENTER', input: { selection: spacesOpt } });
  screen = await term.next();
  check('opened the Spaces list', screen.screenId === 'CRUD_WORLD_SPACES', screen.screenId);
  check('the space is listed', text(screen).includes('main_office'));

  // Edit the space, then press T for its objects (RelationConfig).
  const spaceRow = listRow(screen, 'main_office');
  term.send({ sessionId, screenId: screen.screenId, key: 'ENTER', input: { [`opt_${spaceRow}`]: '2' } });
  screen = await term.next();
  check('opened the space form', screen.screenId === 'CRUD_WORLD_SPACES_FORM', screen.screenId);

  term.send({ sessionId, screenId: screen.screenId, key: 'T' });
  screen = await term.next();
  check('T descended into objects', screen.screenId === 'CRUD_WORLD_THINGS', screen.screenId);
  check('the desk is on the floor', text(screen).includes('Fredrics Desk'));

  // Enter on an unbound container descends the FURNITURE tree, in place.
  const deskRow = listRow(screen, 'Fredrics Desk');
  term.send({ sessionId, screenId: screen.screenId, key: 'ENTER', input: { [`opt_${deskRow}`]: '9' } });
  screen = await term.next();
  check('still on the objects list after descending', screen.screenId === 'CRUD_WORLD_THINGS', screen.screenId);
  check('the drawer is inside the desk', text(screen).includes('Invoices 2024'));

  // Enter on a BOUND object leaves the world entirely and opens what it names.
  const drawerRow = listRow(screen, 'Invoices 2024');
  term.send({ sessionId, screenId: screen.screenId, key: 'ENTER', input: { [`opt_${drawerRow}`]: '9' } });
  screen = await term.next();
  check('the drawer opened My Documents', screen.screenId === 'CRUD_DOCUMENTS', screen.screenId);

  const body = text(screen);
  check('scoped to the bound folder', body.includes('ACME-0041.pdf'), 'expected the folder contents');
  check('breadcrumb shows the bound folder', body.includes('Invoices 2024'));

  // Esc eventually returns to the room it came from. The first press walks up
  // the *folder* tree — `documentsConfig.onListBack` handles Esc in place while
  // there is a parent folder — so leaving the screen can take more than one.
  // That is the two-hierarchy rule visible from the keyboard: you climb out of
  // the data tree before you are back in the furniture tree.
  for (let i = 0; i < 4 && screen.screenId !== 'CRUD_WORLD_THINGS'; i++) {
    term.send({ sessionId, screenId: screen.screenId, key: 'F12' });
    screen = await term.next();
  }
  check('Esc came back to the objects list', screen.screenId === 'CRUD_WORLD_THINGS', screen.screenId);
  check('and back inside the desk it left', text(screen).includes('Invoices 2024'));

  term.ws.close();

  // --- world server end ---------------------------------------------------
  const tokenRes = await fetch(`${API_URL}/api/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  const { access_token: token } = await tokenRes.json();

  const sceneRes = await fetch(`${WORLD_URL}/api/space/${SPACE_KEY}?token=${encodeURIComponent(token)}`);
  check('world server resolved the scene', sceneRes.ok, `HTTP ${sceneRes.status}`);
  const scene = await sceneRes.json();

  const desk = scene.things.find((t) => t.label === 'Fredrics Desk');
  const drawer = desk?.children.find((t) => t.label === 'Invoices 2024');
  check('the same furniture tree over HTTP', Boolean(drawer), 'drawer inside desk');
  check('the same binding resolved', drawer?.access === 'ok', drawer?.reason ?? drawer?.access);
  check(
    'both ends agree on the contents',
    drawer?.contents?.count === 3,
    `world says ${drawer?.contents?.count}, terminal listed the same folder`,
  );

  const unauth = await fetch(`${WORLD_URL}/api/space/${SPACE_KEY}`);
  check('the world refuses an unauthenticated read', unauth.status === 401, `HTTP ${unauth.status}`);

  // --- the room is shared ------------------------------------------------
  await presenceChecks(token);

  finish();
}

/** Open two world sockets and prove each sees the other in the room. */
function worldSocket(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WORLD_URL.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`);
    const seen = [];
    ws.on('message', (raw) => seen.push(JSON.parse(raw.toString())));
    ws.on('error', reject);
    ws.on('open', () => resolve({
      ws,
      seen,
      send: (m) => ws.send(JSON.stringify(m)),
      /** Latest message of a type, or null. */
      latest: (type) => [...seen].reverse().find((m) => m.type === type) ?? null,
    }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function presenceChecks(token) {
  const a = await worldSocket(token);
  a.send({ type: 'ENTER_SPACE', spaceKey: SPACE_KEY });
  await sleep(700);

  const scene = a.latest('SCENE');
  check('socket client received a scene', Boolean(scene), scene ? `${scene.scene.things.length} things` : 'none');

  const b = await worldSocket(token);
  b.send({ type: 'ENTER_SPACE', spaceKey: SPACE_KEY });
  b.send({ type: 'MOVE', pose: { x: 7, y: 4, rot: 0 } });
  await sleep(900);

  const roster = a.latest('PRESENCE');
  check('the first client sees two people in the room', roster?.actors?.length === 2, `saw ${roster?.actors?.length ?? 0}`);
  const moved = roster?.actors?.find((p) => p.pose.x === 7);
  check('and sees the other one move', Boolean(moved), 'relayed pose x=7');

  // Opening an object over the socket resolves the same binding as everywhere else.
  const drawerId = scene?.scene.things
    .flatMap((t) => t.children)
    .find((c) => c.label === 'Invoices 2024')?.id;
  b.send({ type: 'OPEN_THING', thingId: drawerId });
  await sleep(600);
  const opened = b.latest('THING_OPENED');
  check('OPEN_THING resolved the drawer', opened?.thing?.contents?.count === 3, `count ${opened?.thing?.contents?.count}`);

  b.ws.close();
  await sleep(700);
  const after = a.latest('PRESENCE');
  check('leaving the room removes the avatar', after?.actors?.length === 1, `saw ${after?.actors?.length ?? 0}`);

  a.ws.close();
}

function finish() {
  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nworld-loop-check crashed:', err);
  process.exit(1);
});
