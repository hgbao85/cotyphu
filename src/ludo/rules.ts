// Cá Ngựa's rules, with no browser: the board's cells, which horses may move for a roll, a move,
// and the computer's choice. The screens (src/ludo/scene.ts) read and change a LudoState only
// through these, so a seed replays a game exactly. Values come from data/config.json (ludo_*).
//
// The board is a 15x15 grid. The track is the 52 cells around the cross; each side (0 left, 1 top,
// 2 right, 3 bottom) comes out on the outer corner cell of its own arm, by its yard, walks the whole
// way round to its gate (the middle cell at the end of that arm, the one before its start), then
// climbs its stable's 6 steps toward the centre.
// A horse's progress p: -1 at home in its corner, 0..51 on the track, 52..57 on stable step 1..6.

/** One cell of the grid: row, column. */
export type Cell = [number, number];

/** The 52 track cells, clockwise from the cell after side 0's start (its start is the last). */
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
/** The last progress on the track: the side's gate, one cell before its start. */
export const GATE = 51;
/** The stable's steps. */
export const STEPS = 6;
/** The last progress: the stable's top step. */
export const TOP = GATE + STEPS; // 57

/** Where a side's horses enter the track: the outer corner cell of its arm, beside its yard. */
export const startOf = (side: number): number => (side * 13 + 51) % 52;
/** The track cell index of a side's progress p (0..51). */
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
export interface LudoRules { horses: number; dice: number; exitOnOne: boolean; exitDouble: boolean; bonusSix: boolean; bonusKick: boolean; noJump: boolean; homeStrict: boolean }
/** A legal move: which horse, from and to, the dice it spends, and whom it kicks home. */
export interface LudoMove { h: number; from: number; to: number; dice: number[]; kick?: { pi: number; h: number } }

/** The faces that bring a horse out of its corner. */
export const exitRolls = (R: LudoRules): number[] => (R.exitOnOne ? [1, 6] : [6]);
/** True when this throw brings a horse out: one die showing an exit face, or (two dice) a double. */
export const canExit = (dice: number[], R: LudoRules): boolean => dice.some(d => exitRolls(R).includes(d)) || (R.exitDouble && dice.length === 2 && dice[0] === dice[1]);
/** True when this throw earns another: a double with two dice, a six with one. */
export const throwsAgain = (dice: number[]): boolean => (dice.length === 2 ? dice[0] === dice[1] : dice[0] === 6);

/** Who stands on a grid cell (players still racing or not, every horse on the board). */
export function occupant(players: LudoPlayer[], cell: Cell): { pi: number; h: number } | null {
  for (const q of players) for (let h = 0; h < q.horses.length; h++) {
    const c = cellOf(q.side, q.horses[h]);
    if (c && c[0] === cell[0] && c[1] === cell[1]) return { pi: q.id, h };
  }
  return null;
}

/** Every legal move for player pi with the dice still to use. Each die moves one horse on its own:
 * a die showing an exit face (6, or 1 too) brings a horse out; a double of other faces brings one out
 * with both dice; any other die moves a horse that many cells. On the traditional stable a die showing
 * k climbs from the gate to step k, and one showing s + 1 climbs from step s. With both dice unused a
 * horse may also go their total in one move. Each move says which dice it spends. */
