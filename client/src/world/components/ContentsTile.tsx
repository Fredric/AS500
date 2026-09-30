/**
 * One record inside an object's contents: its sprite when the bound config
 * supplied an image, otherwise a small glyph for its kind. The server decides
 * which (`WorldConfig.item`); this only draws it.
 */

import type { ResolvedContents } from '../types';
import { worldApiUrl } from '../useWorldSocket';

type Row = ResolvedContents['preview'][number];

const GLYPH: Record<string, string> = {
  thing: '◈',
  book: '📕',
  file: '📄',
  folder: '📁',
  bike: '🏍',
  generic: '▫',
};

export function ContentsTile({ row }: { row: Row }) {
  const src = row.image ? worldApiUrl(row.image) : null;
  return (
    <li className={`tile${row.tone ? ` tile--${row.tone}` : ''}`} title={row.label}>
      <span className="tile__art">
        {src ? <img src={src} alt="" loading="lazy" /> : <span className="tile__glyph">{GLYPH[row.icon ?? 'generic'] ?? GLYPH.generic}</span>}
      </span>
      <span className="tile__label">{row.label}</span>
    </li>
  );
}
