/**
 * One piece of furniture, in 3D — the mirror of `Floorplan.tsx`'s
 * `ThingShape`/`BookSpines`. Same access-state → color mapping, same book
 * spine layout math, ported rather than reinvented.
 *
 * Every raycastable mesh tags `userData` so `InteractionHUD`'s forward
 * raycast (from camera center, not the mouse pointer — the pointer is
 * locked/hidden in first person) can tell a thing's body from one of its
 * book spines.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import { Billboard, Text } from '@react-three/drei';
import type { Placed } from '../layout';
import type { ResolvedBook, ResolvedThing } from '../types';
import { ACCESS_COLOR, BOOK_COLOR, BOOK_OVERFLOW_COLOR, EDGE_COLOR, NOTE_COLOR, SELECTED_EMISSIVE } from './colors';
import { heightFor, MODEL_FOR_TYPE } from './heights';

interface Props {
  placed: Placed;
  selected: boolean;
  onSelect: (thing: ResolvedThing) => void;
  onOpenBook: (book: ResolvedBook) => void;
}

function accessKey(thing: ResolvedThing): keyof typeof ACCESS_COLOR {
  if (thing.access === 'denied') return 'denied';
  if (thing.access === 'error') return 'error';
  if (thing.access === 'unbound') return 'unbound';
  return thing.contents ? 'ok_bound' : 'ok_open';
}

export default function ThingMesh({ placed, selected, onSelect, onOpenBook }: Props) {
  const { thing, x, y, w, h } = placed;
  const height = heightFor(thing.type);
  const isNote = thing.type === 'postit' || thing.type === 'board';
  const hasSpines = thing.type === 'bookshelf' && thing.books !== null && thing.books.length > 0;

  const color = useMemo(() => {
    if (isNote) return NOTE_COLOR[thing.note?.color ?? 'yellow'];
    return ACCESS_COLOR[accessKey(thing)];
  }, [thing, isNote]);

  // Model swap seam — a real model per type is a later increment (primitives
  // now, per the plan). Reserved so that future work touches this lookup,
  // not this component's structure.
  const modelUrl = MODEL_FOR_TYPE[thing.type];
  void modelUrl; // unused until a model pipeline exists

  const cx = x + w / 2;
  const cz = y + h / 2;

  const label = isNote ? (thing.note?.body || '(empty)') : thing.label;
  const labelText = label.length > 40 ? `${label.slice(0, 39)}…` : label;

  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(w, height, h)), [w, height, h]);

  return (
    <group>
      <mesh
        position={[cx, height / 2, cz]}
        userData={{ thingId: thing.id }}
        onClick={(e) => { e.stopPropagation(); onSelect(thing); }}
      >
        <boxGeometry args={[w, height, h]} />
        <meshStandardMaterial
          color={color}
          emissive={selected ? SELECTED_EMISSIVE : undefined}
          emissiveIntensity={selected ? 0.35 : 0}
        />
        <lineSegments geometry={edges}>
          <lineBasicMaterial color={EDGE_COLOR} />
        </lineSegments>
      </mesh>

      <Billboard position={[cx, height + 0.3, cz]}>
        <Text fontSize={0.32} color="#1c2128" anchorX="center" anchorY="bottom" maxWidth={Math.max(w, 2)}>
          {labelText}
        </Text>
      </Billboard>

      {hasSpines && (
        <BookSpines thing={thing} x={x} y={y} w={w} h={h} height={height} onOpenBook={onOpenBook} />
      )}
    </group>
  );
}

const MAX_SPINES = 8;
const MIN_SPINE_WIDTH = 0.28;
const SPINE_GAP = 0.06;

/** Ported from `Floorplan.tsx`'s `BookSpines` — identical layout math, 3D boxes instead of SVG rects. */
function BookSpines({
  thing, x, y, w, h, height, onOpenBook,
}: {
  thing: ResolvedThing; x: number; y: number; w: number; h: number; height: number;
  onOpenBook: (book: ResolvedBook) => void;
}) {
  const books = thing.books ?? [];
  const overflow = books.length > MAX_SPINES;
  const shown = overflow ? books.slice(0, MAX_SPINES) : books;
  const slots = shown.length + (overflow ? 1 : 0);

  const PAD = 0.18;
  const innerWidth = w - PAD * 2;
  const spineWidth = Math.max(MIN_SPINE_WIDTH, (innerWidth - SPINE_GAP * (slots - 1)) / slots);
  const spineDepth = Math.min(h - 0.3, 0.4);
  const spineHeight = Math.min(height - 0.3, 1.2);

  let cursorX = x + PAD + spineWidth / 2;
  const spineY = spineHeight / 2 + 0.1;
  const spineZ = y + h - spineDepth / 2 - 0.1;

  return (
    <group>
      {shown.map((book) => {
        const pos: [number, number, number] = [cursorX, spineY, spineZ];
        cursorX += spineWidth + SPINE_GAP;
        return (
          <mesh
            key={book.id}
            position={pos}
            userData={{ bookId: book.id }}
            onClick={(e) => { e.stopPropagation(); onOpenBook(book); }}
          >
            <boxGeometry args={[spineWidth, spineHeight, spineDepth]} />
            <meshStandardMaterial color={BOOK_COLOR} />
          </mesh>
        );
      })}
      {overflow && (
        <mesh position={[cursorX, spineY, spineZ]}>
          <boxGeometry args={[spineWidth, spineHeight, spineDepth]} />
          <meshStandardMaterial color={BOOK_OVERFLOW_COLOR} />
        </mesh>
      )}
    </group>
  );
}
