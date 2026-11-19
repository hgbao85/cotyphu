// Rắn và Thang's turns: the game being played (G), the setup screen's seats, and what happens each
// step — shake the die, throw it, hop along, climb a ladder or slide down a snake, win. The rules are
// in ./rules.ts; the screens in ./scene.ts; online play in ./online.ts.
// Online, only the host runs this; a friend's screen draws the G the host sends.

import { rollDice, makeZone, meterPos, inZone, aiHold, throwWithZone, type Zone } from '../game/dice';
import { startOrder, recordOrder, nextOrder, type OrderState } from '../game/orderRoll';
import type { Bubble, Vote } from '../net/roomExtras';
import { tune, CONFIG } from '../config';
import { sfx } from '../audio';
import { rng, setSeed, freshSeed } from '../game/rng';
import type { Loose } from '../game/types';
import { landing, throwsAgain, LAST, type Link, type SnakePlayer, type SnakeRules, type SnakeSeat } from './rules';

/** The four seats' colours: the base under each piece. */
export const SEATS = [
  { color: '#ff7b6b', dark: '#d9442b' },
  { color: '#6aaef0', dark: '#2b6cd6' },
  { color: '#ffc93c', dark: '#c98f0a' },
  { color: '#b58cf0', dark: '#7a4fc9' },
];

/** The piece hopping along: the player, the cells it still passes through, the time into the hop. */
export interface Hop { pi: number; path: number[]; t: number }
/** The piece on a ladder or a snake: the player, the link, the time into the slide. */
export interface Slide { pi: number; link: Link; t: number }
/** The game being played. Plain data: online, the host sends it as it is. */
export interface SnakeGame {
  /** While the players throw for the order of play (src/game/orderRoll.ts). */
  order?: OrderState;
  /** Online: the bubbles over the players' cards and the vote for a new game (src/net/roomExtras.ts). */
  emotes?: Bubble[];
  vote?: Vote;
  seed: number;
  players: SnakePlayer[];
  cur: number;
  phase: 'roll' | 'shake' | 'dice' | 'move' | 'slide' | 'nomove' | 'over';
  t: number; timer: number;
  dice: number[];
  shake: { t: number; ai: boolean; holdFor: number; remote?: boolean; released?: boolean; zone?: Zone; power?: number } | null; // zone: the sweet zone; power: a friend's let-go power
  throwAt: { t: number; dur: number; power: number; faces: number[][]; spin: number } | null;
  show: { t: number; dice: number[] } | null;
  hop: Hop | null;
  slide: Slide | null;
  /** After the hop: the ladder or snake to take, then where it ends. */
  pending: { link?: Link } | null;
  again: boolean;
  log: string[];
  winner: number;
  floaters: { text: string; color: string; pi: number; t: number }[];
  /** The rules' switches this game was started with (RULE_KEYS), so a kept game or a friend's screen plays by them. */
  rules?: Record<string, number>;
}

/** The data/config.json switches a game keeps with it. */
export const RULE_KEYS = ['snake_dice', 'snake_six_to_start', 'snake_exact_finish', 'snake_bonus_six'];

/** The setup screen's seats. */
export const snakeSetup: { seats: SnakeSeat[] } = {
  seats: [{ kind: 'human', animal: 2 }, { kind: 'ai', animal: 8 }, { kind: 'ai', animal: 3 }, { kind: 'off', animal: 11 }],
};
/** The game being played (null before the first). */
export let G: SnakeGame = null as unknown as SnakeGame;
/** Puts a whole game in place (a friend's screen, from the host). */
export function setG(g: SnakeGame): void {
  G = g;
  for (const k of RULE_KEYS) if (typeof g.rules?.[k] === 'number') CONFIG[k].value = g.rules[k]; // play by the game's own rules
}

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
export const rulesNow = (): SnakeRules => ({
  dice: tune.snake_dice >= 2 ? 2 : 1, exactFinish: tune.snake_exact_finish >= 1,
  sixToStart: tune.snake_six_to_start >= 1, bonusSix: tune.snake_bonus_six >= 1,
});

/** Whose turn it is. */
export const curP = (): SnakePlayer => G.players[G.cur];
/** True when a computer plays this player (a computer seat, or a friend who dropped). */
export const autoPlays = (p: SnakePlayer, peerOnline: (id?: number) => boolean): boolean => p.kind === 'ai' || (p.kind === 'remote' && !peerOnline(p.peer));

