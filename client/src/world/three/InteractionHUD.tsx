/**
 * The interaction *logic* — a forward raycast from camera center each frame
 * (not the mouse pointer, which is locked/hidden in first person) finds the
 * nearest interactable thing within reach, and E triggers the *same*
 * callbacks `Floorplan.tsx`'s click handler already uses (`onSelect`/
 * `onOpenBook`) — a new input trigger for an existing interaction, not a new
 * one.
 *
 * This component lives *inside* the R3F `<Canvas>` (it needs `useThree`/
 * `useFrame`) and renders nothing itself — a `<Canvas>` can only contain
 * three.js scene objects, not DOM. The crosshair/prompt overlay is plain DOM
 * and lives outside the canvas in `Scene3D.tsx`, fed by `onHitChange`.
 */

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ResolvedBook, ResolvedThing } from '../types';

const REACH = 4;

export interface Hit {
  kind: 'thing' | 'book';
  label: string;
  thing?: ResolvedThing;
  book?: ResolvedBook;
}

interface Props {
  things: ResolvedThing[];
  onSelect: (thing: ResolvedThing) => void;
  onOpenBook: (book: ResolvedBook) => void;
  onHitChange: (hit: Hit | null) => void;
}

export default function InteractionHUD({ things, onSelect, onOpenBook, onHitChange }: Props) {
  const { camera, scene } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const hitRef = useRef<Hit | null>(null);

  useFrame(() => {
    raycaster.current.set(camera.position, camera.getWorldDirection(new THREE.Vector3()));
    raycaster.current.far = REACH;
    const intersects = raycaster.current.intersectObjects(scene.children, true);

    let next: Hit | null = null;
    for (const hitResult of intersects) {
      // A thing's edge overlay (`<lineSegments>` in `ThingMesh.tsx`) is a
      // CHILD of the tagged `<mesh>`, not tagged itself — and being drawn on
      // the box's own surface, it's often the nearer of the two raycast
      // hits. Fall back to the immediate parent's userData so the edges
      // count as part of the thing they outline, not a miss.
      const own = hitResult.object.userData as { thingId?: number; bookId?: number };
      const data = (own.thingId != null || own.bookId != null)
        ? own
        : (hitResult.object.parent?.userData as { thingId?: number; bookId?: number } | undefined) ?? {};
      if (data.bookId != null) {
        const owner = things.find((t) => t.books?.some((b) => b.id === data.bookId));
        const book = owner?.books?.find((b) => b.id === data.bookId);
        if (book) { next = { kind: 'book', label: book.label, book }; break; }
      } else if (data.thingId != null) {
        const thing = things.find((t) => t.id === data.thingId);
        if (thing) { next = { kind: 'thing', label: thing.label, thing }; break; }
      }
    }

    if (next?.label !== hitRef.current?.label || next?.kind !== hitRef.current?.kind) {
      hitRef.current = next;
      onHitChange(next);
    }
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code !== 'KeyE') return;
      const current = hitRef.current;
      if (!current) return;
      if (current.kind === 'book' && current.book) onOpenBook(current.book);
      else if (current.kind === 'thing' && current.thing) onSelect(current.thing);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSelect, onOpenBook]);

  return null;
}