export function legalMoves(players: LudoPlayer[], pi: number, use: number[], R: LudoRules): LudoMove[] {
  const p = players[pi], out: LudoMove[] = [], ex = exitRolls(R);
  const pair = R.exitDouble && use.length === 2 && use[0] === use[1] && !ex.includes(use[0]);
  p.horses.forEach((from, h) => {
    if (from < 0) {
      for (const d of new Set(use)) if (ex.includes(d)) moveTo(h, from, 0, [d]);
      if (pair) moveTo(h, from, 0, [use[0], use[1]]);
      return;
    }
    for (const d of new Set(use)) {
      let to = -2;
      if (R.homeStrict) {
        if (from < GATE) { if (from + d <= GATE) to = from + d; }
        else if (from === GATE) to = GATE + d;
        else if (from < TOP && d === from - GATE + 1) to = from + 1;
      } else if (from + d <= TOP) to = from + d;
      if (to >= 0) moveTo(h, from, to, [d]);
    }
    if (use.length === 2) { // both dice on one horse, in one go: the total, passing the middle cell without stopping
      const sum = use[0] + use[1], last = R.homeStrict ? GATE : TOP;
      if (from < last && from + sum <= last) moveTo(h, from, from + sum, [use[0], use[1]]);
    }
  });
  return out;
  function moveTo(h: number, from: number, to: number, dice: number[]): void {
    // the cells passed over: none may hold a horse when jumping is not allowed
    if (R.noJump && from >= 0) {
      for (let q = from + 1; q < to; q++) if (occupant(players, cellOf(p.side, q)!)) return;
    }
    const at = occupant(players, cellOf(p.side, to)!);
    if (at && at.pi === pi) return; // never onto your own horse
    out.push(at ? { h, from, to, dice, kick: at } : { h, from, to, dice });
  }
}

/** How far a move goes, as the player picks it: one die's face, or the total when it spends both on a
 * horse already out (a double of 2 to 5 bringing a horse out counts as its face). */
export const moveValue = (m: LudoMove): number => (m.dice.length > 1 && m.from >= 0 ? m.dice[0] + m.dice[1] : m.dice[0]);

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

/** How much the computer likes a move, before any chance: how far it goes, a kick (more for a horse
 * that had come far), coming out, reaching the stable; from level 2 also keeping out of reach. */
export function scoreMove(players: LudoPlayer[], pi: number, m: LudoMove, lv: number, R: LudoRules): number {
  const p = players[pi];
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
  return s;
}

/** The computer's choice among the legal moves: level 0 picks at random, 1 likes kicks, coming out and
 * going home, 2 also keeps its horses out of reach. rand is the game's rng. */
export function aiPick(players: LudoPlayer[], pi: number, moves: LudoMove[], lv: number, R: LudoRules, rand: () => number): LudoMove {
  if (moves.length === 1 || lv <= 0) return moves[Math.floor(rand() * moves.length)];
  let best = moves[0], bestScore = -Infinity;
  for (const m of moves) {
    const s = scoreMove(players, pi, m, lv, R) + rand() * 3; // ties go either way
    if (s > bestScore) { bestScore = s; best = m; }
  }
  return best;
}

/** A copy of the table a plan may change without touching the game. */
const copyTable = (players: LudoPlayer[]): LudoPlayer[] => players.map(q => ({ ...q, horses: [...q.horses] }));

/** Level 2 thinks the whole throw through: for each first move with one die, the best move the other die
 * leaves, and picks the pair (or the one move spending both) that adds up to most. Lower levels, or a
 * throw with one die left, pick move by move (aiPick). `use` is the dice still to use. */
export function aiPlan(players: LudoPlayer[], pi: number, moves: LudoMove[], use: number[], lv: number, R: LudoRules, rand: () => number): LudoMove {
  if (lv < 2 || use.length < 2 || moves.length === 1) return aiPick(players, pi, moves, lv, R, rand);
  let best = moves[0], bestScore = -Infinity;
  for (const m of moves) {
    let s = scoreMove(players, pi, m, lv, R);
    if (m.dice.length < use.length) { // a die is left: the best it can then do (a die that cannot move costs a little)
      const after = copyTable(players);
      applyMove(after, pi, m);
      const rest = [...use]; for (const d of m.dice) rest.splice(rest.indexOf(d), 1);
      const next = legalMoves(after, pi, rest, R);
      s += next.length ? Math.max(...next.map(n => scoreMove(after, pi, n, lv, R))) : -5;
    }
    s += rand() * 3;
    if (s > bestScore) { bestScore = s; best = m; }
  }
  return best;
}
