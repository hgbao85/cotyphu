// The pieces' moods: breathing, bouncing, jumping for joy, shivering, hanging their head in jail.
import * as THREE from 'three';
import { tune } from '../config';

import { state, scene } from '../core/store';

import type { Player } from '../game/types';

import { levelsOf, curP } from '../game/turn';

import { rawSfx } from '../net/room';

import { tokAnim } from '../three/scene3d';
import { canvasTex } from './materials';

// ---- The pieces' moods ---------------------------------------------------------------------------
// Every screen works them out from the state it sees, so a friend online sees the same: a piece
// breathes, bounces while its player is to throw, jumps and spins when it buys or builds, hops when
// money comes in (twice, arms up), bows its head when it pays, dozes off in jail with Zs rising over it,
// and the winner dances at the end.
type MoodKind = 'happy' | 'hop' | 'shiver';
const MOOD_TIME: Record<MoodKind, number> = { happy: 1.0, hop: 0.8, shiver: 1.1 };
const MOOD_RANK: Record<MoodKind, number> = { hop: 0, shiver: 1, happy: 2 };
export const moods: ({ kind: MoodKind; t: number } | null)[] = [];                       // by seat
export const moodPrev: ({ props: number; levels: number; cash: number } | undefined)[] = []; // by seat
let animT = 0; // the pieces' own clock, stepped with the game so the checks repeat
function setMood(k: number, kind: MoodKind) {
  const m = moods[k];
  if (m && MOOD_RANK[m.kind] > MOOD_RANK[kind]) return;
  moods[k] = { kind, t: 0 };
}
/** Notices what just happened to each player and sets their piece's mood. */
export function moodStep(dt: number) {
  animT += dt;
  if (!state.players) return;
  state.players.forEach((p, pi) => {
    const k = p.id, props = state.owner.filter(o => o === pi).length, levels = levelsOf(pi), was = moodPrev[k];
    if (was && !state.ordering && !p.bankrupt) {
      if (props > was.props || levels > was.levels) { setMood(k, 'happy'); rawSfx.animal(p.token); }
      else if (was.cash - p.cash >= tune.mood_loss) setMood(k, 'shiver');
      else if (p.cash - was.cash >= tune.mood_gain) setMood(k, 'hop');
    }
    moodPrev[k] = { props, levels, cash: p.cash };
    const m = moods[k];
    if (m) { m.t += dt; if (m.t >= MOOD_TIME[m.kind]) moods[k] = null; }
  });
}
/** Moves a piece's inner figure for its mood: lift, spin, tilt and squash. */
export function applyMood(inner: THREE.Object3D | undefined, p: Player) {
  if (!inner) return;
  const k = p.id, ph = k * 1.7, moving = !!tokAnim[k], cur = p === curP() && state.phase !== 'over';
  let y = 0, spin = 0, tilt = 0, roll = 0, sy = 1 + 0.035 * Math.sin(animT * 3 + ph), sx = 1 - 0.018 * Math.sin(animT * 3 + ph);
  let pitch = 0;
  if (p.inJail) { // dozing: head nodding forward, slow deep breaths, a little lower
    pitch = 0.32 + 0.1 * Math.sin(animT * 1.1 + ph); roll = 0.05 * Math.sin(animT * 0.55 + ph);
    sy = 0.9 + 0.04 * Math.sin(animT * 1.1 + ph); sx = 1 + 0.03 * Math.sin(animT * 1.1 + ph);
  }
  else if (cur && !moving && (state.phase === 'roll' || state.phase === 'order')) y = Math.abs(Math.sin(animT * 4.5)) * 0.06;
  if (cur && state.shaking) roll = 0.14 * Math.sin(animT * 32);
  const m = moods[k];
  if (m && !moving) {
    const u = Math.min(1, m.t / MOOD_TIME[m.kind]);
    if (m.kind === 'happy') {
      y = Math.sin(Math.PI * u) * 0.3; spin = (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2) * Math.PI * 2;
      const land = u < 0.12 ? 1 - u / 0.12 : u > 0.88 ? (u - 0.88) / 0.12 : 0; sy *= 1 - 0.18 * land; sx *= 1 + 0.1 * land;
    } else if (m.kind === 'hop') { // jumping for joy: two springy hops, a wiggle at the top of each
      const h = Math.abs(Math.sin(u * Math.PI * 2)); y = h * 0.24 * (u < 0.5 ? 1 : 0.8); roll = Math.sin(u * Math.PI * 4) * 0.18 * h;
      const land = 1 - h; sy *= 1 - 0.12 * land * land; sx *= 1 + 0.06 * land * land;
    } else { // paying: bows its head, holds it, slowly looks up again
      const b = u < 0.25 ? u / 0.25 : u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1; pitch = 0.5 * b; sy *= 1 - 0.07 * b; y = -0.02 * b;
    }
  }
  const champ = state.ranking ? state.players[state.ranking[0].i] : undefined;
  if (scene === 'results' && champ && (champ === p || (state.teams && champ.team === p.team))) { // the winner (a whole team) dances
    y = Math.abs(Math.sin(animT * 3.6)) * 0.22; spin = Math.sin(animT * 1.8) * 0.9; tilt = 0;
  }
  inner.position.y = y; inner.rotation.set(roll + pitch, spin, tilt); inner.scale.set(sx, sy, sx);
  sleepZs(inner.parent, p);
}
// ---- Zs over a piece asleep in jail ------------------------------------------------------------------
let zTex: THREE.Texture | null = null;
const zSprites = new Map<THREE.Object3D, THREE.Sprite[]>();
/** Two Zs rise and fade over a piece in jail, one after the other; none for anyone else. */
function sleepZs(outer: THREE.Object3D | null, p: Player) {
  if (!outer) return;
  let zs = zSprites.get(outer);
  if (!zs) {
    zTex ||= canvasTex(64, 64, c => { c.fillStyle = '#5a7ab0'; c.font = 'bold 54px "Baloo 2", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('z', 32, 34); });
    zs = [0, 1].map(() => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: zTex!, transparent: true, depthWrite: false })); s.visible = false; outer.parent?.add(s); return s; }); // in the board's space, not the turning piece's
    zSprites.set(outer, zs);
  }
  zs.forEach((s, j) => {
    s.visible = p.inJail && !p.bankrupt;
    if (!s.visible) return;
    const u = (animT * 0.45 + j * 0.5) % 1; // each Z: rises 1.5 s, then the next
    s.position.set(outer.position.x + 0.15 + u * 0.25, outer.position.y + 0.75 + u * 0.55, outer.position.z);
    s.scale.setScalar(0.2 + u * 0.18); (s.material as THREE.SpriteMaterial).opacity = Math.min(1, (1 - u) * 2.5);
  });
}
