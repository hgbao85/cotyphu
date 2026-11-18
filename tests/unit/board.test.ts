// Vitest: the board's layout and the cards that send a player to a named place.
// Design record: design/game-brief.md (After play: vị trí Cơ Hội, Khí Vận, thuế như bàn tỷ phú gốc).
import { describe, expect, it } from 'vitest';
import { CARDS, TILES } from '../../src/game/data';

const at = (kind: string): number[] => TILES.map((t, i) => (t.t === kind ? i : -1)).filter(i => i >= 0);

describe('board layout', () => {
  it('puts Khí Vận, Cơ Hội and the two taxes where the classic board has them', () => {
    expect(at('kv')).toEqual([2, 17, 33]);
    expect(at('co')).toEqual([7, 22, 36]);
    expect(TILES[4]).toMatchObject({ t: 'tax', kind: 'prop' });
    expect(TILES[38]).toMatchObject({ t: 'tax', kind: 'income' });
  });

  it('keeps the corners, ports and companies where they were', () => {
    expect([0, 10, 20, 30].map(i => TILES[i].t)).toEqual(['go', 'jail', 'free', 'gojail']);
    expect(at('port')).toEqual([5, 15, 25, 35]);
    expect(at('util')).toEqual([13, 27]);
  });

  it('keeps each colour group together, in board order, with 40 tiles in all', () => {
    expect(TILES.length).toBe(40);
    const groups = TILES.map(t => (t.t === 'prop' ? t.g : null)).filter((g): g is number => g !== null);
    expect(groups).toEqual([...groups].sort((a, b) => a - b)); // the groups come one after another round the board
  });

  it('sends every "go to" card to the place its words name', () => {
    for (const deck of ['co', 'kv'] as const) for (const c of CARDS[deck]) {
      if (c.act !== 'move' || c.to === undefined) continue;
      const t = TILES[c.to];
      if (c.to === 0) expect(c.txt).toContain('Xuất Phát');
      else expect(c.txt).toContain(t.n);
    }
  });
});
