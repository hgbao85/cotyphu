// The money rules: rent, building costs, what a player owns and is worth. Pure functions over the
// game state and the tuning values, no browser, so Vitest runs them in Node.
// Design record: design/game-brief.md (Core loop; Features: rent, building, mortgage).
import { tune } from '../config';
import { EVENTS, GROUPS, LEVEL_NAMES, TILES, OWNABLE } from './data';
import type { GameState, Player } from './types';

/** Money as players read it: thousands of đồng in, "1.500.000 đ" out. */
export function money(k: number): string {
  const n = Math.round(k);
  let s = moneyCache.get(n);
  if (s === undefined) { // formatting is slow and the same sums show every frame: keep the last few hundred
    s = VND.format(n * 1000) + ' đ';
    if (moneyCache.size > 500) moneyCache.clear();
    moneyCache.set(n, s);
  }
  return s;
}
const VND = new Intl.NumberFormat('vi-VN'), moneyCache = new Map<number, string>();

/** The tiles player pi owns, in board order. */
export function owned(s: GameState, pi: number): number[] {
  const r: number[] = [];
  for (let i = 0; i < 40; i++) if (s.owner[i] === pi) r.push(i);
  return r;
}

/** True when player pi owns every province in colour group g and none of them is mortgaged: a mortgaged
 * province earns nothing, so the group loses its bonus until it is bought back (like ports and companies).
 * In a team game the group is the team's: a partner's provinces count. */
export function ownsGroup(s: GameState, pi: number, g: number): boolean {
  const ours = (o: number): boolean => o === pi || (!!s.teams && o >= 0 && s.players[o]?.team !== undefined && s.players[o].team === s.players[pi]?.team);
  return TILES.every((t, i) => t.t !== 'prop' || t.g !== g || (ours(s.owner[i]) && !s.mort[i]));
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

/** One line under the land card when player pi may buy tile i: what buying it does for them. A new
 * player learns why a land is worth having: a full group, a rival to block, a port more. */
export function buyHint(s: GameState, pi: number, i: number): string {
  const t = TILES[i];
  const ours = (o: number): boolean => o === pi || (!!s.teams && o >= 0 && s.players[o]?.team !== undefined && s.players[o].team === s.players[pi]?.team);
  if (t.t === 'prop') {
    const g = t.g as number, name = GROUPS[g].name, group = TILES.map((_, j) => j).filter(j => TILES[j].t === 'prop' && TILES[j].g === g);
    const after = { ...s, owner: s.owner.map((o, j) => (j === i ? pi : o)) };
    if (ownsGroup(after, pi, g)) return `Mua ô này là đủ nhóm ${name}: thuê × ${tune.full_group_mult}`;
    const rival = s.players.find(p => !ours(p.id) && group.some(j => s.owner[j] === p.id));
    if (rival) return `${rival.name} đã có ${group.filter(j => s.owner[j] === rival.id).length}/${group.length} ô nhóm ${name}: mua để chặn`;
    const mine = group.filter(j => ours(s.owner[j])).length;
    if (mine > 0) return `${s.teams ? 'Đội bạn' : 'Bạn'} sẽ có ${mine + 1}/${group.length} ô nhóm ${name}`;
    return `Nhóm ${name} có ${group.length} ô: gom đủ thì thuê × ${tune.full_group_mult}`;
  }
  const n = TILES.filter((u, j) => u.t === t.t && s.owner[j] === pi && !s.mort[j]).length + 1; // mortgaged ones earn nothing, as in rentOf
  if (t.t === 'port') return `Có ${n} bến: thuê mỗi bến ${money(Math.round(tune.port_rent * Math.pow(2, n - 1) * tune.rent_scale))}`;
  return `Có ${n} công ty: thuê = tổng xúc xắc × ${money(Math.round((n >= 2 ? tune.util_mult_two : tune.util_mult_one) * tune.rent_scale))}`;
}
/** One line under a rent paid on a province: why it costs that much. Empty for ports and companies. */
export function rentHint(s: GameState, i: number): string {
  const t = TILES[i], o = s.owner[i];
  if (t.t !== 'prop' || o < 0) return '';
  const lvl = LEVEL_NAMES[s.level[i]];
  return ownsGroup(s, o, t.g as number) ? `${lvl} · chủ có đủ nhóm: thuê × ${tune.full_group_mult}` : lvl;
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

/** The order of play from the throws for it. `past[i]` is player i's earlier throws (from re-throws
 * after a tie), `thrown[i]` the latest one. Throws are compared in turn, first throw first, so a
 * re-throw only settles the order among the players who tied. Either the players who still tie (to
 * throw again, with `past` to keep) or the order: player indices, highest first, lowest last. */
export function settleOrder(past: number[][], thrown: number[]): { tied: number[]; past: number[][] } | { order: number[] } {
  const keys = thrown.map((v, i) => [...(past[i] ?? []), v]);
  // a player who sat out a re-throw has a shorter list; the missing throws count lowest, never tying
  const cmp = (a: number[], b: number[]) => {
    for (let k = 0; k < Math.max(a.length, b.length); k++) if ((a[k] ?? -1) !== (b[k] ?? -1)) return (b[k] ?? -1) - (a[k] ?? -1);
    return 0;
  };
  const tied = keys.map((_, i) => i).filter(i => keys.some((k, j) => j !== i && cmp(k, keys[i]) === 0));
  // the tied throw again; everyone else keeps their latest throw where it is, so it is not counted twice
  if (tied.length) return { tied, past: keys.map((k, i) => tied.includes(i) ? k : k.slice(0, -1)) };
  return { order: keys.map((_, i) => i).sort((a, b) => cmp(keys[a], keys[b])) };
}

// ---- What a throw is worth to the thrower: Khó's aim and the sweet zone's better throw -----------------

/** How good landing on tile i is for player pi (a rough sum in đồng): minus the rent it would pay there
 * (none on a mortgaged tile or a partner's), part of a free tile's price it could buy, minus a lot for Đi Tù. */
export function landingWorth(s: GameState, pi: number, i: number, sum: number): number {
  const t = TILES[i], o = s.owner[i], p = s.players[pi];
  if (t.t === 'gojail') return -1500;
  // a partner's land costs nothing (Bug 19/11/2026: counted as rent, so Khó aimed away and the zone threw away a free landing)
  if (o >= 0 && o !== pi) return s.mort[i] || (s.teams && s.players[o].team === p.team) ? 0 : -rentOf(s, i, sum);
  if (o < 0 && OWNABLE(t) && (p.laps || 0) >= tune.first_lap_count && p.cash >= t.p!) return t.p! * 0.2;
  return 0;
}
/** How good a throw of two dice is for player pi out of jail: where it lands, and a third double in a row is
 * jail, as bad as Đi Tù (Bug 19/11/2026: the lucky zone could keep a third double over paying a rent). */
export function throwWorth(s: GameState, pi: number, d: number[]): number {
  const p = s.players[pi];
  if (d[0] === d[1] && p.doubles >= 2) return -1500;
  return landingWorth(s, pi, (p.pos + d[0] + d[1]) % 40, d[0] + d[1]);
}
