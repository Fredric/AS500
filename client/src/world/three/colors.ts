/**
 * Real `THREE.Color`s for the same semantic distinctions `world.css` encodes
 * for the 2D view — Three has no CSS access, so these are the 3D mirror of
 * `world.css`'s `--w-*` tokens, not a new palette. Keep the two in step the
 * same way `client/src/world/types.ts` is kept in step with the server's.
 */

import * as THREE from 'three';

export const ACCESS_COLOR: Record<string, THREE.Color> = {
  ok_bound: new THREE.Color('#eaf1fd'),   // ok + has contents — tinted like .thing--bound
  ok_open: new THREE.Color('#ffffff'),    // ok, nothing to show — .thing--open
  denied: new THREE.Color('#fef3c7'),
  error: new THREE.Color('#fee2e2'),
  unbound: new THREE.Color('#f8f9fb'),
};

export const NOTE_COLOR: Record<string, THREE.Color> = {
  yellow: new THREE.Color('#fef3c7'),
  pink: new THREE.Color('#fce7f3'),
  blue: new THREE.Color('#dbeafe'),
  green: new THREE.Color('#dcfce7'),
};

export const BOOK_COLOR = new THREE.Color('#92400e');
export const BOOK_OVERFLOW_COLOR = new THREE.Color('#9aa3b2');

export const HUMAN_COLOR = new THREE.Color('#2f6fed');
export const AGENT_COLOR = new THREE.Color('#d97706');

export const SELECTED_EMISSIVE = new THREE.Color('#2f6fed');
export const EDGE_COLOR = new THREE.Color('#cbd0da');
export const FLOOR_COLOR = new THREE.Color('#f4f5f7');
export const WALL_COLOR = new THREE.Color('#e2e5eb');
