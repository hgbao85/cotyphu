// Vitest: the money rules in src/game/, run in Node with no browser. Values come from
// data/config.json, so a tuning change moves the expected numbers with it.
// Design record: design/game-brief.md (Core loop: rent, building, full group ×2).
import { describe, expect, it } from 'vitest';
import config from '../../data/config.json';
import { TILES } from '../../src/game/data';
import { buildCost, money, netWorth, ownsGroup, propertyTax, rentOf } from '../../src/game/rules';
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
