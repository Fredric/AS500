/**
 * Virtual office — the 2D floorplan page.
 *
 * Renders whatever the world server resolves for the signed-in user. It holds no
 * domain knowledge: it does not know what a document is, only that an object is
 * bound to something and reports a count. All meaning comes from the binding
 * resolver, which is the same code path the terminal uses.
 */

import { useEffect, useState } from 'react';
import Floorplan from './components/Floorplan';
import ThingPanel from './components/ThingPanel';
import DocumentsBrowserModal from './components/DocumentsBrowserModal';
import { findThing, useWorldSocket, worldApiUrl } from './useWorldSocket';
import type { ResolvedBook, ResolvedThing, WorldSpace } from './types';

/** `?space=main_office` overrides; otherwise the first space is entered. */
function requestedSpace(): string | null {
  return new URLSearchParams(window.location.search).get('space');
}

export default function App() {
  const [spaces, setSpaces] = useState<WorldSpace[]>([]);
  const [spacesError, setSpacesError] = useState<string | null>(null);
  const world = useWorldSocket(requestedSpace());
  const {
    authed, connected, error, scene, actors, opened, browse,
    enterSpace, openThing, closeThing, browseFolder, setNote, move, refresh,
  } = world;

  // Independent of `opened`/the side panel — a book and the panel can be open
  // at once, mirroring how the furniture tree and the data tree are kept
  // separate everywhere else in this feature.
  const [openBook, setOpenBook] = useState<{ folderId: number; label: string } | null>(null);

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
    // Ask the server to resolve it fresh rather than reusing the scene copy, so
    // the panel shows current contents and the actor's presence marks them here.
    openThing(thing.id);
  }

  function openBookModal(book: ResolvedBook) {
    setOpenBook({ folderId: book.id, label: book.label });
  }

  if (!authed) {
    return (
      <div className="shell shell--empty">
        <h1>AS500 · Virtual Office</h1>
        <p>{error ?? 'No AS500 access token found.'}</p>
        <p className="hint">
          Sign in to the terminal at <code>/</code> first — the office reuses that
          session — or open this page with <code>?token=…</code>.
        </p>
      </div>
    );
  }

  return (
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
          <Floorplan
            things={scene.things}
            actors={actors}
            selectedId={selected?.id ?? null}
            onSelect={select}
            onOpenBook={openBookModal}
            onMove={move}
          />
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
  );
}
