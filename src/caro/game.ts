// Cờ Caro's turns: the game being played (G), the setup screen's seats, and what happens each step —
// the first game's dice throw for who goes first, a piece placed and dropping onto its cell, five in a
// row, a full board. The rules are in ./rules.ts; the screens in ./scene.ts; online play in ./online.ts.
// Online, only the host runs this; a friend's screen draws the G the host sends.

import type { Bubble, Vote } from '../net/roomExtras';
import { tune, CONFIG } from '../config';
import { sfx } from '../audio';
import { rng, setSeed, freshSeed } from '../game/rng';
import type { Loose } from '../game/types';
import { emptyBoard, place, winLine, full, aiMove, EMPTY, type CaroPlayer, type CaroRules, type CaroSeat, type CaroWeights } from './rules';

/** The two seats' colours: the base under each piece. */
export const SEATS = [
  { color: '#ff7b6b', dark: '#d9442b' },
  { color: '#6aaef0', dark: '#2b6cd6' },
];
/** The computer's levels, as Cá Ngựa's. */
export const LV_NAMES = ['Dễ', 'Vừa', 'Khó'];

/** The game being played. Plain data: online, the host sends it as it is. */
export interface CaroGame {
  /** Online: the bubbles over the players' cards and the vote for a new game (src/net/roomExtras.ts). */
  emotes?: Bubble[];
  vote?: Vote;
  seed: number;
  players: CaroPlayer[];
  /** The board's side, and its cells (-1 empty, else the player's index). */
  size: number;
  board: number[];
  cur: number;
  /** order: the dice for who goes first; turn: waiting for a piece; drop: a piece falling; over. */
  phase: 'order' | 'turn' | 'drop' | 'over';
  t: number; timer: number;
  /** The first game's throw: each player's die, how long it has rolled. */
  order: { dice: number[]; t: number } | null;
  /** The piece falling onto its cell. */
  drop: { cell: number; t: number } | null;
  /** The last piece placed (-1 none), and the move count. */
  last: number;
  moves: number;
  /** The winning row's cells, when there is one. */
  line: number[] | null;
  /** The winner's index, or -1 (still playing, or a draw: see draw). */
  winner: number;
  draw: boolean;
  /** Which game of this sitting this is (1 first). */
  round: number;
  log: string[];
  floaters: { text: string; color: string; cell: number; t: number }[];
  /** The rules' switches this game was started with (RULE_KEYS), so a kept game or a friend's screen plays by them. */
  rules?: Record<string, number>;
}

/** The data/config.json switches a game keeps with it. */
export const RULE_KEYS = ['caro_size', 'caro_win', 'caro_block_two'];

