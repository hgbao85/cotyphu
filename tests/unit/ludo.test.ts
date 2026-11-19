// Vitest: Cá Ngựa's rules (src/ludo/rules.ts) — the board, coming out, each die on its own or both as a
// total, blocking, kicking, climbing the stable, the computer's choice.
// Design record: design/game-brief.md (Features: Cá Ngựa, and its After play lines from 2026-11-19).
import { describe, expect, it } from 'vitest';
import {
  TRACK, TRACK_LEN, GATE, TOP, STEPS, startOf, trackIndex, stepCell, cellOf, legalMoves, applyMove, moveValue,
  throwsAgain, canExit, allHome, danger, aiPick, aiPlan, type LudoMove, type LudoPlayer, type LudoRules,
} from '../../src/ludo/rules';

// ---- Fixtures ---------------------------------------------------------------------------------
/** The rules as data/config.json sets them (2 dice, a 1 or a 6 comes out, no jumping, traditional stable). */
function rules(over: Partial<LudoRules> = {}): LudoRules {
  return { horses: 4, dice: 2, exitOnOne: true, exitDouble: true, bonusSix: true, bonusKick: false, noJump: true, homeStrict: true, ...over };
}
/** A table: one player per list, playing sides 0, 1, 2... with their horses' progress (-1: in the yard). */
function table(...horses: number[][]): LudoPlayer[] {
  return horses.map((hs, id) => ({ id, side: id, name: `P${id}`, kind: 'human', lv: 1, horses: [...hs], place: 0, kicks: 0, kicked: 0, sixes: 0 }));
}
/** Where a move of player 0's horse h can end, with the dice each spends, as "to:dice". */
function ends(moves: LudoMove[], h = 0): string[] {
  return moves.filter(m => m.h === h).map(m => `${m.to}:${m.dice.join('+')}`).sort();
}
const YARD = -1;
/** Player 1's progress that puts its horse on the same track cell as player 0's progress p. */
const sameCellFor1 = (p0: number): number => (trackIndex(0, p0) - startOf(1) + TRACK_LEN) % TRACK_LEN;

// ---- The board ----------------------------------------------------------------------------------
describe('board', () => {
  it('has 52 track cells, every one different, all on the cross', () => {
    expect(TRACK.length).toBe(52);
    expect(new Set(TRACK.map(([r, c]) => `${r},${c}`)).size).toBe(52);
    for (const [r, c] of TRACK) expect(r === 6 || r === 7 || r === 8 || c === 6 || c === 7 || c === 8).toBe(true);
  });

  it('starts each side on the outer corner cell of its own arm, beside its yard', () => {
    // asked for on 2026-11-19: the four cells at the ends of the arms, next to the yards
    expect([0, 1, 2, 3].map(s => TRACK[startOf(s)])).toEqual([[6, 0], [0, 8], [8, 14], [14, 6]]);
  });

  it('puts each gate on the middle cell at the end of the arm, the cell just before the start', () => {
    expect([0, 1, 2, 3].map(s => cellOf(s, GATE))).toEqual([[7, 0], [0, 7], [7, 14], [14, 7]]);
    for (let s = 0; s < 4; s++) expect(trackIndex(s, GATE)).toBe((startOf(s) + TRACK_LEN - 1) % TRACK_LEN);
  });

  it('climbs six stable steps from the gate toward the centre, the sixth on the centre petal', () => {
    expect(STEPS).toBe(6);
    expect(TOP).toBe(GATE + STEPS);
    expect([1, 2, 3, 4, 5, 6].map(k => stepCell(0, k))).toEqual([[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]]);
    expect([0, 1, 2, 3].map(s => stepCell(s, 6))).toEqual([[7, 6], [6, 7], [7, 8], [8, 7]]);
  });

  it('has no cell for a horse still in its yard', () => {
    expect(cellOf(0, YARD)).toBeNull();
  });
});

