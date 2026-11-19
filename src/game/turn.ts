// The turn: a new game (reset), the throws for the order of play, a turn from the dice to the end,
// landing on each kind of tile, cards, rent, building, debt and going broke, the rare kept cards and the
// round events. The money arithmetic lives in game/rules.ts; this file moves the game along.
// Design record: design/game-brief.md (Core loop, Features, After play).

import { rollFace, makeZone, meterPos, inZone, aiHold, throwWithZone } from './dice';
import { CONFIG, tune } from '../config';
import { params } from '../hook';
import { sfx } from '../audio';

import { W, BW, ctx, text, rrect } from '../screen';
import { rng, setSeed, freshSeed, shuffled } from '../game/rng';
import { TILES, OWNABLE, LEVEL_NAMES, MAX_LEVEL, ANIMALS, CARDS, EVENTS } from '../game/data';

import { tokenSpot } from '../game/board';
import * as R from '../game/rules';
import { state, scene, setup, setState, setScene } from '../core/store';

import { money } from '../game/rules';
import type { DeckKind, GameState, KeepAct, Loose, Player } from '../game/types';
import { aiTurnStart, raiseCash, aiPickTile, landingWorth } from '../game/ai';
import { checkSeed, events, L } from '../main';
import { forgetLocalGame } from '../core/keepLocal';
import { isGuest, lobby, sendLobby, peerOnline, isHost, myName } from '../net/room';
import { tokAnim } from '../three/scene3d';
import { fitText } from '../ui/setupScreen';
import { F } from '../core/flags';
import { CHIBI } from '../core/theme';
import { drawTokenIcon } from '../ui/draw';
import { icon } from '../draw/icons';
import { phoneToolbarEnd } from '../ui/toolbar';
import { CHEAP } from '../core/env';

// ---- Rules --------------------------------------------------------------------------
/** The kinds of game on the setup button, in turn: a short limited game, a long one, until one is left. */
/** This game's round limit: what the host chose, or the short one for a game saved before there was a choice. */
export const maxRounds = (): number => state.maxRounds ?? tune.max_rounds;
/** The setup button's words for a kind of game. */
export function kindLabel(mode: string, rounds: number, long: boolean, teams = false): string {
  const k = mode === 'rounds' ? (long && !teams ? `${rounds} vòng, giàu nhất thắng` : `${rounds} vòng`) : (teams ? 'tới khi phá sản' : 'Tới khi phá sản');
  return teams ? `2 đội · ${k}` : k;
}
/** A seat's team in a team game: what the host chose (seats 1 and 3 against 2 and 4 to begin with). */
export const teamOfSeat = (i: number): number => (isGuest() ? lobby?.teamOf?.[i] : setup.teamOf?.[i]) ?? i % 2;
export const teamTag = (team: number | undefined): string => (team === undefined ? '' : `Đội ${team + 1}`);
/** Gives seat i animal a, when it is a real animal no other seat has. */
export function setAnimal(i: number, a: unknown) {
  if (typeof a !== 'number' || !Number.isInteger(a) || a < 0 || a >= ANIMALS.length) return;
  if (setup.animals.some((x, k) => k !== i && x === a)) return;
  setup.animals[i] = a; sendLobby();
}
/** Gives seat i the next zodiac animal that no other seat has. */
export function nextAnimal(i: number) {
  const taken = setup.animals.filter((_, k) => k !== i);
  let a = setup.animals[i];
  do a = (a + 1) % ANIMALS.length; while (taken.includes(a));
  setup.animals[i] = a;
  sendLobby();
}
function reshuffle(kind: DeckKind) { // the deck ran out: the used cards go back in, in a new order
  const used = state.used[kind];
  for (let i = used.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [used[i], used[j]] = [used[j], used[i]]; }
  state.decks[kind] = used.splice(0);
  log(`Hết bộ thẻ ${kind === 'co' ? 'Cơ Hội' : 'Khí Vận'}: xáo lại!`);
}
export function reset() {
  // Every new game gets a fresh seed, so no two games roll alike. A fixed seed is used only when one is
  // asked for (?seed=) or when an automated check drives the page, so its runs repeat.
  const checked = params.has('seed') || CHEAP || params.get('manual') === '1' || !!window.GAME_CLOCK;
  setSeed(checkSeed ?? (checked ? (Number(params.get('seed')) || CONFIG.seed) : freshSeed()));
  const players: Player[] = [];
  setup.seats.forEach((s, i) => {
    if (s.kind === 'off') return;
    // a friend's seat with nobody in it when the game starts is played by the computer
    const kind = s.kind === 'remote' && !peerOnline(s.peer) ? 'ai' : s.kind;
    const a = setup.animals[i], an = ANIMALS[a].name;
    const name = kind === 'remote' ? (s.name || `Bạn ${an}`)
      : kind === 'human' ? (isHost() && i === 0 && myName ? myName : `Người ${an}`) : `Máy ${an}`;
    players.push({
      id: i, kind, lv: kind === 'remote' ? 1 : kind === 'ai' && s.kind === 'remote' ? 1 : s.lv || 0, color: ANIMALS[a].color, token: a, name,
      cash: tune.start_cash, pos: 0, laps: 0, inJail: false, jailTries: 0, freeCards: [], bankrupt: false, doubles: 0,
      ...(kind === 'remote' ? { peer: s.peer } : {}),
      ...(setup.teams ? { team: setup.teamOf[i] } : {}),
    });
  });
  setState({
    t: 0, score: 0, gained: '', players, cur: 0, round: 1, mode: setup.mode, maxRounds: setup.rounds, teams: setup.teams || undefined,
    owner: Array(40).fill(-1), level: Array(40).fill(0), mort: Array(40).fill(false),
    phase: 'roll', timer: 0, dice: [3, 4], diceT: 9, rolledDouble: false, moveLeft: 0, moveDir: 1, hopT: 0,
    popup: null, debt: null, pick: 0, log: [], floaters: [], decks: { co: shuffled(CARDS.co.length), kv: shuffled(CARDS.kv.length) }, used: { co: [], kv: [] },
    flash: { tile: -1, t: 0 }, ranking: null, turns: 0, pot: tune.pot_start,
  } as GameState);
  log(`Ván mới: ${players.length} người chơi, ${setup.teams ? '2 đội, ' : ''}${setup.mode === 'rounds' ? `${setup.rounds} vòng` : 'chơi tới khi phá sản'}.`);
  if (setup.teams) log(`Đội 1: ${players.filter(p => p.team === 0).map(p => p.name).join(' và ')}. Đội 2: ${players.filter(p => p.team === 1).map(p => p.name).join(' và ')}. Đất đồng đội không mất tiền thuê.`);
  if (tune.order_roll && players.length > 1) startOrder(); else startTurn();
}

