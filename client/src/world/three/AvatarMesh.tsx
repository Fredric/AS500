/**
 * Another occupant — human or agent — the 3D mirror of `Floorplan.tsx`'s
 * `<circle>` avatars. Poses are relayed, never validated or persisted (see
 * `world/presence.ts`); this just renders whatever the server last sent.
 */

import { Billboard, Text } from '@react-three/drei';
import type { Presence } from '../types';
import { AGENT_COLOR, HUMAN_COLOR, MOBILE_COLOR } from './colors';

const COLOR_BY_KIND = { human: HUMAN_COLOR, agent: AGENT_COLOR, mobile: MOBILE_COLOR } as const;
const SUFFIX_BY_KIND = { human: '', agent: ' (agent)', mobile: ' (phone)' } as const;

export default function AvatarMesh({ actor }: { actor: Presence }) {
  const color = COLOR_BY_KIND[actor.kind];
  const { x, y } = actor.pose;

  return (
    <group position={[x, 0, y]} rotation={[0, -actor.pose.rot, 0]}>
      <mesh position={[0, 0.9, 0]}>
        <capsuleGeometry args={[0.32, 1.0, 4, 8]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <Billboard position={[0, 2.0, 0]}>
        <Text fontSize={0.3} color="#1c2128" anchorX="center" anchorY="bottom">
          {actor.username}{SUFFIX_BY_KIND[actor.kind]}{actor.status ? ` · ${actor.status}` : ''}
        </Text>
      </Billboard>
    </group>
  );
}
