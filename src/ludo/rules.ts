// Cá Ngựa's rules, with no browser: the board's cells, which horses may move for a roll, a move,
// and the computer's choice. The screens (src/ludo/scene.ts) read and change a LudoState only
// through these, so a seed replays a game exactly. Values come from data/config.json (ludo_*).
//
// The board is a 15x15 grid. The track is the 52 cells around the cross; each side (0 left, 1 top,
// 2 right, 3 bottom) starts 13 cells after the last, walks 50 cells to its gate (the cell at the
// end of its own arm), then climbs its stable's 6 steps toward the centre.
// A horse's progress p: -1 at home in its corner, 0..50 on the track, 51..56 on stable step 1..6.

/** One cell of the grid: row, column. */
export type Cell = [number, number];

/** The 52 track cells, clockwise from side 0's start. */
export const TRACK: Cell[] = (() => {
  const t: Cell[] = [];
  for (let c = 1; c <= 5; c++) t.push([6, c]);
  for (let r = 5; r >= 0; r--) t.push([r, 6]);
  t.push([0, 7]);
  for (let r = 0; r <= 5; r++) t.push([r, 8]);
  for (let c = 9; c <= 14; c++) t.push([6, c]);
  t.push([7, 14]);
  for (let c = 14; c >= 9; c--) t.push([8, c]);
  for (let r = 9; r <= 14; r++) t.push([r, 8]);
  t.push([14, 7]);
  for (let r = 14; r >= 9; r--) t.push([r, 6]);
  for (let c = 5; c >= 0; c--) t.push([8, c]);
  t.push([7, 0]);
  t.push([6, 0]);
  return t;
})();
/** How many cells the track has. */
export const TRACK_LEN = TRACK.length; // 52
/** The last progress on the track: the side's gate. */
export const GATE = 50;
/** The stable's steps. */
export const STEPS = 6;
/** The last progress: the stable's top step. */
export const TOP = GATE + STEPS; // 56

/** Where a side's horses enter the track. */
export const startOf = (side: number): number => side * 13;
/** The track cell index of a side's progress p (0..50). */
export const trackIndex = (side: number, p: number): number => (startOf(side) + p) % TRACK_LEN;
/** The stable's step k (1..6) of a side, as a grid cell: from the gate's arm toward the centre. */
export function stepCell(side: number, k: number): Cell {
  if (side === 0) return [7, k];
  if (side === 1) return [k, 7];
  if (side === 2) return [7, 14 - k];
  return [14 - k, 7];
}
/** The grid cell of a horse at progress p, or null while it waits in its corner. */
export function cellOf(side: number, p: number): Cell | null {
  if (p < 0) return null;
  if (p <= GATE) return TRACK[trackIndex(side, p)];
  return stepCell(side, p - GATE);
}

/** A seat on the setup screen. */
export interface LudoSeat { kind: 'human' | 'ai' | 'remote' | 'off'; lv?: number; peer?: number; name?: string }
/** One player in a game. */
export interface LudoPlayer {
  id: number; side: number; name: string; kind: LudoSeat['kind']; lv: number; peer?: number;
  /** Each horse's progress. */
  horses: number[];
  /** Finished: 1 for first, 2 for second... (0 while still racing). */
  place: number;
  kicks: number; kicked: number; sixes: number;
}
/** What the rules read from data/config.json. */
export interface LudoRules { horses: number; exitOnOne: boolean; bonusSix: boolean; bonusKick: boolean; noJump: boolean; homeStrict: boolean }
/** A legal move: which horse, from and to, and whom it kicks home. */
export interface LudoMove { h: number; from: number; to: number; kick?: { pi: number; h: number } }

/** The rolls that bring a horse out of its corner. */
export const exitRolls = (R: LudoRules): number[] => (R.exitOnOne ? [1, 6] : [6]);

