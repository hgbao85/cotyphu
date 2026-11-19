// Vitest: the money rules in src/game/, run in Node with no browser. Values come from
// data/config.json, so a tuning change moves the expected numbers with it.
// Design record: design/game-brief.md (Core loop: rent, building, full group ×2).
import { describe, expect, it } from 'vitest';
import config from '../../data/config.json';
import { EVENTS, TILES } from '../../src/game/data';
import { buildCost, buyHint, eventRentMult, landingWorth, money, netWorth, ownsGroup, propertyTax, rentHint, rentOf, settleOrder, throwWorth } from '../../src/game/rules';
import { rng, setSeed, shuffled } from '../../src/game/rng';
import type { GameState, Player } from '../../src/game/types';

const HA_NOI = 14, BAC_NINH = 11, NAM_DINH = 12;           // group 2 (Bắc · Đồng bằng)
const PORTS = [5, 15, 25, 35];
const ELECTRIC = 13, WATER = 27;

function player(id: number, cash: number): Player {
  return {
    id, kind: 'human', lv: 0, color: '#000', token: id, name: `P${id}`, cash, pos: 0, laps: 1,
    inJail: false, jailTries: 0, freeCards: [], bankrupt: false, doubles: 0,
  };
}

/** A game state with only what the money rules read: owners, levels, mortgages, players. */
function board(): GameState {
  return {
    owner: Array(40).fill(-1), level: Array(40).fill(0), mort: Array(40).fill(false),
    players: [player(0, 1000), player(1, 1000)],
  } as unknown as GameState;
}

const price = (i: number): number => TILES[i].p as number;
const roundTo10 = (v: number): number => Math.round(v / 10) * 10;
const toThousand = (v: number): number => Math.round(v); // rent is exact to the thousand đồng (money is in thousands)

describe('rentOf', () => {
  it('charges the empty-land rate on a lone province, nothing when unowned or mortgaged', () => {
    const s = board();
    expect(rentOf(s, HA_NOI, 7)).toBe(0);
    s.owner[HA_NOI] = 0;
    expect(rentOf(s, HA_NOI, 7)).toBe(toThousand(price(HA_NOI) * config.rent_l0.value * config.rent_scale.value));
    s.mort[HA_NOI] = true;
    expect(rentOf(s, HA_NOI, 7)).toBe(0);
  });

  it('multiplies rent by full_group_mult when one player owns the whole colour group', () => {
    const s = board();
    s.owner[HA_NOI] = 0; s.level[HA_NOI] = 5;
    const alone = rentOf(s, HA_NOI, 7);
    s.owner[BAC_NINH] = 0; s.owner[NAM_DINH] = 0;
    expect(ownsGroup(s, 0, TILES[HA_NOI].g as number)).toBe(true);
    expect(rentOf(s, HA_NOI, 7)).toBe(toThousand(price(HA_NOI) * config.rent_l5.value * config.rent_scale.value) * config.full_group_mult.value);
    expect(rentOf(s, HA_NOI, 7)).toBeGreaterThan(alone);
  });

  it('charges rent exact to the thousand đồng, with no rounding to ten thousand', () => {
    // Asked for: Hà Nội's empty land at 7% × rent_scale is 336.000 đ, not 340.000 đ.
    const s = board();
    s.owner[HA_NOI] = 0;
    expect(rentOf(s, HA_NOI, 7)).toBe(toThousand(price(HA_NOI) * config.rent_l0.value * config.rent_scale.value));
    expect(rentOf(s, HA_NOI, 7) % 10).not.toBe(0); // 336, not a round 340
  });

  it('charges a full group exactly full_group_mult times the rent the tile card shows, at every level', () => {
    // Regression: the bonus was applied before rounding, so Hà Nội showed 340.000 đ but a full group took
    // 670.000 đ, not 680.000 đ. The card and the rent now use the same exact number.
    const s = board();
    for (const i of [HA_NOI, BAC_NINH, NAM_DINH]) s.owner[i] = 0;
    for (const i of [HA_NOI, NAM_DINH]) for (let lvl = 0; lvl <= 6; lvl++) {
      s.level[i] = lvl;
      const card = toThousand(price(i) * config['rent_l' + lvl as 'rent_l0'].value * config.rent_scale.value);
      expect(rentOf(s, i, 7)).toBe(card * config.full_group_mult.value);
    }
  });

  it('leaves a mortgaged province out of the full group, so the rest lose the bonus until it is bought back', () => {
    // Regression: a group with one mortgaged province still counted as full and charged ×full_group_mult.
    const s = board();
    for (const i of [HA_NOI, BAC_NINH, NAM_DINH]) s.owner[i] = 0;
    s.mort[NAM_DINH] = true;
    expect(ownsGroup(s, 0, TILES[HA_NOI].g as number)).toBe(false);
    expect(rentOf(s, HA_NOI, 7)).toBe(toThousand(price(HA_NOI) * config.rent_l0.value * config.rent_scale.value));
    s.mort[NAM_DINH] = false;
    expect(rentOf(s, HA_NOI, 7)).toBe(toThousand(price(HA_NOI) * config.rent_l0.value * config.rent_scale.value) * config.full_group_mult.value);
  });

  it('counts only the ports and companies that are not mortgaged', () => {
    const s = board();
    for (const p of PORTS) s.owner[p] = 0;
    s.mort[PORTS[3]] = true;
    expect(rentOf(s, PORTS[0], 7)).toBe(Math.round(config.port_rent.value * 2 ** 2 * config.rent_scale.value)); // 3 ports count
    s.owner[ELECTRIC] = 1; s.owner[WATER] = 1; s.mort[WATER] = true;
    expect(rentOf(s, ELECTRIC, 9)).toBe(Math.round(9 * config.util_mult_one.value * config.rent_scale.value));
  });

  it('doubles port rent for each port the owner holds', () => {
    const s = board();
    PORTS.forEach((p, k) => {
      s.owner[p] = 0;
      expect(rentOf(s, p, 7)).toBe(Math.round(config.port_rent.value * 2 ** k * config.rent_scale.value));
    });
  });

  it('charges utilities by the dice total, more when the owner has both', () => {
    const s = board();
    s.owner[ELECTRIC] = 1;
    expect(rentOf(s, ELECTRIC, 9)).toBe(Math.round(9 * config.util_mult_one.value * config.rent_scale.value));
    s.owner[WATER] = 1;
    expect(rentOf(s, ELECTRIC, 9)).toBe(Math.round(9 * config.util_mult_two.value * config.rent_scale.value));
  });
});

