/**
 * Top-down floorplan.
 *
 * Deliberately plain SVG. This view's long life is as the debug and admin tool
 * for the world — the same role the ingest monitor plays for the RAG stack —
 * so it favours showing what is actually in the model over looking like a room.
 * The 3D renderer swaps in against the same protocol.
 */

import { useEffect, useRef, useState } from 'react';
import type { Presence, ResolvedBook, ResolvedThing } from '../types';
import { layoutThings, quarterTurn, ROOM_H, ROOM_W, type Placed } from '../layout';
import { worldApiUrl } from '../useWorldSocket';
import FurnitureSymbol from './FurnitureSymbol';

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
  /** A piece of furniture was dragged to a new spot; persisted as its transform. */
  onMoveThing: (thingId: number, x: number, y: number, rot?: number) => void;
  /** The active theme draws furniture symbols and label tags rather than plain boxes. */
  symbols?: boolean;
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

/** Pointer travel (room units) before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD = 0.15;
/** How long an optimistic position is kept if the server never confirms it. */
const PENDING_MS = 2500;

interface DragState {
  id: number;
  /** Offset from the shape's corner to where it was grabbed. */
  offX: number;
  offY: number;
  startX: number;
  startY: number;
  w: number;
  h: number;
  moved: boolean;
}

