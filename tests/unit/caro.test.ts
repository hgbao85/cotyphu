// Vitest: Cờ Caro's rules (src/caro/rules.ts) — five in a row, the blocked-at-both-ends rule, the
// board's edge, and what the computer plays at each level.
import { describe, expect, it } from 'vitest';
import { emptyBoard, place, winLine, full, runThrough, shapeAt, aiMove, candidates, rank, EMPTY, type CaroRules, type CaroWeights, type CaroPlayer } from '../../src/caro/rules';

const R: CaroRules = { size: 15, win: 5, blockTwo: true };
const FREE: CaroRules = { ...R, blockTwo: false };
const W: CaroWeights = { five: 100000, openFour: 20000, four: 2500, openThree: 2000, three: 300, openTwo: 200, two: 30, defend: 0.9, easyRandom: 0 };
const at = (r: number, c: number, size = R.size): number => r * size + c;
/** A board with pieces: each [who, r, c]. */
function board(pieces: [number, number, number][], size = R.size): number[] {
  const b = emptyBoard(size);
  for (const [who, r, c] of pieces) b[at(r, c, size)] = who;
  return b;
}
/** Always the same "random" number, so a test reads the same every run. */
const fixed = (v: number) => () => v;

describe('placing', () => {
  it('places on an empty cell only', () => {
    const b = emptyBoard(15);
    expect(place(b, at(7, 7), 0)).toBe(true);
    expect(place(b, at(7, 7), 1)).toBe(false);
    expect(place(b, -1, 1)).toBe(false);
    expect(place(b, 225, 1)).toBe(false);
    expect(b[at(7, 7)]).toBe(0);
  });
  it('a board is full when no cell is empty', () => {
    expect(full(emptyBoard(3))).toBe(false);
    expect(full(Array(9).fill(1))).toBe(true);
  });
});

describe('five in a row', () => {
  it('wins across, down and on both diagonals', () => {
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const b = board([0, 1, 2, 3, 4].map(k => [0, 5 + dr * k, 5 + dc * k] as [number, number, number]));
      expect(winLine(b, R, at(5 + dr * 2, 5 + dc * 2))?.length).toBe(5);
    }
  });
  it('four is not enough', () => {
    const b = board([[0, 3, 3], [0, 3, 4], [0, 3, 5], [0, 3, 6]]);
    expect(winLine(b, R, at(3, 4))).toBeNull();
  });
  it('six in a row still wins', () => {
    const b = board([0, 1, 2, 3, 4, 5].map(c => [1, 9, 2 + c] as [number, number, number]));
    expect(winLine(b, R, at(9, 4))?.length).toBe(6);
  });
  it('five shut by the other player at both ends does not win under the Vietnamese rule', () => {
    const b = board([[1, 7, 2], [0, 7, 3], [0, 7, 4], [0, 7, 5], [0, 7, 6], [0, 7, 7], [1, 7, 8]]);
    expect(winLine(b, R, at(7, 5))).toBeNull();
    expect(winLine(b, FREE, at(7, 5))?.length).toBe(5); // with the rule off, it wins
  });
  it('five shut at one end only wins', () => {
    const b = board([[1, 7, 2], [0, 7, 3], [0, 7, 4], [0, 7, 5], [0, 7, 6], [0, 7, 7]]);
    expect(winLine(b, R, at(7, 3))?.length).toBe(5);
  });
  it('the board\'s edge does not block', () => {
    const b = board([[0, 0, 0], [0, 0, 1], [0, 0, 2], [0, 0, 3], [0, 0, 4], [1, 0, 5]]);
    expect(winLine(b, R, at(0, 0))?.length).toBe(5);
    const r = runThrough(b, 15, at(0, 2), 0, 0, 1);
    expect(r.ends).toEqual(['edge', 'enemy']);
  });
  it('an empty cell wins nothing', () => {
    expect(winLine(emptyBoard(15), R, at(7, 7))).toBeNull();
  });
});

