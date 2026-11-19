// Rắn và Thang's rules, with no browser: the 100-cell board, where a cell sits on the grid, the
// ladders and snakes (data/snake-board.json), and where a throw takes a piece. The screens
// (src/snake/scene.ts) change a SnakeGame only through these and ./game.ts, so a seed replays a game.
//
// The board is 10x10, numbered from the bottom left like a snake itself: 1..10 left to right on the
// bottom row, 11..20 right to left on the next, and so on up to 100 at the top left.
// A piece's position: 0 waiting beside the board, 1..100 on a cell.

import board from '../../data/snake-board.json';

/** The last cell: whoever stands on it first wins. */
export const LAST = 100;
/** One ladder or snake: from the cell you land on, to the cell you end on. */
export interface Link { from: number; to: number; kind: 'ladder' | 'snake' }
/** The board's ladders (going up) and snakes (going down), from data/snake-board.json. */
export const LINKS: Link[] = [
  ...board.ladders.map(([from, to]) => ({ from, to, kind: 'ladder' as const })),
  ...board.snakes.map(([from, to]) => ({ from, to, kind: 'snake' as const })),
];
/** The ladder or snake starting on cell n, if any. */
export const linkAt = (n: number): Link | undefined => LINKS.find(l => l.from === n);

/** The grid square of cell n (1..100): row 0 at the top, column 0 at the left. */
export function gridOf(n: number): { r: number; c: number } {
  const k = n - 1, row = Math.floor(k / 10), col = row % 2 === 0 ? k % 10 : 9 - (k % 10);
  return { r: 9 - row, c: col };
}

/** A seat on the setup screen: who plays it and the animal on its piece. */
export interface SnakeSeat { kind: 'human' | 'ai' | 'remote' | 'off'; animal: number; peer?: number; name?: string }
/** One player in a game. */
export interface SnakePlayer {
  id: number; seat: number; name: string; kind: SnakeSeat['kind']; animal: number; peer?: number;
  /** Where the piece stands: 0 beside the board, 1..100. */
  pos: number;
  ladders: number; bites: number; sixes: number;
}
/** What the rules read from data/config.json. */
export interface SnakeRules { dice: number; exactFinish: boolean; sixToStart: boolean; bonusSix: boolean }

/** True when this throw lets a piece waiting beside the board come on: any throw, or, when that rule is
 * on, a six with one die and a double (any double, not a single six) with two. */
export const canEnter = (dice: number[], R: SnakeRules): boolean => !R.sixToStart || (dice.length === 2 ? dice[0] === dice[1] : dice[0] === 6);
/** True when this throw earns another: a six with one die, a double with two. */
export const throwsAgain = (dice: number[]): boolean => (dice.length === 2 ? dice[0] === dice[1] : dice[0] === 6);

/** The cells a piece hops through for a throw of d from pos, in order: up to 100 and, past it, back
 * down again when the exact finish is on (stopping at 100 when it is off). Empty: it cannot move. */
export function walk(pos: number, dice: number[], R: SnakeRules): number[] {
  if (pos === 0 && !canEnter(dice, R)) return [];
  const d = dice.reduce((a, b) => a + b, 0), path: number[] = [];
  let at = pos, dir = 1;
  for (let k = 0; k < d; k++) {
    if (at === LAST) { if (!R.exactFinish) break; dir = -1; }
    at += dir; path.push(at);
  }
  return path;
}

/** Where the piece ends after the throw and any ladder or snake on the cell it reaches. */
export function landing(pos: number, dice: number[], R: SnakeRules): { path: number[]; link?: Link; end: number } {
  const path = walk(pos, dice, R);
  if (!path.length) return { path, end: pos };
  const stop = path[path.length - 1], link = linkAt(stop);
  return { path, link, end: link ? link.to : stop };
}

/** The ranking at the end: the winner first, then by how far each piece got. */
export function rank(players: SnakePlayer[], winner: number): SnakePlayer[] {
  return [...players].sort((a, b) => (b.id === winner ? 1 : 0) - (a.id === winner ? 1 : 0) || b.pos - a.pos);
}
