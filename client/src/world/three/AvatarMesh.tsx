/**
 * Another occupant — human or agent — the 3D mirror of `Floorplan.tsx`'s
 * `<circle>` avatars. Poses are relayed, never validated or persisted (see
 * `world/presence.ts`); this just renders whatever the server last sent.
 */

import { Billboard, Text } from '@react-three/drei';
import type { Presence } from '../types';
import { AGENT_COLOR, HUMAN_COLOR } from './colors';

export default function AvatarMesh({ actor }: { actor: Presence }) {
  const color = actor.kind === 'agent' ? AGENT_COLOR : HUMAN_COLOR;
  const { x, y } = actor.pose;

  return (
    <group position={[x, 0, y]} rotation={[0, -actor.pose.rot, 0]}>
      <mesh position={[0, 0.9, 0]}>
        <capsuleGeometry args={[0.32, 1.0, 4, 8]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <Billboard position={[0, 2.0, 0]}>
        <Text fontSize={0.3} color="#1c2128" anchorX="center" anchorY="bottom">
          {actor.username}{actor.kind === 'agent' ? ' (agent)' : ''}
        </Text>
      </Billboard>
    </group>
  );
}
