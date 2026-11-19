// Cá Ngựa's turns: the game being played (G), the setup screen's choices, and what happens each step —
// shake the die, throw it, choose a horse, hop it along, kick, climb the stable, win. The rules
// themselves are in ./rules.ts; the screens in ./scene.ts; online play in ./online.ts.
// Online, only the host runs this; a friend's screen draws the G the host sends.

import { tune } from '../config';
import { sfx } from '../audio';
import { rng, setSeed, freshSeed } from '../game/rng';
import type { Loose } from '../game/types';
import { legalMoves, applyMove, aiPlan, allHome, throwsAgain, moveValue, GATE, type LudoMove, type LudoPlayer, type LudoRules, type LudoSeat } from './rules';

/** The four sides' names and colours, seat i plays side i. */
export const SIDES = [
  { name: 'Đỏ', color: '#ff7b6b', dark: '#d9442b' },
  { name: 'Lá', color: '#7ccf5a', dark: '#3f9a2e' },
  { name: 'Vàng', color: '#ffc93c', dark: '#c98f0a' },
  { name: 'Lam', color: '#6aaef0', dark: '#2b6cd6' },
];
/** The computer's levels, as on Cờ tỷ phú's setup screen. */
export const LV_NAMES = ['Dễ', 'Vừa', 'Khó'];

/** One hop along the way: the horse, the progress values it still passes through, the time into the hop. */
export interface Hop { pi: number; h: number; path: number[]; t: number; move: LudoMove }
/** A horse kicked home, flying back to its corner. */
export interface Kicked { pi: number; h: number; from: number; t: number }
/** The game being played. Plain data: online, the host sends it as it is. */
export interface LudoGame {
  seed: number;
  players: LudoPlayer[];
  cur: number;
  phase: 'roll' | 'shake' | 'dice' | 'choose' | 'move' | 'nomove' | 'over';
  t: number; timer: number;
  /** The dice's faces (one or two, data/config.json ludo_dice); empty before the first throw. */
  dice: number[];
  /** The dice still to use this throw: both at first; each move spends one (a double of 2 to 5 that
   * brings a horse out spends both). */
  use: number[];
  shake: { t: number; ai: boolean; holdFor: number; remote?: boolean; released?: boolean } | null;
  /** The throw in the air: how long it tumbles, how hard it was thrown, the faces it flickers through. */
  throwAt: { t: number; dur: number; power: number; faces: number[][]; spin: number } | null;
  /** The big numbers over the dice once they stop. */
  show: { t: number; dice: number[] } | null;
  moves: LudoMove[];
  hop: Hop | null;
  kicked: Kicked[];
  /** True when this roll earns another (a six, or a kick when that rule is on). */
  again: boolean;
  log: string[];
  winner: number;
  /** Floating words over a horse or the die. */
  floaters: { text: string; color: string; pi: number; h: number; t: number }[];
}

/** The setup screen's seats. */
export const ludoSetup: { seats: LudoSeat[] } = { seats: [{ kind: 'human' }, { kind: 'ai', lv: 1 }, { kind: 'ai', lv: 1 }, { kind: 'off' }] };
/** The game being played (null before the first). */
export let G: LudoGame = null as unknown as LudoGame;
/** Puts a whole game in place (a friend's screen, from the host). */
export function setG(g: LudoGame): void { G = g; }

/** Sounds played since the host last sent the game, for the friends' screens. */
export const sounds: Loose[] = [];
let recording = false;
/** Whether this screen keeps the sounds it plays for the friends (the host of a room). */
export function recordSounds(on: boolean): void { recording = on; if (!on) sounds.length = 0; }
/** Plays a sound here (and for the friends, when hosting). */
export function play(k: string, ...a: Loose[]): void {
  const f = (sfx as Loose)[k]; if (f) f(...a);
  if (recording) sounds.push([k, ...a]);
}

/** The rules' switches, from data/config.json now. */
export const rulesNow = (): LudoRules => ({
  horses: Math.max(1, Math.min(4, Math.round(tune.ludo_horses))), dice: tune.ludo_dice >= 2 ? 2 : 1,
  exitOnOne: tune.ludo_exit_on_one >= 1, exitDouble: tune.ludo_exit_double >= 1, bonusSix: tune.ludo_bonus_six >= 1, bonusKick: tune.ludo_bonus_kick >= 1,
  noJump: tune.ludo_no_jump >= 1, homeStrict: tune.ludo_home_strict >= 1,
});

/** Whose turn it is. */
export const curP = (): LudoPlayer => G.players[G.cur];
/** True when a computer plays this player (a computer seat, or a friend who dropped). */
export const autoPlays = (p: LudoPlayer, peerOnline: (id?: number) => boolean): boolean => p.kind === 'ai' || (p.kind === 'remote' && !peerOnline(p.peer));

/** A line in the game's log, newest first. */
export function log(s: string): void { G.log.unshift(s); if (G.log.length > 40) G.log.length = 40; }