describe('buildCost and netWorth', () => {
  it('prices each level as its share of the land price', () => {
    expect(buildCost(HA_NOI, 1)).toBe(toThousand(price(HA_NOI) * config.house_cost_pct.value));
    expect(buildCost(HA_NOI, 5)).toBe(toThousand(price(HA_NOI) * config.hotel_cost_pct.value));
    expect(buildCost(HA_NOI, 6)).toBe(toThousand(price(HA_NOI) * config.landmark_cost_pct.value));
  });

  it('counts cash, land (half when mortgaged) and what was spent building', () => {
    const s = board(), p = s.players[0];
    s.owner[HA_NOI] = 0; s.level[HA_NOI] = 2;
    s.owner[BAC_NINH] = 0; s.mort[BAC_NINH] = true;
    const expected = p.cash + price(HA_NOI) + buildCost(HA_NOI, 1) + buildCost(HA_NOI, 2) + price(BAC_NINH) * config.mortgage_pct.value;
    expect(netWorth(s, p)).toBeCloseTo(expected, 6);
  });
});

describe('propertyTax', () => {
  it('takes the share of cash exact to the thousand đồng, with no rounding to ten thousand', () => {
    // Asked for: 10% of 5.763.000 đ is 576.000 đ (once rounded to 580.000 đ). The cash is chosen so the
    // two roundings differ; the cap is far above it.
    expect(propertyTax(5763)).toBe(toThousand(5763 * config.prop_tax_pct.value));
  });

  const pct = config.prop_tax_pct.value, cap = config.prop_tax_flat.value;

  it('charges prop_tax_pct of the cash when that is under the cap', () => {
    const cash = roundTo10(cap / pct / 2);           // well below the point where the cap bites
    expect(propertyTax(cash)).toBe(toThousand(cash * pct));
    expect(propertyTax(cash)).toBeLessThan(cap);
  });

  it('charges the cap when the percentage would be more', () => {
    expect(propertyTax(cap / pct * 10)).toBe(cap);
    expect(propertyTax(cap / pct)).toBe(cap);         // the boundary: exactly the cap
  });

  it('charges nothing on zero or negative cash', () => {
    expect(propertyTax(0)).toBe(0);
    expect(propertyTax(-500)).toBe(0);
  });
});

describe('money and rng', () => {
  it('shows thousands of đồng as full đồng', () => {
    expect(money(1500)).toBe((1500000).toLocaleString('vi-VN') + ' đ');
  });

  it('repeats the same numbers and the same shuffle for the same seed', () => {
    setSeed(7); const a = [rng(), rng(), rng()], deckA = shuffled(16);
    setSeed(7); const b = [rng(), rng(), rng()], deckB = shuffled(16);
    expect(b).toEqual(a);
    expect(deckB).toEqual(deckA);
    expect(a.every(n => n >= 0 && n < 1)).toBe(true);
    expect([...deckA].sort((x, y) => x - y)).toEqual([...Array(16).keys()]);
  });
});