/** Who stands on a grid cell (players still racing or not, every horse on the board). */
export function occupant(players: LudoPlayer[], cell: Cell): { pi: number; h: number } | null {
  for (const q of players) for (let h = 0; h < q.horses.length; h++) {
    const c = cellOf(q.side, q.horses[h]);
    if (c && c[0] === cell[0] && c[1] === cell[1]) return { pi: q.id, h };
  }
  return null;
}

/** Every legal move for player pi with this roll. */
export function legalMoves(players: LudoPlayer[], pi: number, roll: number, R: LudoRules): LudoMove[] {
  const p = players[pi], out: LudoMove[] = [];
  p.horses.forEach((from, h) => {
    let to = -2;
    if (from < 0) { if (exitRolls(R).includes(roll)) to = 0; }
    else if (R.homeStrict) {
      if (from < GATE) { if (from + roll <= GATE) to = from + roll; }
      else if (from === GATE) to = GATE + roll;                    // the gate: roll k climbs to step k
      else if (from < TOP && roll === from - GATE + 1) to = from + 1; // on step s: only s+1 climbs one more
    } else if (from + roll <= TOP) to = from + roll;
    if (to < 0) return;
    // the cells passed over: none may hold a horse when jumping is not allowed
    if (R.noJump && from >= 0) {
      for (let q = from + 1; q < to; q++) if (occupant(players, cellOf(p.side, q)!)) return;
    }
    const at = occupant(players, cellOf(p.side, to)!);
    if (at && at.pi === pi) return; // never onto your own horse
    out.push(at ? { h, from, to, kick: at } : { h, from, to });
  });
  return out;
}

/** Makes the move: the horse goes, a horse it lands on goes back to its corner. */
export function applyMove(players: LudoPlayer[], pi: number, m: LudoMove): void {
  if (m.kick) { players[m.kick.pi].horses[m.kick.h] = -1; players[m.kick.pi].kicked++; players[pi].kicks++; }
  players[pi].horses[m.h] = m.to;
}

/** True when every horse of the player is in its stable. */
export const allHome = (p: LudoPlayer): boolean => p.horses.every(x => x > GATE);

/** How many horses of other players could land on this track cell next roll (1..6 behind it, or
 * waiting in their corner when it is their start cell). */
export function danger(players: LudoPlayer[], pi: number, side: number, p: number, R: LudoRules): number {
  if (p < 0 || p > GATE) return 0;
  const at = trackIndex(side, p);
  let n = 0;
  for (const q of players) {
    if (q.id === pi || q.place) continue;
    for (const x of q.horses) {
      if (x < 0) { if (startOf(q.side) === at && exitRolls(R).length) n += 0.5; continue; }
      if (x > GATE) continue;
      const d = (at - trackIndex(q.side, x) + TRACK_LEN) % TRACK_LEN;
      if (d >= 1 && d <= 6 && x + d <= GATE) n++;
    }
  }
  return n;
}

/** The computer's choice among the legal moves: level 0 picks at random, 1 likes kicks, coming out and
 * going home, 2 also keeps its horses out of reach. rand is the game's rng. */
export function aiPick(players: LudoPlayer[], pi: number, moves: LudoMove[], lv: number, R: LudoRules, rand: () => number): LudoMove {
  if (moves.length === 1 || lv <= 0) return moves[Math.floor(rand() * moves.length)];
  const p = players[pi];
  let best = moves[0], bestScore = -Infinity;
  for (const m of moves) {
    let s = m.to - Math.max(0, m.from); // how far it goes
    if (m.kick) s += 100 + players[m.kick.pi].horses[m.kick.h];
    if (m.from < 0) s += 70;
    if (m.to > GATE && m.from <= GATE) s += 55;
    if (m.to > GATE) s += 10;
    if (lv >= 2) {
      s -= 40 * danger(players, pi, p.side, m.to, R);
      s += 30 * danger(players, pi, p.side, m.from, R);
      if (m.from === 0) s += 8; // frees its own start for the next horse
    }
    s += rand() * 3; // ties go either way
    if (s > bestScore) { bestScore = s; best = m; }
  }
  return best;
}