/** Starts a new game from the setup seats; `names` gives each seat's name when it is a person online. */
export function newGame(seed?: number, names: (string | undefined)[] = []): void {
  const s = seed ?? freshSeed(); setSeed(s);
  const R = rulesNow();
  const players: LudoPlayer[] = [];
  ludoSetup.seats.forEach((st, i) => {
    if (st.kind === 'off') return;
    const name = names[i] || st.name || (st.kind === 'ai' ? `Máy ${SIDES[i].name}` : `Ngựa ${SIDES[i].name}`);
    players.push({ id: players.length, side: i, name, kind: st.kind, lv: st.lv ?? 1, peer: st.peer, horses: Array(R.horses).fill(-1), place: 0, kicks: 0, kicked: 0, sixes: 0 });
  });
  G = { seed: s, players, cur: Math.floor(rng() * players.length), phase: 'roll', t: 0, timer: 0, dice: [], use: [], shake: null, throwAt: null, show: null, moves: [], hop: null, kicked: [], again: false, log: [], winner: -1, floaters: [] };
  log(`Ván mới! ${curP().name} đi trước.`);
}

/** Starts shaking the die (a person holds; the computer holds for a moment of its own). */
export function startShake(ai = false): void {
  if (G.phase !== 'roll') return;
  G.shake = { t: 0, ai, holdFor: ai ? 0.35 + rng() * 0.6 : 0 };
  G.phase = 'shake';
}
/** How hard the die will be thrown: 0 to 1, from how long it was shaken. */
export const shakePower = (): number => (G.shake ? Math.min(1, G.shake.t / tune.shake_full_time) : 0);
/** The throw in words: "5", or "3 + 5". */
export const diceText = (d: number[]): string => d.join(' + ');
/** Lets go of the dice: they tumble, and land on their faces. */
export function throwDie(): void {
  const power = shakePower();
  G.shake = null;
  const n = rulesNow().dice;
  G.dice = Array.from({ length: n }, () => 1 + Math.floor(rng() * 6));
  const dur = tune.dice_time * (0.75 + 0.6 * power);
  const faces = Array.from({ length: 8 + Math.round(power * 6) }, () => Array.from({ length: n }, () => 1 + Math.floor(rng() * 6)));
  G.throwAt = { t: 0, dur, power, faces, spin: (rng() < 0.5 ? -1 : 1) * (2 + power * 3) };
  G.phase = 'dice'; G.timer = 0; G.show = null;
  play('dice');
}
/** The die has stopped: which horses may move, and what happens next. */
function afterDie(): void {
  const p = curP(), R = rulesNow(), d = G.dice, again = throwsAgain(d);
  G.show = { t: 0, dice: [...d] };
  if (again) { p.sixes++; play('double'); } else play('land');
  G.again = again && R.bonusSix;
  G.use = [...d];
  G.moves = legalMoves(G.players, G.cur, G.use, R);
  G.timer = 0;
  if (!G.moves.length) {
    G.phase = 'nomove';
    floatDie(p.horses.every(x => x < 0) ? 'Chưa ra quân được' : 'Không đi được', '#d9442b');
    log(`${p.name} đổ ${diceText(d)}: không đi được.`);
    return;
  }
  G.phase = 'choose';
}
/** Words floating up over the die. */
function floatDie(text: string, color: string): void { G.floaters.push({ text, color, pi: -1, h: -1, t: 0 }); }

/** Moves horse h of the current player d cells (one die's face, or both dice's total), if that is a
 * legal move; with no d, or no move for it, the horse's farthest move. */
export function pickHorse(h: number, d?: number): void {
  const mine = G.phase === 'choose' ? G.moves.filter(x => x.h === h) : [];
  const withD = mine.filter(x => moveValue(x) === d);
  const pool = withD.length ? withD : mine;
  if (pool.length) pickMove(pool.reduce((a, b) => (b.to > a.to ? b : a)));
}
/** The dice values a move can still be made with, largest first. */
export const usableDice = (): number[] => [...new Set(G.moves.map(moveValue))].sort((a, b) => b - a);
/** Makes one of the legal moves (the computer's choice). */
function pickMove(m: LudoMove): void {
  const h = m.h;
  const path: number[] = [];
  if (m.from < 0) path.push(0);
  else if (m.to > GATE && rulesNow().homeStrict && m.from === GATE) path.push(m.to); // leaps from the gate onto its step
  else for (let q = m.from + 1; q <= m.to; q++) path.push(q);
  G.hop = { pi: G.cur, h, path, t: 0, move: m };
  G.phase = 'move'; G.moves = [];
  for (const d of m.dice) { const k = G.use.indexOf(d); if (k >= 0) G.use.splice(k, 1); } // the dice it spends
  if (m.from < 0) log(`${curP().name} ra quân${m.dice.length > 1 ? ` bằng đôi ${m.dice[0]}` : ` bằng viên ${m.dice[0]}`}!`);
}

