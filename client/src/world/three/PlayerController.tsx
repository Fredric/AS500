/**
 * First-person movement: WASD + mouselook via `PointerLockControls`, with
 * simple AABB collision against furniture so the player slides along a wall
 * instead of clipping through it — local prediction only, matching the
 * server's own "no physics" stance (`world/presence.ts`): nothing here is
 * validated or authoritative, only the final pose is relayed via `onMove`,
 * exactly like a floor click in the 2D view already does.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls } from '@react-three/drei';
import * as THREE from 'three';
import type { PointerLockControls as PointerLockControlsImpl } from 'three-stdlib';
import type { Placed } from '../layout';
import { ROOM_H, ROOM_W } from '../layout';

const PLAYER_RADIUS = 0.35;
const EYE_HEIGHT = 1.6;
const SPEED = 4.5; // room units / second
const MOVE_SEND_HZ = 10;
/** No single collision step may cover more than this — smaller than the thinnest furniture (a postit's 1-unit footprint). */
const MAX_STEP = 0.1;

export interface PlayerControllerHandle {
  lock: () => void;
  unlock: () => void;
}

interface Box { minX: number; maxX: number; minZ: number; maxZ: number }

function collisionBoxes(placed: Placed[]): Box[] {
  return placed.map((p) => ({
    minX: p.x - PLAYER_RADIUS, maxX: p.x + p.w + PLAYER_RADIUS,
    minZ: p.y - PLAYER_RADIUS, maxZ: p.y + p.h + PLAYER_RADIUS,
  }));
}

function collides(x: number, z: number, boxes: Box[]): boolean {
  return boxes.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ);
}

interface Props {
  placed: Placed[];
  startPose: { x: number; y: number; rot: number };
  onMove: (pose: { x: number; y: number; rot: number }) => void;
}

const PlayerController = forwardRef<PlayerControllerHandle, Props>(({ placed, startPose, onMove }, ref) => {
  const { camera, gl } = useThree();
  const controlsRef = useRef<PointerLockControlsImpl>(null);
  const keys = useRef<Set<string>>(new Set());
  const lastSent = useRef(0);
  const lastPose = useRef(startPose);

  useImperativeHandle(ref, () => ({
    lock: () => controlsRef.current?.lock(),
    unlock: () => controlsRef.current?.unlock(),
  }), []);

  useEffect(() => {
    camera.position.set(startPose.x, EYE_HEIGHT, startPose.y);
    camera.rotation.set(0, -startPose.rot, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => keys.current.add(e.code);
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const boxes = useRefFromValue(() => collisionBoxes(placed), [placed]);
  const worldDir = useRef(new THREE.Vector3());

  useFrame((_, rawDelta) => {
    const k = keys.current;
    let dx = 0;
    let dz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) dz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) dz += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) dx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) dx += 1;

    if (dx !== 0 || dz !== 0) {
      const len = Math.hypot(dx, dz);
      dx /= len; dz /= len;

      // Derived from the camera's actual world orientation (the same call
      // `InteractionHUD`'s raycast uses to aim), not `camera.rotation.y` by
      // itself — `PointerLockControls` maintains its own internal euler
      // state once active, so reading the Object3D's raw Euler can disagree
      // with where the camera is actually facing. Projected onto the
      // ground plane and re-normalized since look-up/down must not slow
      // down horizontal movement.
      camera.getWorldDirection(worldDir.current);
      const forwardX = worldDir.current.x;
      const forwardZ = worldDir.current.z;
      const forwardLen = Math.hypot(forwardX, forwardZ) || 1;
      const fx = forwardX / forwardLen;
      const fz = forwardZ / forwardLen;
      const rightX = -fz;
      const rightZ = fx;

      const dirX = fx * -dz + rightX * dx;
      const dirZ = fz * -dz + rightZ * dx;
      const list = boxes.current;

      // A frame hitch (tab backgrounded, GC pause, a slow first frame) can
      // make `rawDelta` large enough that a single step jumps clean over a
      // thin object's collision box — sub-step so no single move is ever
      // larger than the smallest furniture is deep, so tunnelling can't
      // happen regardless of how long a frame took.
      const totalDist = SPEED * rawDelta;
      const steps = Math.max(1, Math.ceil(totalDist / MAX_STEP));
      const stepDist = totalDist / steps;

      for (let i = 0; i < steps; i++) {
        const curX = camera.position.x;
        const curZ = camera.position.z;

        // Resolve per-axis so the player slides along a wall instead of
        // stopping dead the moment either axis would clip through it.
        const nextX = clamp(curX + dirX * stepDist, PLAYER_RADIUS, ROOM_W - PLAYER_RADIUS);
        if (!collides(nextX, curZ, list)) camera.position.x = nextX;

        const nextZ = clamp(curZ + dirZ * stepDist, PLAYER_RADIUS, ROOM_H - PLAYER_RADIUS);
        if (!collides(camera.position.x, nextZ, list)) camera.position.z = nextZ;
      }
    }

    const now = performance.now();
    if (now - lastSent.current > 1000 / MOVE_SEND_HZ) {
      // Same `getWorldDirection`-derived facing as movement/raycasting use,
      // so the pose relayed to everyone else agrees with what this client
      // actually sees, not a possibly-stale `camera.rotation.y`.
      camera.getWorldDirection(worldDir.current);
      const rot = Math.atan2(-worldDir.current.x, -worldDir.current.z);
      const pose = { x: camera.position.x, y: camera.position.z, rot };
      const prev = lastPose.current;
      if (Math.abs(pose.x - prev.x) > 0.02 || Math.abs(pose.y - prev.y) > 0.02 || Math.abs(pose.rot - prev.rot) > 0.02) {
        onMove(pose);
        lastPose.current = pose;
      }
      lastSent.current = now;
    }
  });

  return <PointerLockControls ref={controlsRef} camera={camera} domElement={gl.domElement} />;
});

PlayerController.displayName = 'PlayerController';
export default PlayerController;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** A ref that re-derives its value with `useMemo` semantics but stays a ref for `useFrame` to read without re-subscribing. */
function useRefFromValue<T>(factory: () => T, deps: unknown[]): MutableRefObject<T> {
  const ref = useRef<T>(factory());
  const depsRef = useRef(deps);
  const changed = deps.length !== depsRef.current.length || deps.some((d, i) => d !== depsRef.current[i]);
  if (changed) {
    ref.current = factory();
    depsRef.current = deps;
  }
  return ref;
}