// ---- Rare cards kept for later: Thẻ Miễn Thuê and Thẻ Đổ Lại -----------------------------------------
/** In a team game, whether players a and b (indexes in state.players) are partners. */
const sameTeam = (a: number, b: number): boolean => !!state.teams && a !== b && state.players[a].team === state.players[b].team;
export const hasKeep = (p: Player, act: KeepAct): boolean => !!p.keep && p.keep.some(k => k.act === act);
/** Takes a kept card from a player's hand and puts it back under its deck. */
function spendKeep(p: Player, act: KeepAct) {
  const k = p.keep!.findIndex(x => x.act === act), card = p.keep!.splice(k, 1)[0];
  state.used[card.deck].push(CARDS[card.deck].findIndex(c => c.act === act));
}
/** The rent of tile i, paid to its owner. */
export function payRent(i: number, rent: number, o: number) {
  const p = curP(), pi = state.cur, owner = state.players[o];
  events.push({ type: 'rent', tile: i, amt: rent, from: pi, to: o }); // for checks: which land earns what, who pays whom
  state.popup = { kind: 'rent', tile: i, rent, owner: o };
  // the summary counts the rent when it is paid (now, after a debt, or in part at a bankruptcy): rentTile marks it
  charge([{ to: o, amt: rent, rentTile: i }], `${p.name} trả ${owner.name} ${money(rent)} tiền thuê ở ${TILES[i].n}.`, 'rent');
}
/** Thẻ Miễn Thuê: this rent is not paid. */
export function useNoRent() {
  const p = curP(), pop = state.popup;
  spendKeep(p, 'norent');
  log(`${p.name} dùng Thẻ Miễn Thuê: không trả ${money(pop.rent)} ở ${TILES[pop.tile].n}.`);
  sfx.card(); state.popup = null; afterAction();
}
/** Where a throw of n from p's place would land, and whether that is someone else's rent to pay. */
function landingRent(pi: number, n: number): { tile: number; rent: number } {
  const p = state.players[pi], tile = (p.pos + n) % 40, o = state.owner[tile];
  return { tile, rent: o >= 0 && o !== pi && !state.mort[tile] && !sameTeam(pi, o) ? rentOf(tile, n) : 0 };
}
/** Thẻ Đổ Lại: the throw is taken back and thrown again. */
export function useReroll() {
  const p = curP(), [a, b] = state.dice;
  spendKeep(p, 'reroll');
  if (a === b) p.doubles = Math.max(0, p.doubles - 1); // the double taken back does not count
  state.rolledDouble = false; state.popup = null; state.diceShow = undefined;
  log(`${p.name} dùng Thẻ Đổ Lại: đổ xúc xắc lại.`);
  sfx.card(); state.phase = 'roll'; state.timer = 0;
  if (isAI(p)) aiTurnStart(p);
}
/** The computer uses a kept card when the rent hurts: at least ai_keep_rent_share of its cash, or ai_keep_rent_min. */
export const aiUsesKeep = (p: Player, rent: number): boolean => rent >= Math.min(tune.ai_keep_rent_min, Math.max(0, p.cash) * tune.ai_keep_rent_share) || rent > p.cash;

