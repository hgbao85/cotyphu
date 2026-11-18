// The money rules: rent, building costs, what a player owns and is worth. Pure functions over the
// game state and the tuning values, no browser, so Vitest runs them in Node.
// Design record: design/game-brief.md (Core loop; Features: rent, building, mortgage).
import { tune } from '../config';
import { EVENTS, TILES } from './data';
import type { GameState, Player } from './types';

/** Money as players read it: thousands of đồng in, "1.500.000 đ" out. */
export function money(k: number): string {
  return (Math.round(k) * 1000).toLocaleString('vi-VN') + ' đ';
}

/** The tiles player pi owns, in board order. */
export function owned(s: GameState, pi: number): number[] {
  const r: number[] = [];
  for (let i = 0; i < 40; i++) if (s.owner[i] === pi) r.push(i);
  return r;
}

/** True when player pi owns every province in colour group g and none of them is mortgaged: a mortgaged
 * province earns nothing, so the group loses its bonus until it is bought back (like ports and companies). */
export function ownsGroup(s: GameState, pi: number, g: number): boolean {
  return TILES.every((t, i) => t.t !== 'prop' || t.g !== g || (s.owner[i] === pi && !s.mort[i]));
}

/** The rent at a building level, as a fraction of the land price (config rent_l0..rent_l6). */
export function rentPct(lvl: number): number {
  return tune['rent_l' + lvl];
}

/** The round event in play, if any. */
export function activeEvent(s: GameState) {
  return s.event ? EVENTS[s.event.i] : undefined;
}
/** How the round event in play changes the rent of tile i: 1 when it does not. */
export function eventRentMult(s: GameState, i: number): number {
  const e = activeEvent(s), t = TILES[i];
  if (!e) return 1;
  if (e.kind === 'rentGroups' && t.t === 'prop' && e.groups!.includes(t.g as number)) return e.v;
  if (e.kind === 'rentTile' && t.n === e.tile) return e.v;
  if (e.kind === 'ports' && t.t === 'port') return e.v;
  return 1;
}

/** What landing on tile i costs, with diceSum for the utilities. 0 when unowned or mortgaged. */
export function rentOf(s: GameState, i: number, diceSum: number): number {
  const t = TILES[i], o = s.owner[i];
  if (o < 0 || s.mort[i]) return 0;
  if (t.t === 'prop') {
    // exact to the thousand đồng (money is in thousands), the same number the tile card shows; a full
    // group pays exactly that times full_group_mult
    let r = Math.round((t.p as number) * rentPct(s.level[i]) * tune.rent_scale);
    if (ownsGroup(s, o, t.g as number)) r = Math.round(r * tune.full_group_mult);
    return Math.round(r * eventRentMult(s, i));
  }
  if (t.t === 'port') {
    const n = TILES.filter((u, j) => u.t === 'port' && s.owner[j] === o && !s.mort[j]).length;
    return Math.round(Math.round(tune.port_rent * Math.pow(2, n - 1) * tune.rent_scale) * eventRentMult(s, i));
  }
  const n = TILES.filter((u, j) => u.t === 'util' && s.owner[j] === o && !s.mort[j]).length;
  return Math.round(diceSum * (n >= 2 ? tune.util_mult_two : tune.util_mult_one) * tune.rent_scale);
}

/** What building tile i up to toLevel costs (1-4 houses, 5 hotel, 6 landmark). */
export function buildCost(i: number, toLevel: number): number {
  const p = TILES[i].p as number;
  const pct = toLevel <= 4 ? tune.house_cost_pct : toLevel === 5 ? tune.hotel_cost_pct : tune.landmark_cost_pct;
  return Math.round(p * pct); // exact to the thousand đồng (money is in thousands)
}

/**
 * The Thuế Tài Sản bill for a player holding `cash`: prop_tax_pct of the cash in hand (not of land),
 * exact to the thousand đồng, capped at prop_tax_flat. No cash (or debt) pays nothing.
 * Design record: design/game-brief.md (After play: Ô thuế 10% / 2.000.000).
 */
export function propertyTax(cash: number): number {
  const pct = Math.round(Math.max(0, cash) * tune.prop_tax_pct); // exact to the thousand đồng
  return Math.min(pct, tune.prop_tax_flat);
}

/** Everything spent building on tile i so far. */
export function builtValue(s: GameState, i: number): number {
  let v = 0;
  for (let l = 1; l <= s.level[i]; l++) v += buildCost(i, l);
  return v;
}

/** The building levels player pi has across all their land. */
export function levelsOf(s: GameState, pi: number): number {
  return owned(s, pi).reduce((sum, i) => sum + s.level[i], 0);
}

/** Cash plus land (half for mortgaged land) plus what was spent building. */
export function netWorth(s: GameState, p: Player): number {
  return p.cash + owned(s, p.id === undefined ? -1 : s.players.indexOf(p)).reduce((sum, i) =>
    sum + (s.mort[i] ? (TILES[i].p as number) * tune.mortgage_pct : (TILES[i].p as number)) + builtValue(s, i), 0);
}

/** What selling every level and mortgaging everything would raise for player pi. */
export function liquidValue(s: GameState, pi: number): number {
  return owned(s, pi).reduce((sum, i) => {
    let v = 0;
    for (let l = 1; l <= s.level[i]; l++) v += buildCost(i, l) * tune.sell_pct;
    if (!s.mort[i]) v += (TILES[i].p as number) * tune.mortgage_pct;
    return sum + v;
  }, 0);
}
