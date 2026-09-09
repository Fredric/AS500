/**
 * Top-down floorplan.
 *
 * Deliberately plain SVG. This view's long life is as the debug and admin tool
 * for the world — the same role the ingest monitor plays for the RAG stack —
 * so it favours showing what is actually in the model over looking like a room.
 * The 3D renderer swaps in against the same protocol.
 */

import type { Presence, ResolvedThing } from '../types';
import { layoutThings, ROOM_H, ROOM_W, type Placed } from '../layout';

interface Props {
  things: ResolvedThing[];
  actors: Presence[];
  selectedId: number | null;
  onSelect: (thing: ResolvedThing) => void;
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

export default function Floorplan({ things, actors, selectedId, onSelect, onMove }: Props) {
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
          <path d="M 1 0 L 0 0 0 1" fill="none" stroke="rgba(51,255,51,0.08)" strokeWidth="0.02" />
        </pattern>
      </defs>

      <rect x="0" y="0" width={ROOM_W} height={ROOM_H} fill="url(#grid)" />
      <rect
        x="0.1" y="0.1" width={ROOM_W - 0.2} height={ROOM_H - 0.2}
        fill="none" stroke="rgba(51,255,51,0.35)" strokeWidth="0.08"
      />

      {placed.map((p) => (
        <ThingShape
          key={p.thing.id}
          placed={p}
          selected={p.thing.id === selectedId}
          onSelect={onSelect}
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
}: {
  placed: Placed;
  selected: boolean;
  onSelect: (t: ResolvedThing) => void;
}) {
  const { thing, x, y, w, h } = placed;
  const mark = badge(thing);

  const PAD = 0.18;
  const badgeWidth = mark ? mark.length * 0.34 * ADVANCE + 0.22 : 0;
  const label = fit(thing.label, w - PAD * 2, 0.42, 0.26);
  const type = fit(thing.type, w - PAD * 2 - badgeWidth, 0.32, 0.2);

  return (
    <g
      className={`thing ${accessClass(thing)} ${selected ? 'thing--selected' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(thing);
      }}
    >
      <rect x={x} y={y} width={w} height={h} rx="0.15" />
      <title>{`${thing.label} — ${thing.type}${thing.reason ? ` — ${thing.reason}` : ''}`}</title>
      <text x={x + PAD} y={y + 0.58} className="thing__label" fontSize={label.fontSize}>
        {label.text}
      </text>
      <text x={x + PAD} y={y + h - 0.22} className="thing__type" fontSize={type.fontSize}>
        {type.text}
      </text>
      {mark && (
        <text x={x + w - PAD} y={y + h - 0.22} textAnchor="end" className="thing__badge">
          {mark}
        </text>
      )}
    </g>
  );
}