export default function Floorplan({ things, actors, selectedId, onSelect, onOpenBook, onEnterDoor, onMove, onMoveThing, symbols = false }: Props) {
  // Positions shown while a drag is in flight, and until the server's scene
  // echoes the saved transform back — so a dropped box never flickers home.
  const [override, setOverride] = useState<Map<number, { x: number; y: number; rot?: number; w?: number; h?: number }>>(new Map());
  const drag = useRef<DragState | null>(null);
  const justDragged = useRef(false);

  const placed = layoutThings(things).map((p) => {
    const o = override.get(p.thing.id);
    return o ? { ...p, x: o.x, y: o.y, rot: o.rot !== undefined ? quarterTurn(o.rot) : p.rot, w: o.w ?? p.w, h: o.h ?? p.h } : p;
  });

  // Drop an optimistic position once the scene agrees with it.
  useEffect(() => {
    setOverride((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      for (const [id, pos] of prev) {
        const t = things.find((th) => th.id === id);
        if (
          t?.transform &&
          Math.abs(t.transform.x - pos.x) < 0.05 &&
          Math.abs(t.transform.y - pos.y) < 0.05 &&
          (pos.rot === undefined || quarterTurn(t.transform.rot) === quarterTurn(pos.rot))
        ) {
          next.delete(id);
        }
      }
      return next.size === prev.size ? prev : next;
    });
  }, [things]);

  function toRoom(svg: SVGSVGElement, clientX: number, clientY: number) {
    const rect = svg.getBoundingClientRect();
    // preserveAspectRatio="meet" letterboxes, so use the scale of the tighter axis.
    const scale = Math.min(rect.width / ROOM_W, rect.height / ROOM_H);
    const left = rect.left + (rect.width - ROOM_W * scale) / 2;
    const top = rect.top + (rect.height - ROOM_H * scale) / 2;
    return { x: (clientX - left) / scale, y: (clientY - top) / scale };
  }

  function handleShapeDown(e: React.PointerEvent<SVGGElement>, p: Placed) {
    if (e.button !== 0) return;
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    const at = toRoom(svg, e.clientX, e.clientY);
    drag.current = {
      id: p.thing.id, offX: at.x - p.x, offY: at.y - p.y,
      startX: at.x, startY: at.y, w: p.w, h: p.h, moved: false,
    };
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d) return;
    const at = toRoom(e.currentTarget, e.clientX, e.clientY);
    if (!d.moved) {
      if (Math.hypot(at.x - d.startX, at.y - d.startY) < DRAG_THRESHOLD) return;
      d.moved = true;
      // Only capture once it is really a drag, or a plain click on a book
      // spine would be retargeted away from the spine.
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const x = Math.max(0, Math.min(ROOM_W - d.w, at.x - d.offX));
    const y = Math.max(0, Math.min(ROOM_H - d.h, at.y - d.offY));
    setOverride((prev) => new Map(prev).set(d.id, { x, y }));
  }

  function handlePointerUp(e: React.PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.moved) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);

    // The click that follows a drag must not select the box or walk the avatar.
    justDragged.current = true;
    setTimeout(() => { justDragged.current = false; }, 0);

    const at = toRoom(e.currentTarget, e.clientX, e.clientY);
    const x = Math.round(Math.max(0, Math.min(ROOM_W - d.w, at.x - d.offX)) * 10) / 10;
    const y = Math.round(Math.max(0, Math.min(ROOM_H - d.h, at.y - d.offY)) * 10) / 10;
    const cur = placed.find((q) => q.thing.id === d.id);
    setOverride((prev) => new Map(prev).set(d.id, { x, y, rot: cur?.rot }));
    onMoveThing(d.id, x, y, cur?.rot);
    // If the server refuses (no write permission) the scene never changes, so
    // let the box fall back to where it really is.
    setTimeout(() => {
      setOverride((prev) => {
        if (!prev.has(d.id)) return prev;
        const next = new Map(prev);
        next.delete(d.id);
        return next;
      });
    }, PENDING_MS);
  }

  // Quarter-turn clockwise about the shape's centre, then save (x/y/rot together,
  // so an auto-placed object is pinned where it is being turned).
  function handleRotate(p: Placed) {
    const rot = quarterTurn(p.rot + 90);
    const w = p.h;
    const h = p.w;
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    const x = Math.round(Math.max(0, Math.min(ROOM_W - w, cx - w / 2)) * 10) / 10;
    const y = Math.round(Math.max(0, Math.min(ROOM_H - h, cy - h / 2)) * 10) / 10;
    setOverride((prev) => new Map(prev).set(p.thing.id, { x, y, rot, w, h }));
    onMoveThing(p.thing.id, x, y, rot);
    setTimeout(() => {
      setOverride((prev) => {
        if (!prev.has(p.thing.id)) return prev;
        const next = new Map(prev);
        next.delete(p.thing.id);
        return next;
      });
    }, PENDING_MS);
  }

  // Click on empty floor walks there. Positions are relayed to other viewers but
  // never stored — the server owns containment, not motion.
  function handleFloorClick(e: React.MouseEvent<SVGSVGElement>) {
    if (justDragged.current) return;
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
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
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
          onPointerDown={handleShapeDown}
          onRotate={handleRotate}
          justDragged={justDragged}
          symbols={symbols}
        />
      ))}

      {actors.map((a) => (
        <g key={`${a.actorId}-${a.since}`} className={`avatar avatar--${a.kind}`}>
          <circle cx={a.pose.x} cy={a.pose.y} r="0.42" />
          <text x={a.pose.x} y={a.pose.y - 0.7} textAnchor="middle" className="avatar__name">
            {a.kind === 'mobile' ? `${a.username} (phone)` : a.username}
          </text>
          {a.kind === 'mobile' && a.status ? (
            <text x={a.pose.x} y={a.pose.y + 0.95} textAnchor="middle" className="avatar__status">
              {a.status}
            </text>
          ) : null}
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
  onPointerDown,
  onRotate,
  justDragged,
  symbols,
}: {
  placed: Placed;
  symbols: boolean;
  onRotate: (p: Placed) => void;
  onPointerDown: (e: React.PointerEvent<SVGGElement>, p: Placed) => void;
  justDragged: React.MutableRefObject<boolean>;
  selected: boolean;
  onSelect: (t: ResolvedThing) => void;
  onOpenBook: (book: ResolvedBook) => void;
  onEnterDoor: (spaceKey: string) => void;
}) {
  const { thing, x, y, w, h, rot } = placed;
  // The unrotated footprint: a quarter turn swapped w and h in the layout.
  const [fw, fh] = rot === 90 || rot === 270 ? [h, w] : [w, h];
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

  const spriteUrl = thing.sprite ? worldApiUrl(thing.sprite.url) : null;

  return (
    <g
      className={`thing thing--type-${thing.type} ${accessClass(thing)}${noteClass}${doorClass} ${selected ? 'thing--selected' : ''}`}
      onPointerDown={(e) => onPointerDown(e, placed)}
      onClick={(e) => {
        e.stopPropagation();
        if (justDragged.current) return;
        if (isDoor) onEnterDoor(thing.door!.spaceKey);
        else onSelect(thing);
      }}
    >
      <rect x={x} y={y} width={w} height={h} rx="0.15" />
      {symbols && (
        <g transform={`translate(${x + w / 2} ${y + h / 2}) rotate(${rot}) translate(${-fw / 2} ${-fh / 2})`} pointerEvents="none">
          <FurnitureSymbol thing={thing} fw={fw} fh={fh} />
        </g>
      )}
      {spriteUrl && (
        <image
          href={spriteUrl}
          x={x + 0.08}
          y={y + 0.08}
          width={w - 0.16}
          height={h - 0.16}
          preserveAspectRatio="xMidYMid meet"
        />
      )}
      <title>{`${thing.label} — ${thing.type}${thing.reason ? ` — ${thing.reason}` : ''}`}</title>
      {symbols ? (
        <>
          <LabelTag x={x} y={y} text={isDoor ? `→ ${thing.door!.spaceName}` : thing.label} count={mark} />
          {noteBody && (
            <text x={x + PAD} y={y + 0.42} className="thing__note-body" fontSize={noteBody.fontSize}>
              {noteBody.text}
            </text>
          )}
        </>
      ) : (
        <>
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
        </>
      )}
      {hasSpines && (
        <BookSpines
          books={thing.books as ResolvedBook[]}
          x={x} y={y} w={w} h={h}
          onOpenBook={onOpenBook}
          onOverflow={() => onSelect(thing)}
        />
      )}
      <FrontMarker x={x} y={y} w={w} h={h} rot={rot} />
      {selected && (
        <g
          className="rotate-handle"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRotate(placed);
          }}
        >
          <title>Rotate 90°</title>
          <circle cx={x + w} cy={y} r="0.3" />
          <text x={x + w} y={y + 0.13} textAnchor="middle" fontSize="0.42">↻</text>
        </g>
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

/**
 * The "front" of an object: a bar along the side that faces out, with a small
 * arrowhead pointing the way it looks. rot 0 faces south (down the plan) and
 * each quarter turn is clockwise, so south → west → north → east.
 */
function FrontMarker({ x, y, w, h, rot }: { x: number; y: number; w: number; h: number; rot: number }) {
  const T = 0.11; // bar thickness
  const INSET = 0.22;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const A = 0.16; // arrowhead half-width / height
  let bar: { x: number; y: number; w: number; h: number };
  let head: string;
  switch (rot) {
    case 90: // faces west
      bar = { x, y: y + INSET, w: T, h: h - INSET * 2 };
      head = `${x + T + A},${cy - A} ${x + T},${cy} ${x + T + A},${cy + A}`;
      break;
    case 180: // faces north
      bar = { x: x + INSET, y, w: w - INSET * 2, h: T };
      head = `${cx - A},${y + T + A} ${cx},${y + T} ${cx + A},${y + T + A}`;
      break;
    case 270: // faces east
      bar = { x: x + w - T, y: y + INSET, w: T, h: h - INSET * 2 };
      head = `${x + w - T - A},${cy - A} ${x + w - T},${cy} ${x + w - T - A},${cy + A}`;
      break;
    default: // faces south
      bar = { x: x + INSET, y: y + h - T, w: w - INSET * 2, h: T };
      head = `${cx - A},${y + h - T - A} ${cx},${y + h - T} ${cx + A},${y + h - T - A}`;
  }
  return (
    <g className="thing__front" pointerEvents="none">
      <rect x={bar.x} y={bar.y} width={bar.w} height={bar.h} rx="0.04" />
      <polyline points={head} fill="none" strokeWidth="0.05" />
    </g>
  );
}

/**
 * An inventory-style name tag above an object: white, hairline border, the name
 * in the display face and the count in mono. Sized by character count — SVG
 * cannot measure text before it is drawn, and the tag only needs to be close.
 */
function LabelTag({ x, y, text, count }: { x: number; y: number; text: string; count: string }) {
  const FS = 0.3;
  const H = 0.36;
  const name = text.length > 26 ? `${text.slice(0, 25)}…` : text;
  const nameW = name.length * FS * 0.5 + 0.26;
  const countFs = 0.24;
  const countW = count ? count.length * countFs * 0.62 + 0.22 : 0;
  const ty = Math.max(0.06, y - H - 0.12);
  return (
    <g className="label-tag" pointerEvents="none">
      <rect x={x} y={ty} width={nameW} height={H} rx={0.04} />
      <text x={x + 0.13} y={ty + H / 2} dominantBaseline="central" fontSize={FS} className="label-tag__name">{name}</text>
      {count && (
        <>
          <rect x={x + nameW + 0.06} y={ty} width={countW} height={H} rx={0.04} />
          <text x={x + nameW + 0.06 + countW / 2} y={ty + H / 2} textAnchor="middle" dominantBaseline="central" fontSize={countFs} className="label-tag__count">
            {count}
          </text>
        </>
      )}
    </g>
  );
}