// ---- Coming out ---------------------------------------------------------------------------------
describe('coming out', () => {
  it('a 1 or a 6 brings one horse out, spending that die only', () => {
    expect(ends(legalMoves(table([YARD, YARD, YARD, YARD]), 0, [6, 3], rules()))).toEqual(['0:6']);
    expect(ends(legalMoves(table([YARD, YARD, YARD, YARD]), 0, [1, 4], rules()))).toEqual(['0:1']);
  });

  it('no 1, no 6 and no double: nobody comes out', () => {
    expect(legalMoves(table([YARD, YARD, YARD, YARD]), 0, [3, 4], rules())).toEqual([]);
  });

  it('a 1 does not bring a horse out when that rule is off', () => {
    expect(legalMoves(table([YARD, YARD, YARD, YARD]), 0, [1, 4], rules({ exitOnOne: false }))).toEqual([]);
    expect(canExit([1, 4], rules({ exitOnOne: false }))).toBe(false);
  });

  it('a double of 2 to 5 brings one horse out with both dice', () => {
    // asked for on 2026-11-19: coming out on such a double spends it, the twin does not move
    expect(ends(legalMoves(table([YARD, YARD, YARD, YARD]), 0, [3, 3], rules()))).toEqual(['0:3+3']);
  });

  it('a double of 2 to 5 does not bring a horse out when that rule is off, and still moves', () => {
    // dropped on 2026-11-19 (ludo_exit_double 0): four-player games ran too long
    const off = rules({ exitDouble: false });
    expect(legalMoves(table([YARD, YARD, YARD, YARD]), 0, [3, 3], off)).toEqual([]);
    expect(canExit([3, 3], off)).toBe(false);
    expect(ends(legalMoves(table([10, YARD, YARD, YARD]), 0, [3, 3], off))).toEqual(['13:3', '16:3+3']);
  });

  it('a double 6 brings a horse out with one die and leaves the other', () => {
    expect(ends(legalMoves(table([YARD, YARD, YARD, YARD]), 0, [6, 6], rules()))).toEqual(['0:6']);
  });

  it('cannot come out onto its own horse standing on the start', () => {
    const moves = legalMoves(table([0, YARD, YARD, YARD]), 0, [6, 3], rules());
    expect(moves.filter(m => m.from === YARD)).toEqual([]);
  });

  it('kicks a horse of another player standing on its start', () => {
    const players = table([YARD, YARD, YARD, YARD], [sameCellFor1(0), YARD, YARD, YARD]);
    const out = legalMoves(players, 0, [6, 2], rules()).find(m => m.from === YARD);
    expect(out?.kick).toEqual({ pi: 1, h: 0 });
  });
});

// ---- Each die on its own, or both as a total ----------------------------------------------------
describe('moving with two dice', () => {
  it('2 + 4: one horse may go 2, 4, or the total 6 in one move', () => {
    const moves = legalMoves(table([10, YARD, YARD, YARD]), 0, [2, 4], rules());
    expect(ends(moves)).toEqual(['12:2', '14:4', '16:2+4']);
    expect(moves.map(moveValue).sort((a, b) => a - b)).toEqual([2, 4, 6]);
  });

  it('2 + 4 with two horses out: either horse may take either die', () => {
    // asked for on 2026-11-19: horse 1 goes 2 or 4, then horse 1 or horse 2 goes the other
    const moves = legalMoves(table([10, 20, YARD, YARD]), 0, [2, 4], rules());
    expect(ends(moves, 0)).toEqual(['12:2', '14:4', '16:2+4']);
    expect(ends(moves, 1)).toEqual(['22:2', '24:4', '26:2+4']);
  });

  it('after one die is used, only the other is left: no total', () => {
    expect(ends(legalMoves(table([12, 20, YARD, YARD]), 0, [4], rules()), 0)).toEqual(['16:4']);
  });

  it('a double of 2 to 5 moves a horse already out like any two dice', () => {
    expect(ends(legalMoves(table([10, YARD, YARD, YARD]), 0, [3, 3], rules()))).toEqual(['13:3', '16:3+3']);
  });

  it('the total goes past the middle cell without stopping there', () => {
    // a horse of another player 2 ahead: jumping allowed, the total lands beyond it and kicks nobody
    const players = table([10, YARD, YARD, YARD], [sameCellFor1(12), YARD, YARD, YARD]);
    const sum = legalMoves(players, 0, [2, 4], rules({ noJump: false })).find(m => m.dice.length === 2);
    expect(sum).toMatchObject({ to: 16 });
    expect(sum?.kick).toBeUndefined();
  });
});

// ---- Blocking and kicking ------------------------------------------------------------------------
describe('blocking and kicking', () => {
  it('may not jump over a horse: only the die that lands on it is left, as a kick', () => {
    const players = table([10, YARD, YARD, YARD], [sameCellFor1(12), YARD, YARD, YARD]);
    const moves = legalMoves(players, 0, [2, 4], rules());
    expect(ends(moves)).toEqual(['12:2']);
    expect(moves[0].kick).toEqual({ pi: 1, h: 0 });
  });

  it('may jump over horses when that rule is off', () => {
    const players = table([10, YARD, YARD, YARD], [sameCellFor1(12), YARD, YARD, YARD]);
    expect(ends(legalMoves(players, 0, [2, 4], rules({ noJump: false })))).toEqual(['12:2', '14:4', '16:2+4']);
  });

  it('never lands on its own horse', () => {
    expect(ends(legalMoves(table([10, 14, YARD, YARD]), 0, [4, 5], rules({ noJump: false })), 0)).toEqual(['15:5', '19:4+5']);
  });

  it('a kick sends the horse back to its yard and counts for both players', () => {
    const players = table([10, YARD, YARD, YARD], [sameCellFor1(12), YARD, YARD, YARD]);
    const kick = legalMoves(players, 0, [2], rules())[0];
    applyMove(players, 0, kick);
    expect(players[0].horses[0]).toBe(12);
    expect(players[1].horses[0]).toBe(YARD);
    expect([players[0].kicks, players[1].kicked]).toEqual([1, 1]);
  });
});