/** A line in the game's log, newest first. */
/** The whole game's lines, oldest first, for "Lịch sử" (the host's; a friend asks for it). Kept out of G,
 * which is sent 20 times a second, so it costs nothing on the wire until someone opens it. */
export const history: string[] = [];
export function log(s: string): void {
  G.log.unshift(s); if (G.log.length > 40) G.log.length = 40;
  history.push(s); if (history.length > 300) history.shift();
}

/** Starts a new game from the setup seats; `names` gives each seat's name when it is a person online. */
export function newGame(seed?: number, names: (string | undefined)[] = [], animalName: (a: number) => string = a => `Quân ${a + 1}`): void {
  history.length = 0; // a new game, a new history
  const s = seed ?? freshSeed(); setSeed(s);
  const players: SnakePlayer[] = [];
  snakeSetup.seats.forEach((st, i) => {
    if (st.kind === 'off') return;
    const name = names[i] || st.name || (st.kind === 'ai' ? `Máy ${animalName(st.animal)}` : `Người ${animalName(st.animal)}`); // Người / Máy + the animal, as in Cờ Tỷ Phú
    players.push({ id: players.length, seat: i, name, kind: st.kind, animal: st.animal, peer: st.peer, pos: 0, ladders: 0, bites: 0, sixes: 0 });
  });
  G = { seed: s, players, cur: Math.floor(rng() * players.length), phase: 'roll', t: 0, timer: 0, dice: [], shake: null, throwAt: null, show: null, hop: null, slide: null, pending: null, again: false, log: [], winner: -1, floaters: [], rules: Object.fromEntries(RULE_KEYS.map(k => [k, tune[k]])) };
  if (tune.order_roll >= 1 && players.length > 1) startOrder(G, log); // everyone throws once: the highest goes first, as in Cờ Tỷ Phú
  else log(`Ván mới! ${curP().name} đi trước.`);
}

/** Starts shaking the die (a person holds; the computer holds for a moment of its own). */
export function startShake(ai = false, aim?: number): void { // aim: the power a computer that aims wants (Khó)
  if (G.phase !== 'roll') return;
  const zone = makeZone(); // the sweet zone of this shake (src/game/dice.ts)
  G.shake = { t: 0, ai, holdFor: ai ? aiHold(1, zone, aim) : 0, zone };
  G.phase = 'shake';
}
/** How hard the die will be thrown: 0 to 1, from how long it was shaken. */
/** Where the current player's piece would end after a throw (its ladder or snake taken): what a throw let go
 * in the sweet zone is worth (the better of two kept). */
function landedOn(d: number[]): number {
  const p = curP(), L = landing(p.pos, d, rulesNow());
  return L.link ? L.link.to : L.path.length ? L.path[L.path.length - 1] : p.pos;
}
/** Where the power bar stands: a friend's own let-go power online, else the bar's place now (it runs up and down). */
export const shakePower = (): number => (G.shake ? G.shake.power ?? meterPos(G.shake.t) : 0);
/** The throw in words: "5", or "3 + 5". */
export const diceText = (d: number[]): string => d.join(' + ');