// ---- Round events ----------------------------------------------------------------------------------
// Every event_every rounds one event (EVENTS in game/data.ts) is drawn for the whole table and lasts
// event_rounds rounds: a festival doubles a province's rent, a storm halves central Vietnam's, Tết doubles
// the salary... Drawn with the game's rng, so a seed repeats them. Design: game-brief.md (After play).
/** At the start of a round: the event that ran out ends, and on every event_every-th round a new one begins. */
function roundEvents() {
  if (state.event && state.round > state.event.until) { log(`Hết sự kiện ${EVENTS[state.event.i].name}.`); state.event = undefined; }
  if (!tune.event_every || state.round % tune.event_every !== 0) return;
  const i = Math.floor(rng() * EVENTS.length);
  state.event = { i, until: state.round + tune.event_rounds - 1, t: 0 };
  log(`Sự kiện: ${EVENTS[i].name}. ${EVENTS[i].txt}${tune.event_rounds > 1 ? ` (${tune.event_rounds} vòng)` : ' (vòng này)'}.`);
  sfx.card();
}
const activeEvent = () => R.activeEvent(state);
/** What building to a level costs now: the base price, halved while Kích cầu xây dựng is on. */
export function buildPrice(i: number, to: number): number {
  const e = activeEvent();
  return Math.round(buildCost(i, to) * (e && e.kind === 'build' ? e.v : 1));
}
/** The salary for passing Xuất Phát now: doubled at Tết. */
export function salaryNow(): number {
  const e = activeEvent();
  return Math.round(tune.salary * (e && e.kind === 'salary' ? e.v : 1));
}
/** The event's banner: big for a few seconds when it begins, then a small card in the corner while it lasts. */
export function drawEvent() {
  const e = activeEvent();
  if (!e || !state.event || F.inspect >= 0) return;
  const left = state.event.until - state.round + 1, fresh = state.event.t < tune.event_banner_time;
  const sub = `${e.txt}${left > 1 ? ` · còn ${left} vòng` : ' · vòng này'}`;
  if (fresh) { // the announcement over the board
    const a = Math.min(1, state.event.t / 0.25, (tune.event_banner_time - state.event.t) / 0.4);
    const w = Math.min(L.maxW, 440), h = 104, x = L.cx - w / 2, y = L.phone ? L.by + 150 : 200;
    ctx.save(); ctx.globalAlpha = Math.max(0, a);
    ctx.fillStyle = 'rgba(122,20,18,0.95)'; rrect(ctx, x, y, w, h, 16); ctx.fill(); ctx.strokeStyle = '#f2c44a'; ctx.lineWidth = 3; ctx.stroke();
    text('SỰ KIỆN', L.cx, y + 22, 15, '#f2c44a', 'center', 'bold');
    fitText(e.name, L.cx, y + 52, w - 30, 28, '#fff8e6');
    fitText(sub, L.cx, y + 84, w - 30, 17, '#ffe9a8', '');
    ctx.restore();
    return;
  }
  // the reminder: a phone puts it in the toolbar row, right of the pills, clear of the board
  const toolbarEnd = L.phone ? phoneToolbarEnd() : 0;
  const x = L.phone ? toolbarEnd : BW - 340, w = L.phone ? W - 12 - toolbarEnd : 330, y = L.phone ? L.by + 6 : 10, h = L.phone ? 32 : 46;
  ctx.save(); ctx.fillStyle = 'rgba(122,20,18,0.88)'; rrect(ctx, x, y, w, h, 10); ctx.fill(); ctx.strokeStyle = '#f2c44a'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
  fitText(`Sự kiện: ${e.name}`, x + w / 2, y + (L.phone ? 10 : 15), w - 12, L.phone ? 13 : 15, '#f2c44a');
  fitText(sub, x + w / 2, y + (L.phone ? 24 : 33), w - 12, L.phone ? 11 : 13, '#fff8e6', '');
}

// ---- Choosing who goes first ----------------------------------------------------------------
// With order_roll on, a game opens with everyone throwing the dice once, in seat order. The highest
// total goes first, then downwards: the lowest goes last. Players who tie throw again among themselves.
/** Starts the throws for the order of play. */
function startOrder() {
  state.ordering = true;
  state.order = state.players.map(() => null);
  state.orderPast = state.players.map(() => []);
  log('Tung xúc xắc chọn thứ tự đi: ai cao nhất đi trước, thấp nhất đi cuối.');
  nextOrderThrow();
}
/** The next player who still has to throw, or the order decided. */
export function nextOrderThrow() {
  const i = state.order!.findIndex(v => v === null);
  if (i < 0) { finishOrder(); return; }
  state.cur = i; state.phase = 'order'; state.timer = 0; state.popup = null;
}
/** A throw for the order landed: note it, show it for a moment. */
function orderThrown(total: number) {
  const p = curP();
  state.order![state.cur] = total; p.orderRoll = total;
  log(`${p.name} tung được ${total}.`);
  state.phase = 'orderShow'; state.timer = 0;
}
/** Everyone has thrown: ties throw again; otherwise the players are put in order, highest first, lowest last.
 * A re-throw only settles the order among the players who tied: each player's throws so far are
 * compared in turn (the first throw, then the re-throw), so a re-throw never jumps a higher first throw. */
function finishOrder() {
  const past = state.orderPast ?? state.players.map(() => []); // a game kept before orderPast: no earlier throws
  const r = R.settleOrder(past, state.order as number[]);
  if ('tied' in r) {
    log(`Hòa điểm: ${r.tied.map(i => state.players[i].name).join(', ')} tung lại.`);
    state.orderPast = r.past;
    for (const i of r.tied) state.order![i] = null;
    nextOrderThrow();
    return;
  }
  const idx = r.order;
  state.players = idx.map(i => state.players[i]);
  state.ordering = false; state.order = undefined; state.orderPast = undefined;
  log(`Thứ tự đi: ${state.players.map(p => p.name).join(' → ')}.`);
  state.cur = 0;
  startTurn();
}
/** The board of throws while the order is chosen. */
export function drawOrder() {
  // A slim table low on the board, so the dice thrown above it stay in view.
  if (!state.ordering) return;
  if (CHIBI) { drawOrderChibi(); return; }
  const n = state.players.length, cols = 2, rows = Math.ceil(n / cols);
  const w = Math.min(460, L.maxW), h = 52 + rows * 32, x = L.cx - w / 2, y = L.by + L.bh - h - (L.phone ? 10 : 70), cw = (w - 24) / cols;
  ctx.save(); ctx.fillStyle = 'rgba(30,12,8,0.88)'; rrect(ctx, x, y, w, h, 14); ctx.fill();
  ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
  text('Chọn thứ tự đi · cao nhất đi trước', L.cx, y + 22, 17, '#f2c44a', 'center', 'bold');
  state.players.forEach((p, i) => {
    const cx = x + 12 + (i % cols) * cw, yy = y + 56 + Math.floor(i / cols) * 32, cur = i === state.cur;
    if (cur) { ctx.fillStyle = 'rgba(242,196,74,0.2)'; rrect(ctx, cx, yy - 14, cw - 6, 28, 6); ctx.fill(); }
    ctx.fillStyle = p.color; ctx.fillRect(cx + 8, yy - 8, 10, 16);
    text(p.name, cx + 26, yy, 16, '#fff8e6', 'left', cur ? 'bold' : '');
    const v = state.order![i];
    text(v === null ? (cur ? 'đang tung' : 'chờ') : String(v), cx + cw - 16, yy, v === null ? 14 : 20, v === null ? '#cbb994' : '#f2c44a', 'right', 'bold');
  });
}
/** The chibi look's order table: each player's animal in a bubble, their throw on a little die, the
 * one throwing now hopping; the highest throw so far wears a crown. */
