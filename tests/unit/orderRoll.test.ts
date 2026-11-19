// Vitest: choosing who goes first in Cá Ngựa and Rắn và Thang (src/game/orderRoll.ts), as Cờ Tỷ Phú does.
import { describe, expect, it } from 'vitest';
import { startOrder, recordOrder, nextOrder, type OrderGame } from '../../src/game/orderRoll';

/** A game of n players named A, B, C... */
function game(n: number): OrderGame & { log: string[] } {
  return { players: Array.from({ length: n }, (_, k) => ({ id: k, name: 'ABCD'[k] })), cur: 0, log: [] };
}
/** Every player still to throw throws its number, in turn; true once the order is settled. */
function throwAll(g: OrderGame & { log: string[] }, totals: number[]): boolean {
  let done = false;
  for (const t of totals) { recordOrder(g, t, s => g.log.push(s)); done = nextOrder(g, s => g.log.push(s)); }
  return done;
}

describe('the throws for the order of play', () => {
  it('lets every seat throw once in turn, then puts the highest first and the lowest last', () => {
    const g = game(3);
    startOrder(g, s => g.log.push(s));
    expect(g.cur).toBe(0);
    expect(throwAll(g, [5, 11, 8])).toBe(true);
    expect(g.players.map(p => p.name)).toEqual(['B', 'C', 'A']);
    expect(g.players.map(p => p.id)).toEqual([0, 1, 2]); // ids follow the new places: the rules compare them
    expect(g.order).toBeUndefined();
    expect(g.cur).toBe(0);
    expect(g.log.at(-1)).toBe('Thứ tự đi: B → C → A.');
  });
  it('has only the players who tied throw again, among themselves', () => {
    const g = game(3);
    startOrder(g, s => g.log.push(s));
    expect(throwAll(g, [10, 7, 7])).toBe(false);
    expect(g.log.at(-1)).toBe('Hòa điểm: B, C tung lại.');
    expect(g.cur).toBe(1);                         // B throws again first
    expect(throwAll(g, [12, 3])).toBe(true);       // B's 12 does not jump A's 10: only B and C are settled
    expect(g.players.map(p => p.name)).toEqual(['A', 'B', 'C']);
  });
});