// ---- The stable ----------------------------------------------------------------------------------
describe('the traditional stable', () => {
  it('a horse must stop on the gate: nothing that would pass it', () => {
    expect(ends(legalMoves(table([GATE - 3, YARD, YARD, YARD]), 0, [2, 4], rules()))).toEqual([`${GATE - 1}:2`]);
  });

  it('on the gate, a die showing k climbs to step k; no total', () => {
    expect(ends(legalMoves(table([GATE, YARD, YARD, YARD]), 0, [2, 5], rules()))).toEqual([`${GATE + 2}:2`, `${GATE + 5}:5`]);
  });

  it('on step s, only a die showing s + 1 climbs, one step', () => {
    const onStep2 = GATE + 2;
    expect(ends(legalMoves(table([onStep2, YARD, YARD, YARD]), 0, [3, 6], rules()))).toEqual([`${onStep2 + 1}:3`]);
    expect(legalMoves(table([onStep2, YARD, YARD, YARD]), 0, [4, 5], rules())).toEqual([]);
  });

  it('a horse on a low step blocks the gate from climbing past it', () => {
    expect(ends(legalMoves(table([GATE, GATE + 1, YARD, YARD]), 0, [3, 4], rules()), 0)).toEqual([]);
  });
});

describe('the quick stable', () => {
  it('goes straight in by a die or the total, never past the top step', () => {
    const quick = rules({ homeStrict: false });
    expect(ends(legalMoves(table([GATE - 1, YARD, YARD, YARD]), 0, [3, 4], quick))).toEqual([`${GATE + 2}:3`, `${GATE + 3}:4`, `${GATE + 6}:3+4`]);
    expect(ends(legalMoves(table([TOP - 2, YARD, YARD, YARD]), 0, [6, 6], quick))).toEqual([]);
  });
});

// ---- Throws, winning, danger, the computer --------------------------------------------------------
describe('throws and the end', () => {
  it('a double throws again with two dice; a 6 with one', () => {
    expect([throwsAgain([4, 4]), throwsAgain([4, 5]), throwsAgain([6]), throwsAgain([5])]).toEqual([true, false, true, false]);
  });

  it('a player wins with every horse in the stable', () => {
    expect(allHome(table([GATE + 1, GATE + 3, GATE + 5, TOP])[0])).toBe(true);
    expect(allHome(table([GATE + 1, GATE + 3, GATE + 5, GATE])[0])).toBe(false);
  });
});

describe('danger and the computer', () => {
  it('counts a horse of another player 1 to 6 cells behind as a danger', () => {
    const players = table([20, YARD, YARD, YARD], [sameCellFor1(17), YARD, YARD, YARD]);
    expect(danger(players, 0, 0, 20, rules())).toBe(1);
    expect(danger(players, 0, 0, 30, rules())).toBe(0);
  });

  it('the computer above Dễ takes a kick over a plain move', () => {
    const players = table([10, 30, YARD, YARD], [sameCellFor1(12), YARD, YARD, YARD]);
    const moves = legalMoves(players, 0, [2, 4], rules());
    const fixed = () => 0.5;
    expect(aiPick(players, 0, moves, 1, rules(), fixed).kick).toEqual({ pi: 1, h: 0 });
    expect(aiPick(players, 0, moves, 2, rules(), fixed).kick).toEqual({ pi: 1, h: 0 });
  });

  it('Khó thinks both dice through: comes out on the 1 to kick with the 5, where move by move it takes the total', () => {
    // 1 + 5: the total takes horse 0 from 10 onto a horse at 16 (one kick); coming out on the 1 and then
    // going 5 from the start kicks a horse there and brings a new horse out too
    const players = table([10, YARD, YARD, YARD], [sameCellFor1(16), sameCellFor1(5), YARD, YARD]);
    const moves = legalMoves(players, 0, [1, 5], rules());
    const fixed = () => 0.5;
    expect(aiPick(players, 0, moves, 1, rules(), fixed)).toMatchObject({ from: 10, to: 16, dice: [1, 5] });
    expect(aiPlan(players, 0, moves, [1, 5], 2, rules(), fixed)).toMatchObject({ from: YARD, to: 0, dice: [1] });
  });

  it('Vừa still picks move by move, and a single die left needs no plan', () => {
    const players = table([10, YARD, YARD, YARD], [sameCellFor1(16), sameCellFor1(5), YARD, YARD]);
    const fixed = () => 0.5;
    const moves = legalMoves(players, 0, [1, 5], rules());
    expect(aiPlan(players, 0, moves, [1, 5], 1, rules(), fixed)).toEqual(aiPick(players, 0, moves, 1, rules(), fixed));
    const one = legalMoves(players, 0, [5], rules());
    expect(aiPlan(players, 0, one, [5], 2, rules(), fixed)).toEqual(aiPick(players, 0, one, 2, rules(), fixed));
  });
});
