/**
 * Virtual office — the single page of AS500.
 *
 * The world is now the app's front door. The green-screen terminal is mounted
 * inside it in two roles:
 *   1. the login gate — full screen until the user is authenticated;
 *   2. the workstation modal — opened by clicking a `workstation` object.
 *
 * The terminal component is mounted once and never unmounted, so its WebSocket
 * session and current screen survive being hidden and reshown. Signing off in
 * the terminal (F3 at the main menu) clears the token and drops back to the
 * login gate.
 */

import { useCallback, useEffect, useState } from 'react';
import Terminal from '../components/Terminal';
import Floorplan from './components/Floorplan';
import ThingPanel from './components/ThingPanel';
import DocumentsBrowserModal from './components/DocumentsBrowserModal';
import Scene3D from './three/Scene3D';
import { findThing, useWorldSocket, worldApiUrl } from './useWorldSocket';
import type { ResolvedBook, ResolvedThing, WorldSpace } from './types';

/** `?space=main_office` overrides; otherwise the first space is entered. */
function requestedSpace(): string | null {
  return new URLSearchParams(window.location.search).get('space');
}

interface TerminalStatus {
  authenticated: boolean;
  screenId: string;
  connected: boolean;
}

export default function App() {
  const [spaces, setSpaces] = useState<WorldSpace[]>([]);
  const [spacesError, setSpacesError] = useState<string | null>(null);

  // Auth state is driven entirely by the embedded terminal, which resumes any
  // existing session from its cookie on mount. Until it reports back, the login
  // gate stays up (a brief green flash for already-signed-in users).
  const [term, setTerm] = useState<TerminalStatus>({ authenticated: false, screenId: '', connected: false });
  const authed = term.authenticated;

  // Whether the workstation modal is showing. Never open while unauthenticated
  // (the gate is showing the same terminal full screen anyway).
  const [terminalOpen, setTerminalOpen] = useState(false);

  const handleStatus = useCallback((s: TerminalStatus) => setTerm(s), []);

  const world = useWorldSocket(requestedSpace(), authed);
  const {
    connected, error, scene, actors, opened, browse,
    enterSpace, openThing, closeThing, browseFolder, setNote, move, refresh,
  } = world;

  const [openBook, setOpenBook] = useState<{ folderId: number; label: string } | null>(null);
  const [view, setView] = useState<'2d' | '3d'>('2d');

  // Signing off closes the modal so the gate takes over cleanly.
  useEffect(() => {
    if (!authed) setTerminalOpen(false);
  }, [authed]);

  // The terminal's own layout measures against the window; nudge it to recompute
  // when it becomes visible again after being hidden.
  useEffect(() => {
    if (terminalOpen) window.dispatchEvent(new Event('resize'));
  }, [terminalOpen]);

  // Esc minimises the workstation modal — but only at the main menu / login,
  // where the terminal itself has nothing to back out of. On any deeper screen
  // Esc must fall through to the terminal as F3. Capture phase so we see it
  // before the terminal's own key handler.
  useEffect(() => {
    if (!terminalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (term.screenId === 'MAIN_MENU' || term.screenId === 'LOGIN' || term.screenId === '') {
        e.stopPropagation();
        e.preventDefault();
        setTerminalOpen(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [terminalOpen, term.screenId]);

  // The space list comes over HTTP rather than the socket: it is needed to pick
  // a room before entering one, and it never changes while you are standing in it.
  useEffect(() => {
    if (!authed) return;
    const url = worldApiUrl('/api/spaces');
    if (!url) return;

    let cancelled = false;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body: { spaces: WorldSpace[] }) => {
        if (cancelled) return;
        setSpaces(body.spaces);
        if (!requestedSpace() && body.spaces.length > 0) enterSpace(body.spaces[0].key);
      })
      .catch((err: Error) => !cancelled && setSpacesError(err.message));

    return () => { cancelled = true; };
  }, [authed, enterSpace]);

  const selected = opened ?? null;

  function select(thing: ResolvedThing) {
    // A workstation is not an inspectable object — it *is* the terminal.
    if (thing.binding?.kind === 'workstation') {
      setTerminalOpen(true);
      return;
    }
    openThing(thing.id);
  }

  function openBookModal(book: ResolvedBook) {
    setOpenBook({ folderId: book.id, label: book.label });
  }

  function enterDoor(spaceKey: string) {
    setOpenBook(null);
    enterSpace(spaceKey);
  }

  // Terminal layer — always mounted. Full screen as the login gate; a modal
  // (with a close strip) once signed in; hidden otherwise.
  const termLayerClass = !authed
    ? 'term-layer term-layer--full'
    : 'term-layer term-layer--modal';

  const terminalLayer = (
    <div className={termLayerClass} hidden={authed && !terminalOpen}>
      {authed && terminalOpen && (
        <div className="term-layer__bar">
          <span>AS500 terminal — workstation</span>
          <button type="button" onClick={() => setTerminalOpen(false)}>✕ Close (Esc at menu)</button>
        </div>
      )}
      <div className="app">
        <Terminal onStatus={handleStatus} visible={!authed || terminalOpen} />
      </div>
    </div>
  );

  // One stable tree across the auth transition, so the embedded <Terminal>
  // is never unmounted (which would drop its WebSocket session).
  return (
    <>
      {authed && (
      <div className="shell">
        <header className="topbar">
          <h1>AS500 · Virtual Office</h1>

          <label className="topbar__space">
            Space
            <select
              value={scene?.space.key ?? ''}
              onChange={(e) => enterSpace(e.target.value)}
              disabled={spaces.length === 0}
            >
              {spaces.length === 0 && <option value="">(none yet)</option>}
              {spaces.map((s) => (
                <option key={s.key} value={s.key}>{s.name}</option>
              ))}
            </select>
          </label>

          <span className="topbar__actors">
            {actors.length} here{actors.length > 0 ? `: ${actors.map((a) => a.username).join(', ')}` : ''}
          </span>

          <button type="button" onClick={() => setTerminalOpen(true)}>Terminal</button>
          <button type="button" onClick={() => setView(view === '2d' ? '3d' : '2d')}>
            {view === '2d' ? 'Enter 3D' : 'Back to 2D'}
          </button>
          <button type="button" onClick={refresh}>Refresh</button>
          <span className={`dot ${connected ? 'dot--on' : 'dot--off'}`} title={connected ? 'connected' : 'reconnecting'} />
        </header>

        {(error || spacesError) && <div className="banner">{error ?? spacesError}</div>}

        {spaces.length === 0 && !spacesError && (
          <div className="banner banner--hint">
            No spaces yet. In the terminal: <strong>MAIN MENU → Virtual Office → Spaces</strong>,
            press F6 to create one, then <strong>T</strong> on it to place objects.
          </div>
        )}

        <main className="stage">
          {scene ? (
            view === '2d' ? (
              <Floorplan
                things={scene.things}
                actors={actors}
                selectedId={selected?.id ?? null}
                onSelect={select}
                onOpenBook={openBookModal}
                onEnterDoor={enterDoor}
                onMove={move}
              />
            ) : (
              <Scene3D
                things={scene.things}
                actors={actors}
                selectedId={selected?.id ?? null}
                onSelect={select}
                onOpenBook={openBookModal}
                onEnterDoor={enterDoor}
                onMove={move}
                overlayOpen={Boolean(selected) || Boolean(openBook) || terminalOpen}
              />
            )
          ) : (
            <p className="stage__empty">Entering…</p>
          )}

          {selected && (
            <ThingPanel
              key={selected.id}
              thing={scene ? findThing(scene.things, selected.id) ?? selected : selected}
              onClose={closeThing}
              onSelect={select}
              onOpenBook={openBookModal}
              onSetNote={setNote}
              onEnterDoor={enterDoor}
            />
          )}
        </main>

        {openBook && (
          <DocumentsBrowserModal
            key={openBook.folderId}
            rootFolderId={openBook.folderId}
            rootLabel={openBook.label}
            browse={browse}
            error={error}
            onNavigate={browseFolder}
            onClose={() => setOpenBook(null)}
          />
        )}
      </div>
      )}

      {terminalLayer}
    </>
  );
}
