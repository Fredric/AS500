/**
 * First-person 3D view — the Three.js/R3F mirror of `Floorplan.tsx`. Same
 * props, same `useWorldSocket` state, same callbacks — only the render
 * layer changes, per the roadmap's own framing of Phase 4 as a renderer
 * swap, not a new feature. The server, the WS protocol and `resolver.ts`
 * are all untouched.
 */

import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import type { Presence, ResolvedBook, ResolvedThing } from '../types';
import { layoutThings, ROOM_H, ROOM_W } from '../layout';
import { FLOOR_COLOR, WALL_COLOR } from './colors';
import ThingMesh from './ThingMesh';
import AvatarMesh from './AvatarMesh';
import PlayerController, { type PlayerControllerHandle } from './PlayerController';
import InteractionHUD, { type Hit } from './InteractionHUD';
import './three.css';

interface Props {
  things: ResolvedThing[];
  actors: Presence[];
  selectedId: number | null;
  onSelect: (thing: ResolvedThing) => void;
  onOpenBook: (book: ResolvedBook) => void;
  onMove: (pose: { x: number; y: number; rot: number }) => void;
  /** True while a DOM overlay (side panel, book modal) is open — releases pointer lock. */
  overlayOpen: boolean;
}

const DEFAULT_ENTRY_POSE = { x: 12, y: 8, rot: 0 };

export default function Scene3D({ things, actors, selectedId, onSelect, onOpenBook, onMove, overlayOpen }: Props) {
  const placed = layoutThings(things);
  const controllerRef = useRef<PlayerControllerHandle>(null);
  const [hit, setHit] = useState<Hit | null>(null);

  // Opening a panel/modal is normal DOM interaction — pointer lock must
  // release so clicking and typing there work, and re-acquire once it
  // closes so movement resumes where the player expects it to.
  useEffect(() => {
    if (overlayOpen) controllerRef.current?.unlock();
    else controllerRef.current?.lock();
  }, [overlayOpen]);

  return (
    <div className="three-stage">
      <Canvas shadows camera={{ fov: 75, near: 0.1, far: 100 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[8, 12, 4]} intensity={0.8} castShadow />
        <fog attach="fog" args={[FLOOR_COLOR.getHex(), 8, 28]} />

        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[ROOM_W / 2, 0, ROOM_H / 2]} receiveShadow>
          <planeGeometry args={[ROOM_W, ROOM_H]} />
          <meshStandardMaterial color={FLOOR_COLOR} />
        </mesh>
        <Walls />

        {placed.map((p) => (
          <ThingMesh
            key={p.thing.id}
            placed={p}
            selected={p.thing.id === selectedId}
            onSelect={onSelect}
            onOpenBook={onOpenBook}
          />
        ))}

        {actors.map((a) => (
          <AvatarMesh key={`${a.actorId}-${a.since}`} actor={a} />
        ))}

        <PlayerController ref={controllerRef} placed={placed} startPose={DEFAULT_ENTRY_POSE} onMove={onMove} />
        <InteractionHUD things={things} onSelect={onSelect} onOpenBook={onOpenBook} onHitChange={setHit} />
      </Canvas>

      <div className="hud">
        <div className="hud__crosshair" />
        {hit && <div className="hud__prompt">Press E — {hit.label}</div>}
        <div className="hud__hint">WASD move · mouse look · E interact</div>
      </div>
    </div>
  );
}

const WALL_HEIGHT = 3;
const WALL_THICKNESS = 0.2;

/** Four thin boxes around the room, sized from the same `ROOM_W`/`ROOM_H` the 2D border rect uses. */
function Walls() {
  return (
    <>
      <mesh position={[ROOM_W / 2, WALL_HEIGHT / 2, -WALL_THICKNESS / 2]}>
        <boxGeometry args={[ROOM_W + WALL_THICKNESS * 2, WALL_HEIGHT, WALL_THICKNESS]} />
        <meshStandardMaterial color={WALL_COLOR} />
      </mesh>
      <mesh position={[ROOM_W / 2, WALL_HEIGHT / 2, ROOM_H + WALL_THICKNESS / 2]}>
        <boxGeometry args={[ROOM_W + WALL_THICKNESS * 2, WALL_HEIGHT, WALL_THICKNESS]} />
        <meshStandardMaterial color={WALL_COLOR} />
      </mesh>
      <mesh position={[-WALL_THICKNESS / 2, WALL_HEIGHT / 2, ROOM_H / 2]}>
        <boxGeometry args={[WALL_THICKNESS, WALL_HEIGHT, ROOM_H]} />
        <meshStandardMaterial color={WALL_COLOR} />
      </mesh>
      <mesh position={[ROOM_W + WALL_THICKNESS / 2, WALL_HEIGHT / 2, ROOM_H / 2]}>
        <boxGeometry args={[WALL_THICKNESS, WALL_HEIGHT, ROOM_H]} />
        <meshStandardMaterial color={WALL_COLOR} />
      </mesh>
    </>
  );
}