function drawOrderChibi() {
  const n = state.players.length, cols = 2, rows = Math.ceil(n / cols), rowH = 46;
  const w = Math.min(460, L.maxW), h = 50 + rows * rowH, x = L.cx - w / 2, y = L.by + L.bh - h - (L.phone ? 10 : 70), cw = (w - 24) / cols;
  ctx.save(); ctx.fillStyle = 'rgba(255,249,234,0.96)'; rrect(ctx, x, y, w, h, 22); ctx.fill();
  ctx.strokeStyle = '#e8a86a'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
  text('Tung xúc xắc chọn lượt · cao nhất đi trước', L.cx, y + 24, 17, '#d9622b', 'center', 'bold');
  const thrown = state.order!.filter((v): v is number => v !== null), best = thrown.length ? Math.max(...thrown) : -1;
  state.players.forEach((p, i) => {
    const cx = x + 12 + (i % cols) * cw, cy = y + 50 + Math.floor(i / cols) * rowH + rowH / 2 - 4, cur = i === state.cur, v = state.order![i];
    ctx.save(); ctx.fillStyle = cur ? '#ffe2b0' : '#fff6e2'; rrect(ctx, cx, cy - 19, cw - 8, 38, 19); ctx.fill();
    ctx.strokeStyle = cur ? '#ff9a76' : '#ecd2a8'; ctx.lineWidth = cur ? 2.5 : 1.5; ctx.stroke(); ctx.restore();
    const hop = cur && v === null ? -Math.abs(Math.sin(state.t * 6)) * 5 : 0;
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(cx + 19, cy + hop, 16, 0, 7); ctx.fill();
    drawTokenIcon(p.token, cx + 19, cy + 1 + hop, 28, p.color, v !== null && v === best ? 'happy' : undefined);
    if (v !== null && v === best) icon.crown(ctx, cx + 19, cy - 20 + hop, 16);
    text(p.name, cx + 42, cy, 15, '#4a3020', 'left', cur ? 'bold' : '');
    const dx = cx + cw - 30;
    if (v === null) { text(cur ? '...' : 'chờ', dx, cy, 14, '#9a7a5a', 'center', 'bold'); return; }
    ctx.save(); ctx.fillStyle = '#ffffff'; rrect(ctx, dx - 15, cy - 15, 30, 30, 8); ctx.fill(); ctx.strokeStyle = '#d2a878'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
    text(String(v), dx, cy + 1, 18, '#d9622b', 'center', 'bold');
  });
}
export const curP = () => state.players[state.cur];
export const firstLap = (p: Player) => (p.laps || 0) < tune.first_lap_count; // still on the first lap: no buying, no tax
export const isAI = (p: Player) => p.kind === 'ai';
export function log(s: string) { (state.history ||= []).push(`V${state.round}: ${s}`); if (state.history.length > 300) state.history.shift(); state.log.push(s); if (state.log.length > 5) state.log.shift(); events.push({ type: 'log', text: s }); }
// The money rules, read against this game's state (src/game/rules.ts).
export const owned = (pi: number): number[] => R.owned(state, pi);
export const ownsGroup = (pi: number, g: number): boolean => R.ownsGroup(state, pi, g);
export const rentPct = R.rentPct;
export const rentOf = (i: number, diceSum: number): number => R.rentOf(state, i, diceSum);
const buildCost = R.buildCost;
export const levelsOf = (pi: number): number => R.levelsOf(state, pi);
const netWorth = (p: Player): number => R.netWorth(state, p);
export const liquidValue = (pi: number): number => R.liquidValue(state, pi);
function activePlayers() { return state.players.filter(p => !p.bankrupt); }

export function floatAtToken(pi: number, s: string, color: string) {
  const q = state.players[pi], sp = tokenSpot(q.id, q.pos, q.inJail);
  state.floaters.push({ world: { x: sp.x, y: 1.2, z: sp.z }, s, color, t: 0 });
}
function floatAtRow(pi: number, s: string, color: string) { state.floaters.push({ row: pi, s, color, t: 0 }); }
export function gain(pi: number, amt: number, why?: string) {
  if (amt <= 0) return;
  state.players[pi].cash += amt; state.players[pi].face = { k: 'happy', at: state.t };
  floatAtRow(pi, '+' + money(amt), '#7ee08a'); floatAtToken(pi, '+' + money(amt), '#3fcf5a');
  if (why) log(why);
  sfx.coin();
}
function lose(pi: number, amt: number) {
  state.players[pi].cash -= amt; state.players[pi].face = { k: 'sad', at: state.t };
  floatAtRow(pi, '-' + money(amt), '#ff9a8a'); floatAtToken(pi, '-' + money(amt), '#ff5a4a');
}
// pay: the current player pays amounts to players (or the bank, to -1). If the cash is short the
// game enters the debt phase and pays once the money is raised; `next` says where the turn goes after paying.
/** What comes after a charge is paid. A name, not a function, because a debt is saved with the game
 * (JSON) and must still know where to go after a reload. */