/** The setup screen's seats: always two. */
export const caroSetup: { seats: CaroSeat[] } = {
  seats: [{ kind: 'human', animal: 4 }, { kind: 'ai', lv: 1, animal: 9 }],
};
/** The game being played (null before the first). */
export let G: CaroGame = null as unknown as CaroGame;
/** Puts a whole game in place (a friend's screen, from the host, or a kept game). */
export function setG(g: CaroGame): void {
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
export const rulesNow = (): CaroRules => ({ size: Math.round(tune.caro_size), win: Math.round(tune.caro_win), blockTwo: tune.caro_block_two >= 1 });
/** The computer's weights, from data/config.json now. */
export const weightsNow = (): CaroWeights => ({
  five: tune.caro_ai_five, openFour: tune.caro_ai_open_four, four: tune.caro_ai_four, openThree: tune.caro_ai_open_three,
  three: tune.caro_ai_three, openTwo: tune.caro_ai_open_two, two: tune.caro_ai_two, defend: tune.caro_ai_defend, easyRandom: tune.caro_ai_easy_random,
});

/** Whose turn it is. */
export const curP = (): CaroPlayer => G.players[G.cur];
/** True when a computer plays this player (a computer seat, or a friend who dropped). */
export const autoPlays = (p: CaroPlayer, peerOnline: (id?: number) => boolean): boolean => p.kind === 'ai' || (p.kind === 'remote' && !peerOnline(p.peer));

/** The whole game's lines, oldest first, for "Lịch sử" (the host's; a friend asks for it). Kept out of G. */
export const history: string[] = [];
/** A line in the game's log, newest first. */
export function log(s: string): void {
  G.log.unshift(s); if (G.log.length > 40) G.log.length = 40;
  history.push(s); if (history.length > 300) history.shift();
}
/** A cell in words: column letter and row number, as on the board's edge ("H8"). */
export function cellName(cell: number, size = G.size): string {
  return `${String.fromCharCode(65 + (cell % size))}${Math.floor(cell / size) + 1}`;
}

/** Starts a new sitting from the setup seats; `names` gives each seat's name when it is a person online.
 * The first game opens with a dice throw for who goes first. */
export function newGame(seed?: number, names: (string | undefined)[] = [], animalName: (a: number) => string = a => `Quân ${a + 1}`): void {
  history.length = 0;
  const s = seed ?? freshSeed(); setSeed(s);
  const players: CaroPlayer[] = [];
  caroSetup.seats.forEach((st, i) => {
    if (st.kind === 'off') return;
    const name = names[i] || st.name || (st.kind === 'ai' ? `Máy ${animalName(st.animal)}` : `Người ${animalName(st.animal)}`);
    players.push({ id: players.length, seat: i, name, kind: st.kind, lv: st.lv ?? 1, animal: st.animal, peer: st.peer, moves: 0, wins: 0 });
  });
  start(s, players, 0, 1);
  // the throw for who goes first: each a die, thrown again on a tie
  let d: number[];
  do d = players.map(() => 1 + Math.floor(rng() * 6)); while (d[0] === d[1]);
  G.order = { dice: d, t: 0 };
  G.cur = d[0] > d[1] ? 0 : 1;
  G.phase = 'order';
  play('dice');
  log('Ván mới! Thảy xúc xắc chọn người đi trước.');
}
/** Another game with the same players: the loser of the last goes first (after a draw, the one who went
 * second), and the wins carry over. */
export function playAgain(): void {
  if (!G?.players) return;
  const prev = G, first = prev.draw ? 1 - firstOf(prev) : prev.winner >= 0 ? 1 - prev.winner : 0;
  history.length = 0;
  const s = freshSeed(); setSeed(s);
  start(s, prev.players.map(p => ({ ...p, moves: 0 })), first, prev.round + 1);
  log(`Ván ${G.round}: ${curP().name} đi trước.`);
}
/** Who went first in a game (the piece count tells: the first player has one more, or as many). */
const firstOf = (g: CaroGame): number => {
  const a = g.board.filter(x => x === 0).length, b = g.board.filter(x => x === 1).length;
  return a >= b ? 0 : 1;
};
function start(seed: number, players: CaroPlayer[], cur: number, round: number): void {
  const R = rulesNow();
  G = { seed, players, size: R.size, board: emptyBoard(R.size), cur, phase: 'turn', t: 0, timer: 0, order: null, drop: null, last: -1, moves: 0, line: null, winner: -1, draw: false, round, log: [], floaters: [], rules: Object.fromEntries(RULE_KEYS.map(k => [k, tune[k]])) };
}

/** Places the current player's piece on cell, if it is their turn and the cell is empty; true when placed. */
export function tryPlace(cell: number): boolean {
  if (G.phase !== 'turn' || !place(G.board, cell, G.cur)) return false;
  const p = curP();
  p.moves++; G.moves++; G.last = cell;
  G.drop = { cell, t: 0 }; G.phase = 'drop'; G.timer = 0;
  play('land');
  log(`${p.name} đi ${cellName(cell)}.`);
  return true;
}
/** The piece has landed: five in a row wins, a full board is a draw, else the other player's turn. */
function landed(): void {
  const cell = G.drop!.cell, p = curP(), R = rulesNow();
  G.drop = null; G.timer = 0;
  const line = winLine(G.board, R, cell);
  if (line) {
    G.line = line; G.winner = G.cur; G.phase = 'over'; p.wins++;
    log(`${p.name} có ${line.length} quân liền: THẮNG!`);
    play('win');
    return;
  }
  if (R.blockTwo && blockedFive(cell)) { G.floaters.push({ text: 'Bị chặn hai đầu!', color: '#d9442b', cell, t: 0 }); log(`${p.name} đủ ${R.win} quân nhưng bị chặn hai đầu, chưa thắng.`); }
  if (full(G.board)) { G.draw = true; G.phase = 'over'; log('Hết chỗ đặt quân: HOÀ!'); play('land'); return; }
  G.cur = 1 - G.cur; G.phase = 'turn';
}
/** True when the piece on cell completes a row long enough that is shut at both ends (so it did not win). */
function blockedFive(cell: number): boolean {
  const R = rulesNow();
  return !!winLine(G.board, { ...R, blockTwo: false }, cell);
}

/** One step of the game (the host's, or one screen's). `peerOnline` says whether a friend's seat is connected. */
export function step(dt: number, peerOnline: (id?: number) => boolean): void {
  G.t += dt; G.timer += dt;
  for (const f of G.floaters) f.t += dt;
  G.floaters = G.floaters.filter(f => f.t < 1.6);
  switch (G.phase) {
    case 'order':
      G.order!.t += dt;
      if (G.order!.t >= tune.caro_order_time) {
        G.phase = 'turn'; G.timer = 0;
        play('double');
        log(`${G.players[0].name} đổ ${G.order!.dice[0]}, ${G.players[1].name} đổ ${G.order!.dice[1]}: ${curP().name} đi trước.`);
      }
      break;
    case 'turn': {
      const p = curP();
      if (autoPlays(p, peerOnline) && G.timer >= tune.caro_ai_delay) {
        const cell = aiMove(G.board, rulesNow(), G.cur, p.kind === 'ai' ? p.lv : 1, weightsNow(), rng);
        if (cell >= 0) tryPlace(cell);
      }
      break;
    }
    case 'drop':
      G.drop!.t += dt;
      if (G.drop!.t >= tune.caro_place_time) landed();
      break;
  }
}
/** How many empty cells are left (for the panel). */
export const emptyLeft = (): number => G.board.filter(x => x === EMPTY).length;
