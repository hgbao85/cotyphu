// The pieces' moods: breathing, bouncing, jumping for joy, shivering, hanging their head in jail.
import * as THREE from 'three';
import { tune } from '../config';

import { state, scene } from '../core/store';

import type { Player } from '../game/types';

import { levelsOf, curP } from '../game/turn';

import { rawSfx } from '../net/room';

import { tokAnim } from '../three/scene3d';

// ---- The pieces' moods ---------------------------------------------------------------------------
// Every screen works them out from the state it sees, so a friend online sees the same: a piece
// breathes, bounces while its player is to throw, jumps and spins when it buys or builds, hops when
// money comes in, shivers when it pays, hangs its head in jail, and the winner dances at the end.
type MoodKind = 'happy' | 'hop' | 'shiver';
const MOOD_TIME: Record<MoodKind, number> = { happy: 1.0, hop: 0.5, shiver: 0.6 };
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
  if (p.inJail) { tilt = -0.3; roll = 0.07 * Math.sin(animT * 1.3 + ph); sy *= 0.93; }
  else if (cur && !moving && (state.phase === 'roll' || state.phase === 'order')) y = Math.abs(Math.sin(animT * 4.5)) * 0.06;
  if (cur && state.shaking) roll = 0.14 * Math.sin(animT * 32);
  const m = moods[k];
  if (m && !moving) {
    const u = Math.min(1, m.t / MOOD_TIME[m.kind]);
    if (m.kind === 'happy') {
      y = Math.sin(Math.PI * u) * 0.3; spin = (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2) * Math.PI * 2;
      const land = u < 0.12 ? 1 - u / 0.12 : u > 0.88 ? (u - 0.88) / 0.12 : 0; sy *= 1 - 0.18 * land; sx *= 1 + 0.1 * land;
    } else if (m.kind === 'hop') y = Math.sin(Math.PI * u) * 0.12;
    else { roll = Math.sin(u * 42) * 0.2 * (1 - u); sy *= 0.94; }
  }
  const champ = state.ranking ? state.players[state.ranking[0].i] : undefined;
  if (scene === 'results' && champ && (champ === p || (state.teams && champ.team === p.team))) { // the winner (a whole team) dances
    y = Math.abs(Math.sin(animT * 3.6)) * 0.22; spin = Math.sin(animT * 1.8) * 0.9; tilt = 0;
  }
  inner.position.y = y; inner.rotation.set(roll, spin, tilt); inner.scale.set(sx, sy, sx);
}