describe('round events', () => {
  const ev = (name: string): number => EVENTS.findIndex(e => e.name === name);
  const tile = (name: string): number => TILES.findIndex(t => t.n === name);

  it("doubles one province's rent during its festival and leaves the others alone", () => {
    const s = board(), dn = tile('Đà Nẵng'), hue = tile('Huế');
    s.owner[dn] = 0; s.owner[hue] = 0;
    const plain = rentOf(s, dn, 7), other = rentOf(s, hue, 7);
    s.event = { i: ev('Pháo hoa Đà Nẵng'), until: 99, t: 0 };
    expect(rentOf(s, dn, 7)).toBe(plain * 2);
    expect(rentOf(s, hue, 7)).toBe(other);
  });

  it("halves central Vietnam's rent in the storm, not the north's or the south's", () => {
    const s = board(), hue = tile('Huế'), hn = tile('Hà Nội'), hcm = tile('TP. Hồ Chí Minh');
    for (const i of [hue, hn, hcm]) s.owner[i] = 1;
    const before = [hue, hn, hcm].map(i => rentOf(s, i, 7));
    s.event = { i: ev('Bão miền Trung'), until: 99, t: 0 };
    expect([hue, hn, hcm].map(i => rentOf(s, i, 7))).toEqual([Math.round(before[0] * 0.5), before[1], before[2]]);
  });

  it('doubles port rent in the summer season, and an event that is not about rent changes none', () => {
    const s = board();
    s.owner[PORTS[0]] = 0;
    const plain = rentOf(s, PORTS[0], 7);
    s.event = { i: ev('Mùa du lịch hè'), until: 99, t: 0 };
    expect(rentOf(s, PORTS[0], 7)).toBe(plain * 2);
    s.event = { i: ev('Tết Nguyên Đán'), until: 99, t: 0 };
    expect(eventRentMult(s, PORTS[0])).toBe(1);
    expect(rentOf(s, PORTS[0], 7)).toBe(plain);
  });

  it('names a real tile and real groups in every event', () => {
    for (const e of EVENTS) {
      if (e.tile) expect(TILES.some(t => t.n === e.tile)).toBe(true);
      for (const g of e.groups ?? []) expect(TILES.some(t => t.t === 'prop' && t.g === g)).toBe(true);
    }
  });
});

describe('full group in a team game', () => {
  it("counts a partner's provinces toward the group, so both get the bonus; an opponent's do not count", () => {
    // Asked for: in a 2-team game the colour group is the team's together.
    const s = board();
    s.owner[HA_NOI] = 0; s.owner[BAC_NINH] = 1; s.owner[NAM_DINH] = 1;
    const alone = toThousand(price(HA_NOI) * config.rent_l0.value * config.rent_scale.value);
    expect(rentOf(s, HA_NOI, 7)).toBe(alone);                      // a plain game: two owners, no full group
    s.teams = true; s.players[0].team = 0; s.players[1].team = 0;  // partners
    expect(ownsGroup(s, 0, TILES[HA_NOI].g as number)).toBe(true);
    expect(rentOf(s, HA_NOI, 7)).toBe(alone * config.full_group_mult.value);
    s.players[1].team = 1;                                         // opponents
    expect(ownsGroup(s, 0, TILES[HA_NOI].g as number)).toBe(false);
    s.players[1].team = 0; s.mort[NAM_DINH] = true;                // a partner's mortgaged province breaks it too
    expect(ownsGroup(s, 0, TILES[HA_NOI].g as number)).toBe(false);
  });
});

