// Cờ Caro's rules, with no browser: the square board, placing a piece, five in a row (and the
// Vietnamese rule that five blocked at both ends does not win), and how the computer picks a cell.
// The screens (src/caro/scene.ts) change a CaroGame only through these and ./game.ts, so a seed
// replays a game.
//
// The board is size x size cells, kept as one array, row by row: cell = r * size + c.
// A cell holds -1 when empty, else the index of the player whose piece stands on it (0 or 1).

/** An empty cell. */
export const EMPTY = -1;
/** The four lines through a cell: across, down, and the two diagonals. */
export const DIRS: [number, number][] = [[0, 1], [1, 0], [1, 1], [1, -1]];

/** What the rules read from data/config.json. */
export interface CaroRules {
  /** The board's side, in cells (15). */
  size: number;
  /** How many in a row win (5). */
  win: number;
  /** True: a row blocked at both ends by the other player's pieces does not win. The board's edge does not block. */
  blockTwo: boolean;
}
/** A seat on the setup screen: who plays it, the computer's level (0 Dễ, 1 Vừa, 2 Khó), the animal on its pieces. */
export interface CaroSeat { kind: 'human' | 'ai' | 'remote' | 'off'; lv?: number; animal: number; peer?: number; name?: string }
/** One player in a game. */
export interface CaroPlayer {
  id: number; seat: number; name: string; kind: CaroSeat['kind']; lv: number; animal: number; peer?: number;
  /** Pieces placed this game. */
  moves: number;
  /** Games won in this sitting (kept from one game to the next while the players stay the same). */
  wins: number;
}
/** How the computer weighs a cell: the points for each shape a piece there makes (data/config.json caro_ai_*). */
export interface CaroWeights {
  five: number; openFour: number; four: number; openThree: number; three: number; openTwo: number; two: number;
  /** How much blocking the other player counts, next to building one's own line. */
  defend: number;
  /** Dễ: the chance it plays a cell near the pieces at random instead of thinking. */
  easyRandom: number;
}

/** An empty board. */
export const emptyBoard = (size: number): number[] => Array(size * size).fill(EMPTY);
/** True when (r, c) is on the board. */
const on = (size: number, r: number, c: number): boolean => r >= 0 && c >= 0 && r < size && c < size;

/** The run of `who`'s pieces through cell along (dr, dc): its cells in order, and what stands just past
 * each end: 'edge', 'empty' or 'enemy'. The cell itself counts as who's even when still empty. */
export function runThrough(b: number[], size: number, cell: number, who: number, dr: number, dc: number): { cells: number[]; ends: ('edge' | 'empty' | 'enemy')[] } {
  const r0 = Math.floor(cell / size), c0 = cell % size, cells = [cell], ends: ('edge' | 'empty' | 'enemy')[] = [];
  for (const s of [-1, 1]) {
    let r = r0 + dr * s, c = c0 + dc * s;
    while (on(size, r, c) && b[r * size + c] === who) { if (s < 0) cells.unshift(r * size + c); else cells.push(r * size + c); r += dr * s; c += dc * s; }
    ends.push(!on(size, r, c) ? 'edge' : b[r * size + c] === EMPTY ? 'empty' : 'enemy');
  }
  return { cells, ends };
}

/** The winning row through cell for the piece standing there, or null: win or more in a row, and,
 * when blockTwo is on, not shut at both ends by the other player's pieces. */
export function winLine(b: number[], R: CaroRules, cell: number): number[] | null {
  const who = b[cell];
  if (who === EMPTY) return null;
  for (const [dr, dc] of DIRS) {
    const run = runThrough(b, R.size, cell, who, dr, dc);
    if (run.cells.length < R.win) continue;
    if (R.blockTwo && run.ends[0] === 'enemy' && run.ends[1] === 'enemy') continue;
    return run.cells;
  }
  return null;
}

/** True when no empty cell is left: a draw if nobody has won. */
export const full = (b: number[]): boolean => !b.includes(EMPTY);

/** Places who's piece on cell, if it is on the board and empty; true when it was placed. */
export function place(b: number[], cell: number, who: number): boolean {
  if (cell < 0 || cell >= b.length || b[cell] !== EMPTY) return false;
  b[cell] = who;
  return true;
}

/** The empty cells within reach (two cells) of a piece: where a move is worth thinking about. The
 * middle cell on an empty board. */
export function candidates(b: number[], size: number, reach = 2): number[] {
  const out: number[] = [];
  if (!b.some(x => x !== EMPTY)) return [Math.floor(size / 2) * size + Math.floor(size / 2)];
  for (let cell = 0; cell < b.length; cell++) {
    if (b[cell] !== EMPTY) continue;
    const r = Math.floor(cell / size), c = cell % size;
    let near = false;
    for (let dr = -reach; dr <= reach && !near; dr++) for (let dc = -reach; dc <= reach && !near; dc++) if (on(size, r + dr, c + dc) && b[(r + dr) * size + c + dc] !== EMPTY) near = true;
    if (near) out.push(cell);
  }
  return out;
}