describe('shapes', () => {
  it('reads an open four, a four with a gap and an open three', () => {
    expect(shapeAt(board([[0, 7, 4], [0, 7, 5], [0, 7, 6]]), R, at(7, 7), 0, 0, 1)).toBe('openFour');
    expect(shapeAt(board([[0, 7, 4], [0, 7, 5], [0, 7, 7]]), R, at(7, 8), 0, 0, 1)).toBe('four'); // xx_xx
    expect(shapeAt(board([[0, 7, 5], [0, 7, 6]]), R, at(7, 7), 0, 0, 1)).toBe('openThree');
  });
  it('a five the rule will not count is no shape', () => {
    const b = board([[1, 7, 2], [0, 7, 3], [0, 7, 4], [0, 7, 6], [0, 7, 7], [1, 7, 8]]);
    expect(shapeAt(b, R, at(7, 5), 0, 0, 1)).toBe('none');
    expect(shapeAt(b, FREE, at(7, 5), 0, 0, 1)).toBe('five');
  });
});

describe('the computer', () => {
  it('opens in the middle of an empty board', () => {
    expect(aiMove(emptyBoard(15), R, 0, 2, W, fixed(0.5))).toBe(at(7, 7));
    expect(candidates(emptyBoard(15), 15)).toEqual([at(7, 7)]);
  });
  it('every level takes a win in one', () => {
    const b = board([[0, 4, 4], [0, 4, 5], [0, 4, 6], [0, 4, 7], [1, 4, 3], [1, 9, 9], [1, 10, 9], [1, 11, 9]]);
    for (const lv of [0, 1, 2]) expect(aiMove(b, R, 0, lv, W, fixed(0.99))).toBe(at(4, 8));
  });
  it('Vừa and Khó block the other\'s win in one', () => {
    const b = board([[1, 2, 2], [1, 3, 3], [1, 4, 4], [1, 5, 5], [0, 1, 1], [0, 7, 9]]);
    for (const lv of [1, 2]) expect(aiMove(b, R, 0, lv, W, fixed(0.3))).toBe(at(6, 6));
  });
  it('Khó blocks an open three; it would have built its own two otherwise', () => {
    const b = board([[1, 7, 6], [1, 7, 7], [1, 7, 8], [0, 3, 3]]);
    const pick = aiMove(b, R, 0, 2, W, fixed(0.3));
    expect([at(7, 5), at(7, 9)]).toContain(pick);
  });
  it('does not try to block a five the rule would not count', () => {
    // the other player's four is shut at one end by the computer and its last cell is shut by the computer too
    const b = board([[0, 5, 1], [1, 5, 2], [1, 5, 3], [1, 5, 4], [1, 5, 5], [0, 5, 7], [0, 9, 9], [0, 10, 10], [0, 11, 11]]);
    // the computer has three on a diagonal, open: it builds there instead of filling (5, 6)
    expect(aiMove(b, R, 0, 2, W, fixed(0.3))).not.toBe(at(5, 6));
  });
  it('only plays empty cells', () => {
    const b = board([[0, 7, 7], [1, 7, 8], [0, 8, 7]]);
    for (const lv of [0, 1, 2]) for (const v of [0.1, 0.5, 0.9]) expect(b[aiMove(b, R, 1, lv, { ...W, easyRandom: 0.5 }, fixed(v))]).toBe(EMPTY);
  });
});

describe('the end', () => {
  it('ranks the winner first', () => {
    const p = (id: number): CaroPlayer => ({ id, seat: id, name: `P${id}`, kind: 'ai', lv: 1, animal: id, moves: 0, wins: 0 });
    expect(rank([p(0), p(1)], 1).map(x => x.id)).toEqual([1, 0]);
    expect(rank([p(0), p(1)], -1).map(x => x.id)).toEqual([0, 1]);
  });
});
