/**
 * Top-down furniture detail for themes that draw symbols (Garage).
 *
 * Drawn in the object's own unrotated footprint — `(0,0)` to `(fw,fh)` room
 * units, front edge at the bottom — so the caller rotates the group. The object's
 * outline and fill still come from the `<rect>` the floorplan already draws;
 * this only adds what makes a desk read as a desk. Colours are theme variables
 * (`--w-sym-*`), never literals.
 */

import type { CSSProperties } from 'react';
import type { ResolvedThing } from '../types';
import { worldApiUrl } from '../useWorldSocket';

const v = (name: string) => `var(--w-sym-${name})`;
const fill = (name: string, stroke?: string, sw = 0.03): CSSProperties => ({
  fill: v(name),
  ...(stroke ? { stroke: v(stroke), strokeWidth: sw } : {}),
});

interface Props {
  thing: ResolvedThing;
  fw: number;
  fh: number;
}

export default function FurnitureSymbol({ thing, fw, fh }: Props) {
  switch (thing.type) {
    case 'desk':
      return (
        <g className="sym">
          <rect x={fw / 2 - 0.67} y={0.21} width={1.33} height={0.19} style={fill('ink')} />
          <rect x={fw / 2 - 0.5} y={0.58} width={1} height={0.29} style={fill('tile', 'line', 0.02)} />
          <rect x={fw / 2 + 0.7} y={0.62} width={0.25} height={0.33} rx={0.12} style={fill('tile', 'line', 0.02)} />
          <circle cx={fw / 2} cy={fh + 0.4} r={0.35} style={fill('steel', 'ink', 0.05)} />
        </g>
      );
    case 'workstation':
      return (
        <g className="sym">
          <rect x={0.21} y={0.17} width={fw - 0.42} height={0.19} style={fill('ink')} />
          <rect x={0.25} y={0.54} width={fw - 0.5} height={0.12} style={fill('tile', 'line', 0.02)} />
          <rect x={0.25} y={0.8} width={fw - 0.5} height={0.12} style={fill('tile', 'line', 0.02)} />
        </g>
      );
    case 'box': {
      // The box is open: its first four things sit inside, as their sprites.
      const items = (thing.contents?.preview ?? []).slice(0, 4);
      const inner = { x: 0.17, y: 0.17, w: fw - 0.34, h: fh - 0.34 };
      const cell = (inner.w - 0.1) / 2;
      return (
        <g className="sym">
          <rect x={inner.x} y={inner.y} width={inner.w} height={inner.h} style={fill('tile', 'ink', 0.03)} />
          {[0, 1, 2, 3].map((i) => {
            const cx = inner.x + 0.04 + (i % 2) * (cell + 0.02);
            const cy = inner.y + 0.04 + Math.floor(i / 2) * (cell + 0.02);
            const item = items[i];
            if (!item) return null;
            const src = item.image ? worldApiUrl(item.image) : null;
            return src ? (
              <image key={i} href={src} x={cx} y={cy} width={cell} height={cell} preserveAspectRatio="xMidYMid meet" />
            ) : (
              <rect key={i} x={cx + 0.04} y={cy + 0.04} width={cell - 0.08} height={cell - 0.08} rx={0.03} style={fill('steel-light', 'ink', 0.02)} />
            );
          })}
        </g>
      );
    }
    case 'shelf':
      return (
        <g className="sym">
          {[1, 2, 3].map((i) => <rect key={i} x={(fw * i) / 4 - 0.02} y={0} width={0.04} height={fh} style={fill('ink')} />)}
          <rect x={fw / 4 + 0.2} y={0.2} width={0.54} height={0.46} style={fill('enamel-light', 'ink', 0.04)} />
          <circle cx={(fw * 3) / 4 + 0.46} cy={0.42} r={0.24} style={fill('steel-light', 'ink', 0.04)} />
        </g>
      );
    case 'bookshelf':
      // Spines are interactive and drawn by BookSpines; this is only the shelf divider.
      return (
        <g className="sym">
          <rect x={0} y={fh / 2 - 0.02} width={fw} height={0.04} style={fill('ink')} />
        </g>
      );
    case 'rack': {
      const rows = 8;
      const rowH = (fh - 0.4) / rows;
      return (
        <g className="sym">
          {Array.from({ length: rows }, (_, i) => (
            <g key={i}>
              <rect x={0.2} y={0.2 + i * rowH} width={fw - 0.4} height={rowH - 0.05} style={fill('ink-2', 'ink-line', 0.02)} />
              <circle cx={fw - 0.42} cy={0.2 + i * rowH + (rowH - 0.05) / 2} r={0.05} style={fill(i === 5 ? 'caution' : 'go')} />
            </g>
          ))}
        </g>
      );
    }
    case 'postit':
      return (
        <g className="sym">
          {[0.26, 0.42, 0.58].map((y, i) => (
            <rect key={y} x={0.17} y={y} width={fw - 0.34 - i * 0.12} height={0.04} style={fill('steel-light')} />
          ))}
        </g>
      );
    case 'plant':
      return (
        <g className="sym">
          <circle cx={fw / 2} cy={fh / 2} r={fw / 2 - 0.03} style={fill('enamel-light', 'ink', 0.05)} />
          <circle cx={fw / 2} cy={fh / 2} r={fw * 0.22} style={fill('enamel', 'ink', 0.04)} />
        </g>
      );
    case 'door':
      // The leaf swung open, hinged at the left end.
      return (
        <g className="sym">
          <rect x={0.12} y={-fh * 0.5} width={0.08} height={fh * 2} style={fill('ink')} />
        </g>
      );
    default:
      return null;
  }
}