/** Lets go of the die: it tumbles, and lands on its face. */
export function throwDie(): void {
  const power = shakePower(), n = rulesNow().dice;
  const hit = inZone(power, G.shake?.zone);
  G.shake = null;
  if (hit) float(-1, 'Trúng vùng đẹp!', '#c98f0a');
  G.dice = throwWithZone(n, power, hit, (d: number[]) => (G.order ? d.reduce((a, b) => a + b, 0) : landedOn(d))); // a hard throw tends high, a soft one low; the sweet zone a little luckier (src/game/dice.ts)
  const dur = tune.dice_time * (0.75 + 0.6 * power);
  const faces = Array.from({ length: 8 + Math.round(power * 6) }, () => Array.from({ length: n }, () => 1 + Math.floor(rng() * 6)));
  G.throwAt = { t: 0, dur, power, faces, spin: (rng() < 0.5 ? -1 : 1) * (2 + power * 3) };
  G.phase = 'dice'; G.timer = 0; G.show = null;
  play('dice');
}
/** The die stopped: the piece hops, or waits when it cannot come on yet. */
function afterDie(): void {
  const p = curP(), R = rulesNow(), d = G.dice, again = throwsAgain(d);
  G.show = { t: 0, dice: [...d] };
  if (G.order) { // a throw for the order of play: noted and shown for a moment, nothing moves
    recordOrder(G, d.reduce((a, b) => a + b, 0), log); play('land');
    G.phase = 'nomove'; G.timer = 0; return;
  }
  if (again) { p.sixes++; play('double'); } else play('land');
  G.again = again && R.bonusSix;
  const L = landing(p.pos, d, R);
  G.timer = 0;
  if (!L.path.length) {
    G.phase = 'nomove';
    float(-1, R.dice > 1 ? 'Cần đổ đôi để vào bàn' : 'Cần đổ 6 để vào bàn', '#d9442b');
    log(`${p.name} đổ ${diceText(d)}: chưa vào bàn được.`);
    return;
  }
  if (p.pos === 0) log(`${p.name} vào bàn!`);
  if (L.path.includes(LAST) && L.path[L.path.length - 1] !== LAST) float(G.cur, 'Dư rồi, lùi lại!', '#b0501f');
  G.hop = { pi: G.cur, path: L.path, t: 0 };
  G.pending = { link: L.link };
  G.phase = 'move';
}
/** Words floating up over a piece (pi), or over the die (-1). */
function float(pi: number, text: string, color: string): void { G.floaters.push({ text, color, pi, t: 0 }); }

/** The hop ended on its cell: a ladder or a snake there takes the piece, else the turn goes on. */
function hopDone(): void {
  const p = curP(), link = G.pending?.link;
  G.hop = null; G.pending = null; G.timer = 0;
  if (link) {
    G.slide = { pi: G.cur, link, t: 0 };
    G.phase = 'slide';
    if (link.kind === 'ladder') { p.ladders++; play('build'); float(G.cur, 'Lên thang!', '#2f8a3a'); log(`${p.name} leo thang từ ô ${link.from} lên ô ${link.to}!`); }
    else { p.bites++; play('pay'); play('animal', 5); float(G.cur, 'Rắn cắn!', '#d9442b'); log(`${p.name} bị rắn ở ô ${link.from} đớp, tuột xuống ô ${link.to}.`); }
    return;
  }
  settle();
}
/** The piece stands still: a win on 100, or another throw, or the next player's turn. */
function settle(): void {
  const p = curP();
  if (p.pos === LAST) {
    G.winner = p.id; G.phase = 'over'; G.timer = 0;
    log(`${p.name} về tới ô ${LAST}: THẮNG!`);
    play('win');
    return;
  }
  endRoll();
}
/** After a throw: throw again (a six), or the next player's turn. */
function endRoll(): void {
  G.timer = 0;
  if (G.order) { G.again = false; nextOrder(G, log); G.phase = 'roll'; return; } // the next throw for the order, or the game's first turn
  if (G.again) { G.again = false; G.phase = 'roll'; float(-1, 'Thảy thêm!', '#2f8a3a'); return; }
  G.cur = (G.cur + 1) % G.players.length;
  G.phase = 'roll';
}

/** One step of the game (the host's, or one screen's). `held` says whether the person shaking still
 * holds the die; `peerOnline` whether a friend's seat is connected. */
export function step(dt: number, held: boolean, peerOnline: (id?: number) => boolean): void {
  G.t += dt; G.timer += dt;
  for (const f of G.floaters) f.t += dt;
  G.floaters = G.floaters.filter(f => f.t < 1.4);
  if (G.show) G.show.t += dt;
  if (G.phase === 'over') return;
  const p = curP(), auto = autoPlays(p, peerOnline);
  switch (G.phase) {
    case 'roll':
      if (auto && G.timer >= tune.snake_ai_delay) startShake(true);
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
      if (G.timer >= (G.order ? tune.order_show_time : tune.snake_no_move_time)) endRoll();
      break;
    case 'move': {
      const hp = G.hop!; hp.t += dt;
      if (hp.t >= tune.snake_hop_time) {
        hp.t -= tune.snake_hop_time;
        G.players[hp.pi].pos = hp.path.shift()!;
        play('tick');
        if (!hp.path.length) hopDone();
      }
      break;
    }
    case 'slide': {
      const sl = G.slide!; sl.t += dt;
      if (sl.t >= tune.snake_slide_time) { G.players[sl.pi].pos = sl.link.to; G.slide = null; if (sl.link.kind === 'ladder') play('coin'); settle(); }
      break;
    }
  }
}
