/**
 * Top-down floorplan.
 *
 * Deliberately plain SVG. This view's long life is as the debug and admin tool
 * for the world — the same role the ingest monitor plays for the RAG stack —
 * so it favours showing what is actually in the model over looking like a room.
 * The 3D renderer swaps in against the same protocol.
 */

import type { Presence, ResolvedBook, ResolvedThing } from '../types';
import { layoutThings, ROOM_H, ROOM_W, type Placed } from '../layout';

interface Props {
  things: ResolvedThing[];
  actors: Presence[];
  selectedId: number | null;
  onSelect: (thing: ResolvedThing) => void;
  /** A book spine was clicked directly on a bookshelf. */
  onOpenBook: (book: ResolvedBook) => void;
  /** A door was clicked directly on its shape. */
  onEnterDoor: (spaceKey: string) => void;
  onMove: (pose: { x: number; y: number; rot: number }) => void;
}

/** Access state drives the outline, so a locked cabinet reads at a glance. */
function accessClass(thing: ResolvedThing): string {
  switch (thing.access) {
    case 'ok':      return thing.contents ? 'thing--bound' : 'thing--open';
    case 'denied':  return 'thing--denied';
    case 'error':   return 'thing--error';
    default:        return 'thing--unbound';
  }
}

function badge(thing: ResolvedThing): string {
  if (thing.access === 'denied') return 'locked';
  if (thing.access === 'error') return '!';
  if (thing.contents) return String(thing.contents.count);
  if (thing.children.length) return `${thing.children.length}`;
  return '';
}