/** The shapes a piece makes along one line, strongest first. */
export type Shape = 'five' | 'openFour' | 'four' | 'openThree' | 'three' | 'openTwo' | 'two' | 'none';
const PATTERNS: [Shape, string[]][] = [
  ['openFour', ['_xxxx_']],
  ['four', ['xxxx_', '_xxxx', 'xxx_x', 'x_xxx', 'xx_xx']],
  ['openThree', ['_xxx__', '__xxx_', '_xx_x_', '_x_xx_']],
  ['three', ['xxx__', '__xxx', 'xx_x_', '_x_xx', 'x_xx_', '_xx_x', 'x__xx', 'xx__x', 'x_x_x']],
  ['openTwo', ['__xx__', '_x_x_', '__xx_', '_xx__']],
  ['two', ['xx___', '___xx', 'x_x__', '__x_x', 'x___x']],
];

/** The strongest shape a piece of who's on (empty) cell makes along (dr, dc). A row of five that the
 * rules would not count (blocked at both ends) is no shape at all. */
export function shapeAt(b: number[], R: CaroRules, cell: number, who: number, dr: number, dc: number): Shape {
  const run = runThrough(b, R.size, cell, who, dr, dc);
  if (run.cells.length >= R.win) return R.blockTwo && run.ends[0] === 'enemy' && run.ends[1] === 'enemy' ? 'none' : 'five';
  // the line through the cell, R.win - 1 cells each way: x who's (the cell too), _ empty, o the other's or the edge
  const r0 = Math.floor(cell / R.size), c0 = cell % R.size, span = R.win - 1;
  let line = '';
  for (let k = -span; k <= span; k++) {
    const r = r0 + dr * k, c = c0 + dc * k;
    line += k === 0 ? 'x' : !on(R.size, r, c) ? 'o' : b[r * R.size + c] === who ? 'x' : b[r * R.size + c] === EMPTY ? '_' : 'o';
  }
  for (const [shape, pats] of PATTERNS) {
    for (const p of pats) {
      for (let at = line.indexOf(p); at >= 0; at = line.indexOf(p, at + 1)) {
        if (at <= span && at + p.length > span && p[span - at] === 'x') return shape; // the pattern uses the cell itself
      }
    }
  }
  return 'none';
}

/** The points of a piece of who's on cell: the sum of its shapes along the four lines. `upTo` keeps
 * only the shapes from the strongest down to that one (the computer at Vừa blocks fours, not threes). */
export function cellScore(b: number[], R: CaroRules, cell: number, who: number, W: CaroWeights, upTo: Shape = 'two'): number {
  const order: Shape[] = ['five', 'openFour', 'four', 'openThree', 'three', 'openTwo', 'two'];
  const limit = order.indexOf(upTo);
  let s = 0;
  for (const [dr, dc] of DIRS) {
    const sh = shapeAt(b, R, cell, who, dr, dc);
    if (sh !== 'none' && order.indexOf(sh) <= limit) s += W[sh];
  }
  return s;
}

/**
 * The cell the computer plays for player `me` (0 or 1) at level lv: 0 Dễ, 1 Vừa, 2 Khó.
 * Every level takes a win in one, and Vừa and Khó block the other's win in one. Then each cell near
 * the pieces scores its own shapes plus `defend` times the other player's shapes there: Dễ sees only
 * its own and often plays at random, Vừa blocks fours, Khó blocks open threes too. Ties are broken by
 * rand (the game's seeded random), leaning to the middle of the board.
 */
export function aiMove(b: number[], R: CaroRules, me: number, lv: number, W: CaroWeights, rand: () => number): number {
  const cand = candidates(b, R.size), them = 1 - me;
  if (!cand.length) return -1;
  for (const cell of cand) if (shapeAtAny(b, R, cell, me) === 'five') return cell; // a win in one
  if (lv >= 1) for (const cell of cand) if (shapeAtAny(b, R, cell, them) === 'five') return cell; // block theirs
  if (lv === 0 && rand() < W.easyRandom) return cand[Math.floor(rand() * cand.length)];
  const mid = (R.size - 1) / 2;
  let best = -Infinity, pick = cand[0];
  for (const cell of cand) {
    const r = Math.floor(cell / R.size), c = cell % R.size;
    const own = cellScore(b, R, cell, me, W);
    const block = lv === 0 ? 0 : cellScore(b, R, cell, them, W, lv === 1 ? 'four' : 'two');
    const s = own + W.defend * block - (Math.abs(r - mid) + Math.abs(c - mid)) * 0.01 + rand() * 0.5;
    if (s > best) { best = s; pick = cell; }
  }
  return pick;
}
/** 'five' when a piece of who's on cell would win along any line, else 'none'. */
function shapeAtAny(b: number[], R: CaroRules, cell: number, who: number): Shape {
  for (const [dr, dc] of DIRS) if (shapeAt(b, R, cell, who, dr, dc) === 'five') return 'five';
  return 'none';
}

/** The ranking at the end: the winner first (a draw keeps the seats' order). */
export function rank(players: CaroPlayer[], winner: number): CaroPlayer[] {
  return [...players].sort((a, b) => (b.id === winner ? 1 : 0) - (a.id === winner ? 1 : 0));
}
