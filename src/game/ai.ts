// The computer players: what Dễ, Vừa and Khó buy, build and keep, how they raise cash and use their
// cards, and one decision per think delay (aiAct). Khó reads the board (dangerAhead, hardReserve).
// Design record: design/balance/self-play-2026-11-16.md (Máy Khó chơi khôn hơn).

import { tune } from '../config';

import { rng } from '../game/rng';
import { TILES, OWNABLE, MAX_LEVEL } from '../game/data';

import { state } from '../core/store';

import type { Player } from '../game/types';
import { owned, rentOf, unmortgage, mortgage, sellLevel, isAI, autoRaise, buildPrice, firstLap, curP, startShake, payJail, doBuy, log, skip, doBuild, afterAction, applyCard, aiUsesKeep, useNoRent, payRent, useReroll, beginMove, flyTo, payDebt, declareBankrupt, nextTurn } from './turn';

// ---- AI ------------------------------------------------------------------------------
export function aiTurnStart(p: Player) {
  const pi = state.players.indexOf(p);
  if (p.lv === 2) { // Hard: buy back the land that earns most first, while the cash covers the danger ahead
    const back = owned(pi).filter(i => state.mort[i]).sort((a, b) => earnWhenFree(b) - earnWhenFree(a));
    for (const i of back) if (p.cash - TILES[i].p! * tune.unmortgage_pct >= hardReserve(pi) + tune.ai_hard_unmortgage_spare) unmortgage(pi, i);
  } else if (p.lv >= 1) { // buy back mortgaged land when comfortable
    for (const i of owned(pi)) if (state.mort[i] && p.cash > TILES[i].p! * tune.unmortgage_pct + 3000) unmortgage(pi, i);
  }
}
// ---- Hard: reads the board instead of keeping a fixed sum ----
/** The dearest rent among other players' land 2 to 12 steps ahead: what this turn's throw could cost. */
function dangerAhead(pi: number) {
  const p = state.players[pi];
  let m = 0;
  for (let k = 2; k <= 12; k++) { const i = (p.pos + k) % 40; if (state.owner[i] >= 0 && state.owner[i] !== pi && !state.mort[i]) m = Math.max(m, rentOf(i, 7)); }
  return m;
}
/** Hard: the cash to keep: the danger just ahead, and a share of the worst rent anywhere on the board. */
function hardReserve(pi: number) {
  return Math.max(tune.ai_reserve_hard, dangerAhead(pi), maxRentAgainst(pi) * tune.ai_hard_danger);
}
/** What a tile of this player earns when it is not mortgaged: its rent as it stands. */
function earnWhenFree(i: number) {
  const was = state.mort[i]; state.mort[i] = false;
  const r = rentOf(i, 7); state.mort[i] = was;
  return r;
}
/** Hard: what a free tile is worth to this player beyond its price: ports, a group to finish, a group to spoil. */
function hardWantsTile(pi: number, i: number): 'must' | 'good' | 'plain' {
  const t = TILES[i];
  if (t.t === 'port') return 'must'; // the ports earned the most in self-play
  if (t.t !== 'prop') return 'plain';
  const group = TILES.map((_, j) => j).filter(j => TILES[j].t === 'prop' && TILES[j].g === t.g);
  const mine = group.filter(j => state.owner[j] === pi).length;
  const owners = new Set(group.map(j => state.owner[j]).filter(o => o >= 0 && o !== pi));
  if (mine === group.length - 1) return 'must';                                  // it finishes my group
  if (owners.size === 1 && group.filter(j => state.owner[j] >= 0 && state.owner[j] !== pi).length === group.length - 1) return 'must'; // it stops another finishing theirs
  if (mine > 0 && owners.size === 0) return 'good';                               // on the way to a group
  return 'plain';
}
/** Hard: raises cash by giving up what earns least: bare land with the lowest rent first, then single levels. */
function hardRaise(pi: number, need: number) {
  const p = state.players[pi];
  let guard = 200;
  while (p.cash < need && guard-- > 0) {
    const mine = owned(pi);
    const bare = mine.filter(i => !state.mort[i] && state.level[i] === 0).sort((a, b) => rentOf(a, 7) - rentOf(b, 7) || TILES[a].p! - TILES[b].p!);
    if (bare.length) { mortgage(pi, bare[0]); continue; }
    const built = mine.filter(i => state.level[i] > 0).sort((a, b) => rentOf(a, 7) - rentOf(b, 7));
    if (built.length) { sellLevel(pi, built[0]); continue; }
    break;
  }
  return p.cash >= need;
}
/** Raises cash for a player: Hard computers choose what to give up, everyone else the plain way. */
export function raiseCash(pi: number, need: number) {
  const p = state.players[pi];
  return isAI(p) && p.lv === 2 ? hardRaise(pi, need) : autoRaise(pi, need);
}
function aiReserve(p: Player) { return p.lv === 2 ? tune.ai_reserve_hard : tune.ai_reserve_mid; }
function aiWantsBuy(pi: number, i: number) {
  const p = state.players[pi], t = TILES[i];
  if (p.cash < t.p!) return false;
  if (p.lv === 0) return rng() < tune.ai_easy_buy_chance;
  if (p.lv === 2) { // Hard: ports and key group tiles nearly always; the rest while the board is safe enough
    const left = p.cash - t.p!, kind = hardWantsTile(pi, i);
    if (kind === 'must') return left >= tune.ai_hard_must_spare;
    return left >= hardReserve(pi) * (kind === 'good' ? tune.ai_hard_buy_keep * 0.5 : tune.ai_hard_buy_keep);
  }
  const left = p.cash - t.p!;
  let want = left >= aiReserve(p);
  if (t.t === 'prop') { // finishing or blocking a group is worth dipping into the reserve
    const groupTiles = TILES.map((_, j) => j).filter(j => TILES[j].t === 'prop' && TILES[j].g === t.g);
    const mineIn = groupTiles.filter(j => state.owner[j] === pi).length;
    const otherOwns = groupTiles.some(j => state.owner[j] >= 0 && state.owner[j] !== pi);
    if (mineIn === groupTiles.length - 1 && left >= 200) want = true;
    if (p.lv === 2 && otherOwns && left >= 400) want = true;
  }
  if (p.lv === 1 && rng() < tune.ai_mid_mistake) want = !want;
  return want;
}
function maxRentAgainst(pi: number) { // the worst rent this player could meet on the board
  let m = 0;
  for (let i = 0; i < 40; i++) if (state.owner[i] >= 0 && state.owner[i] !== pi) m = Math.max(m, rentOf(i, 7));
  return m;
}
function aiWantsBuild(pi: number, i: number) {
  const p = state.players[pi], cost = buildPrice(i, state.level[i] + 1);
  if (p.cash < cost) return false;
  if (p.lv === 0) return rng() < 0.7;
  const keep = p.lv === 2 ? hardReserve(pi) * tune.ai_hard_build_keep : tune.ai_reserve_mid + 300;
  let want = p.cash - cost >= keep;
  if (p.lv === 1 && rng() < tune.ai_mid_mistake) want = !want;
  return want;
}
export function aiPickTile(pi: number) {
  const p = state.players[pi];
  let best = -1, bestV = -1;
  for (let i = 0; i < 40; i++) {
    const t = TILES[i];
    let v = -1;
    if (OWNABLE(t) && state.owner[i] < 0 && !firstLap(p) && t.p! <= p.cash - (p.lv ? aiReserve(p) : 0)) v = t.p!;
    else if (state.owner[i] === pi && t.t === 'prop' && state.level[i] < MAX_LEVEL && !state.mort[i]) v = t.p! * 0.8;
    else if (t.t === 'free') v = state.pot;
    if (p.lv === 0) v = OWNABLE(t) && state.owner[i] < 0 ? rng() * 1000 : v;
    if (v > bestV) { bestV = v; best = i; }
  }
  return best >= 0 ? best : 0;
}
export function aiAct() { // one decision for the computer player, after its think delay
  const pi = state.cur, p = curP();
  switch (state.phase) {
    case 'roll': case 'order': startShake(true); return;
    case 'jail': {
      // Hard keeps its Thẻ Ra Tù while the board is full of others' land: a cell pays no rent
      if (p.freeCards.length && !(p.lv === 2 && state.owner.filter(o => o >= 0 && o !== pi).length >= tune.ai_hard_jail_tiles)) payJail();
      else startShake(true);
      return;
    }
    case 'buy': if (aiWantsBuy(pi, state.popup.tile)) doBuy(); else { log(`${p.name} bỏ qua ${TILES[state.popup.tile].n}.`); skip(); } return;
    case 'build': if (aiWantsBuild(pi, state.popup.tile)) doBuild(state.popup.tile); state.popup = null; afterAction(); return;
    case 'card': applyCard(); return;
    case 'rentShow': state.popup = null; afterAction(); return;
    case 'rentChoice': if (aiUsesKeep(p, state.popup.rent)) useNoRent(); else { const pop = state.popup; payRent(pop.tile, pop.rent, pop.owner); } return;
    case 'rerollChoice': if (aiUsesKeep(p, state.popup.rent)) useReroll(); else { const n = state.popup.n; state.popup = null; beginMove(n); } return;
    case 'pick': flyTo(state.pick); return;
    case 'debt':
      if (raiseCash(pi, state.debt.total)) payDebt(); else declareBankrupt();
      return;
    case 'end': nextTurn(); return;
  }
}