type AfterCharge = 'rent' | 'after';
function afterCharge(next: AfterCharge) {
  if (next === 'rent') { state.phase = 'rentShow'; state.timer = 0; } else afterAction();
}
function charge(payments: Loose[], why: string, next: AfterCharge) {
  const pi = state.cur, p = curP();
  const total = payments.reduce((s: number, x: Loose) => s + x.amt, 0);
  if (total <= 0) { afterCharge(next); return; }
  if (p.cash >= total) { settle(pi, payments); if (why) log(why); afterCharge(next); return; }
  state.debt = { payments, total, why, next };
  state.phase = 'debt'; state.timer = 0;
  log(`${p.name} thiếu tiền: cần ${money(total)}.`);
}
/** Rent actually paid, for the end-of-game summary, by seat and by tile. */
function countRent(pi: number, x: Loose, amt: number) {
  if (x.rentTile === undefined || amt <= 0) return;
  const st = (state.stats ||= { paid: [0, 0, 0, 0], got: [0, 0, 0, 0], tile: {} });
  st.paid[state.players[pi].id] += amt; st.got[state.players[x.to].id] += amt; st.tile[x.rentTile] = (st.tile[x.rentTile] || 0) + amt;
}
function settle(pi: number, payments: Loose[]) {
  for (const x of payments) {
    lose(pi, x.amt); countRent(pi, x, x.amt);
    if (x.to >= 0) { gain(x.to, x.amt); fly(pi, x.to); }
    else if (x.pot) { feedPot(x.amt); fly(pi, -1); } // only the two tax tiles feed the jar; other bank payments just leave the game
  }
  sfx.pay();
}
/** Coins fly with a payment, from a seat (or the jar, -1) to a seat (or the jar): src/three/coinFlights.ts. */
function fly(from: number, to: number) { (state.flights ||= []).push({ from, to, at: state.t }); }
// Hũ tiền giữa bàn: the two tax tiles pay into the jar; landing on Bến Đỗ Tự Do takes it all.
function feedPot(amt: number) { const add = Math.round(amt * tune.pot_share); if (add > 0) { state.pot += add; } }
function takePot(pi: number) {
  const p = state.players[pi], amt = state.pot;
  if (amt <= 0) { log(`${p.name} nghỉ chân ở Bến Đỗ Tự Do, nhưng hũ tiền đang trống.`); return; }
  state.pot = 0; fly(-1, pi);
  gain(pi, amt, `${p.name} dừng ở Bến Đỗ Tự Do: ôm trọn hũ tiền ${money(amt)}!`);
  sfx.win(); events.push({ type: 'pot', who: pi, amt });
}
export function sellLevel(pi: number, i: number) {
  if (state.owner[i] !== pi || state.level[i] <= 0) return false;
  const refund = Math.round(buildCost(i, state.level[i]) * tune.sell_pct);
  state.level[i]--; state.players[pi].cash += refund;
  log(`${state.players[pi].name} bán bớt 1 cấp ở ${TILES[i].n}: +${money(refund)}.`);
  return true;
}
export function mortgage(pi: number, i: number) {
  if (state.owner[i] !== pi || state.mort[i] || state.level[i] > 0) return false;
  const v = Math.round(TILES[i].p! * tune.mortgage_pct);
  state.mort[i] = true; state.players[pi].cash += v;
  log(`${state.players[pi].name} cầm cố ${TILES[i].n}: +${money(v)}.`);
  return true;
}
export function unmortgage(pi: number, i: number) {
  const v = Math.round(TILES[i].p! * tune.unmortgage_pct);
  if (state.owner[i] !== pi || !state.mort[i] || state.players[pi].cash < v) return false;
  state.mort[i] = false; state.players[pi].cash -= v;
  log(`${state.players[pi].name} chuộc lại ${TILES[i].n}: -${money(v)}.`);
  return true;
}
export function autoRaise(pi: number, need: number) { // sells levels (highest first), then mortgages the cheapest land
  const p = state.players[pi];
  let guard = 200;
  while (p.cash < need && guard-- > 0) {
    const mine = owned(pi);
    const built = mine.filter(i => state.level[i] > 0).sort((a, b) => state.level[b] - state.level[a] || TILES[a].p! - TILES[b].p!);
    if (built.length) { sellLevel(pi, built[0]); continue; }
    const free = mine.filter(i => !state.mort[i]).sort((a, b) => {
      const ga = TILES[a].t === 'prop' && ownsGroup(pi, TILES[a].g!), gb = TILES[b].t === 'prop' && ownsGroup(pi, TILES[b].g!);
      return (Number(ga) - Number(gb)) || TILES[a].p! - TILES[b].p!;
    });
    if (free.length) { mortgage(pi, free[0]); continue; }
    break;
  }
  return p.cash >= need;
}
function goBankrupt(pi: number, creditors: Loose[]) {
  const p = state.players[pi];
  autoRaise(pi, Infinity);
  // what is left goes to the creditors, in order
  let left = Math.max(0, p.cash);
  for (const x of creditors || []) {
    if (x.to < 0) continue;
    const part = Math.min(left, x.amt); left -= part;
    if (part > 0) { gain(x.to, part); countRent(pi, x, part); }
  }
  p.cash = 0; p.bankrupt = true;
  for (const i of owned(pi)) { state.owner[i] = -1; state.level[i] = 0; state.mort[i] = false; }
  // the cards they kept go back under their decks, as a used card does, so no card leaves the game
  for (const d of p.freeCards) state.used[d].push(CARDS[d].findIndex(c => c.act === 'free'));
  for (const k of p.keep || []) state.used[k.deck].push(CARDS[k.deck].findIndex(c => c.act === k.act));
  p.freeCards = []; p.keep = [];
  log(`${p.name} PHÁ SẢN! Đất trả về ngân hàng.`);
  sfx.broke();
  events.push({ type: 'bankrupt', who: pi });
  if (state.teams) { const left = new Set(activePlayers().map(q => q.team)); if (left.size <= 1) endGame(`Chỉ còn ${teamTag([...left][0])} trụ lại!`); }
  else if (activePlayers().length <= 1) endGame('Chỉ còn một người trụ lại!');
}
function endGame(reason: string) {
  const worthOf = (p: Player): number => (p.bankrupt ? 0 : netWorth(p));
  // a team game ranks the team first (both its players together), then each player
  const teamWorth = (t: number | undefined): number => state.players.filter(q => q.team === t).reduce((a, q) => a + worthOf(q), 0);
  const ranking = state.players.map((p, i) => ({ i, worth: worthOf(p), bankrupt: p.bankrupt, team: p.team }))
    .sort((a, b) => (state.teams ? teamWorth(b.team) - teamWorth(a.team) : 0) || (Number(a.bankrupt) - Number(b.bankrupt)) || b.worth - a.worth);
  state.ranking = ranking; state.phase = 'over';
  const w = state.players[ranking[0].i];
  // the same worth at the top (a game that ends after its rounds): a tie, said as one, not a winner by seat order
  const top = ranking.filter(r => !r.bankrupt && (state.teams ? r.team !== w.team && teamWorth(r.team) === teamWorth(w.team) : r.i !== ranking[0].i && r.worth === ranking[0].worth));
  const tied = !w.bankrupt && top.length > 0;
  state.gained = tied
    ? (state.teams ? `Hòa! Hai đội bằng tài sản: ${money(teamWorth(w.team))} mỗi đội.` : `Hòa! ${[w, ...top.map(r => state.players[r.i])].map(q => q.name).join(' và ')} cùng là tỷ phú.`)
    : state.teams ? `${teamTag(w.team)} thắng: ${state.players.filter(q => q.team === w.team).map(q => q.name).join(' và ')}!` : `${w.name} là tỷ phú, thắng ván!`;
  state.score = Math.round(ranking[0].worth);
  state.reason = reason;
  log(state.gained);
  events.push({ type: 'over', winner: ranking[0].i });
  sfx.win();
  setScene('results'); state.t = 0;
  forgetLocalGame(); // a finished game is not offered again
}