describe('the hint under a land card', () => {
  const g = TILES[HA_NOI].g as number, mult = config.full_group_mult.value;
  it('says buying the last province of a group completes it', () => {
    const s = board(); s.owner[BAC_NINH] = 0; s.owner[NAM_DINH] = 0;
    expect(buyHint(s, 0, HA_NOI)).toBe(`Mua ô này là đủ nhóm Bắc · Đồng bằng: thuê × ${mult}`);
  });
  it('says a rival already holds part of the group, so buying blocks them', () => {
    const s = board(); s.owner[BAC_NINH] = 1;
    expect(buyHint(s, 0, HA_NOI)).toBe('P1 đã có 1/3 ô nhóm Bắc · Đồng bằng: mua để chặn');
  });
  it('counts the group the buyer would hold', () => {
    const s = board(); s.owner[BAC_NINH] = 0;
    expect(buyHint(s, 0, HA_NOI)).toBe('Bạn sẽ có 2/3 ô nhóm Bắc · Đồng bằng');
  });
  it('names the group and its bonus when nobody holds any of it', () => {
    expect(buyHint(board(), 0, HA_NOI)).toBe(`Nhóm Bắc · Đồng bằng có 3 ô: gom đủ thì thuê × ${mult}`);
  });
  it("counts a partner's provinces in a team game", () => {
    const s = board(); (s as { teams?: boolean }).teams = true; s.players[0].team = 0; s.players[1].team = 0;
    s.owner[BAC_NINH] = 1; s.owner[NAM_DINH] = 0;
    expect(buyHint(s, 0, HA_NOI)).toBe(`Mua ô này là đủ nhóm Bắc · Đồng bằng: thuê × ${mult}`);
  });
  it('leaves a mortgaged port out of the count, as the rent does', () => {
    // Regression (full review 19/11/2026): a mortgaged port was counted, so the hint promised a rent the ports do not earn.
    const s = board(); s.owner[PORTS[0]] = 0; s.owner[PORTS[2]] = 0; s.mort[PORTS[2]] = true;
    expect(buyHint(s, 0, PORTS[1])).toBe(`Có 2 bến: thuê mỗi bến ${money(config.port_rent.value * 2 * config.rent_scale.value)}`);
  });
  it('gives the rent per port with one more port', () => {
    const s = board(); s.owner[PORTS[0]] = 0;
    expect(buyHint(s, 0, PORTS[1])).toBe(`Có 2 bến: thuê mỗi bến ${money(config.port_rent.value * 2 * config.rent_scale.value)}`);
  });
  it('explains a rent from the building level and the full group', () => {
    const s = board(); s.owner[HA_NOI] = 1; s.owner[BAC_NINH] = 1; s.owner[NAM_DINH] = 1; s.level[HA_NOI] = 2;
    expect(rentHint(s, HA_NOI)).toBe(`Nhà 2 · chủ có đủ nhóm: thuê × ${mult}`);
    s.owner[NAM_DINH] = 0;
    expect(rentHint(s, HA_NOI)).toBe('Nhà 2');
    expect(g).toBe(TILES[BAC_NINH].g);
  });
});

describe('settleOrder', () => {
  it('puts the highest throw first and the lowest last', () => {
    expect(settleOrder([[], [], []], [5, 11, 8])).toEqual({ order: [1, 2, 0] });
  });
  it('has only the players who tied throw again', () => {
    expect(settleOrder([[], [], []], [10, 7, 7])).toEqual({ tied: [1, 2], past: [[], [7], [7]] });
  });
  it('settles a tie among the tied players only: a high re-throw never jumps a higher first throw', () => {
    // A threw 10, B and C 7; B re-throws 12, C 3. A stays first: B, C only settle second and third.
    expect(settleOrder([[], [7], [7]], [10, 12, 3])).toEqual({ order: [0, 1, 2] });
  });
  it('does not make a player who did not tie throw again when a re-throw lands on their number', () => {
    // B and C tied on 7 and re-throw; B gets 10, the same as A's first throw. Nobody ties.
    expect(settleOrder([[], [7], [7]], [10, 10, 4])).toEqual({ order: [0, 1, 2] });
  });
  it('keeps throwing again while the tied players still tie', () => {
    expect(settleOrder([[], [7], [7]], [10, 9, 9])).toEqual({ tied: [1, 2], past: [[], [7, 9], [7, 9]] });
    expect(settleOrder([[], [7, 9], [7, 9]], [10, 2, 6])).toEqual({ order: [0, 2, 1] });
  });
});

describe('throwWorth and landingWorth (what Khó aims for, and which throw the sweet zone keeps)', () => {
  it('counts a third double in a row as jail, worse than paying a rent', () => {
    // Regression (full review 19/11/2026): only the landing tile was weighed, so the zone could keep 4+4 (jail) over 2+3 (a rent).
    const s = board(); s.owner[PORTS[0]] = 1;                // 2+3 from Xuất Phát lands on P1's port
    s.players[0].doubles = 2;
    expect(throwWorth(s, 0, [2, 3])).toBe(-rentOf(s, PORTS[0], 5));
    expect(throwWorth(s, 0, [4, 4])).toBe(-1500);
    expect(throwWorth(s, 0, [4, 4])).toBeLessThan(throwWorth(s, 0, [2, 3]));
  });
  it('weighs a first or second double by where it lands', () => {
    const s = board(); s.players[0].doubles = 1;
    expect(throwWorth(s, 0, [4, 4])).toBe(landingWorth(s, 0, 8, 8));
  });
  it("costs nothing on a partner's land in a team game, a rent on a rival's", () => {
    // Regression (full review 19/11/2026): a partner's land was weighed as rent to pay.
    const s = board(); s.owner[HA_NOI] = 1;
    expect(landingWorth(s, 0, HA_NOI, 7)).toBe(-rentOf(s, HA_NOI, 7));
    (s as { teams?: boolean }).teams = true; s.players[0].team = 0; s.players[1].team = 0;
    expect(landingWorth(s, 0, HA_NOI, 7)).toBe(0);
    s.players[1].team = 1;
    expect(landingWorth(s, 0, HA_NOI, 7)).toBe(-rentOf(s, HA_NOI, 7));
  });
});