/** The hop finished: the move counts, a kicked horse flies home, then the turn goes on or passes. */
function landed(): void {
  const hp = G.hop!, p = G.players[hp.pi], m = hp.move;
  G.hop = null;
  if (m.kick) {
    const v = G.players[m.kick.pi];
    G.kicked.push({ pi: m.kick.pi, h: m.kick.h, from: v.horses[m.kick.h], t: 0 });
    play('pay'); play('animal', 6);
    G.floaters.push({ text: 'Đá!', color: '#d9442b', pi: hp.pi, h: hp.h, t: 0 });
    log(`${p.name} đá ngựa của ${v.name} về chuồng!`);
    if (rulesNow().bonusKick) G.again = true;
  }
  applyMove(G.players, hp.pi, m);
  if (m.from < 0) { play('buy'); G.floaters.push({ text: 'Ra quân!', color: '#2f8a3a', pi: hp.pi, h: hp.h, t: 0 }); }
  if (m.to > GATE) {
    play('build');
    G.floaters.push({ text: `Bậc ${m.to - GATE}`, color: '#b0501f', pi: hp.pi, h: hp.h, t: 0 });
    if (m.from <= GATE) log(`${p.name} đưa một ngựa lên chuồng (bậc ${m.to - GATE}).`);
  }
  if (allHome(p)) {
    p.place = 1; G.winner = p.id; G.phase = 'over'; G.timer = 0;
    log(`${p.name} đưa đủ ngựa lên chuồng: THẮNG!`);
    play('win');
    return;
  }
  if (G.use.length) { // a die left: another move, with the same horse or another
    G.moves = legalMoves(G.players, G.cur, G.use, rulesNow());
    G.timer = 0;
    if (G.moves.length) { G.phase = 'choose'; return; }
    floatDie(`Viên ${G.use[0]} không đi được`, '#d9442b');
    G.use = [];
  }
  endRoll();
}
/** After a roll: roll again (a six), or the next player's turn. */
function endRoll(): void {
  G.timer = 0; G.moves = [];
  if (G.again) { G.again = false; G.phase = 'roll'; floatDie('Đổ thêm!', '#2f8a3a'); return; }
  G.cur = (G.cur + 1) % G.players.length;
  G.phase = 'roll';
}

/** One step of the game (the host's, or one screen's). `held` says whether the person shaking still
 * holds the die; `peerOnline` whether a friend's seat is connected. */
export function step(dt: number, held: boolean, peerOnline: (id?: number) => boolean): void {
  G.t += dt; G.timer += dt;
  for (const f of G.floaters) f.t += dt;
  G.floaters = G.floaters.filter(f => f.t < 1.4);
  for (const k of G.kicked) k.t += dt;
  G.kicked = G.kicked.filter(k => k.t < 0.6);
  if (G.show) G.show.t += dt;
  if (G.phase === 'over') return;
  const p = curP(), auto = autoPlays(p, peerOnline);
  switch (G.phase) {
    case 'roll':
      if (auto && G.timer >= tune.ludo_ai_delay) startShake(true);
      break;
    case 'shake': {
      const sh = G.shake!; sh.t += dt;
      if (Math.floor(sh.t / 0.09) !== Math.floor((sh.t - dt) / 0.09)) play('rattle', sh.t);
      const still = sh.ai ? sh.t < sh.holdFor : sh.remote ? !sh.released && peerOnline(p.peer) : held;
      if (!still || sh.t > tune.shake_max_time) throwDie();
      break;
    }
    case 'dice':
      G.throwAt!.t += dt;
      if (G.throwAt!.t >= G.throwAt!.dur) { G.throwAt = null; afterDie(); }
      break;
    case 'nomove':
      if (G.timer >= tune.ludo_no_move_time) endRoll();
      break;
    case 'choose': {
      // one choice (or every choice the same horse's): it moves by itself after a beat
      const only = new Set(G.moves.map(m => `${m.from}>${m.to}:${m.dice.join()}`)).size === 1; // one move, or the same move for any horse (all coming out)
      if (only && G.timer >= 0.45) pickMove(G.moves[0]);
      else if (auto && G.timer >= tune.ludo_ai_delay * 0.7) pickMove(aiPlan(G.players, G.cur, G.moves, G.use, p.kind === 'ai' ? p.lv : 1, rulesNow(), rng)); // Khó thinks both dice through
      break;
    }
    case 'move': {
      const hp = G.hop!; hp.t += dt;
      if (hp.t >= tune.ludo_hop_time) {
        hp.t -= tune.ludo_hop_time;
        const q = hp.path.shift()!;
        G.players[hp.pi].horses[hp.h] = q === hp.move.to ? G.players[hp.pi].horses[hp.h] : q; // the last hop lands through landed()
        play('tick');
        if (!hp.path.length) landed();
      }
      break;
    }
  }
}

/** The ranking at the end: the winner, then by how far each one's horses got. */
export function ranking(): LudoPlayer[] {
  const far = (q: LudoPlayer): number => q.horses.reduce((a, x) => a + (x < 0 ? 0 : x + 1), 0);
  return [...G.players].sort((a, b) => (b.place === 1 ? 1 : 0) - (a.place === 1 ? 1 : 0) || far(b) - far(a));
}