// ---- Turn flow ----------------------------------------------------------------------
function startTurn() {
  const p = curP();
  p.doubles = 0; state.rolledDouble = false; state.popup = null;
  state.timer = 0;
  if (p.inJail) { state.phase = 'jail'; log(`${p.name} đang ở tù (lượt ${p.jailTries + 1}/3).`); }
  else state.phase = 'roll';
  state.turns++;
  if (isAI(p)) aiTurnStart(p);
}
export function nextTurn() {
  if (state.phase === 'over' || scene !== 'play') return;
  const n = state.players.length;
  let i = state.cur;
  for (let k = 0; k < n; k++) {
    i = (i + 1) % n;
    if (i === 0 || (i <= state.cur && k === 0)) { /* wrap handled below */ }
    if (!state.players[i].bankrupt) break;
  }
  if (i <= state.cur) {
    state.round++;
    if (state.mode === 'rounds' && state.round > maxRounds()) { endGame(`Hết ${maxRounds()} vòng: ai giàu nhất thắng!`); return; }
    if (state.mode === 'rounds' && state.round === maxRounds()) log('Vòng cuối cùng!');
    roundEvents();
  }
  state.cur = i;
  startTurn();
}
// Throwing: hold to shake the dice in the air, let go to throw. The longer the shake, the harder
// the throw: more spin, higher bounces, a longer tumble, and the faces tend high (a soft throw: low;
// src/game/dice.ts, data/config.json dice_power_tilt).
export function startShake(ai = false, aim?: number) { // aim: the power a computer that aims wants (Khó)
  if (state.shaking) return;
  const zone = makeZone(); // the sweet zone of this shake (src/game/dice.ts)
  state.shaking = { t: 0, ai, holdFor: ai ? aiHold(curP().lv ?? 1, zone, aim) : 0, rattle: 0, zone };
}
/** Where the power bar stands: the friend's own let-go power online, else the bar's place now (it runs up and down). */
export function shakePower() { return state.shaking ? state.shaking.power ?? meterPos(state.shaking.t) : 0; }
export function throwDice() {
  const pw = shakePower(), hit = inZone(pw, state.shaking?.zone), p = curP(), pi = state.cur;
  state.shaking = null;
  if (hit) log(`${p.name} thả trúng vùng đẹp!`);
  // let go in the sweet zone: maybe a second throw, the better one for the thrower kept (as Khó weighs it)
  const worth = (d: number[]) => (state.ordering ? d[0] + d[1] : p.inJail ? (d[0] === d[1] ? 1 : 0) : landingWorth(pi, (p.pos + d[0] + d[1]) % 40, d[0] + d[1]));
  roll(pw, throwWithZone(2, pw, hit, worth));
}
function roll(power = 0.5, dice?: number[]) {
  const p = curP();
  const [a, b] = dice ?? [rollFace(power), rollFace(power)]; // a hard throw tends high, a soft one low (src/game/dice.ts)
  state.dice = [a, b]; state.diceT = 0; state.phase = 'dice'; state.timer = 0;
  state.throwPower = power; state.diceDur = tune.dice_time * (0.75 + 0.6 * power); state.diceShow = null;
  state.diceSpin = [0, 1].map(() => ({ ax: rng() * 2 - 1, ay: rng() * 2 - 1, az: rng() * 2 - 1, yaw: rng() * Math.PI * 2, n: 2 + Math.floor(rng() * 2) + Math.round(power * 3) }));
  sfx.dice();
  events.push({ type: 'roll', who: state.cur, dice: [a, b] });
  p.lastRoll = a + b;
}
export function afterDice() {
  const p = curP(), [a, b] = state.dice, dbl = a === b;
  state.diceShow = { t: 0, a, b, dbl };
  if (dbl) sfx.double(); else sfx.land();
  if (state.ordering) { orderThrown(a + b); return; }
  if (p.inJail) {
    if (dbl) { // a double frees them and, like any double, earns another roll (it counts toward three in a row)
      p.inJail = false; p.jailTries = 0; p.doubles = 1; state.rolledDouble = true;
      log(`${p.name} đổ đôi ${a}-${b}: ra tù và được đổ tiếp!`); beginMove(a + b); return;
    }
    p.jailTries++;
    if (p.jailTries >= 3) {
      // the third miss uses up the third turn: the stay is over, and next turn they roll as usual
      p.inJail = false; p.jailTries = 0; log(`${p.name} đã ở đủ 3 lượt: lượt sau được ra tù, không mất tiền.`);
      toEnd(); return;
    }
    log(`${p.name} đổ ${a}-${b}, không phải đôi: ở lại tù.`);
    toEnd(); return;
  }
  if (dbl) {
    p.doubles++;
    if (p.doubles >= 3) { log(`${p.name} đổ đôi 3 lần liền: vào tù!`); sendToJail(state.cur); toEnd(); return; }
    state.rolledDouble = true;
  } else state.rolledDouble = false;
  log(`${p.name} đổ ${a} + ${b} = ${a + b}${dbl ? ' (đôi!)' : ''}.`);
  if (hasKeep(p, 'reroll')) { // Thẻ Đổ Lại in hand and the throw lands on someone else's land: the player chooses
    const land = landingRent(state.cur, a + b);
    if (land.rent > 0) { state.popup = { kind: 'reroll', tile: land.tile, rent: land.rent, n: a + b }; state.phase = 'rerollChoice'; state.timer = 0; return; }
  }
  beginMove(a + b);
}
export function beginMove(n: number, dir = 1, fast = false) {
  state.moveLeft = n; state.moveDir = dir; state.hopT = 0; state.hopFast = fast; state.phase = 'move';
}
function sendToJail(pi: number) {
  const p = state.players[pi];
  const from = tokenSpot(p.id, p.pos, false);
  p.pos = 10; p.inJail = true; p.jailTries = 0; state.rolledDouble = false;
  const to = tokenSpot(p.id, 10, true);
  tokAnim[p.id] = { from, to, t: 0, dur: 0.8, h: 2.2 };
  sfx.jail(); events.push({ type: 'jail', who: pi });
}
function toEnd() { state.phase = 'end'; state.timer = 0; state.popup = null; }
export function afterAction() { // the landing is resolved: roll again on a double, else end the turn
  if (state.phase === 'over') return;
  const p = curP();
  if (p.bankrupt) { nextTurn(); return; }
  if (state.rolledDouble && !p.inJail) { state.phase = 'roll'; state.timer = 0; state.popup = null; log(`${p.name} được đổ tiếp!`); if (isAI(p)) aiTurnStart(p); return; }
  toEnd();
}
export function resolveLanding() {
  const pi = state.cur, p = curP(), i = p.pos, t = TILES[i];
  state.flash = { tile: i, t: 0 };
  events.push({ type: 'land', who: pi, tile: i });
  if (OWNABLE(t)) {
    const o = state.owner[i];
    if (o < 0 && firstLap(p)) { // a player's first lap, until they pass Xuất Phát, is for looking around: no buying yet
      state.popup = { kind: 'nobuy', tile: i }; state.phase = 'rentShow'; state.timer = 0;
      log(`${p.name} chưa qua Xuất Phát lần nào: chưa được mua ${t.n}.`); return;
    }
    if (o < 0) { state.popup = { kind: 'buy', tile: i }; state.phase = 'buy'; state.timer = 0; return; }
    if (o === pi) {
      if (t.t === 'prop' && !state.mort[i] && state.level[i] < MAX_LEVEL) {
        state.popup = { kind: 'build', tile: i }; state.phase = 'build'; state.timer = 0; return;
      }
      log(`${p.name} về thăm ${t.n} của mình.`); afterAction(); return;
    }
    if (state.mort[i]) { log(`${t.n} đang cầm cố: không mất tiền thuê.`); afterAction(); return; }
    if (sameTeam(pi, o)) { log(`${t.n} là đất đồng đội ${state.players[o].name}: không mất tiền thuê.`); afterAction(); return; }
    const rent = rentOf(i, p.lastRoll || 7);
    if (rent > 0 && hasKeep(p, 'norent')) { // Thẻ Miễn Thuê in hand: the player chooses
      state.popup = { kind: 'rentChoice', tile: i, rent, owner: o }; state.phase = 'rentChoice'; state.timer = 0; return;
    }
    payRent(i, rent, o);
    return;
  }
  if (t.t === 'co' || t.t === 'kv') {
    if (!state.decks[t.t].length) reshuffle(t.t);
    const ci = state.decks[t.t].shift();
    const card = CARDS[t.t][ci!];
    if (card.act !== 'free' && card.act !== 'norent' && card.act !== 'reroll') state.used[t.t].push(ci!); // a kept card stays out until it is used
    state.popup = { kind: 'card', deck: t.t, ci, card };
    state.phase = 'card'; state.timer = 0; sfx.card();
    log(`${p.name} rút thẻ ${t.n}: ${card.txt}`);
    return;
  }
  if (t.t === 'tax' && activeEvent()?.kind === 'noTax') { // Giảm thuế: neither tax tile charges this round
    state.popup = { kind: 'notax', tile: i }; state.phase = 'rentShow'; state.timer = 0;
    log(`${p.name} được miễn ${t.n} (sự kiện ${activeEvent()!.name}).`); return;
  }
  if (t.t === 'tax' && firstLap(p)) { // no tax on the first lap either
    state.popup = { kind: 'notax', tile: i }; state.phase = 'rentShow'; state.timer = 0;
    log(`${p.name} đang đi vòng đầu: miễn ${t.n}.`); return;
  }
  if (t.t === 'tax' && t.kind === 'prop') { // Thuế Tài Sản: 10% of the cash in hand, capped at the flat sum; no choice
    const amt = R.propertyTax(p.cash);
    charge([{ to: -1, amt, pot: true }], `${p.name} đóng ${t.n}: ${money(amt)} (${Math.round(tune.prop_tax_pct * 100)}% tiền mặt, tối đa ${money(tune.prop_tax_flat)}; vào hũ).`, 'after'); return;
  }
  if (t.t === 'tax') {
    const amt = tune.income_tax;
    charge([{ to: -1, amt, pot: true }], `${p.name} đóng ${t.n}: ${money(amt)} (vào hũ).`, 'after'); return;
  }
  if (t.t === 'gojail') { log(`${p.name} bị dẫn vào tù!`); sendToJail(pi); toEnd(); return; }
  if (t.t === 'free') takePot(pi);
  if (t.t === 'jail') log(`${p.name} ghé thăm Nhà Tù.`);
  afterAction();
}
export function doBuy() {
  const pi = state.cur, p = curP(), i = state.popup.tile, t = TILES[i];
  if (p.cash < t.p!) return;
  p.cash -= t.p!; state.owner[i] = pi;
  floatAtRow(pi, '-' + money(t.p!), '#ff9a8a');
  log(`${p.name} mua ${t.n} giá ${money(t.p!)}.`);
  sfx.buy(); events.push({ type: 'buy', who: pi, tile: i });
  state.popup = null; afterAction();
}
export function doBuild(i: number, free = false) {
  const pi = state.cur, p = curP();
  const to = state.level[i] + 1, cost = free ? 0 : buildPrice(i, to);
  if (to > MAX_LEVEL || p.cash < cost) return;
  p.cash -= cost; state.level[i] = to;
  if (cost) floatAtRow(pi, '-' + money(cost), '#ff9a8a');
  log(`${p.name} xây ${LEVEL_NAMES[to]}${to === 6 ? ' ' + TILES[i].lm : ''} ở ${TILES[i].n}${free ? ' (miễn phí)' : ''}.`);
  if (to === MAX_LEVEL) sfx.landmark(); else sfx.build(); // a Landmark rises to a gong and drums
  events.push({ type: 'build', who: pi, tile: i, level: to });
}
export function skip() { state.popup = null; afterAction(); }
export function applyCard() {
  const pi = state.cur, p = curP(), c = state.popup.card, deckKind = state.popup.deck;
  state.popup = null;
  switch (c.act) {
    case 'money': { // no card moves more than card_max either way
      const v = Math.max(-tune.card_max, Math.min(tune.card_max, c.v));
      if (v >= 0) { gain(pi, v); afterAction(); }
      else charge([{ to: -1, amt: -v }], '', 'after');
    }
      return;
    case 'move': beginMove((c.to - p.pos + 40) % 40 || 40, 1, true); return;
    case 'back': beginMove(c.v, -1, true); return;
    case 'nearport': { let k = 1; while (TILES[(p.pos + k) % 40].t !== 'port') k++; beginMove(k, 1, true); return; }
    case 'jail': // a jail card also docks the next salary, unless they later leave jail with a Thẻ Ra Tù
      sendToJail(pi); p.noSalary = true; log(`${p.name} sẽ mất lương lần qua Xuất Phát tới.`); toEnd(); return;
    case 'free': p.freeCards.push(deckKind); afterAction(); return;
    case 'norent': case 'reroll': (p.keep ||= []).push({ act: c.act, deck: deckKind }); afterAction(); return;
    case 'repair': charge([{ to: -1, amt: Math.min(tune.card_max, c.v * levelsOf(pi)) }], '', 'after'); return;
    // "each player" means the other side: a teammate neither pays nor is paid (as with rent)
    case 'payeach': charge(state.players.map((q, j) => ({ to: j, amt: (j !== pi && !q.bankrupt && !sameTeam(pi, j)) ? c.v : 0 })).filter(x => x.amt > 0), '', 'after'); return;
    case 'collect':
      state.players.forEach((q, j) => {
        if (j === pi || q.bankrupt || sameTeam(pi, j) || state.phase === 'over') return; // the game may end part way: nobody pays after
        if (q.cash < c.v) raiseCash(j, c.v);
        if (q.cash >= c.v) { lose(j, c.v); gain(pi, c.v); }
        else { const part = Math.max(0, q.cash); if (part) { lose(j, part); gain(pi, part); } goBankrupt(j, []); }
      });
      if (state.phase !== 'over') afterAction();
      return;
    case 'freebuild': {
      const opts = owned(pi).filter(i => TILES[i].t === 'prop' && !state.mort[i] && state.level[i] < MAX_LEVEL)
        .sort((a, b) => TILES[b].p! - TILES[a].p! || state.level[b] - state.level[a]);
      if (opts.length) doBuild(opts[0], true); else log(`${p.name} chưa có đất để xây.`);
      afterAction(); return;
    }
    case 'fly':
      state.phase = 'pick'; state.pick = (p.pos + 1) % 40; state.timer = 0;
      if (isAI(p)) state.pick = aiPickTile(pi);
      return;
  }
  afterAction();
}
export function flyTo(target: number) {
  const p = curP();
  beginMove((target - p.pos + 40) % 40 || 40, 1, true);
  log(`${p.name} bay tới ${TILES[target].n}.`);
}
export function payJail() {
  const p = curP();
  if (p.freeCards.length) { const d = p.freeCards.pop() as DeckKind; state.used[d].push(CARDS[d].findIndex(c => c.act === 'free')); log(`${p.name} dùng Thẻ Ra Tù Miễn Phí${p.noSalary ? ': được nhận lương lại' : ''}.`); p.noSalary = false; }
  else return; // no paying out of jail: only a double, a Thẻ Ra Tù or three tries
  p.inJail = false; p.jailTries = 0; state.phase = 'roll'; state.timer = 0;
  if (isAI(p)) aiTurnStart(p);
}
export function payDebt() {
  const d = state.debt, p = curP();
  if (!d || p.cash < d.total) return;
  state.debt = null;
  settle(state.cur, d.payments); if (d.why) log(d.why);
  afterCharge(d.next === 'rent' ? 'rent' : 'after'); // a game saved before 'next' existed goes on as 'after'
}
export function declareBankrupt() {
  const d = state.debt; state.debt = null; state.popup = null;
  goBankrupt(state.cur, d ? d.payments : []);
  if (state.phase !== 'over') nextTurn();
}