export default function Floorplan({ things, actors, selectedId, onSelect, onOpenBook, onEnterDoor, onMove }: Props) {
  const placed = layoutThings(things);

  // Click on empty floor walks there. Positions are relayed to other viewers but
  // never stored — the server owns containment, not motion.
  function handleFloorClick(e: React.MouseEvent<SVGSVGElement>) {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * ROOM_W;
    const y = ((e.clientY - rect.top) / rect.height) * ROOM_H;
    onMove({ x, y, rot: 0 });
  }

  return (
    <svg
      className="floorplan"
      viewBox={`0 0 ${ROOM_W} ${ROOM_H}`}
      preserveAspectRatio="xMidYMid meet"
      onClick={handleFloorClick}
      role="img"
      aria-label="Office floorplan"
    >
      <defs>
        <pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse">
          <path d="M 1 0 L 0 0 0 1" fill="none" className="floorplan__grid-line" strokeWidth="0.02" />
        </pattern>
      </defs>

      <rect x="0" y="0" width={ROOM_W} height={ROOM_H} fill="url(#grid)" />
      <rect
        x="0.1" y="0.1" width={ROOM_W - 0.2} height={ROOM_H - 0.2}
        fill="none" className="floorplan__border" strokeWidth="0.08"
      />

      {placed.map((p) => (
        <ThingShape
          key={p.thing.id}
          placed={p}
          selected={p.thing.id === selectedId}
          onSelect={onSelect}
          onOpenBook={onOpenBook}
          onEnterDoor={onEnterDoor}
        />
      ))}

      {actors.map((a) => (
        <g key={`${a.actorId}-${a.since}`} className={`avatar avatar--${a.kind}`}>
          <circle cx={a.pose.x} cy={a.pose.y} r="0.42" />
          <text x={a.pose.x} y={a.pose.y - 0.7} textAnchor="middle" className="avatar__name">
            {a.username}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Monospace advance as a fraction of font size, measured against the rendered face. */
const ADVANCE = 0.6;

/**
 * Fit text to a box.
 *
 * SVG has no wrapping and these boxes are a couple of room units wide, so long
 * names overflow their furniture. Shrinking the text keeps the name readable
 * where truncating it ("Admin Cabinet" → "Admin…") destroys the one piece of
 * information the object carries. Truncation is the last resort, once the type
 * is already at its minimum legible size.
 */
function fit(
  value: string,
  widthUnits: number,
  preferred: number,
  minimum: number,
): { text: string; fontSize: number } {
  if (widthUnits <= 0 || value.length === 0) return { text: '', fontSize: preferred };

  const needed = (widthUnits / value.length) / ADVANCE;
  const fontSize = Math.max(minimum, Math.min(preferred, needed));

  const max = Math.floor(widthUnits / (fontSize * ADVANCE));
  if (max <= 1) return { text: '', fontSize };
  return {
    text: value.length > max ? `${value.slice(0, max - 1)}…` : value,
    fontSize,
  };
}

function ThingShape({
  placed,
  selected,
  onSelect,
  onOpenBook,
  onEnterDoor,
}: {
  placed: Placed;
  selected: boolean;
  onSelect: (t: ResolvedThing) => void;
  onOpenBook: (book: ResolvedBook) => void;
  onEnterDoor: (spaceKey: string) => void;
}) {
  const { thing, x, y, w, h } = placed;
  const mark = badge(thing);
  const hasSpines = thing.type === 'bookshelf' && thing.books !== null && thing.books.length > 0;
  const isNote = thing.type === 'postit' || thing.type === 'board';
  const noteClass = isNote ? ` note note--${thing.note?.color ?? 'yellow'}` : '';
  const isDoor = thing.type === 'door' && thing.door !== null;
  const doorClass = isDoor ? ' thing--door' : '';

  const PAD = 0.18;
  const badgeWidth = mark ? mark.length * 0.34 * ADVANCE + 0.22 : 0;
  const label = fit(thing.label, w - PAD * 2, 0.42, 0.26);
  const type = fit(thing.type, w - PAD * 2 - badgeWidth, 0.32, 0.2);
  // A note's own text is the point of the object — shown right on the
  // floorplan, same "primary interaction lives on the shape" precedent the
  // bookshelf's spines set, in place of the generic type line.
  const noteBody = isNote
    ? fit(thing.note?.body || '(empty)', w - PAD * 2, 0.3, 0.2)
    : null;
  // The destination is the point of a door — shown in place of the generic
  // type line, same "primary interaction lives on the shape" precedent notes
  // and book spines already set.
  const doorLabel = isDoor ? fit(`→ ${thing.door!.spaceName}`, w - PAD * 2, 0.3, 0.2) : null;

  return (
    <g
      className={`thing ${accessClass(thing)}${noteClass}${doorClass} ${selected ? 'thing--selected' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        // A door's primary interaction is walking through it directly, not
        // opening the side panel — the panel is still reachable as a
        // fallback (it has its own "Go through" button) the same way a
        // bookshelf's panel is a fallback for its spines.
        if (isDoor) onEnterDoor(thing.door!.spaceKey);
        else onSelect(thing);
      }}
    >
      <rect x={x} y={y} width={w} height={h} rx="0.15" />
      <title>{`${thing.label} — ${thing.type}${thing.reason ? ` — ${thing.reason}` : ''}`}</title>
      <text x={x + PAD} y={y + 0.58} className="thing__label" fontSize={label.fontSize}>
        {label.text}
      </text>
      {doorLabel ? (
        <text x={x + PAD} y={y + h - 0.22} className="thing__door-label" fontSize={doorLabel.fontSize}>
          {doorLabel.text}
        </text>
      ) : noteBody ? (
        <text x={x + PAD} y={y + h - 0.22} className="thing__note-body" fontSize={noteBody.fontSize}>
          {noteBody.text}
        </text>
      ) : (
        <text x={x + PAD} y={y + h - 0.22} className="thing__type" fontSize={type.fontSize}>
          {type.text}
        </text>
      )}
      {mark && (
        <text x={x + w - PAD} y={y + h - 0.22} textAnchor="end" className="thing__badge">
          {mark}
        </text>
      )}
      {hasSpines && (
        <BookSpines
          books={thing.books as ResolvedBook[]}
          x={x} y={y} w={w} h={h}
          onOpenBook={onOpenBook}
          onOverflow={() => onSelect(thing)}
        />
      )}
    </g>
  );
}

/** Book spines rendered too small or too numerous to click individually. */
const MAX_SPINES = 8;
/** Below this, a spine stops being a reliable click target. */
const MIN_SPINE_WIDTH = 0.28;
const SPINE_GAP = 0.06;

/**
 * The primary way into a bookshelf's books: one clickable spine per subfolder,
 * drawn directly on the floorplan shape. Capped at {@link MAX_SPINES} with a
 * trailing "+N" tab that opens the side panel instead — where the full list
 * always renders regardless of count (`ThingPanel`'s "Books" section) — so a
 * shelf with many subfolders stays usable rather than drawing slivers no one
 * can reliably click.
 */
function BookSpines({
  books,
  x, y, w, h,
  onOpenBook,
  onOverflow,
}: {
  books: ResolvedBook[];
  x: number; y: number; w: number; h: number;
  onOpenBook: (book: ResolvedBook) => void;
  onOverflow: () => void;
}) {
  const overflow = books.length > MAX_SPINES;
  const shown = overflow ? books.slice(0, MAX_SPINES) : books;
  const slots = shown.length + (overflow ? 1 : 0);

  const PAD = 0.18;
  const innerWidth = w - PAD * 2;
  const spineWidth = Math.max(MIN_SPINE_WIDTH, (innerWidth - SPINE_GAP * (slots - 1)) / slots);

  const top = y + 0.85;
  const bottom = y + h - 0.55;
  const spineHeight = Math.max(0.4, bottom - top);

  let cursorX = x + PAD;

  return (
    <>
      {shown.map((book) => {
        const spineX = cursorX;
        cursorX += spineWidth + SPINE_GAP;
        return (
          <g
            key={book.id}
            className="book-spine"
            onClick={(e) => {
              e.stopPropagation();
              onOpenBook(book);
            }}
          >
            <rect x={spineX} y={top} width={spineWidth} height={spineHeight} rx="0.03" />
            <title>{book.label}</title>
          </g>
        );
      })}
      {overflow && (
        <g
          className="book-spine book-spine--overflow"
          onClick={(e) => {
            e.stopPropagation();
            onOverflow();
          }}
        >
          <rect x={cursorX} y={top} width={spineWidth} height={spineHeight} rx="0.03" />
          <title>{`${books.length - shown.length} more — click to see all in the panel`}</title>
          <text
            x={cursorX + spineWidth / 2}
            y={top + spineHeight / 2 + 0.08}
            textAnchor="middle"
            className="book-spine__overflow-label"
          >
            +{books.length - shown.length}
          </text>
        </g>
      )}
    </>
  );
}
