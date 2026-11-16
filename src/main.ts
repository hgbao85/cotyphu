// Tỷ Phú Đất Việt: a property board game on a map of Việt Nam, 2-4 seats, each a person or the
// computer. The 3D board is drawn with three.js into an offscreen canvas and copied into the 2D
// canvas each frame; the HUD, popups and buttons are drawn on top in 2D.
// Design record: design/game-brief.md. Rules with no browser live in src/game/.
import * as THREE from 'three';
import { CONFIG, tune } from './config';
import { clock, install, params } from './hook';
import { startAudio, setMuted, isMuted, sfx } from './audio';
import * as net from './net/net';
import { W, H, BW, FONT, canvas, ctx, screenScale, afterFit, beforeFit, setLogical, fit, clear, text, rrect, wrapLines } from './screen';
import { rng, setSeed, freshSeed, shuffled } from './game/rng';
import { GROUPS, TILES, OWNABLE, LEVEL_NAMES, LEVEL_SHORT, MAX_LEVEL, PLAYER_COLORS, PLAYER_COLOR_NAMES, TOKEN_NAMES, AI_LEVELS, CARDS } from './game/data';
import { HALF, CORNER, BAND, BOARD_TOP, L as BOARD_SIZE, tileInfo, tileAt, tokenSpot } from './game/board';
import * as R from './game/rules';
import { money } from './game/rules';
import type { DeckKind, GameState, Loose, Player, Seat, Tile } from './game/types';

if (import.meta.env.DEV) await import('./dev/tune'); // the tweak panel, on the dev server only

// ---- Layout: wide screens and phones held upright --------------------------------------
// A wide screen is 1280x720: the board on the left, the panel on the right, the turn's buttons over
// the board. A phone held upright is 480x960: a header, a square board, the players, then a strip
// of big buttons. Everything that sits over or beside the board reads its place from L.
interface Layout {
  phone: boolean;
  /** The board view's rectangle on the screen. */
  bx: number; by: number; bw: number; bh: number;
  /** The centre line of the turn's buttons and messages, and the popup card's centre. */
  cx: number; popCy: number;
  /** Where the turn's message, the roll button and the popup buttons sit. */
  msgY: number; rollY: number; btnY: number;
  /** The widest message box, the power bar, the network banner, the inspect card's close button. */
  maxW: number; powerY: number; bannerY: number; closeY: number;
}
const WIDE: Layout = { phone: false, bx: 0, by: 0, bw: BW, bh: 720, cx: BW / 2, popCy: 330, msgY: 322, rollY: 372, btnY: 600, maxW: 640, powerY: 446, bannerY: 676, closeY: 548 };
const PHONE: Layout = { phone: true, bx: 0, by: 50, bw: 480, bh: 480, cx: 240, popCy: 290, msgY: 738, rollY: 782, btnY: 782, maxW: 464, powerY: 908, bannerY: 942, closeY: 782 };
let L: Layout = WIDE;
/** Picks the layout from the window's shape: a tall window gets the phone layout. */
function chooseLayout() {
  const phone = innerHeight > innerWidth * 1.05;
  const next = phone ? PHONE : WIDE;
  if (next !== L) { L = next; propScroll = 0; sheetOpen = false; if (camera) aimCamera(); }
  setLogical(phone ? 480 : 1280, phone ? 960 : 720);
}
beforeFit(chooseLayout);
/** True when a point on the screen is over the board view. */
const inBoard = (x: number, y: number): boolean => x >= L.bx && x < L.bx + L.bw && y >= L.by && y < L.by + L.bh;
let sheetOpen = false; // phone: the property list, opened from its button

const STEP = 1 / 60;            // simulation step in seconds; motion is per second, never per frame
const TITLE = 'Tỷ Phú Đất Việt';
const CONTROLS = ['Chuột: bấm các nút', 'Space / Enter: đổ xúc xắc, đồng ý', 'N / Esc: bỏ qua', 'M: tắt tiếng'];
const CHEAP = params.get('render') === 'cheap'; // a headless shot or check: 3D draws cheap; players never see it
const events: Loose[] = []; // window.game.events: anything the game wants a run to see

const muted = (): boolean => isMuted();

// ---- Input: keys by position (event.code), OS key repeat ignored ------------------------
const down = new Set(), hit = new Set();
const pressed = (code: string) => hit.has(code); // true for one step after the key goes down
const clicks: { x: number; y: number }[] = []; // pointer clicks in logical coordinates, read by the next step
let pointer = { x: -1, y: -1 };
addEventListener('keydown', e => {
  startAudio();
  if (!e.repeat) { down.add(e.code); hit.add(e.code); }
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', e => down.delete(e.code));
function toLogical(e: { clientX: number; clientY: number }) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
}
let pointerHeld = false;
addEventListener('pointerdown', e => { startAudio(); pointerHeld = true; clicks.push(toLogical(e)); });
addEventListener('pointerup', e => { pointerHeld = false; if (e.pointerType !== 'mouse') pointer = { x: -1, y: -1 }; }); // a finger leaves no hover behind
addEventListener('contextmenu', e => e.preventDefault()); // a long press shakes the dice, it opens no menu
addEventListener('pointercancel', () => { pointerHeld = false; });
addEventListener('pointermove', e => { pointer = toLogical(e); });
addEventListener('wheel', e => { wheel += Math.sign(e.deltaY); }, { passive: true });
let wheel = 0;
addEventListener('blur', () => { down.clear(); pointerHeld = false; });


// ---- Online play -----------------------------------------------------------------------
// The host's browser runs the rules exactly as on one screen. A friend's seat is 'remote': when it
// is their turn the host builds that turn's buttons unseen, and the friend's acts press them. The
// host sends the whole game state about 20 times a second; a guest's browser draws it, animates
// the tokens, plays the sounds the host played, and sends its own presses back.
const isHost = (): boolean => net.getRole() === 'host';
const isGuest = (): boolean => net.getRole() === 'guest';
let roomCode = '', myName = '', mySeat = -1;
let linkUp = false, hostOnline = true, netError = '';
let guestShaking = false;                    // guest: holding the shake button, waiting to let go
let lobby: Loose = null;                     // guest: the host's seats before the game starts
const peers = new Map<number, { name: string; online: boolean }>();   // host: friends in the room
let pendingSfx: Loose[] = [];                // host: sounds played since the last state sent
let sendEvery = 0;
const rawSfx: Record<string, (...a: Loose[]) => void> = {};
for (const k of Object.keys(sfx)) { // the host records each sound so the guests hear it too
  const f = (sfx as Loose)[k] as (...a: Loose[]) => void;
  rawSfx[k] = f;
  (sfx as Loose)[k] = (...a: Loose[]) => { if (isHost() && k !== 'click') pendingSfx.push([k, ...a]); f(...a); };
}
const peerOnline = (id: number | undefined): boolean => id !== undefined && !!peers.get(id)?.online;

/** Guest: an act for the host (the name of a button, and a tile for 'pick'). */
function sendAct(act: string, i?: number) {
  net.toHost({ k: 'act', act, i });
}

const handlers: net.NetHandlers = {
  onRoom(code) { roomCode = code; netError = ''; if (isHost()) sendLobby(); },
  onPeer(id, name, online) {
    const known = peers.has(id);
    peers.set(id, { name, online });
    if (!known) seatPeer(id, name);
    const seat = setup.seats.find(s => s.kind === 'remote' && s.peer === id);
    if (seat) seat.name = name;
    if (state && state.players) for (const p of state.players) if (p.peer === id) { p.offline = !online; if (online) p.name = name; }
    if (online) sendYou(id);
    sendLobby();
  },
  onFromPeer(from, d) { if (d && d.k === 'act') onGuestAct(from, d); },
  onFromHost(d) { onHostMsg(d); },
  onHost(online) { hostOnline = online; },
  onLink(up) { linkUp = up; },
  onError(msg) { netError = msg; roomCode = ''; showOnlinePanel(true); },
};

/** Host: a new friend takes the first empty or computer seat (seat 0 is the host's). */
function seatPeer(id: number, name: string) {
  if (scene !== 'title') { net.toOne(id, { k: 'full', msg: 'Ván đang chơi: chờ ván sau nhé.' }); return; }
  const order = [1, 2, 3];
  let i = order.find(k => setup.seats[k].kind === 'remote' && setup.seats[k].peer === undefined);
  if (i === undefined) i = order.find(k => setup.seats[k].kind === 'off');
  if (i === undefined) i = order.find(k => setup.seats[k].kind === 'ai');
  if (i === undefined) { net.toOne(id, { k: 'full', msg: 'Phòng đã đủ người.' }); return; }
  setup.seats[i] = { kind: 'remote', peer: id, name };
}
/** Host: tells a friend which seat is theirs. */
function sendYou(id: number) {
  const i = setup.seats.findIndex(s => s.kind === 'remote' && s.peer === id);
  const p = state && state.players ? state.players.find(q => q.peer === id) : undefined;
  net.toOne(id, { k: 'you', seat: p ? p.id : i });
}
/** Host: the seats before a game, for the friends' waiting screen. */
function sendLobby() {
  if (!isHost()) return;
  net.toAll({ k: 'lobby', code: roomCode, mode: setup.mode, hostName: myName, seats: setup.seats.map(s => ({ ...s })) });
  for (const id of peers.keys()) sendYou(id);
}

/** Host: a friend pressed a button. Only their own turn's buttons count, checked as for a press here. */
function onGuestAct(from: number, a: Loose) {
  if (scene !== 'play' || !state.players) return;
  const p = curP();
  if (p.kind !== 'remote' || p.peer !== from) return;
  if (a.act === 'throw') { if (state.shaking && state.shaking.remote) state.shaking.released = true; return; }
  if (a.act === 'pick') { if (state.phase === 'pick' && Number.isInteger(a.i) && a.i >= 0 && a.i < 40) state.pick = a.i; return; }
  const row = /^(sell|mort|unmort):(\d+)$/.exec(String(a.act));
  if (row) { // the property list: allowed while the turn's buttons show it
    if (!['roll', 'end', 'debt', 'jail'].includes(state.phase)) return;
    const i = Number(row[2]);
    if (row[1] === 'sell') sellLevel(state.cur, i); else if (row[1] === 'mort') mortgage(state.cur, i); else unmortgage(state.cur, i);
    return;
  }
  const saved = ui; ui = [];
  buildTurnUI();
  const b = ui.find(x => x.act === a.act && x.enabled);
  ui = saved;
  if (!b) return;
  b.fn();
  if (a.act === 'shake' && state.shaking) state.shaking.remote = true;
}

/** Guest: a message from the host. */
function onHostMsg(d: Loose) {
  if (!d) return;
  if (d.k === 'you') mySeat = d.seat;
  else if (d.k === 'full') { netError = d.msg; }
  else if (d.k === 'lobby') { lobby = d; if (scene !== 'title') { scene = 'title'; clearVis(); } }
  else if (d.k === 'state') {
    const fresh = scene !== d.scene && d.scene === 'play' && scene === 'title';
    state = d.state; scene = d.scene;
    if (fresh) { clearVis(); propScroll = 0; }
    for (const s of d.sfx || []) rawSfx[s[0]]?.(...s.slice(1));
  }
}

/** Every step: the host sends the state; a guest lets go of the dice when the finger lifts. */
function netStep() {
  if (isHost() && (scene === 'play' || scene === 'results')) {
    for (const p of state.players) if (p.kind === 'remote') p.offline = !peerOnline(p.peer);
    if (++sendEvery >= 3 || pendingSfx.length) { // about 20 times a second, at once when a sound plays
      sendEvery = 0;
      net.toAll({ k: 'state', scene, state, sfx: pendingSfx });
      pendingSfx = [];
    }
  } else if (isHost() && scene === 'title') {
    if (++sendEvery >= 30) { sendEvery = 0; sendLobby(); }
  }
  if (isGuest() && guestShaking && !(pointerHeld || down.has('Space') || down.has('Enter'))) {
    guestShaking = false; sendAct('throw');
  }
}

// The online panel: plain HTML over the canvas, so phones get their own keyboard for the name and code.
let onlinePanel: HTMLDivElement | null = null;
function showOnlinePanel(on: boolean) {
  if (!onlinePanel) {
    const d = document.createElement('div');
    d.id = 'online';
    d.innerHTML = `
      <div class="op-card">
        <h2>Chơi online với bạn bè</h2>
        <label>Tên của bạn<input id="op-name" maxlength="20" autocomplete="nickname" placeholder="Ví dụ: Bảo"></label>
        <button id="op-create" class="op-main">Tạo phòng mới</button>
        <div class="op-or">hoặc vào phòng của bạn bè</div>
        <label>Mã phòng<input id="op-code" maxlength="6" autocapitalize="characters" placeholder="Ví dụ: HN42"></label>
        <button id="op-join">Vào phòng</button>
        <p id="op-error"></p>
        <button id="op-close" class="op-close">Đóng</button>
      </div>`;
    document.body.appendChild(d);
    onlinePanel = d;
    const name = d.querySelector('#op-name') as HTMLInputElement, code = d.querySelector('#op-code') as HTMLInputElement;
    name.value = net.savedName();
    const nameOk = (): string => { const n = name.value.trim(); if (!n) { setErr('Nhập tên của bạn trước nhé.'); name.focus(); } return n; };
    (d.querySelector('#op-create') as HTMLButtonElement).onclick = () => {
      const n = nameOk(); if (!n) return;
      myName = n; peers.clear(); setup.seats[0] = { kind: 'human' };
      net.createRoom(n, handlers); showOnlinePanel(false);
    };
    (d.querySelector('#op-join') as HTMLButtonElement).onclick = () => {
      const n = nameOk(); if (!n) return;
      if (!/^[A-Za-z]{2}\d{2}$/.test(code.value.trim())) { setErr('Mã phòng gồm 2 chữ và 2 số, ví dụ HN42.'); code.focus(); return; }
      myName = n; mySeat = -1; lobby = null;
      net.joinRoom(code.value, n, handlers); showOnlinePanel(false);
    };
    (d.querySelector('#op-close') as HTMLButtonElement).onclick = () => showOnlinePanel(false);
    d.addEventListener('keydown', e => e.stopPropagation()); // typing a name never moves the game
  }
  const setErr = (m: string) => { (onlinePanel!.querySelector('#op-error') as HTMLElement).textContent = m; };
  setErr(netError);
  onlinePanel.style.display = on ? 'flex' : 'none';
}
/** Leaves the room and goes back to playing on this screen. */
function leaveRoom() {
  net.leave(); roomCode = ''; mySeat = -1; lobby = null; peers.clear(); netError = '';
  setup.seats.forEach((s, i) => { if (s.kind === 'remote') setup.seats[i] = { kind: 'ai', lv: 1 }; });
  scene = 'title'; reset(); clearVis();
}

// ---- Rules --------------------------------------------------------------------------
let setup: { seats: Seat[]; mode: 'bankrupt' | 'rounds' } = { seats: [{ kind: 'human' }, { kind: 'ai', lv: 1 }, { kind: 'ai', lv: 0 }, { kind: 'off' }], mode: 'bankrupt' };
let scene: string;
let state: GameState;
function reshuffle(kind: DeckKind) { // the deck ran out: the used cards go back in, in a new order
  const used = state.used[kind];
  for (let i = used.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [used[i], used[j]] = [used[j], used[i]]; }
  state.decks[kind] = used.splice(0);
  log(`Hết bộ thẻ ${kind === 'co' ? 'Cơ Hội' : 'Khí Vận'}: xáo lại!`);
}
function reset() {
  // Every new game gets a fresh seed, so no two games roll alike. A fixed seed is used only when one is
  // asked for (?seed=) or when an automated check drives the page, so its runs repeat.
  const checked = params.has('seed') || CHEAP || params.get('manual') === '1' || !!window.GAME_CLOCK;
  setSeed(checked ? (Number(params.get('seed')) || CONFIG.seed) : freshSeed());
  const players: Player[] = [];
  setup.seats.forEach((s, i) => {
    if (s.kind === 'off') return;
    // a friend's seat with nobody in it when the game starts is played by the computer
    const kind = s.kind === 'remote' && !peerOnline(s.peer) ? 'ai' : s.kind;
    const name = kind === 'remote' ? (s.name || `Bạn ${PLAYER_COLOR_NAMES[i]}`)
      : kind === 'human' ? (isHost() && i === 0 && myName ? myName : `Người ${PLAYER_COLOR_NAMES[i]}`) : `Máy ${PLAYER_COLOR_NAMES[i]}`;
    players.push({
      id: i, kind, lv: kind === 'remote' ? 1 : kind === 'ai' && s.kind === 'remote' ? 1 : s.lv || 0, color: PLAYER_COLORS[i], token: i, name,
      cash: tune.start_cash, pos: 0, laps: 0, inJail: false, jailTries: 0, freeCards: [], bankrupt: false, doubles: 0,
      ...(kind === 'remote' ? { peer: s.peer } : {}),
    });
  });
  state = {
    t: 0, score: 0, gained: '', players, cur: 0, round: 1, mode: setup.mode,
    owner: Array(40).fill(-1), level: Array(40).fill(0), mort: Array(40).fill(false),
    phase: 'roll', timer: 0, dice: [3, 4], diceT: 9, rolledDouble: false, moveLeft: 0, moveDir: 1, hopT: 0,
    popup: null, debt: null, pick: 0, log: [], floaters: [], decks: { co: shuffled(16), kv: shuffled(16) }, used: { co: [], kv: [] },
    flash: { tile: -1, t: 0 }, ranking: null, turns: 0, pot: tune.pot_start,
  };
  log(`Ván mới: ${players.length} người chơi, ${setup.mode === 'rounds' ? `${tune.max_rounds} vòng` : 'chơi tới khi phá sản'}.`);
  startTurn();
}
const curP = () => state.players[state.cur];
const firstLap = (p: Player) => (p.laps || 0) < tune.first_lap_count; // still on the first lap: no buying, no tax
const isAI = (p: Player) => p.kind === 'ai';
function log(s: string) { state.log.push(s); if (state.log.length > 5) state.log.shift(); events.push({ type: 'log', text: s }); }
// The money rules, read against this game's state (src/game/rules.ts).
const owned = (pi: number): number[] => R.owned(state, pi);
const ownsGroup = (pi: number, g: number): boolean => R.ownsGroup(state, pi, g);
const rentPct = R.rentPct;
const rentOf = (i: number, diceSum: number): number => R.rentOf(state, i, diceSum);
const buildCost = R.buildCost;
const builtValue = (i: number): number => R.builtValue(state, i);
const levelsOf = (pi: number): number => R.levelsOf(state, pi);
const netWorth = (p: Player): number => R.netWorth(state, p);
const liquidValue = (pi: number): number => R.liquidValue(state, pi);
function activePlayers() { return state.players.filter(p => !p.bankrupt); }

function floatAtToken(pi: number, s: string, color: string) {
  const q = state.players[pi], sp = tokenSpot(q.id, q.pos, q.inJail);
  state.floaters.push({ world: { x: sp.x, y: 1.2, z: sp.z }, s, color, t: 0 });
}
function floatAtRow(pi: number, s: string, color: string) { state.floaters.push({ row: pi, s, color, t: 0 }); }
function gain(pi: number, amt: number, why?: string) {
  if (amt <= 0) return;
  state.players[pi].cash += amt;
  floatAtRow(pi, '+' + money(amt), '#7ee08a'); floatAtToken(pi, '+' + money(amt), '#3fcf5a');
  if (why) log(why);
  sfx.coin();
}
function lose(pi: number, amt: number) {
  state.players[pi].cash -= amt;
  floatAtRow(pi, '-' + money(amt), '#ff9a8a'); floatAtToken(pi, '-' + money(amt), '#ff5a4a');
}
// pay: the current player pays amounts to players (or the bank, to -1). If the cash is short the
// game enters the debt phase and pays once the money is raised; `then` runs after paying.
function charge(payments: Loose[], why: string, then: () => void) {
  const pi = state.cur, p = curP();
  const total = payments.reduce((s: number, x: Loose) => s + x.amt, 0);
  if (total <= 0) { then(); return; }
  if (p.cash >= total) { settle(pi, payments); if (why) log(why); then(); return; }
  state.debt = { payments, total, why, then };
  state.phase = 'debt'; state.timer = 0;
  log(`${p.name} thiếu tiền: cần ${money(total)}.`);
}
function settle(pi: number, payments: Loose[]) {
  for (const x of payments) {
    lose(pi, x.amt);
    if (x.to >= 0) gain(x.to, x.amt);
    else if (x.pot) feedPot(x.amt); // only the two tax tiles feed the jar; other bank payments just leave the game
  }
  sfx.pay();
}
// Hũ tiền giữa bàn: the two tax tiles pay into the jar; landing on Bến Đỗ Tự Do takes it all.
function feedPot(amt: number) { const add = Math.round(amt * tune.pot_share); if (add > 0) { state.pot += add; } }
function takePot(pi: number) {
  const p = state.players[pi], amt = state.pot;
  if (amt <= 0) { log(`${p.name} nghỉ chân ở Bến Đỗ Tự Do, nhưng hũ tiền đang trống.`); return; }
  state.pot = 0;
  gain(pi, amt, `${p.name} dừng ở Bến Đỗ Tự Do: ôm trọn hũ tiền ${money(amt)}!`);
  sfx.win(); events.push({ type: 'pot', who: pi, amt });
}
function sellLevel(pi: number, i: number) {
  if (state.owner[i] !== pi || state.level[i] <= 0) return false;
  const refund = Math.round(buildCost(i, state.level[i]) * tune.sell_pct);
  state.level[i]--; state.players[pi].cash += refund;
  log(`${state.players[pi].name} bán bớt 1 cấp ở ${TILES[i].n}: +${money(refund)}.`);
  return true;
}
function mortgage(pi: number, i: number) {
  if (state.owner[i] !== pi || state.mort[i] || state.level[i] > 0) return false;
  const v = Math.round(TILES[i].p! * tune.mortgage_pct);
  state.mort[i] = true; state.players[pi].cash += v;
  log(`${state.players[pi].name} cầm cố ${TILES[i].n}: +${money(v)}.`);
  return true;
}
function unmortgage(pi: number, i: number) {
  const v = Math.round(TILES[i].p! * tune.unmortgage_pct);
  if (state.owner[i] !== pi || !state.mort[i] || state.players[pi].cash < v) return false;
  state.mort[i] = false; state.players[pi].cash -= v;
  log(`${state.players[pi].name} chuộc lại ${TILES[i].n}: -${money(v)}.`);
  return true;
}
function autoRaise(pi: number, need: number) { // sells levels (highest first), then mortgages the cheapest land
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
    if (part > 0) gain(x.to, part);
  }
  p.cash = 0; p.bankrupt = true;
  for (const i of owned(pi)) { state.owner[i] = -1; state.level[i] = 0; state.mort[i] = false; }
  p.freeCards = [];
  log(`${p.name} PHÁ SẢN! Đất trả về ngân hàng.`);
  sfx.broke();
  events.push({ type: 'bankrupt', who: pi });
  if (activePlayers().length <= 1) endGame('Chỉ còn một người trụ lại!');
}
function endGame(reason: string) {
  const ranking = state.players.map((p, i) => ({ i, worth: p.bankrupt ? 0 : netWorth(p), bankrupt: p.bankrupt }))
    .sort((a, b) => (Number(a.bankrupt) - Number(b.bankrupt)) || b.worth - a.worth);
  state.ranking = ranking; state.phase = 'over';
  const w = state.players[ranking[0].i];
  state.gained = `${w.name} là Tỷ Phú Đất Việt!`;
  state.score = Math.round(ranking[0].worth);
  state.reason = reason;
  log(state.gained);
  events.push({ type: 'over', winner: ranking[0].i });
  sfx.win();
  scene = 'results'; state.t = 0;
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
function nextTurn() {
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
    if (state.mode === 'rounds' && state.round > tune.max_rounds) { endGame(`Hết ${tune.max_rounds} vòng: ai giàu nhất thắng!`); return; }
    if (state.mode === 'rounds' && state.round === tune.max_rounds) log('Vòng cuối cùng!');
  }
  state.cur = i;
  startTurn();
}
// Throwing: hold to shake the dice in the air, let go to throw. The longer the shake, the harder
// the throw: more spin, higher bounces, a longer tumble. The faces are rolled by rng() either way.
function startShake(ai = false) {
  if (state.shaking) return;
  state.shaking = { t: 0, ai, holdFor: ai ? 0.35 + rng() * 0.7 : 0, rattle: 0 };
}
function shakePower() { return state.shaking ? Math.min(1, state.shaking.t / tune.shake_full_time) : 0; }
function throwDice() { const pw = shakePower(); state.shaking = null; roll(pw); }
function roll(power = 0.5) {
  const p = curP();
  const a = 1 + Math.floor(rng() * 6), b = 1 + Math.floor(rng() * 6);
  state.dice = [a, b]; state.diceT = 0; state.phase = 'dice'; state.timer = 0;
  state.throwPower = power; state.diceDur = tune.dice_time * (0.75 + 0.6 * power); state.diceShow = null;
  state.diceSpin = [0, 1].map(() => ({ ax: rng() * 2 - 1, ay: rng() * 2 - 1, az: rng() * 2 - 1, yaw: rng() * Math.PI * 2, n: 2 + Math.floor(rng() * 2) + Math.round(power * 3) }));
  sfx.dice();
  events.push({ type: 'roll', who: state.cur, dice: [a, b] });
  p.lastRoll = a + b;
}
function afterDice() {
  const p = curP(), [a, b] = state.dice, dbl = a === b;
  state.diceShow = { t: 0, a, b, dbl };
  if (dbl) sfx.double(); else sfx.land();
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
  beginMove(a + b);
}
function beginMove(n: number, dir = 1, fast = false) {
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
function afterAction() { // the landing is resolved: roll again on a double, else end the turn
  if (state.phase === 'over') return;
  const p = curP();
  if (p.bankrupt) { nextTurn(); return; }
  if (state.rolledDouble && !p.inJail) { state.phase = 'roll'; state.timer = 0; state.popup = null; log(`${p.name} được đổ tiếp!`); if (isAI(p)) aiTurnStart(p); return; }
  toEnd();
}
function resolveLanding() {
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
    const rent = rentOf(i, p.lastRoll || 7);
    const owner = state.players[o];
    state.popup = { kind: 'rent', tile: i, rent, owner: o };
    charge([{ to: o, amt: rent }], `${p.name} trả ${owner.name} ${money(rent)} tiền thuê ở ${t.n}.`, () => { state.phase = 'rentShow'; state.timer = 0; });
    return;
  }
  if (t.t === 'co' || t.t === 'kv') {
    if (!state.decks[t.t].length) reshuffle(t.t);
    const ci = state.decks[t.t].shift();
    const card = CARDS[t.t][ci!];
    if (card.act !== 'free') state.used[t.t].push(ci!); // a kept Thẻ Ra Tù stays out until it is used
    state.popup = { kind: 'card', deck: t.t, ci, card };
    state.phase = 'card'; state.timer = 0; sfx.card();
    log(`${p.name} rút thẻ ${t.n}: ${card.txt}`);
    return;
  }
  if (t.t === 'tax' && firstLap(p)) { // no tax on the first lap either
    state.popup = { kind: 'notax', tile: i }; state.phase = 'rentShow'; state.timer = 0;
    log(`${p.name} đang đi vòng đầu: miễn ${t.n}.`); return;
  }
  if (t.t === 'tax' && t.kind === 'prop') { // Thuế Tài Sản: pay 10% of everything you own, or the flat sum: your pick
    const pct = Math.round(Math.max(0, p.cash) * tune.prop_tax_pct / 10) * 10; // 10% of the cash in hand, not of land
    state.popup = { kind: 'tax', tile: i, pct, flat: tune.prop_tax_flat };
    state.phase = 'taxChoice'; state.timer = 0; return;
  }
  if (t.t === 'tax') {
    const amt = tune.income_tax;
    charge([{ to: -1, amt, pot: true }], `${p.name} đóng ${t.n}: ${money(amt)} (vào hũ).`, afterAction); return;
  }
  if (t.t === 'gojail') { log(`${p.name} bị dẫn vào tù!`); sendToJail(pi); toEnd(); return; }
  if (t.t === 'free') takePot(pi);
  if (t.t === 'jail') log(`${p.name} ghé thăm Nhà Tù.`);
  afterAction();
}
function doBuy() {
  const pi = state.cur, p = curP(), i = state.popup.tile, t = TILES[i];
  if (p.cash < t.p!) return;
  p.cash -= t.p!; state.owner[i] = pi;
  floatAtRow(pi, '-' + money(t.p!), '#ff9a8a');
  log(`${p.name} mua ${t.n} giá ${money(t.p!)}.`);
  sfx.buy(); events.push({ type: 'buy', who: pi, tile: i });
  state.popup = null; afterAction();
}
function doBuild(i: number, free = false) {
  const pi = state.cur, p = curP();
  const to = state.level[i] + 1, cost = free ? 0 : buildCost(i, to);
  if (to > MAX_LEVEL || p.cash < cost) return;
  p.cash -= cost; state.level[i] = to;
  if (cost) floatAtRow(pi, '-' + money(cost), '#ff9a8a');
  log(`${p.name} xây ${LEVEL_NAMES[to]}${to === 6 ? ' ' + TILES[i].lm : ''} ở ${TILES[i].n}${free ? ' (miễn phí)' : ''}.`);
  sfx.build(); events.push({ type: 'build', who: pi, tile: i, level: to });
}
function skip() { state.popup = null; afterAction(); }
function applyCard() {
  const pi = state.cur, p = curP(), c = state.popup.card, deckKind = state.popup.deck;
  state.popup = null;
  switch (c.act) {
    case 'money': { // no card moves more than card_max either way
      const v = Math.max(-tune.card_max, Math.min(tune.card_max, c.v));
      if (v >= 0) { gain(pi, v); afterAction(); }
      else charge([{ to: -1, amt: -v }], '', afterAction);
    }
      return;
    case 'move': beginMove((c.to - p.pos + 40) % 40 || 40, 1, true); return;
    case 'back': beginMove(c.v, -1, true); return;
    case 'nearport': { let k = 1; while (TILES[(p.pos + k) % 40].t !== 'port') k++; beginMove(k, 1, true); return; }
    case 'jail': // a jail card also docks the next salary, unless they later leave jail with a Thẻ Ra Tù
      sendToJail(pi); p.noSalary = true; log(`${p.name} sẽ mất lương lần qua Xuất Phát tới.`); toEnd(); return;
    case 'free': p.freeCards.push(deckKind); afterAction(); return;
    case 'repair': charge([{ to: -1, amt: Math.min(tune.card_max, c.v * levelsOf(pi)) }], '', afterAction); return;
    case 'payeach': charge(state.players.map((q, j) => ({ to: j, amt: (j !== pi && !q.bankrupt) ? c.v : 0 })).filter(x => x.amt > 0), '', afterAction); return;
    case 'collect':
      state.players.forEach((q, j) => {
        if (j === pi || q.bankrupt) return;
        if (q.cash < c.v) autoRaise(j, c.v);
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
function flyTo(target: number) {
  const p = curP();
  beginMove((target - p.pos + 40) % 40 || 40, 1, true);
  log(`${p.name} bay tới ${TILES[target].n}.`);
}
function payTax(amt: number) {
  const p = curP(), t = TILES[state.popup.tile];
  state.popup = null;
  charge([{ to: -1, amt, pot: true }], `${p.name} đóng ${t.n}: ${money(amt)} (vào hũ).`, afterAction);
}
function payJail() {
  const p = curP();
  if (p.freeCards.length) { const d = p.freeCards.pop() as DeckKind; state.used[d].push(CARDS[d].findIndex(c => c.act === 'free')); log(`${p.name} dùng Thẻ Ra Tù Miễn Phí${p.noSalary ? ': được nhận lương lại' : ''}.`); p.noSalary = false; }
  else return; // no paying out of jail: only a double, a Thẻ Ra Tù or three tries
  p.inJail = false; p.jailTries = 0; state.phase = 'roll'; state.timer = 0;
  if (isAI(p)) aiTurnStart(p);
}
function payDebt() {
  const d = state.debt, p = curP();
  if (!d || p.cash < d.total) return;
  state.debt = null;
  settle(state.cur, d.payments); if (d.why) log(d.why);
  d.then();
}
function declareBankrupt() {
  const d = state.debt; state.debt = null; state.popup = null;
  goBankrupt(state.cur, d ? d.payments : []);
  if (state.phase !== 'over') nextTurn();
}

// ---- AI ------------------------------------------------------------------------------
function aiTurnStart(p: Player) {
  const pi = state.players.indexOf(p);
  if (p.lv >= 1) { // buy back mortgaged land when comfortable
    for (const i of owned(pi)) if (state.mort[i] && p.cash > TILES[i].p! * tune.unmortgage_pct + 3000) unmortgage(pi, i);
  }
}
function aiReserve(p: Player) { return p.lv === 2 ? tune.ai_reserve_hard : tune.ai_reserve_mid; }
function aiWantsBuy(pi: number, i: number) {
  const p = state.players[pi], t = TILES[i];
  if (p.cash < t.p!) return false;
  if (p.lv === 0) return rng() < tune.ai_easy_buy_chance;
  const left = p.cash - t.p!;
  let want = left >= aiReserve(p);
  if (t.t === 'prop') { // finishing or blocking a group is worth dipping into the reserve
    const groupTiles = TILES.map((u, j) => j).filter(j => TILES[j].t === 'prop' && TILES[j].g === t.g);
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
  const p = state.players[pi], cost = buildCost(i, state.level[i] + 1);
  if (p.cash < cost) return false;
  if (p.lv === 0) return rng() < 0.7;
  const keep = p.lv === 2 ? Math.max(tune.ai_reserve_hard, maxRentAgainst(pi) * 0.6) : tune.ai_reserve_mid + 300;
  let want = p.cash - cost >= keep;
  if (p.lv === 1 && rng() < tune.ai_mid_mistake) want = !want;
  return want;
}
function aiPickTile(pi: number) {
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
function aiAct() { // one decision for the computer player, after its think delay
  const pi = state.cur, p = curP();
  switch (state.phase) {
    case 'roll': startShake(true); return;
    case 'jail': {
      if (p.freeCards.length) payJail(); else startShake(true);
      return;
    }
    case 'buy': if (aiWantsBuy(pi, state.popup.tile)) doBuy(); else { log(`${p.name} bỏ qua ${TILES[state.popup.tile].n}.`); skip(); } return;
    case 'build': if (aiWantsBuild(pi, state.popup.tile)) doBuild(state.popup.tile); state.popup = null; afterAction(); return;
    case 'card': applyCard(); return;
    case 'rentShow': state.popup = null; afterAction(); return;
    case 'taxChoice': payTax(Math.min(state.popup.pct, state.popup.flat)); return;
    case 'pick': flyTo(state.pick); return;
    case 'debt':
      if (autoRaise(pi, state.debt.total)) payDebt(); else declareBankrupt();
      return;
    case 'end': nextTurn(); return;
  }
}

// ---- 3D: renderer, table, board ------------------------------------------------------
let renderer: THREE.WebGLRenderer | null = null, scene3: THREE.Scene, camera: THREE.PerspectiveCamera, figScene: THREE.Scene, figCamera: THREE.PerspectiveCamera;
const tok3: THREE.Group[] = [], tokAnim: (Loose | null)[] = [], tokVis: ({ x: number; y: number; z: number } | undefined)[] = [];
const tileGroups: THREE.Group[] = [], tileShown: number[] = [], ownerMarks: THREE.Mesh<THREE.BufferGeometry, Loose>[] = [], riseAnims: { obj: THREE.Object3D; t: number; s: number }[] = [];
type LooseMesh = THREE.Mesh<THREE.BufferGeometry, Loose>; // a mesh whose material the code recolours
let dice3: THREE.Mesh[] = [], ring3: LooseMesh, flash3: LooseMesh, pick3: LooseMesh, hover3: LooseMesh;
/** Frames the board for the layout: a phone's square view stands the camera a little further back. */
function aimCamera() {
  const k = L.phone ? 1.12 : 1;
  camera.aspect = L.bw / L.bh;
  camera.position.set(0, 19.7 * k, 13.75 * k); camera.lookAt(0, 0, 0.5);
  camera.updateProjectionMatrix();
}
function sizeRenderer() {
  renderer!.setPixelRatio(CHEAP ? 0.5 : Math.min(2, screenScale));
  renderer!.setSize(L.bw, L.bh, false);
}
afterFit(() => { if (renderer) sizeRenderer(); }); // the 3D view follows the window size
function mat(color: THREE.ColorRepresentation, opts = {}) { return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.55, metalness: 0.0 }, opts)); }
function plastic(color: THREE.ColorRepresentation) { return new THREE.MeshPhongMaterial({ color, shininess: 90, specular: 0x666666 }); }
function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function woodTexture() {
  return canvasTex(1024, 1024, (c: CanvasRenderingContext2D, w: number, h: number) => {
    c.fillStyle = '#8a5a34'; c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) { // grain: wavy darker and lighter lines, from a fixed pattern
      const k = Math.sin(y * 0.05) * 0.5 + Math.sin(y * 0.013 + 1.7) * 0.5;
      c.strokeStyle = k > 0.2 ? 'rgba(60,32,14,0.18)' : 'rgba(255,214,160,0.06)';
      c.beginPath(); c.moveTo(0, y);
      for (let x = 0; x <= w; x += 32) c.lineTo(x, y + Math.sin(x * 0.01 + y * 0.03) * 3);
      c.stroke();
    }
    for (let p = 0; p < 7; p++) { // planks
      c.fillStyle = 'rgba(40,20,8,0.35)'; c.fillRect(0, p * (h / 7), w, 3);
    }
  });
}

// Icons painted on the board and on cards: each drawn with paths, never a font glyph.
const icon = {
  lantern(c: CanvasRenderingContext2D, x: number, y: number, s: number) { // đèn lồng đỏ: Cơ Hội
    c.save(); c.translate(x, y);
    c.fillStyle = '#5a3a1a'; c.fillRect(-s * 0.04, -s * 0.62, s * 0.08, s * 0.16);
    c.fillStyle = '#e8b33a'; rrect(c, -s * 0.24, -s * 0.48, s * 0.48, s * 0.1, s * 0.03); c.fill();
    rrect(c, -s * 0.24, s * 0.38, s * 0.48, s * 0.1, s * 0.03); c.fill();
    c.fillStyle = '#d42a24'; c.beginPath(); c.ellipse(0, -s * 0.0, s * 0.4, s * 0.4, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#f2c44a'; c.lineWidth = s * 0.04;
    for (const k of [-0.22, 0, 0.22]) { c.beginPath(); c.ellipse(0, 0, Math.abs(k) * s * 1.3 + s * 0.02, s * 0.4, 0, 0, Math.PI * 2); c.stroke(); }
    c.strokeStyle = '#e8b33a'; c.lineWidth = s * 0.03;
    for (let k = -2; k <= 2; k++) { c.beginPath(); c.moveTo(k * s * 0.05, s * 0.48); c.lineTo(k * s * 0.07, s * 0.72); c.stroke(); }
    c.restore();
  },
  envelope(c: CanvasRenderingContext2D, x: number, y: number, s: number) { // bao lì xì: Khí Vận
    c.save(); c.translate(x, y);
    c.fillStyle = '#c8201f'; rrect(c, -s * 0.32, -s * 0.48, s * 0.64, s * 0.96, s * 0.06); c.fill();
    c.fillStyle = '#a3171a'; c.beginPath(); c.moveTo(-s * 0.32, -s * 0.44); c.lineTo(0, -s * 0.12); c.lineTo(s * 0.32, -s * 0.44); c.closePath(); c.fill();
    c.strokeStyle = '#f2c44a'; c.lineWidth = s * 0.035; rrect(c, -s * 0.26, -s * 0.42, s * 0.52, s * 0.84, s * 0.04); c.stroke();
    c.fillStyle = '#f2c44a'; c.beginPath(); c.arc(0, s * 0.12, s * 0.14, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#c8201f'; c.fillRect(-s * 0.06, s * 0.06, s * 0.12, s * 0.12);
    c.restore();
  },
  coins(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
    c.save(); c.translate(x, y);
    for (let k = 0; k < 4; k++) {
      const yy = s * 0.3 - k * s * 0.15;
      c.fillStyle = '#b98a1c'; c.beginPath(); c.ellipse(0, yy + s * 0.04, s * 0.32, s * 0.11, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#f2c44a'; c.beginPath(); c.ellipse(0, yy, s * 0.32, s * 0.11, 0, 0, Math.PI * 2); c.fill();
    }
    c.strokeStyle = '#8a6410'; c.lineWidth = s * 0.03; c.strokeRect(-s * 0.08, -s * 0.2, s * 0.16, s * 0.08);
    c.restore();
  },
  ship(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
    c.save(); c.translate(x, y);
    c.fillStyle = '#2d4f7c'; c.beginPath(); c.moveTo(-s * 0.48, 0); c.lineTo(s * 0.48, 0); c.lineTo(s * 0.34, s * 0.24); c.lineTo(-s * 0.4, s * 0.24); c.closePath(); c.fill();
    c.fillStyle = '#f4ead2'; c.fillRect(-s * 0.26, -s * 0.2, s * 0.44, s * 0.2);
    c.fillStyle = '#d8403a'; c.fillRect(-s * 0.06, -s * 0.38, s * 0.12, s * 0.18);
    c.strokeStyle = '#3d86c6'; c.lineWidth = s * 0.04;
    c.beginPath(); for (let k = -0.5; k <= 0.5; k += 0.25) c.arc(k * s, s * 0.34, s * 0.12, Math.PI, 0); c.stroke();
    c.restore();
  },
  train(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
    c.save(); c.translate(x, y);
    c.fillStyle = '#2d6a4f'; rrect(c, -s * 0.42, -s * 0.28, s * 0.6, s * 0.44, s * 0.06); c.fill();
    c.fillStyle = '#d8403a'; c.fillRect(s * 0.18, -s * 0.1, s * 0.26, s * 0.26);
    c.fillStyle = '#333'; c.fillRect(-s * 0.3, -s * 0.44, s * 0.1, s * 0.16);
    c.fillStyle = '#cfe8f7'; c.fillRect(-s * 0.32, -s * 0.18, s * 0.16, s * 0.14); c.fillRect(-s * 0.08, -s * 0.18, s * 0.16, s * 0.14);
    c.fillStyle = '#222'; for (const k of [-0.3, 0, 0.3]) { c.beginPath(); c.arc(k * s, s * 0.22, s * 0.09, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = '#8a8a8a'; c.fillRect(-s * 0.5, s * 0.31, s, s * 0.04);
    c.restore();
  },
  plane(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
    c.save(); c.translate(x, y); c.rotate(-0.4);
    c.fillStyle = '#3a6ea5';
    c.beginPath(); c.ellipse(0, 0, s * 0.46, s * 0.08, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(-s * 0.05, 0); c.lineTo(-s * 0.2, -s * 0.4); c.lineTo(s * 0.05, -s * 0.4); c.lineTo(s * 0.15, 0); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(-s * 0.05, 0); c.lineTo(-s * 0.2, s * 0.4); c.lineTo(s * 0.05, s * 0.4); c.lineTo(s * 0.15, 0); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(-s * 0.38, 0); c.lineTo(-s * 0.5, -s * 0.18); c.lineTo(-s * 0.42, -s * 0.18); c.lineTo(-s * 0.3, 0); c.closePath(); c.fill();
    c.fillStyle = '#d8403a'; c.beginPath(); c.ellipse(s * 0.38, 0, s * 0.08, s * 0.05, 0, 0, Math.PI * 2); c.fill();
    c.restore();
  },
  bulb(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
    c.save(); c.translate(x, y);
    c.fillStyle = '#fff1a8'; c.beginPath(); c.arc(0, -s * 0.12, s * 0.3, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#c99a10'; c.lineWidth = s * 0.04; c.stroke();
    c.fillStyle = '#9a9a9a'; c.fillRect(-s * 0.13, s * 0.16, s * 0.26, s * 0.2);
    c.strokeStyle = '#666'; c.lineWidth = s * 0.03; for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(-s * 0.13, s * (0.2 + k * 0.06)); c.lineTo(s * 0.13, s * (0.22 + k * 0.06)); c.stroke(); }
    c.strokeStyle = '#e09a10'; c.lineWidth = s * 0.03; c.beginPath(); c.moveTo(-s * 0.08, s * 0.1); c.lineTo(-s * 0.04, -s * 0.12); c.lineTo(s * 0.04, -s * 0.04); c.lineTo(s * 0.08, -s * 0.2); c.stroke();
    c.restore();
  },
  drop(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
    c.save(); c.translate(x, y);
    c.fillStyle = '#3a9bdc'; c.beginPath(); c.moveTo(0, -s * 0.46);
    c.bezierCurveTo(s * 0.36, -s * 0.05, s * 0.34, s * 0.4, 0, s * 0.4); c.bezierCurveTo(-s * 0.34, s * 0.4, -s * 0.36, -s * 0.05, 0, -s * 0.46); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.6)'; c.beginPath(); c.ellipse(-s * 0.1, s * 0.08, s * 0.05, s * 0.12, 0.3, 0, Math.PI * 2); c.fill();
    c.restore();
  },
  arrow(c: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number) {
    c.save(); c.translate(x, y); c.rotate(rot);
    c.fillStyle = '#d8403a'; c.beginPath();
    c.moveTo(-s * 0.5, -s * 0.12); c.lineTo(s * 0.15, -s * 0.12); c.lineTo(s * 0.15, -s * 0.3); c.lineTo(s * 0.5, 0);
    c.lineTo(s * 0.15, s * 0.3); c.lineTo(s * 0.15, s * 0.12); c.lineTo(-s * 0.5, s * 0.12); c.closePath(); c.fill();
    c.restore();
  },
  bars(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
    c.save(); c.translate(x, y);
    c.fillStyle = '#e8d9b5'; c.fillRect(-s * 0.4, -s * 0.4, s * 0.8, s * 0.8);
    c.strokeStyle = '#3a3a3a'; c.lineWidth = s * 0.06;
    for (let k = -0.3; k <= 0.31; k += 0.15) { c.beginPath(); c.moveTo(k * s, -s * 0.4); c.lineTo(k * s, s * 0.4); c.stroke(); }
    c.lineWidth = s * 0.08; c.strokeRect(-s * 0.4, -s * 0.4, s * 0.8, s * 0.8);
    c.restore();
  },
  palm(c: CanvasRenderingContext2D, x: number, y: number, s: number) { // Bến Đỗ Tự Do: a coconut palm and a hammock
    c.save(); c.translate(x, y);
    c.strokeStyle = '#8a5a2a'; c.lineWidth = s * 0.08;
    c.beginPath(); c.moveTo(-s * 0.3, s * 0.45); c.quadraticCurveTo(-s * 0.35, 0, -s * 0.15, -s * 0.3); c.stroke();
    c.beginPath(); c.moveTo(s * 0.35, s * 0.45); c.quadraticCurveTo(s * 0.38, 0, s * 0.25, -s * 0.2); c.stroke();
    c.fillStyle = '#2f8a3a';
    for (const [px, py] of [[-0.15, -0.3], [0.25, -0.2]]) for (let a = 0; a < 5; a++) {
      c.save(); c.translate(px * s, py * s); c.rotate(-2.6 + a * 0.9);
      c.beginPath(); c.ellipse(s * 0.18, 0, s * 0.2, s * 0.05, 0, 0, Math.PI * 2); c.fill(); c.restore();
    }
    c.strokeStyle = '#d8403a'; c.lineWidth = s * 0.05; c.beginPath(); c.moveTo(-s * 0.28, s * 0.05); c.quadraticCurveTo(0, s * 0.35, s * 0.33, s * 0.08); c.stroke();
    c.restore();
  },
  cap(c: CanvasRenderingContext2D, x: number, y: number, s: number) { // Đi Tù: a khaki officer's cap with a red band
    c.save(); c.translate(x, y);
    c.fillStyle = '#5d6b2e'; c.beginPath(); c.ellipse(0, -s * 0.08, s * 0.44, s * 0.24, 0, Math.PI, 0); c.fill();
    c.fillStyle = '#c8201f'; c.fillRect(-s * 0.36, -s * 0.1, s * 0.72, s * 0.12);
    c.fillStyle = '#2a2a1a'; c.beginPath(); c.ellipse(0, s * 0.04, s * 0.42, s * 0.1, 0, 0, Math.PI); c.fill();
    c.fillStyle = '#f2c44a'; star(c, 0, -s * 0.22, s * 0.1);
    c.restore();
  },
};
function star(c: CanvasRenderingContext2D, x: number, y: number, r: number) {
  c.beginPath();
  for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.42 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  c.closePath(); c.fill();
}
const TILE_ICON: Record<string, string> = { ship: 'ship', train: 'train', plane: 'plane', bulb: 'bulb', drop: 'drop' };

function boardTexture() {
  const S = 2048, k = S / BOARD_SIZE;
  return canvasTex(S, S, (c: CanvasRenderingContext2D) => {
    const X = (x: number) => (x + HALF) * k, Z = (z: number) => (z + HALF) * k;
    c.fillStyle = '#f2e6c8'; c.fillRect(0, 0, S, S);
    // the centre: a bamboo frame, rice-field stripes, the title, and the two deck spots
    const e = HALF - CORNER;
    c.fillStyle = '#e9dcb6'; c.fillRect(X(-e), Z(-e), (2 * e) * k, (2 * e) * k);
    c.save(); c.beginPath(); c.rect(X(-e), Z(-e), 2 * e * k, 2 * e * k); c.clip();
    for (let r = -20; r < 30; r++) { c.fillStyle = r % 2 ? 'rgba(120,170,80,0.10)' : 'rgba(200,190,120,0.08)'; c.fillRect(X(-e) + r * 60, Z(-e), 30, 2 * e * k); }
    c.restore();
    c.strokeStyle = '#7a8a3a'; c.lineWidth = 10; c.strokeRect(X(-e) + 26, Z(-e) + 26, 2 * e * k - 52, 2 * e * k - 52);
    c.strokeStyle = '#a9b65a'; c.lineWidth = 3;
    for (let s = 0; s < 4; s++) for (let n = 0; n < 12; n++) { // bamboo nodes along the frame
      const t = (n + 0.5) / 12, a = X(-e) + 26, b = 2 * e * k - 52;
      const pts = [[a + t * b, Z(-e) + 26], [X(-e) + 26 + b, Z(-e) + 26 + t * b], [a + t * b, Z(-e) + 26 + b], [X(-e) + 26, Z(-e) + 26 + t * b]][s];
      c.beginPath(); if (s % 2 === 0) { c.moveTo(pts[0], pts[1] - 9); c.lineTo(pts[0], pts[1] + 9); } else { c.moveTo(pts[0] - 9, pts[1]); c.lineTo(pts[0] + 9, pts[1]); } c.stroke();
    }
    // title band
    c.save(); c.translate(S / 2, Z(3.0));
    c.fillStyle = '#b3201e'; rrect(c, -560, -95, 1120, 190, 30); c.fill();
    c.strokeStyle = '#f2c44a'; c.lineWidth = 8; rrect(c, -540, -77, 1080, 154, 22); c.stroke();
    c.fillStyle = '#ffe9a8'; c.font = `bold 108px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('TỶ PHÚ ĐẤT VIỆT', 0, 6);
    c.restore();
    c.fillStyle = '#6a4a2a'; c.font = `italic 40px ${FONT}`; c.textAlign = 'center';
    c.fillText('Từ Hà Giang tới Cà Mau', S / 2, Z(3.95));
    // deck spots
    for (const [dx, dz, kind, label] of [[-2.3, -2.9, 'co', 'CƠ HỘI'], [2.3, -2.9, 'kv', 'KHÍ VẬN']] as [number, number, string, string][]) {
      c.save(); c.translate(X(dx), Z(dz)); c.rotate(dx < 0 ? -0.12 : 0.12);
      c.setLineDash([16, 10]); c.strokeStyle = '#8a6a3a'; c.lineWidth = 5; rrect(c, -150, -110, 300, 220, 18); c.stroke(); c.setLineDash([]);
      c.fillStyle = '#6a4a2a'; c.font = `bold 40px ${FONT}`; c.textAlign = 'center'; c.fillText(label, 0, 150);
      c.restore();
    }
    // tiles
    for (let i = 0; i < 40; i++) {
      const t = TILES[i], ti = tileInfo(i);
      let x0, z0, w, h; // tile rect in world units
      if (ti.side === -1) { x0 = ti.x - 0.8; z0 = ti.z - 0.8; w = 1.6; h = 1.6; }
      else if (ti.side === 0 || ti.side === 2) { x0 = ti.x - 0.5; z0 = ti.z - 0.8; w = 1; h = 1.6; }
      else { x0 = ti.x - 0.8; z0 = ti.z - 0.5; w = 1.6; h = 1; }
      const px = X(x0), pz = Z(z0), pw = w * k, ph = h * k;
      c.fillStyle = t.t === 'prop' ? '#fbf3df' : ti.side === -1 ? '#f6e3b8' : '#f4ecd6';
      c.fillRect(px, pz, pw, ph);
      // text area: the tile minus its inner band
      let tx = px, tz = pz, tw = pw, th = ph;
      if (t.t === 'prop') {
        c.fillStyle = GROUPS[t.g!].color;
        const b = BAND * k;
        if (ti.side === 0) { c.fillRect(px, pz, pw, b); tz += b; th -= b; }
        if (ti.side === 2) { c.fillRect(px, pz + ph - b, pw, b); th -= b; }
        if (ti.side === 1) { c.fillRect(px + pw - b, pz, b, ph); tw -= b; }
        if (ti.side === 3) { c.fillRect(px, pz, b, ph); tx += b; tw -= b; }
        c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 2;
        if (ti.side === 0) { c.beginPath(); c.moveTo(px, pz + b); c.lineTo(px + pw, pz + b); c.stroke(); }
        if (ti.side === 2) { c.beginPath(); c.moveTo(px, pz + ph - b); c.lineTo(px + pw, pz + ph - b); c.stroke(); }
        if (ti.side === 1) { c.beginPath(); c.moveTo(px + pw - b, pz); c.lineTo(px + pw - b, pz + ph); c.stroke(); }
        if (ti.side === 3) { c.beginPath(); c.moveTo(px + b, pz); c.lineTo(px + b, pz + ph); c.stroke(); }
      }
      c.strokeStyle = '#5a3d2b'; c.lineWidth = 4; c.strokeRect(px, pz, pw, ph);
      const cx = tx + tw / 2;
      c.fillStyle = '#2b1d12'; c.textAlign = 'center'; c.textBaseline = 'middle';
      // Names as large as the tile allows: start big and shrink until they fit in at most 3 lines.
      const label = t.t === 'co' || t.t === 'kv' ? t.n.toUpperCase() : (t.b || t.n);
      const hasIcon = t.t !== 'prop';
      const maxLines = 3, nameRoom = th * (hasIcon ? 0.56 : 0.64);
      let nameSize = ti.side === -1 ? 50 : 54, lines;
      for (;; nameSize -= 2) {
        c.font = `bold ${nameSize}px ${FONT}`;
        lines = wrapLines(c, label, tw * 0.92);
        const fits = lines.length <= maxLines && lines.every(l => c.measureText(l).width <= tw * 0.94) && lines.length * (nameSize + 2) <= nameRoom;
        if (fits || nameSize <= 30) break;
      }
      const fitFont = (txt: string, size: number, maxW: number, weight = 'bold') => { // one line, shrunk until it fits maxW
        for (; size > 20; size -= 2) { c.font = `${weight} ${size}px ${FONT}`; if (c.measureText(txt).width <= maxW) break; }
      };
      if (ti.side === -1) {
        const cz = tz + th / 2;
        c.font = `bold 50px ${FONT}`;
        if (t.t === 'go') { c.fillText('XUẤT PHÁT', cx, tz + 62); icon.arrow(c, cx, cz + 30, 170, Math.PI); fitFont('Nhận lương', 40, tw * 0.9); c.fillText('Nhận lương', cx, tz + th - 46); }
        if (t.t === 'jail') { icon.bars(c, cx + 30, cz - 40, 140); c.fillText('NHÀ TÙ', cx + 30, cz + 70); fitFont('Chỉ ghé thăm', 38, tw * 0.9, ''); c.textAlign = 'left'; c.fillText('Chỉ ghé thăm', tx + 16, tz + th - 30); c.textAlign = 'center'; }
        if (t.t === 'free') { c.fillText('BẾN ĐỖ', cx, tz + 48); c.fillText('TỰ DO', cx, tz + 100); icon.palm(c, cx, cz + 30, 130); c.fillStyle = '#b3201e'; fitFont('Nhận hũ tiền', 40, tw * 0.9); c.fillText('Nhận hũ tiền', cx, tz + th - 44); }
        if (t.t === 'gojail') { c.fillText('ĐI TÙ', cx, tz + 58); icon.cap(c, cx, cz + 10, 180); fitFont('Vào thẳng Nhà Tù', 36, tw * 0.9, ''); c.fillText('Vào thẳng Nhà Tù', cx, tz + th - 44); }
        continue;
      }
      c.font = `bold ${nameSize}px ${FONT}`;
      const top = tz + 14 + nameSize / 2;
      lines.forEach((ln, j) => c.fillText(ln, cx, top + j * (nameSize + 2)));
      const priceY = tz + th - 30, nameBottom = top + (lines.length - 1) * (nameSize + 2) + nameSize / 2;
      const iconS = Math.min(tw * 0.55, priceY - 26 - nameBottom - 6), iconY = (nameBottom + priceY - 22) / 2 + 2;
      if (t.t === 'co') icon.lantern(c, cx, iconY, iconS);
      if (t.t === 'kv') icon.envelope(c, cx, iconY, iconS);
      if (t.t === 'tax') { icon.coins(c, cx, iconY, iconS); }
      if (TILE_ICON[t.icon!]) (icon as Loose)[TILE_ICON[t.icon!]](c, cx, iconY, iconS);
      c.fillStyle = '#3a2416';
      let price = '';
      if (t.p) price = (t.p / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tr';
      if (t.t === 'tax') price = t.kind === 'income' ? `Trả ${(tune.income_tax / 1000).toLocaleString('vi-VN')} tr` : `${Math.round(tune.prop_tax_pct * 100)}% / ${(tune.prop_tax_flat / 1000).toLocaleString('vi-VN')} tr`;
      if (price) { fitFont(price, 40, tw * 0.92); c.fillText(price, cx, priceY); }
    }
    c.strokeStyle = '#3a2416'; c.lineWidth = 10; c.strokeRect(5, 5, S - 10, S - 10);
  });
}
function pipTexture(n: number) {
  return canvasTex(128, 128, (c: CanvasRenderingContext2D, w: number) => {
    c.fillStyle = '#fbf7ee'; c.fillRect(0, 0, w, w);
    c.strokeStyle = '#d8d0bf'; c.lineWidth = 6; c.strokeRect(3, 3, w - 6, w - 6);
    const P3 = { 1: [[2, 2]], 2: [[1, 1], [3, 3]], 3: [[1, 1], [2, 2], [3, 3]], 4: [[1, 1], [3, 1], [1, 3], [3, 3]], 5: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]], 6: [[1, 1], [3, 1], [1, 2], [3, 2], [1, 3], [3, 3]] }[n];
    c.fillStyle = n === 1 ? '#c8201f' : '#1d1d1d';
    for (const [a, b] of P3!) { c.beginPath(); c.arc(a * w / 4, b * w / 4, n === 1 ? 17 : 12, 0, Math.PI * 2); c.fill(); }
  });
}

// ---- 3D figures: tokens, buildings, landmarks ----------------------------------------
function mesh(geo: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0) { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = !CHEAP; o.receiveShadow = !CHEAP; return o; }
function makeToken(kind: number, color: string) {
  const g = new THREE.Group();
  const col = new THREE.Color(color), dark = col.clone().multiplyScalar(0.6);
  const m = plastic(col), md = plastic(dark), white = plastic(0xf6f0e0), black = plastic(0x222222);
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.07, 24), md, 0, 0.035, 0));
  if (kind === 0) { // trâu: a water buffalo with sweeping horns
    const body = mesh(new THREE.SphereGeometry(0.16, 20, 14), m, 0, 0.27, 0); body.scale.set(1.35, 0.9, 0.85); g.add(body);
    for (const [x, z] of [[-0.12, -0.07], [0.12, -0.07], [-0.12, 0.07], [0.12, 0.07]]) g.add(mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.16, 8), md, x, 0.15, z));
    const head = mesh(new THREE.SphereGeometry(0.09, 16, 12), m, 0.24, 0.33, 0); head.scale.set(1.2, 0.95, 0.9); g.add(head);
    const hornG = new THREE.Group(); // one crescent across the head, opening upward
    const horn = mesh(new THREE.TorusGeometry(0.12, 0.024, 8, 24, Math.PI), white); horn.rotation.z = Math.PI; hornG.add(horn);
    hornG.position.set(0.25, 0.5, 0); hornG.rotation.y = Math.PI / 2; g.add(hornG);
    const tail = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6), md, -0.24, 0.24, 0); tail.rotation.z = 0.5; g.add(tail);
  } else if (kind === 1) { // cá chép: a carp leaping up from the base
    const body = mesh(new THREE.SphereGeometry(0.13, 20, 14), m, 0, 0.3, 0); body.scale.set(0.75, 1.6, 0.55); body.rotation.z = -0.35; g.add(body);
    const tailA = mesh(new THREE.ConeGeometry(0.1, 0.16, 4), md, 0.07, 0.1, 0); tailA.rotation.z = 2.6; tailA.scale.z = 0.3; g.add(tailA);
    const tailB = mesh(new THREE.ConeGeometry(0.1, 0.16, 4), md, -0.06, 0.11, 0); tailB.rotation.z = -2.4; tailB.scale.z = 0.3; g.add(tailB);
    const fin = mesh(new THREE.ConeGeometry(0.07, 0.16, 4), md, -0.1, 0.36, 0); fin.rotation.z = 1.1; fin.scale.z = 0.25; g.add(fin);
    for (const s of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.022, 8, 6), black, 0.09, 0.47, s * 0.05));
    const lip = mesh(new THREE.TorusGeometry(0.03, 0.012, 6, 12), md, 0.11, 0.53, 0); lip.rotation.y = Math.PI / 2; g.add(lip);
  } else if (kind === 2) { // chim Lạc: the long-beaked crested bird of the bronze drums
    const body = mesh(new THREE.SphereGeometry(0.11, 18, 12), m, -0.03, 0.27, 0); body.scale.set(1.5, 0.85, 0.8); g.add(body);
    const neck = mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.22, 8), m, 0.1, 0.4, 0); neck.rotation.z = -0.5; g.add(neck);
    g.add(mesh(new THREE.SphereGeometry(0.055, 12, 10), m, 0.17, 0.5, 0));
    const beak = mesh(new THREE.ConeGeometry(0.022, 0.26, 8), md, 0.3, 0.47, 0); beak.rotation.z = -1.75; g.add(beak);
    for (let k = 0; k < 3; k++) { const cr = mesh(new THREE.ConeGeometry(0.015, 0.12, 6), md, 0.14 - k * 0.03, 0.58, 0); cr.rotation.z = 0.6 + k * 0.25; g.add(cr); }
    const tail = mesh(new THREE.ConeGeometry(0.06, 0.2, 4), md, -0.22, 0.33, 0); tail.rotation.z = 1.9; tail.scale.z = 0.3; g.add(tail);
    for (const z of [-0.04, 0.04]) g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6), md, 0, 0.12, z));
  } else { // nón lá: a conical leaf hat on a small stand, with its chin strap
    g.add(mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.18, 10), md, 0, 0.16, 0));
    const hat = mesh(new THREE.ConeGeometry(0.25, 0.22, 32, 1, true), m, 0, 0.36, 0); hat.material = plastic(col); hat.material.side = THREE.DoubleSide; g.add(hat);
    for (let k = 1; k <= 3; k++) { const r = mesh(new THREE.TorusGeometry(0.25 * (1 - k * 0.22), 0.008, 6, 32), md, 0, 0.25 + k * 0.05, 0); r.rotation.x = Math.PI / 2; g.add(r); }
    const strap = mesh(new THREE.TorusGeometry(0.12, 0.01, 6, 24, Math.PI), white, 0, 0.25, 0); strap.rotation.x = Math.PI; g.add(strap);
  }
  return g;
}
function makeHouse() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.17, 0.13, 0.17), mat(0xf4ead2), 0, 0.065, 0));
  const roof = mesh(new THREE.ConeGeometry(0.15, 0.11, 4), mat(0xc0502a), 0, 0.185, 0); roof.rotation.y = Math.PI / 4; g.add(roof);
  g.add(mesh(new THREE.BoxGeometry(0.05, 0.07, 0.01), mat(0x6a3a1a), 0, 0.035, 0.086));
  return g;
}
function makeHotel() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.62, 0.34, 0.26), mat(0x3d7fb8), 0, 0.17, 0));
  g.add(mesh(new THREE.BoxGeometry(0.66, 0.04, 0.3), mat(0xf4ead2), 0, 0.36, 0));
  for (let r = 0; r < 2; r++) for (let k = -2; k <= 2; k++) g.add(mesh(new THREE.BoxGeometry(0.07, 0.07, 0.01), mat(0xfff0b0, { emissive: 0x332200 }), k * 0.11, 0.1 + r * 0.13, 0.131));
  g.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.28, 6), mat(0x888888), 0.26, 0.52, 0));
  g.add(mesh(new THREE.BoxGeometry(0.14, 0.08, 0.005), mat(0xd8403a), 0.33, 0.62, 0));
  return g;
}
function makeLandmark(kind: string) { // ~0.9 tall, a toy model of the province's landmark
  const g = new THREE.Group();
  const stone = mat(0xe8dcc0), gold = mat(0xe8b33a, { metalness: 0.3, roughness: 0.4 }), red = mat(0xb3201e), roofM = mat(0x8a3a24);
  const green = mat(0x3f8a3a), blue = mat(0x3a8fd0), white = mat(0xf7f3ea), brick = mat(0xb8602e), grey = mat(0x8a8a8a);
  const base = mesh(new THREE.BoxGeometry(0.8, 0.05, 0.36), mat(0xd9c48a), 0, 0.025, 0); g.add(base);
  const curvedRoof = (w: number, d: number, y: number, m?: THREE.Material) => { // a hipped roof: a 4-sided cone squashed to w x d
    const r = new THREE.Group(), c = mesh(new THREE.ConeGeometry(0.71, 0.12, 4), m || roofM); c.rotation.y = Math.PI / 4; r.add(c);
    r.position.set(0, y, 0); r.scale.set(w, 1, d); return r;
  };
  if (kind === 'cotco') { // flag tower on a hill
    g.add(mesh(new THREE.ConeGeometry(0.36, 0.2, 7), green, 0, 0.15, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.38, 8), stone, 0, 0.44, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 6), grey, 0, 0.84, 0));
    const flag = mesh(new THREE.BoxGeometry(0.26, 0.17, 0.008), red, 0.13, 0.96, 0); g.add(flag);
    const st = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.01, 5), gold, 0.13, 0.96, 0.007); st.rotation.x = Math.PI / 2; g.add(st);
  } else if (kind === 'thac') { // waterfall over stepped cliffs
    for (let k = 0; k < 3; k++) g.add(mesh(new THREE.BoxGeometry(0.75 - k * 0.12, 0.2, 0.3 - k * 0.04), mat(0x5a6a4a), 0, 0.12 + k * 0.2, -0.02 - k * 0.02));
    for (let k = 0; k < 3; k++) g.add(mesh(new THREE.BoxGeometry(0.5 - k * 0.1, 0.2, 0.02), blue, 0, 0.12 + k * 0.2, 0.14 - k * 0.02));
    g.add(mesh(new THREE.BoxGeometry(0.78, 0.03, 0.12), mat(0x9fd6f0), 0, 0.05, 0.13));
    for (const x of [-0.3, 0.3]) g.add(mesh(new THREE.ConeGeometry(0.08, 0.22, 8), green, x, 0.72, -0.06));
  } else if (kind === 'nui') { // a peak with snow and a little pagoda
    g.add(mesh(new THREE.ConeGeometry(0.38, 0.75, 7), mat(0x4f7a3a), 0, 0.42, 0));
    g.add(mesh(new THREE.ConeGeometry(0.13, 0.25, 7), white, 0, 0.67, 0));
    g.add(mesh(new THREE.BoxGeometry(0.1, 0.08, 0.1), red, 0.24, 0.15, 0.14));
    g.add(curvedRoof(0.16, 0.16, 0.22, roofM).translateX(0.24).translateZ(0.14));
  } else if (kind === 'dao') { // two karst islets rising from the sea
    g.add(mesh(new THREE.BoxGeometry(0.8, 0.03, 0.36), mat(0x3aa6c8), 0, 0.055, 0));
    const a = mesh(new THREE.CylinderGeometry(0.08, 0.15, 0.62, 7), mat(0x6f7f5a), -0.13, 0.36, 0); a.rotation.z = 0.08; g.add(a);
    const b = mesh(new THREE.CylinderGeometry(0.07, 0.13, 0.5, 7), mat(0x6f7f5a), 0.15, 0.3, 0.02); b.rotation.z = -0.1; g.add(b);
    g.add(mesh(new THREE.SphereGeometry(0.09, 10, 8), green, -0.13, 0.68, 0)); g.add(mesh(new THREE.SphereGeometry(0.08, 10, 8), green, 0.17, 0.56, 0.02));
  } else if (kind === 'thap') { // a tiered tower
    for (let k = 0; k < 6; k++) {
      const s = 0.3 - k * 0.04;
      g.add(mesh(new THREE.BoxGeometry(s, 0.11, s), brick, 0, 0.1 + k * 0.13, 0));
      g.add(mesh(new THREE.BoxGeometry(s + 0.06, 0.02, s + 0.06), stone, 0, 0.165 + k * 0.13, 0));
    }
    g.add(mesh(new THREE.ConeGeometry(0.05, 0.16, 8), gold, 0, 0.94, 0));
  } else if (kind === 'chua') { // a small temple on a single pillar over a lotus pond
    g.add(mesh(new THREE.BoxGeometry(0.62, 0.03, 0.32), mat(0x3aa6c8), 0, 0.055, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.36, 10), stone, 0, 0.25, 0));
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.04, 0.3), mat(0x8a5a2a), 0, 0.44, 0));
    g.add(mesh(new THREE.BoxGeometry(0.22, 0.16, 0.22), mat(0x9a3a1a), 0, 0.54, 0));
    g.add(curvedRoof(0.42, 0.42, 0.7, roofM));
    g.add(mesh(new THREE.SphereGeometry(0.03, 8, 6), gold, 0, 0.78, 0));
    for (const [x, z] of [[-0.22, 0.08], [0.22, -0.08], [0.2, 0.1]]) g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.01, 10), green, x, 0.075, z));
  } else if (kind === 'cong') { // a citadel gate with a pavilion
    g.add(mesh(new THREE.BoxGeometry(0.76, 0.32, 0.3), mat(0x9a8a6a), 0, 0.21, 0));
    g.add(mesh(new THREE.BoxGeometry(0.16, 0.2, 0.31), mat(0x2a1d12), 0, 0.15, 0));
    g.add(mesh(new THREE.BoxGeometry(0.44, 0.14, 0.2), red, 0, 0.44, 0));
    g.add(curvedRoof(0.56, 0.3, 0.57, mat(0xd8a020)));
    g.add(mesh(new THREE.BoxGeometry(0.26, 0.1, 0.14), red, 0, 0.66, 0));
    g.add(curvedRoof(0.36, 0.22, 0.76, mat(0xd8a020)));
  } else if (kind === 'cau') { // a bridge with a golden dragon arching over it
    g.add(mesh(new THREE.BoxGeometry(0.8, 0.03, 0.36), mat(0x3aa6c8), 0, 0.055, 0));
    g.add(mesh(new THREE.BoxGeometry(0.82, 0.05, 0.14), stone, 0, 0.22, 0));
    for (const x of [-0.3, 0, 0.3]) g.add(mesh(new THREE.BoxGeometry(0.05, 0.16, 0.1), stone, x, 0.12, 0));
    for (let k = 0; k < 3; k++) { const arc = mesh(new THREE.TorusGeometry(0.13, 0.03, 8, 20, Math.PI), gold, -0.26 + k * 0.26, 0.25, 0); g.add(arc); }
    const head = mesh(new THREE.ConeGeometry(0.05, 0.14, 8), gold, 0.42, 0.3, 0); head.rotation.z = -1.2; g.add(head);
  } else if (kind === 'haidang') { // a striped lighthouse
    for (let k = 0; k < 5; k++) g.add(mesh(new THREE.CylinderGeometry(0.09 - k * 0.008, 0.1 - k * 0.008, 0.14, 14), k % 2 ? red : white, 0, 0.12 + k * 0.14, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 12), mat(0xfff2a0, { emissive: 0xffc840, emissiveIntensity: 0.8 }), 0, 0.82, 0));
    g.add(mesh(new THREE.ConeGeometry(0.09, 0.1, 12), red, 0, 0.91, 0));
    g.add(mesh(new THREE.BoxGeometry(0.2, 0.1, 0.16), white, 0.24, 0.1, 0.05));
  } else if (kind === 'thapdh') { // a market hall with a clock tower
    g.add(mesh(new THREE.BoxGeometry(0.76, 0.24, 0.28), mat(0xf0e2b0), 0, 0.17, 0));
    g.add(curvedRoof(0.8, 0.32, 0.33, mat(0x6a7f8a)));
    g.add(mesh(new THREE.BoxGeometry(0.18, 0.5, 0.18), mat(0xf6ecc8), 0, 0.42, 0.02));
    const clockFace = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 20), white, 0, 0.58, 0.115); clockFace.rotation.x = Math.PI / 2; g.add(clockFace);
    g.add(mesh(new THREE.BoxGeometry(0.008, 0.045, 0.004), mat(0x222222), 0, 0.595, 0.123));
    g.add(mesh(new THREE.ConeGeometry(0.13, 0.16, 4), mat(0x6a7f8a), 0, 0.75, 0.02).rotateY(Math.PI / 4));
  }
  return g;
}

// ---- 3D scene assembly ---------------------------------------------------------------
function build3D() {
  renderer = new THREE.WebGLRenderer({ antialias: !CHEAP, preserveDrawingBuffer: true, alpha: false });
  renderer.shadowMap.enabled = !CHEAP; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  sizeRenderer();
  scene3 = new THREE.Scene(); scene3.background = new THREE.Color(0x2a1a10);
  camera = new THREE.PerspectiveCamera(30, BW / 720, 0.1, 100);
  aimCamera();
  addLights(scene3);
  const wood = woodTexture(); wood.wrapS = wood.wrapT = THREE.RepeatWrapping; wood.repeat.set(3, 3);
  const table = mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.75 }), 0, 0, 0);
  table.rotation.x = -Math.PI / 2; scene3.add(table);
  const edge = mat(0x4a2c1a, { roughness: 0.5 });
  const top = new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.65 });
  const board = mesh(new THREE.BoxGeometry(BOARD_SIZE, BOARD_TOP, BOARD_SIZE), [edge, edge, top, edge, edge, edge], 0, BOARD_TOP / 2, 0);
  scene3.add(board);
  // the two decks of cards in the centre
  for (const [dx, dz, kind] of [[-2.3, -2.9, 'co'], [2.3, -2.9, 'kv']] as [number, number, string][]) {
    const faceTex = canvasTex(256, 192, (c: CanvasRenderingContext2D, w: number, h: number) => {
      c.fillStyle = kind === 'co' ? '#f6d26a' : '#d8403a'; c.fillRect(0, 0, w, h);
      c.strokeStyle = kind === 'co' ? '#b3201e' : '#f2c44a'; c.lineWidth = 8; c.strokeRect(10, 10, w - 20, h - 20);
      if (kind === 'co') icon.lantern(c, w / 2, h / 2, 120); else icon.envelope(c, w / 2, h / 2, 130);
    });
    const deck = new THREE.Group();
    for (let k = 0; k < 6; k++) {
      const card = mesh(new THREE.BoxGeometry(1.7, 0.03, 1.25), k === 5 ? [mat(0xf4ead2), mat(0xf4ead2), new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.5 }), mat(0xf4ead2), mat(0xf4ead2), mat(0xf4ead2)] : mat(0xf4ead2), (k % 2) * 0.02, BOARD_TOP + 0.015 + k * 0.03, 0);
      deck.add(card);
    }
    deck.position.set(dx, 0, dz); deck.rotation.y = dx < 0 ? 0.12 : -0.12; scene3.add(deck);
  }
  // owner marks along each ownable tile's outer edge
  for (let i = 0; i < 40; i++) {
    tileGroups[i] = new THREE.Group(); scene3.add(tileGroups[i]); tileShown[i] = -1;
    if (!OWNABLE(TILES[i])) continue;
    const ti = tileInfo(i);
    const horiz = ti.side === 0 || ti.side === 2;
    const m = mesh(new THREE.BoxGeometry(horiz ? 0.84 : 0.14, 0.05, horiz ? 0.14 : 0.84), mat(0xffffff), ti.x + ti.ox * 0.68, BOARD_TOP + 0.025, ti.z + ti.oz * 0.68);
    m.visible = false; scene3.add(m); ownerMarks[i] = m;
  }
  // tokens
  for (let k = 0; k < 4; k++) { const t = makeToken(k, PLAYER_COLORS[k]); t.scale.setScalar(1.3); t.visible = false; scene3.add(t); tok3[k] = t; }
  // dice
  const pips = [3, 4, 1, 6, 2, 5].map(n => new THREE.MeshStandardMaterial({ map: pipTexture(n), roughness: 0.35 }));
  for (let k = 0; k < 2; k++) { const d = mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), pips, 0, 0, 0); scene3.add(d); dice3.push(d); }
  // the current player's ring, the landing flash and the fly-to cursor
  ring3 = mesh(new THREE.TorusGeometry(0.3, 0.035, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffffff }), 0, BOARD_TOP + 0.02, 0); ring3.rotation.x = Math.PI / 2; ring3.castShadow = false; scene3.add(ring3);
  flash3 = mesh(new THREE.BoxGeometry(1, 0.02, 1), new THREE.MeshBasicMaterial({ color: 0xfff2a0, transparent: true, opacity: 0.5 }), 0, BOARD_TOP + 0.012, 0); flash3.castShadow = false; flash3.visible = false; scene3.add(flash3);
  buildPot();
  hover3 = mesh(new THREE.BoxGeometry(1, 0.02, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 }), 0, BOARD_TOP + 0.015, 0); hover3.castShadow = false; hover3.visible = false; scene3.add(hover3);
  pick3 = mesh(new THREE.BoxGeometry(1, 0.03, 1), new THREE.MeshBasicMaterial({ color: 0x3fcf5a, transparent: true, opacity: 0.55 }), 0, BOARD_TOP + 0.02, 0); pick3.castShadow = false; pick3.visible = false; scene3.add(pick3);
  buildFigures();
}
// The jar of money between the two decks: a glazed clay jar, with coins piling up beside it.
const POT_X = 0, POT_Z = -2.75;
let potCoins: THREE.Mesh[] = [], potShown = -1;
function buildPot() {
  const pts = [[0, 0], [0.32, 0], [0.42, 0.12], [0.46, 0.32], [0.4, 0.52], [0.26, 0.62], [0.24, 0.7], [0.3, 0.74], [0.3, 0.78], [0, 0.78]].map(([x, y]) => new THREE.Vector2(x, y));
  const jar = mesh(new THREE.LatheGeometry(pts, 28), new THREE.MeshPhongMaterial({ color: 0x5b3a8a, shininess: 70, specular: 0x777777 }), POT_X, BOARD_TOP, POT_Z);
  scene3.add(jar);
  const band = mesh(new THREE.TorusGeometry(0.455, 0.02, 8, 32), mat(0xe8b33a, { metalness: 0.3 }), POT_X, BOARD_TOP + 0.32, POT_Z); band.rotation.x = Math.PI / 2; scene3.add(band);
  const mouth = mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.02, 24), mat(0x2a1a10), POT_X, BOARD_TOP + 0.77, POT_Z); scene3.add(mouth);
  const coinGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.04, 20), coinM = new THREE.MeshPhongMaterial({ color: 0xf2c44a, shininess: 100, specular: 0xffffff });
  for (let k = 0; k < 30; k++) {
    const stack = k % 3, h = Math.floor(k / 3);
    const c = mesh(coinGeo, coinM, POT_X + 0.62 + stack * 0.2 - (stack === 2 ? 0.1 : 0), BOARD_TOP + 0.02 + h * 0.042, POT_Z + (stack === 2 ? 0.2 : -0.05));
    c.visible = false; scene3.add(c); potCoins.push(c);
  }
}
function syncPot() {
  const n = Math.min(potCoins.length, Math.ceil(state.pot / 200));
  if (n === potShown) return;
  potCoins.forEach((c, k) => { c.visible = k < n; }); potShown = n;
}
function addLights(s: THREE.Scene) {
  s.add(new THREE.HemisphereLight(0xfff0d8, 0x5a6f9a, 1.35));
  const sun = new THREE.DirectionalLight(0xffe0b0, 2.3);
  sun.position.set(-6, 14, 7); sun.castShadow = !CHEAP;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
  sun.shadow.bias = -0.0005;
  s.add(sun);
}
function buildFigures() { // the figures scene: every token, building and landmark side by side
  figScene = new THREE.Scene(); figScene.background = new THREE.Color(0x2a1a10);
  addLights(figScene);
  const wood = woodTexture(); wood.wrapS = wood.wrapT = THREE.RepeatWrapping; wood.repeat.set(2, 2);
  const table = mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.75 })); table.rotation.x = -Math.PI / 2; figScene.add(table);
  figCamera = new THREE.PerspectiveCamera(30, BW / H, 0.1, 100); figCamera.position.set(0, 7.4, 8.2); figCamera.lookAt(0, 0, 0.2);
  figItems = [];
  const put = (obj: THREE.Object3D, x: number, z: number, name: string, s = 1) => { obj.position.set(x, 0, z); obj.scale.setScalar(s); figScene.add(obj); figItems.push({ x, z, name }); };
  TOKEN_NAMES.forEach((n, k) => put(makeToken(k, PLAYER_COLORS[k]), -2.1 + k * 0.85, -1.3, n, 1.6));
  put(makeHouse(), 1.4, -1.3, 'Nhà', 1.8); put(makeHotel(), 2.3, -1.3, 'Khách sạn', 1.2);
  const kinds = ['cotco', 'thac', 'nui', 'dao', 'thap', 'chua', 'cong', 'cau', 'haidang', 'thapdh'];
  const names = ['Cột cờ', 'Thác', 'Núi', 'Đảo đá', 'Tháp', 'Chùa', 'Cổng thành', 'Cầu rồng', 'Hải đăng', 'Tháp đồng hồ'];
  kinds.forEach((k, j) => put(makeLandmark(k), -2.4 + (j % 5) * 1.2, j < 5 ? 0.1 : 1.45, names[j], 1.05));
}
let figItems: { x: number; z: number; name: string }[] = [];

// ---- 3D per-frame sync ---------------------------------------------------------------
function syncBuildings(dt: number) {
  for (let i = 0; i < 40; i++) {
    if (!OWNABLE(TILES[i])) continue;
    const o = state.owner[i];
    const m = ownerMarks[i];
    m.visible = o >= 0;
    if (o >= 0) { m.material.color.set(state.mort[i] ? '#8a8378' : state.players[o].color); }
    const lvl = TILES[i].t === 'prop' && o >= 0 ? state.level[i] : 0;
    if (tileShown[i] === lvl) continue;
    const g = tileGroups[i]; g.clear();
    const ti = tileInfo(i);
    const inX = ti.x - ti.ox * (0.8 - BAND / 2), inZ = ti.z - ti.oz * (0.8 - BAND / 2); // the band's centre
    const rotY = ti.side === 0 ? 0 : ti.side === 1 ? -Math.PI / 2 : ti.side === 2 ? Math.PI : Math.PI / 2;
    let obj = null;
    if (lvl >= 1 && lvl <= 4) {
      obj = new THREE.Group();
      for (let h = 0; h < lvl; h++) { const hs = makeHouse(); hs.position.x = -0.33 + h * 0.22; obj.add(hs); }
    } else if (lvl === 5) obj = makeHotel();
    else if (lvl === 6) obj = makeLandmark(TILES[i].lk!);
    if (obj) {
      obj.position.set(inX, BOARD_TOP, inZ); obj.rotation.y = rotY;
      if (lvl === 6) obj.scale.setScalar(1.05);
      g.add(obj);
      if (lvl > tileShown[i] && tileShown[i] >= 0) riseAnims.push({ obj, t: 0, s: obj.scale.x });
    }
    tileShown[i] = lvl;
  }
  for (let k = riseAnims.length - 1; k >= 0; k--) {
    const a = riseAnims[k]; a.t += dt;
    const u = Math.min(1, a.t / 0.45), e = 1 - Math.pow(1 - u, 3);
    a.obj.scale.set(a.s, a.s * Math.max(0.02, e) * (1 + 0.15 * Math.sin(u * Math.PI)), a.s);
    if (u >= 1) { a.obj.scale.setScalar(a.s); riseAnims.splice(k, 1); }
  }
}
const lastPos: number[] = [];
function updateTokens(dt: number) {
  state.players.forEach((p, pi) => {
    const k = p.id, tgt = tokenSpot(k, p.pos, p.inJail);
    if (!tokVis[k]) tokVis[k] = { x: tgt.x, y: 0, z: tgt.z };
    if (isGuest() && lastPos[k] !== undefined && lastPos[k] !== p.pos && !tokAnim[k]) { // a guest sees the host's moves as hops
      const step1 = (p.pos - lastPos[k] + 40) % 40 === 1 || (lastPos[k] - p.pos + 40) % 40 === 1;
      tokAnim[k] = { from: { x: tokVis[k]!.x, z: tokVis[k]!.z }, to: tgt, t: 0, dur: step1 ? tune.hop_time * 0.95 : 0.7, h: step1 ? 0.45 : 1.8 };
      if (step1) rawSfx.tick();
    }
    lastPos[k] = p.pos;
    const a = tokAnim[k];
    if (a) {
      a.t += dt; const u = Math.min(1, a.t / a.dur);
      tokVis[k].x = a.from.x + (a.to.x - a.from.x) * u; tokVis[k].z = a.from.z + (a.to.z - a.from.z) * u;
      tokVis[k].y = Math.sin(u * Math.PI) * a.h;
      if (u >= 1) tokAnim[k] = null;
    } else {
      tokVis[k].x += (tgt.x - tokVis[k].x) * Math.min(1, dt * 10); tokVis[k].z += (tgt.z - tokVis[k].z) * Math.min(1, dt * 10); tokVis[k].y = 0;
    }
  });
}
function hop(pi: number, fromPos: number, toPos: number, dur: number) {
  const p = state.players[pi];
  tokAnim[p.id] = { from: tokenSpot(p.id, fromPos, false), to: tokenSpot(p.id, toPos, false), t: 0, dur, h: 0.45 };
}
function diceFinalQuat(v: number, yaw: number) {
  const e = ({ 1: [0, 0, 0], 6: [Math.PI, 0, 0], 2: [-Math.PI / 2, 0, 0], 5: [Math.PI / 2, 0, 0], 3: [0, 0, Math.PI / 2], 4: [0, 0, -Math.PI / 2] } as Record<number, number[]>)[v];
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2]));
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(q);
}
const SHAKE_AT = [{ x: -0.3, y: 1.9, z: 0.9 }, { x: 0.3, y: 2.0, z: 1.0 }];
function placeDice() {
  if (state && state.shaking) { // rattling in the air: the harder the shake, the wilder the jiggle
    const t = state.shaking.t, pw = shakePower(), amp = 0.06 + 0.22 * pw;
    for (let k = 0; k < 2; k++) {
      const d = dice3[k], h = SHAKE_AT[k], f = 22 + k * 5;
      d.position.set(h.x + Math.sin(t * f + k) * amp, h.y + Math.abs(Math.sin(t * (f + 9))) * amp * 1.2, h.z + Math.cos(t * (f - 4) + k * 2) * amp);
      d.rotation.set(t * (9 + 6 * pw) + k, t * (7 + 5 * pw) * (k ? -1 : 1), Math.sin(t * 13) * 1.5);
    }
    return;
  }
  const dur = state && state.diceDur || tune.dice_time, pw = state && state.throwPower !== undefined ? state.throwPower : 0.5;
  const u = Math.min(1, state.diceT / dur), ease = 1 - Math.pow(1 - u, 3);
  const bounces = 2 + 2.5 * pw, height = 1.2 + 1.6 * pw;
  for (let k = 0; k < 2; k++) {
    const d = dice3[k], spin = state.diceSpin ? state.diceSpin[k] : { ax: 0, ay: 1, az: 0, yaw: 0.3 + k, n: 0 };
    const sx = SHAKE_AT[k].x, sz = SHAKE_AT[k].z, ex = -0.5 + k * 1.0, ez = -1.7 + k * 0.25;
    const over = Math.sin(u * Math.PI) * 0.35 * pw; // a hard throw skids a little past and slides back
    d.position.x = sx + (ex - sx) * ease + over * (k ? 1 : -1) * 0.4; d.position.z = sz + (ez - sz) * ease - over;
    const fall = u < 0.18 ? (SHAKE_AT[k].y - BOARD_TOP - 0.275) * (1 - u / 0.18) : 0;
    d.position.y = BOARD_TOP + 0.275 + Math.max(fall, height * Math.pow(1 - u, 1.6) * Math.abs(Math.cos(u * Math.PI * bounces)) * Math.min(1, u / 0.18));
    const qf = diceFinalQuat(state.dice[k], spin.yaw);
    const ax = new THREE.Vector3(spin.ax, spin.ay, spin.az).normalize();
    const extra = new THREE.Quaternion().setFromAxisAngle(ax, (1 - ease) * spin.n * Math.PI * 2);
    d.quaternion.copy(extra.multiply(qf));
  }
}
function render3D() {
  if (!renderer) return;
  if (scene === 'figures') { renderer.render(figScene, figCamera); return; }
  const showGame = state && state.players;
  for (let k = 0; k < 4; k++) tok3[k].visible = false;
  if (showGame && scene !== 'title') {
    state.players.forEach((p) => {
      const t = tok3[p.id], v = tokVis[p.id];
      if (!v || p.bankrupt) return;
      t.visible = true; t.position.set(v.x, BOARD_TOP + v.y, v.z);
      const ti = tileInfo(p.pos); t.rotation.y = Math.atan2(ti.ox, ti.oz) + Math.PI;
    });
    const cp = curP(), cv = tokVis[cp.id];
    ring3.visible = !!cv && state.phase !== 'over';
    if (cv) { ring3.position.set(cv.x, BOARD_TOP + 0.02 + cv.y, cv.z); ring3.material.color.set(cp.color); const s = 1 + 0.12 * Math.sin(state.t * 6); ring3.scale.set(s, s, s); }
    placeDice(); syncPot();
    flash3.visible = state.flash.tile >= 0 && state.flash.t < 1.2;
    if (flash3.visible) { const ti = tileInfo(state.flash.tile); flash3.position.x = ti.x; flash3.position.z = ti.z; const hz = ti.side === 0 || ti.side === 2; flash3.scale.set(ti.side < 0 ? 1.6 : hz ? 1 : 1.6, 1, ti.side < 0 ? 1.6 : hz ? 1.6 : 1); flash3.material.opacity = 0.55 * (1 - state.flash.t / 1.2); }
    hover3.visible = hoverTile >= 0 && state.phase !== 'pick';
    if (hover3.visible) { const ti = tileInfo(hoverTile); const hz = ti.side === 0 || ti.side === 2; hover3.position.set(ti.x, BOARD_TOP + 0.015, ti.z); hover3.scale.set(ti.side < 0 ? 1.6 : hz ? 1 : 1.6, 1, ti.side < 0 ? 1.6 : hz ? 1.6 : 1); }
    pick3.visible = state.phase === 'pick';
    if (pick3.visible) { const ti = tileInfo(state.pick); const hz = ti.side === 0 || ti.side === 2; pick3.position.set(ti.x, BOARD_TOP + 0.02, ti.z); pick3.scale.set(ti.side < 0 ? 1.6 : hz ? 1 : 1.6, 1, ti.side < 0 ? 1.6 : hz ? 1.6 : 1); pick3.material.opacity = 0.35 + 0.25 * Math.sin(state.t * 8); }
  } else { ring3.visible = false; flash3.visible = false; pick3.visible = false; placeDice(); }
  renderer.render(scene3, camera);
}
function project(x: number, y: number, z: number, cam = camera) {
  const v = new THREE.Vector3(x, y, z).project(cam);
  return cam === camera ? { x: L.bx + (v.x + 1) / 2 * L.bw, y: L.by + (1 - v.y) / 2 * L.bh } : { x: (v.x + 1) / 2 * BW, y: (1 - v.y) / 2 * 720 };
}
function boardPointAt(lx: number, ly: number) {
  const ndc = new THREE.Vector2((lx - L.bx) / L.bw * 2 - 1, -((ly - L.by) / L.bh * 2 - 1));
  const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, camera);
  const pt = new THREE.Vector3();
  return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -BOARD_TOP), pt) ? pt : null;
}

// ---- 2D UI ---------------------------------------------------------------------------
const PX = BW, PW = 1280 - BW; // the wide layout's panel
let ui: Loose[] = []; // buttons this frame: { x, y, w, h, label, fn, role: 'primary'|'secondary'|'', enabled, color }
let propScroll = 0;
let inspect = -1, hoverTile = -1, drawingInspect = false; // the tile whose card is open from a click, and the tile under the mouse
/** Adds a button for this frame. act names it for online play: a guest sends the act, and the host
 * presses its own button with that act, so the rules and their checks run in one place. */
function btn(x: number, y: number, w: number, h: number, label: string, fn: () => void, role = '', enabled = true, color?: string, act?: string) { ui.push({ x, y, w, h, label, fn, role, enabled, color, act }); }
/** True when the player whose turn it is plays on this screen. */
function humanTurn(): boolean {
  if (!state || !state.players || state.phase === 'over') return false;
  const p = curP();
  return isGuest() ? p.id === mySeat : p.kind === 'human';
}
/** Host: a friend online is taking their turn. */
function remoteTurn(): boolean {
  return isHost() && !!state && !!state.players && state.phase !== 'over' && curP().kind === 'remote';
}
function buildUI() {
  ui = [];
  if (scene === 'title') { buildTitleUI(); return; }
  if (scene === 'results') {
    if (isGuest()) return; // only the host starts the next game
    btn(L.cx - 200, L.phone ? 840 : 560, 190, 52, 'Chơi lại (Enter)', () => { reset(); clearVis(); scene = 'play'; }, 'primary');
    btn(L.cx + 10, L.phone ? 840 : 560, 190, 52, 'Ván mới (N)', () => { scene = 'title'; }, 'secondary');
    return;
  }
  if (scene !== 'play') return;
  btn(W - 52, 12, 40, 34, '', () => setMuted(!muted()), 'mute');
  if (inspect >= 0) { btn(L.cx - 90, L.closeY, 180, 50, 'Đóng', () => { inspect = -1; }, 'close'); return; }
  if (sheetOpen) { buildSheetUI(state.cur); return; }
  if (!L.phone) { // click a row of the property list to see that land's card
    const mine = owned(state.cur), rows = Math.floor((H - 16 - 400) / 30);
    mine.slice(propScroll, propScroll + rows).forEach((i, r) => btn(PX + 14, 400 + r * 30, 250, 30, '', () => { inspect = i; }, 'hidden'));
  }
  if (humanTurn()) buildTurnUI();
}
/** The buttons of the current player's turn: drawn when they play here, built unseen on the host
 * when a friend online plays, so the friend's act finds the same button. */
function buildTurnUI() {
  const p = curP();
  const ax = L.cx, ay = L.rollY, by = L.btnY; // wide: the board's open centre; phone: the strip under the players
  switch (state.phase) {
    case 'roll': btn(ax - 130, ay, 260, 58, state.shaking ? 'Thả ra để ném!' : 'Giữ để lắc xúc xắc', () => startShake(), 'primary', true, '#c8201f', 'shake'); break;
    case 'jail': {
      btn(ax - 230, ay, 220, 54, state.shaking ? 'Thả ra để ném!' : 'Giữ lắc tìm đôi', () => startShake(), 'primary', true, '#c8201f', 'shake');
      if (p.freeCards.length > 0) btn(ax + 10, ay, 220, 54, 'Dùng thẻ ra tù', payJail, 'secondary', true, undefined, 'jailCard');
      break;
    }
    case 'buy': { const t = TILES[state.popup.tile]; btn(ax - 230, by, 220, 54, `Mua ${money(t.p!)}`, doBuy, 'primary', p.cash >= t.p!, '#2f8a3a', 'buy'); btn(ax + 10, by, 220, 54, 'Bỏ qua', () => { log(`${p.name} bỏ qua ${t.n}.`); skip(); }, 'secondary', true, undefined, 'skip'); break; }
    case 'build': {
      const i = state.popup.tile, to = state.level[i] + 1, cost = buildCost(i, to);
      btn(ax - 230, by, 220, 54, `Xây ${LEVEL_NAMES[to]}: ${money(cost)}`, () => { doBuild(i); state.popup = null; afterAction(); }, 'primary', p.cash >= cost, '#2f8a3a', 'build');
      btn(ax + 10, by, 220, 54, 'Không xây', () => { state.popup = null; afterAction(); }, 'secondary', true, undefined, 'noBuild');
      break;
    }
    case 'card': btn(ax - 110, by, 220, 54, 'Đồng ý', applyCard, 'primary', true, '#c8201f', 'cardOk'); break;
    case 'rentShow': btn(ax - 110, by, 220, 54, 'Tiếp tục', () => { state.popup = null; afterAction(); }, 'primary', true, undefined, 'continue'); break;
    case 'taxChoice': {
      const pp = state.popup;
      btn(ax - 230, by, 220, 54, `Trả ${Math.round(tune.prop_tax_pct * 100)}%: ${money(pp.pct)}`, () => payTax(pp.pct), pp.pct <= pp.flat ? 'primary' : 'secondary', true, '#8a5a2a', 'taxPct');
      btn(ax + 10, by, 220, 54, `Trả ${money(pp.flat)}`, () => payTax(pp.flat), pp.pct <= pp.flat ? 'secondary' : 'primary', true, '#8a5a2a', 'taxFlat');
      break;
    }
    case 'pick': btn(ax - 110, by, 220, 54, `Bay tới ${TILES[state.pick].n}`, () => flyTo(state.pick), 'primary', true, '#2f8a3a', 'fly'); break;
    case 'debt': {
      const d = state.debt;
      btn(ax - (L.phone ? 232 : 255), by, L.phone ? 148 : 160, 54, 'Trả nợ', payDebt, 'primary', p.cash >= d.total, '#2f8a3a', 'payDebt');
      btn(ax - (L.phone ? 74 : 80), by, L.phone ? 148 : 160, 54, 'Tự bán bớt', () => { autoRaise(state.cur, d.total); }, '', liquidValue(state.cur) > 0, undefined, 'autoRaise');
      btn(ax + (L.phone ? 84 : 95), by, L.phone ? 148 : 160, 54, 'Phá sản', declareBankrupt, 'secondary', true, '#6a6a6a', 'bankrupt');
      break;
    }
    case 'end': btn(ax - 110, ay, 220, 58, 'Kết thúc lượt', nextTurn, 'primary', true, '#c8201f', 'endTurn'); break;
  }
  if (['roll', 'end', 'debt', 'jail'].includes(state.phase)) { if (L.phone) buildSheetButton(state.cur); else buildPropUI(state.cur); }
}
/** What a seat is, in the seat's button. */
function seatLabel(s: Seat): string {
  if (s.kind === 'human') return 'Người chơi';
  if (s.kind === 'remote') return s.peer === undefined ? 'Chờ bạn online...' : `Online · ${s.name || 'Bạn'}${peerOnline(s.peer) || isGuest() ? '' : ' (đã rời)'}`;
  if (s.kind === 'ai') return `Máy · ${AI_LEVELS[s.lv!]}`;
  return 'Không chơi';
}
function startGame() { reset(); clearVis(); scene = 'play'; }
function buildTitleUI() {
  const T = titleSpots();
  const b4 = (r: number[], label: string, fn: () => void, role: string, color: string) => btn(r[0], r[1], r[2], r[3], label, fn, role, true, color);
  if (isGuest()) { b4(T.leave, 'Rời phòng', leaveRoom, 'secondary', '#6a4a2a'); return; }
  setup.seats.forEach((s, i) => {
    // online, the host plays seat 0, and a friend who is in the room keeps their seat
    const locked = isHost() && (i === 0 || (s.kind === 'remote' && peerOnline(s.peer)));
    btn(T.seatX, T.y0 + i * T.step, T.seatW, T.seatH, seatLabel(s), () => {
      const base = isHost() ? ['human', 'remote', 'ai0', 'ai1', 'ai2'] : ['human', 'ai0', 'ai1', 'ai2'];
      const order = i < 2 ? base : [...base, 'off'];
      const curKey = s.kind === 'ai' ? 'ai' + s.lv : s.kind;
      const nk = order[(order.indexOf(curKey) + 1) % order.length];
      setup.seats[i] = nk.startsWith('ai') ? { kind: 'ai', lv: Number(nk[2]) } : { kind: nk as Seat['kind'] };
      sendLobby();
    }, 'seat', !locked);
  });
  const roundsLabel = L.phone ? `${tune.max_rounds} vòng` : `${tune.max_rounds} vòng, giàu nhất thắng`;
  btn(T.seatX, T.y0 + 4 * T.step + T.modeDy, T.seatW, T.seatH, setup.mode === 'rounds' ? roundsLabel : 'Tới khi phá sản', () => { setup.mode = setup.mode === 'rounds' ? 'bankrupt' : 'rounds'; sendLobby(); }, 'seat');
  b4(T.start, L.phone ? 'Bắt đầu' : 'Bắt đầu (Enter)', startGame, 'primary', '#c8201f');
  if (isHost()) b4(T.online, `Rời phòng ${roomCode}`, leaveRoom, '', '#6a4a2a');
  else b4(T.online, 'Chơi online', () => showOnlinePanel(true), '', '#2b6cd6');
}
/** A line about the connection, over the board, when something is wrong with it. */
function drawNetBanner() {
  let msg = '';
  if (net.getRole() !== 'off' && !linkUp) msg = 'Mất kết nối mạng, đang nối lại...';
  else if (isGuest() && !hostOnline) msg = 'Chủ phòng mất kết nối, đang chờ quay lại...';
  else if (netError && scene !== 'title') msg = netError;
  if (msg) messageBox([msg], L.cx, L.bannerY, 620);
}
function clearVis() { inspect = -1; lastPos.length = 0; tokVis.length = 0; tokAnim.length = 0; for (let i = 0; i < 40; i++) tileShown[i] = -1; riseAnims.length = 0; }
function buildPropUI(pi: number) {
  const mine = owned(pi);
  const rowH = 30, y0 = 400, rows = Math.floor((H - 16 - y0) / rowH);
  propScroll = Math.max(0, Math.min(propScroll, mine.length - rows));
  mine.slice(propScroll, propScroll + rows).forEach((i, r) => {
    const y = y0 + r * rowH, p = state.players[pi];
    if (state.level[i] > 0) btn(W - 104, y + 3, 92, 24, 'Bán 1 cấp', () => sellLevel(pi, i), 'row', true, undefined, `sell:${i}`);
    else if (state.mort[i]) btn(W - 104, y + 3, 92, 24, 'Chuộc', () => unmortgage(pi, i), 'row', p.cash >= TILES[i].p! * tune.unmortgage_pct, undefined, `unmort:${i}`);
    else btn(W - 104, y + 3, 92, 24, 'Cầm cố', () => mortgage(pi, i), 'row', true, undefined, `mort:${i}`);
  });
  if (mine.length > rows) {
    btn(PX + PW / 2 - 70, H - 4 - 22, 60, 20, 'up', () => { propScroll = Math.max(0, propScroll - rows); }, 'arrowUp', propScroll > 0);
    btn(PX + PW / 2 + 10, H - 4 - 22, 60, 20, 'down', () => { propScroll += rows; }, 'arrowDown', propScroll + rows < mine.length);
  }
}
/** A button pressed here: a guest sends its act to the host; everyone else runs it. */
function pressBtn(b: Loose) {
  sfx.click();
  if (isGuest() && b.act) { sendAct(b.act); if (b.act === 'shake') guestShaking = true; return; }
  b.fn();
}
/** The same for an act with no button (picking a tile with the plane ticket). */
function pressAct(act: string, run: () => void) {
  if (isGuest()) sendAct(act); else run();
}
function pickTile(i: number) {
  if (isGuest()) sendAct('pick', i); else state.pick = i;
}
function handleInput() {
  for (const c of clicks) {
    const b = ui.find(b => c.x >= b.x && c.x <= b.x + b.w && c.y >= b.y && c.y <= b.y + b.h);
    if (b) { if (b.enabled) pressBtn(b); continue; }
    if (scene === 'play' && state.phase === 'pick' && humanTurn() && inBoard(c.x, c.y)) {
      const pt = boardPointAt(c.x, c.y);
      if (pt) { const i = tileAt(pt.x, pt.z); if (i >= 0) { if (i === state.pick) pressAct('fly', () => flyTo(i)); else pickTile(i); } }
    } else if (scene === 'play' && inBoard(c.x, c.y)) { // anywhere else on the board: open that tile's card, or close it
      const pt = boardPointAt(c.x, c.y), i = pt ? tileAt(pt.x, pt.z) : -1;
      inspect = i >= 0 && i !== inspect ? i : -1;
      if (i >= 0) sfx.card();
    }
  }
  clicks.length = 0;
  if (inspect >= 0 && (pressed('Space') || pressed('Enter') || pressed('Escape') || pressed('KeyN'))) { inspect = -1; return; }
  if (wheel && scene === 'play') { propScroll = Math.max(0, propScroll + wheel); wheel = 0; }
  if (pressed('Space') || pressed('Enter')) { const b = ui.find(b => b.role === 'primary' && b.enabled); if (b) { pressBtn(b); return; } }
  if (pressed('KeyN') || pressed('Escape')) { const b = ui.find(b => b.role === 'secondary' && b.enabled); if (b) { pressBtn(b); return; } }
  if (scene === 'play' && state.phase === 'pick' && humanTurn()) {
    if (pressed('ArrowRight') || pressed('ArrowUp')) pickTile((state.pick + 1) % 40);
    if (pressed('ArrowLeft') || pressed('ArrowDown')) pickTile((state.pick + 39) % 40);
  }
}

// ---- 2D drawing ----------------------------------------------------------------------
function drawBoardView() { render3D(); ctx.drawImage(renderer!.domElement, L.bx, L.by, L.bw, L.bh); }
function lacquer(x: number, y: number, w: number, h: number) { // sơn mài: deep red-black lacquer with a gold trim
  const g = ctx.createLinearGradient(x, y, x, y + h); g.addColorStop(0, '#3b1712'); g.addColorStop(1, '#1f0c09');
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 2; ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);
}
function drawButton(b: Loose) {
  if (b.role === 'mute') { drawSpeaker(b); return; }
  if (b.role === 'hidden' || (b.role === 'close' && !drawingInspect)) return;
  const hover = pointer.x >= b.x && pointer.x <= b.x + b.w && pointer.y >= b.y && pointer.y <= b.y + b.h;
  ctx.save();
  if (b.role === 'arrowUp' || b.role === 'arrowDown') {
    ctx.fillStyle = b.enabled ? '#c9a24a' : '#5a4a3a'; ctx.beginPath();
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, up = b.role === 'arrowUp';
    ctx.moveTo(cx - 12, cy + (up ? 6 : -6)); ctx.lineTo(cx + 12, cy + (up ? 6 : -6)); ctx.lineTo(cx, cy + (up ? -7 : 7)); ctx.closePath(); ctx.fill();
    ctx.restore(); return;
  }
  const base = b.color || (b.role === 'seat' ? '#f4ead2' : b.role === 'row' ? '#6a4a2a' : '#8a5a2a');
  ctx.globalAlpha = b.enabled ? 1 : 0.45;
  if (b.role !== 'row') { ctx.fillStyle = 'rgba(0,0,0,0.35)'; rrect(ctx, b.x, b.y + 4, b.w, b.h, 12); ctx.fill(); }
  ctx.fillStyle = base; rrect(ctx, b.x, b.y, b.w, b.h, b.role === 'row' ? 6 : 12); ctx.fill();
  if (hover && b.enabled) { ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fill(); }
  ctx.strokeStyle = b.role === 'seat' ? '#5a3d2b' : '#f2c44a'; ctx.lineWidth = b.role === 'row' ? 1 : 2; ctx.stroke();
  const pulse = b.role === 'primary' && b.enabled && scene === 'play' ? 0.5 + 0.5 * Math.sin(state.t * 5) : 0;
  if (pulse) { ctx.strokeStyle = `rgba(255,236,150,${0.3 + 0.6 * pulse})`; ctx.lineWidth = 4; rrect(ctx, b.x - 3, b.y - 3, b.w + 6, b.h + 6, 14); ctx.stroke(); }
  const fs = b.role === 'row' ? 14 : b.h >= 54 ? 21 : 19;
  text(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1, fs, b.role === 'seat' ? '#2b1d12' : '#fff8e6', 'center', 'bold');
  ctx.restore();
}
function drawSpeaker(b: Loose) {
  ctx.save(); ctx.translate(b.x + 8, b.y + b.h / 2);
  ctx.fillStyle = '#e8d9b5'; ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(6, -5); ctx.lineTo(13, -11); ctx.lineTo(13, 11); ctx.lineTo(6, 5); ctx.lineTo(0, 5); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#e8d9b5'; ctx.lineWidth = 2.5;
  if (muted()) { ctx.beginPath(); ctx.moveTo(17, -6); ctx.lineTo(27, 6); ctx.moveTo(27, -6); ctx.lineTo(17, 6); ctx.stroke(); }
  else { ctx.beginPath(); ctx.arc(14, 0, 7, -0.9, 0.9); ctx.stroke(); ctx.beginPath(); ctx.arc(14, 0, 12, -0.9, 0.9); ctx.stroke(); }
  ctx.restore();
}
function drawTokenIcon(kind: number, x: number, y: number, s: number, color: string) { // 2D silhouettes of the four tokens for the HUD
  ctx.save(); ctx.translate(x, y); ctx.fillStyle = color; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (kind === 0) { // buffalo head and horns
    ctx.ellipse(0, s * 0.12, s * 0.28, s * 0.32, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-s * 0.2, -s * 0.12); ctx.quadraticCurveTo(-s * 0.6, -s * 0.2, -s * 0.5, -s * 0.5); ctx.quadraticCurveTo(-s * 0.45, -s * 0.25, -s * 0.12, -s * 0.2); ctx.closePath();
    ctx.moveTo(s * 0.2, -s * 0.12); ctx.quadraticCurveTo(s * 0.6, -s * 0.2, s * 0.5, -s * 0.5); ctx.quadraticCurveTo(s * 0.45, -s * 0.25, s * 0.12, -s * 0.2); ctx.closePath();
    ctx.fillStyle = '#f6f0e0'; ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(-s * 0.1, s * 0.05, s * 0.04, 0, 7); ctx.arc(s * 0.1, s * 0.05, s * 0.04, 0, 7); ctx.fill();
  } else if (kind === 1) { // carp
    ctx.ellipse(-s * 0.05, 0, s * 0.36, s * 0.2, -0.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s * 0.25, -s * 0.05); ctx.lineTo(s * 0.5, -s * 0.3); ctx.lineTo(s * 0.45, s * 0.02); ctx.lineTo(s * 0.52, s * 0.25); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(-s * 0.25, -s * 0.02, s * 0.04, 0, 7); ctx.fill();
  } else if (kind === 2) { // Lạc bird
    ctx.ellipse(-s * 0.08, s * 0.1, s * 0.3, s * 0.16, -0.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(s * 0.18, -s * 0.18, s * 0.1, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s * 0.26, -s * 0.2); ctx.lineTo(s * 0.62, -s * 0.08); ctx.lineTo(s * 0.26, -s * 0.13); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(s * 0.14, -s * 0.26); ctx.lineTo(s * 0.0, -s * 0.5); ctx.lineTo(s * 0.2, -s * 0.28); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-s * 0.36, s * 0.08); ctx.lineTo(-s * 0.6, -s * 0.1); ctx.lineTo(-s * 0.4, s * 0.18); ctx.closePath(); ctx.fill();
  } else { // conical hat
    ctx.moveTo(0, -s * 0.38); ctx.lineTo(s * 0.5, s * 0.16); ctx.quadraticCurveTo(0, s * 0.3, -s * 0.5, s * 0.16); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; for (let k = 1; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(-s * 0.12 * k, -s * 0.38 + s * 0.13 * k); ctx.lineTo(s * 0.12 * k, -s * 0.38 + s * 0.13 * k); ctx.stroke(); }
    ctx.strokeStyle = '#f6f0e0'; ctx.beginPath(); ctx.arc(0, s * 0.2, s * 0.18, 0.2, Math.PI - 0.2); ctx.stroke();
  }
  ctx.restore();
}
function drawPanel() {
  lacquer(PX, 0, PW, H);
  text('TỶ PHÚ ĐẤT VIỆT', PX + PW / 2 - 14, 30, 24, '#f2c44a', 'center', 'bold');
  const roundTxt = state.mode === 'rounds' ? `Vòng ${Math.min(state.round, tune.max_rounds)} / ${tune.max_rounds}` : `Vòng ${state.round} · tới khi phá sản`;
  text(roundTxt, PX + PW / 2, 58, 16, '#e8d9b5');
  state.players.forEach((p, pi) => {
    const y = 76 + pi * 72, cur = pi === state.cur && state.phase !== 'over';
    ctx.save();
    ctx.globalAlpha = p.bankrupt ? 0.45 : 1;
    ctx.fillStyle = cur ? '#5a2a1c' : '#2c140f'; rrect(ctx, PX + 14, y, PW - 28, 64, 10); ctx.fill();
    ctx.strokeStyle = cur ? '#f2c44a' : '#6a4a2a'; ctx.lineWidth = cur ? 3 : 1; ctx.stroke();
    ctx.fillStyle = p.color; rrect(ctx, PX + 14, y, 8, 64, 4); ctx.fill();
    ctx.fillStyle = '#f4ead2'; ctx.beginPath(); ctx.arc(PX + 52, y + 32, 22, 0, 7); ctx.fill();
    drawTokenIcon(p.token, PX + 52, y + 34, 38, p.color);
    text(p.name, PX + 84, y + 18, 18, '#fff8e6', 'left', 'bold');
    const sub = (isAI(p) ? `Máy ${AI_LEVELS[p.lv]}` : p.kind === 'remote' ? (p.offline ? 'Online · mất kết nối' : 'Online') : 'Người chơi') + ` · ${owned(pi).length} ô` + (firstLap(p) && !p.bankrupt ? ' · vòng đầu' : '') + (p.inJail ? ' · trong tù' : '') + (p.noSalary ? ' · mất lương' : '') + (p.freeCards.length ? ' · có thẻ ra tù' : '') + (p.bankrupt ? ' · phá sản' : '');
    text(sub, PX + 84, y + 45, 15, '#d9c8a6', 'left');
    text(money(p.cash), PX + PW - 26, y + 18, 18, p.cash < 0 ? '#ff8a7a' : '#f2c44a', 'right', 'bold');
    ctx.restore();
  });
  // the property list for the person whose turn it is
  const pi = state.cur, p = curP(), mine = owned(pi);
  const y0 = 370;
  text(humanTurn() ? 'Tài sản của bạn' : `Tài sản của ${p.name}`, PX + 22, y0 + 14, 17, '#f2c44a', 'left', 'bold');
  if (!mine.length) text('Chưa có ô đất nào.', PX + 22, y0 + 48, 15, '#d9c8a6', 'left');
  const rowH = 30, rows = Math.floor((H - 16 - 400) / rowH);
  mine.slice(propScroll, propScroll + rows).forEach((i, r) => {
    const y = 400 + r * rowH, t = TILES[i];
    ctx.fillStyle = r % 2 ? '#2c140f' : '#34180f'; ctx.fillRect(PX + 14, y, PW - 28, rowH);
    ctx.fillStyle = t.t === 'prop' ? GROUPS[t.g!].color : '#9a8a6a'; ctx.fillRect(PX + 20, y + 7, 14, 16);
    text(t.n, PX + 42, y + 15, 15, state.mort[i] ? '#9a8a7a' : '#fff8e6', 'left');
    const tag = state.mort[i] ? 'cầm cố' : LEVEL_SHORT[state.level[i]];
    if (tag) text(tag, PX + 230, y + 15, 14, state.mort[i] ? '#ff9a8a' : '#7ee08a', 'center', 'bold');
  });
}
function drawDiceFeel() {
  if (state.shaking && !state.shaking.ai) { // the power bar under the shaking dice
    const pw = shakePower(), x = L.cx - 130, y = L.powerY, w = 260, h = 16;
    ctx.save();
    ctx.fillStyle = 'rgba(20,10,6,0.8)'; rrect(ctx, x - 4, y - 4, w + 8, h + 8, 8); ctx.fill();
    const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, '#3fcf5a'); g.addColorStop(0.6, '#f2c44a'); g.addColorStop(1, '#e8402a');
    ctx.fillStyle = g; rrect(ctx, x, y, Math.max(8, w * pw), h, 6); ctx.fill();
    text(pw >= 1 ? 'Lực tối đa!' : 'Lực ném', L.cx, y + 34, 16, '#fff8e6', 'center', 'bold');
    ctx.restore();
  }
  const ds = state.diceShow;
  if (!ds || ds.t > 1.6) return;
  const s = project((dice3[0].position.x + dice3[1].position.x) / 2, BOARD_TOP + 1.1, (dice3[0].position.z + dice3[1].position.z) / 2);
  const pop = ds.t < 0.18 ? 0.4 + 0.6 * (ds.t / 0.18) * 1.25 : 1 + 0.25 * Math.max(0, 1 - (ds.t - 0.18) * 5);
  const alpha = ds.t > 1.2 ? Math.max(0, 1 - (ds.t - 1.2) / 0.4) : 1;
  const label = ds.dbl ? `ĐÔI! ${ds.a} + ${ds.b} = ${ds.a + ds.b}` : `${ds.a} + ${ds.b} = ${ds.a + ds.b}`;
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(s.x, s.y - ds.t * 12); ctx.scale(pop, pop);
  ctx.font = `bold 44px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(40,14,8,0.9)'; ctx.strokeText(label, 0, 0);
  ctx.fillStyle = ds.dbl ? '#f2c44a' : '#fff8e6'; ctx.fillText(label, 0, 0);
  if (ds.dbl) { ctx.fillStyle = '#ffe9a8'; for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + ds.t * 2, r = 150 + 20 * Math.sin(ds.t * 9 + k); star(ctx, Math.cos(a) * r, Math.sin(a) * r * 0.45, 10); } }
  ctx.restore();
}
function drawPotLabel() {
  const s = project(POT_X, BOARD_TOP + 1.05, POT_Z);
  const label = `Hũ tiền: ${money(state.pot)}`;
  ctx.save(); ctx.font = `bold 16px ${FONT}`;
  const w = ctx.measureText(label).width + 22;
  ctx.fillStyle = 'rgba(40,16,10,0.85)'; rrect(ctx, s.x - w / 2, s.y - 14, w, 28, 8); ctx.fill();
  ctx.strokeStyle = '#f2c44a'; ctx.lineWidth = 1.5; ctx.stroke();
  text(label, s.x, s.y + 1, 16, '#f2c44a', 'center', 'bold');
  ctx.restore();
}
function drawLog() {
  const lines = state.log.slice(-3);
  ctx.save();
  ctx.font = `15px ${FONT}`;
  const w = Math.max(...lines.map(l => ctx.measureText(l).width), 10) + 24;
  ctx.fillStyle = 'rgba(20,10,6,0.72)'; rrect(ctx, 10, 10, Math.min(w, BW - 20), lines.length * 22 + 12, 8); ctx.fill();
  lines.forEach((l, j) => text(l, 22, 28 + j * 22, 15, j === lines.length - 1 ? '#fff8e6' : '#cbb994', 'left'));
  ctx.restore();
}
function tileCard(i: number, cx: number, cy: number, extra?: (x: number, y: number, w: number, h: number) => void) { // the land card: band, name, price, rent per level, landmark
  const t = TILES[i], w = 330, h = 360, x = cx - w / 2, y = cy - h / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; rrect(ctx, x + 6, y + 8, w, h, 14); ctx.fill();
  ctx.fillStyle = '#fbf3df'; rrect(ctx, x, y, w, h, 14); ctx.fill();
  ctx.strokeStyle = '#5a3d2b'; ctx.lineWidth = 3; ctx.stroke();
  const band = t.t === 'prop' ? GROUPS[t.g!].color : '#5a3d2b';
  ctx.fillStyle = band; rrect(ctx, x + 10, y + 10, w - 20, 70, 8); ctx.fill();
  const dark = t.t === 'prop' && [0, 3, 4].includes(t.g!);
  text(t.n, cx, y + 38, 26, dark ? '#2b1d12' : '#fff8e6', 'center', 'bold');
  text(t.t === 'prop' ? GROUPS[t.g!].name : t.t === 'port' ? 'Bến cảng · Sân bay' : 'Công ty', cx, y + 66, 15, dark ? '#3a2416' : '#f4ead2');
  let yy = y + 104;
  text(`Giá đất: ${money(t.p!)}`, cx, yy, 18, '#2b1d12', 'center', 'bold'); yy += 30;
  if (t.t === 'prop') {
    for (let l = 0; l <= MAX_LEVEL; l++) {
      const r = Math.round(t.p! * rentPct(l) * tune.rent_scale / 10) * 10;
      const here = state.owner[i] >= 0 && state.level[i] === l;
      if (here) { ctx.fillStyle = 'rgba(242,196,74,0.35)'; ctx.fillRect(x + 16, yy - 11, w - 32, 22); }
      text(LEVEL_NAMES[l] + (l === 6 ? `: ${t.lm}` : ''), x + 22, yy, 15, '#3a2416', 'left');
      text(money(r), x + w - 22, yy, 15, '#3a2416', 'right', here ? 'bold' : '');
      yy += 22;
    }
    text(`Gom đủ nhóm: thuê × ${tune.full_group_mult}`, cx, yy + 6, 15, '#8a3a24', 'center', 'bold'); yy += 30;
  } else if (t.t === 'port') {
    [1, 2, 3, 4].forEach(n => { text(`Có ${n} bến`, x + 22, yy, 15, '#3a2416', 'left'); text(money(tune.port_rent * Math.pow(2, n - 1) * tune.rent_scale), x + w - 22, yy, 15, '#3a2416', 'right'); yy += 24; });
  } else {
    text(`1 công ty: tổng xúc xắc × ${money(tune.util_mult_one)}`, cx, yy, 15, '#3a2416'); yy += 24;
    text(`2 công ty: tổng xúc xắc × ${money(tune.util_mult_two)}`, cx, yy, 15, '#3a2416'); yy += 24;
  }
  const o = state.owner[i];
  if (o >= 0) text(`Chủ: ${state.players[o].name}${state.mort[i] ? ' (cầm cố)' : ''}`, cx, y + h - 22, 16, state.players[o].color, 'center', 'bold');
  else text('Chưa có chủ', cx, y + h - 22, 16, '#6a5a4a', 'center');
  if (extra) extra(x, y, w, h);
  ctx.restore();
}
function messageBox(lines: string[], cx: number, cy: number, w: number) {
  w = Math.min(w, L.maxW);
  ctx.save(); ctx.font = `bold 19px ${FONT}`;
  const all = lines.flatMap((l: string) => wrapLines(ctx, l, w - 40));
  const h = all.length * 28 + 26;
  ctx.fillStyle = 'rgba(20,10,6,0.82)'; rrect(ctx, cx - w / 2, cy - h / 2, w, h, 14); ctx.fill();
  ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 2; ctx.stroke();
  all.forEach((l: string, j: number) => text(l, cx, cy - h / 2 + 26 + j * 28, 19, '#fff8e6', 'center', 'bold'));
  ctx.restore();
}
function drawPopup() {
  const p = curP(), pop = state.popup, human = humanTurn();
  const cx = L.cx, cy = L.popCy, my = (y: number): number => L.phone ? L.msgY - 8 : y; // wide: over the board; phone: above the buttons
  if (state.phase === 'roll' && human && !state.shaking) messageBox([`Lượt của ${p.name}${state.rolledDouble ? ': đổ đôi, được đổ tiếp!' : ''}`], cx, my(322), 460);
  if (state.phase === 'jail' && human && !state.shaking) messageBox([`${p.name} đang ở tù. Đổ được đôi thì ra ngay (lượt ${p.jailTries + 1}/3; ở đủ 3 lượt thì lượt sau được ra).${p.noSalary ? (p.freeCards.length ? ' Dùng Thẻ Ra Tù thì được nhận lương lại!' : ' Lần qua Xuất Phát tới sẽ mất lương.') : ''}`], cx, my(312), 520);
  if (state.phase === 'end' && human) messageBox([`${p.name}: hết lượt. Quản lý tài sản ${L.phone ? 'ở nút Tài sản' : 'ở bên phải'} nếu cần.`], cx, my(318), 640);
  if (!pop && state.phase !== 'pick' && state.phase !== 'debt') return;
  if (state.phase === 'pick') { messageBox([human ? 'Vé máy bay: bấm một ô trên bàn cờ (hoặc dùng phím mũi tên) để bay tới.' : `${p.name} đang chọn nơi bay tới...`], cx, my(545), 600); return; }
  if (state.phase === 'debt') { const d = state.debt; messageBox([`${p.name} cần trả ${money(d.total)}, đang có ${money(p.cash)}.`, `Bán bớt nhà hoặc cầm cố đất ${L.phone ? 'ở nút Tài sản' : 'ở danh sách bên phải'}, rồi bấm Trả nợ.`], cx, L.phone ? L.msgY - 24 : 520, 620); return; }
  if (pop.kind === 'notax') { messageBox([`Vòng đầu tiên (chưa qua Xuất Phát): miễn ${TILES[pop.tile].n}!`], cx, L.phone ? L.popCy : 330, 560); return; }
  if (pop.kind === 'buy' || pop.kind === 'build' || pop.kind === 'rent' || pop.kind === 'nobuy') {
    tileCard(pop.tile, cx, cy - 10);
    if (pop.kind === 'rent') messageBox([`${p.name} trả ${state.players[pop.owner].name} ${money(pop.rent)}`], cx, my(548), 520);
    if (pop.kind === 'build') messageBox([`Đất của bạn! Xây thêm 1 cấp?`], cx, my(548), 420);
    if (pop.kind === 'nobuy') messageBox([`Vòng đầu tiên (chưa qua Xuất Phát): chưa được mua, chỉ ghé xem.`], cx, my(548), 600);
    if (!human && pop.kind !== 'rent' && pop.kind !== 'nobuy') messageBox([`${p.name} đang suy nghĩ...`], cx, my(548), 420);
  }
  if (pop.kind === 'tax') {
    const w = 460, h = 250, x = cx - w / 2, y = cy - h / 2;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; rrect(ctx, x + 6, y + 8, w, h, 16); ctx.fill();
    ctx.fillStyle = '#fbf3df'; rrect(ctx, x, y, w, h, 16); ctx.fill(); ctx.strokeStyle = '#5a3d2b'; ctx.lineWidth = 3; ctx.stroke();
    icon.coins(ctx, x + 70, y + 72, 90);
    text('THUẾ TÀI SẢN', cx + 40, y + 52, 28, '#8a3a24', 'center', 'bold');
    text(`Tiền mặt của ${p.name}: ${money(p.cash)}`, cx + 40, y + 90, 16, '#3a2416');
    text(`Chọn một: ${Math.round(tune.prop_tax_pct * 100)}% tiền đang có = ${money(pop.pct)}`, cx, y + 150, 19, '#2b1d12', 'center', 'bold');
    text(`hoặc trả gọn ${money(pop.flat)}`, cx, y + 182, 19, '#2b1d12', 'center', 'bold');
    text('Tiền thuế vào hũ giữa bàn.', cx, y + 220, 15, '#6a5a4a');
    ctx.restore();
    if (!human) messageBox([`${p.name} đang tính...`], cx, my(548), 360);
  }
  if (pop.kind === 'card') {
    const w = 380, h = 250, x = cx - w / 2, y = cy - h / 2;
    const co = pop.deck === 'co';
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; rrect(ctx, x + 6, y + 8, w, h, 16); ctx.fill();
    ctx.fillStyle = co ? '#f6d26a' : '#c8201f'; rrect(ctx, x, y, w, h, 16); ctx.fill();
    ctx.strokeStyle = co ? '#b3201e' : '#f2c44a'; ctx.lineWidth = 4; rrect(ctx, x + 10, y + 10, w - 20, h - 20, 10); ctx.stroke();
    if (co) icon.lantern(ctx, x + 56, y + 70, 70); else icon.envelope(ctx, x + 56, y + 70, 76);
    text(co ? 'CƠ HỘI' : 'KHÍ VẬN', cx + 30, y + 56, 30, co ? '#8a1a14' : '#ffe9a8', 'center', 'bold');
    ctx.font = `bold 20px ${FONT}`;
    wrapLines(ctx, pop.card.txt, w - 60).forEach((l, j) => text(l, cx, y + 132 + j * 28, 20, co ? '#2b1d12' : '#fff8e6', 'center', 'bold'));
    ctx.restore();
    if (!human) messageBox([`${p.name} đọc thẻ...`], cx, my(548), 360);
  }
}
const SPECIAL_INFO: Record<string, (t: Tile) => string[]> = {
  go: () => [`Đi qua hoặc dừng ở đây: nhận lương ${money(tune.salary)}.`],
  jail: () => ['Đứng trên mép ô: chỉ ghé thăm, không sao.', `Ở trong tù: mỗi lượt đổ tìm đôi để ra, hoặc dùng Thẻ Ra Tù. Ở đủ 3 lượt mà không ra đôi thì lượt sau được ra, không mất tiền. Vào tù vì rút thẻ thì lần qua Xuất Phát tới mất lương, trừ khi ra tù bằng Thẻ Ra Tù. Sau 3 lần không ra được thì phải nộp phạt.`],
  free: () => ['Dừng ở đây: lấy hết tiền trong hũ giữa bàn (tiền 2 ô thuế dồn vào hũ).', `Hũ đang có: ${money(state.pot)}.`],
  gojail: () => ['Dừng ở đây: vào thẳng Nhà Tù, không đi qua Xuất Phát, không nhận lương.'],
  co: () => ['Rút một thẻ Cơ Hội: thường là đi tới đâu đó (về Xuất Phát, bay đi du lịch, lùi lại...), đôi khi được tiền hoặc bị phạt.'],
  kv: () => ['Rút một thẻ Khí Vận (bao lì xì): thường là được tiền hoặc mất tiền: lì xì, sinh nhật, khám răng, trúng số...'],
  tax: (t: Tile) => [t.kind === 'income' ? `Trả cố định ${money(tune.income_tax)}. Tiền vào hũ giữa bàn.` : `Chọn trả ${Math.round(tune.prop_tax_pct * 100)}% tiền mặt đang có hoặc ${money(tune.prop_tax_flat)}. Tiền vào hũ giữa bàn.`, 'Vòng đầu (chưa qua Xuất Phát lần nào): được miễn.'],
};
function drawInspect() {
  if (inspect < 0 || scene !== 'play') return;
  const i = inspect, t = TILES[i];
  ctx.save(); ctx.fillStyle = 'rgba(10,5,3,0.45)'; ctx.fillRect(0, 0, L.phone ? W : BW, H); ctx.restore();
  if (OWNABLE(t)) {
    tileCard(i, L.cx, L.popCy);
    if (state.owner[i] >= 0 && !state.mort[i]) text(`Hiện thu: ${t.t === 'util' ? 'tổng xúc xắc × ' + money(rentOf(i, 1)) : money(rentOf(i, 7))}${t.t === 'prop' && ownsGroup(state.owner[i], t.g!) ? ' (đủ nhóm)' : ''}`, L.cx, L.popCy + 198, 17, '#fff8e6', 'center', 'bold');
  } else {
    const w = 440; ctx.font = `17px ${FONT}`;
    const infoLines = SPECIAL_INFO[t.t](t).flatMap((para: string) => wrapLines(ctx, para, w - 50));
    const h = Math.max(300, 190 + infoLines.length * 24), x = L.cx - w / 2, y = Math.max(L.by + 10, L.popCy - 10 - h / 2);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; rrect(ctx, x + 6, y + 8, w, h, 14); ctx.fill();
    ctx.fillStyle = '#fbf3df'; rrect(ctx, x, y, w, h, 14); ctx.fill(); ctx.strokeStyle = '#5a3d2b'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#5a3d2b'; rrect(ctx, x + 10, y + 10, w - 20, 60, 8); ctx.fill();
    text(t.n, L.cx, y + 40, 26, '#fff8e6', 'center', 'bold');
    const draw = ({ co: 'lantern', kv: 'envelope', tax: 'coins', go: 'arrow', jail: 'bars', free: 'palm', gojail: 'cap' } as Record<string, string>)[t.t];
    if (draw === 'arrow') icon.arrow(ctx, L.cx, y + 115, 70, Math.PI); else (icon as Loose)[draw](ctx, L.cx, y + 115, 70);
    let yy = y + 175;
    for (const ln of infoLines) { text(ln, L.cx, yy, 17, '#2b1d12'); yy += 24; }
    ctx.restore();
  }
  const here = state.players.filter(p => !p.bankrupt && p.pos === i).map(p => p.name);
  if (here.length) text(`Đang đứng ở đây: ${here.join(', ')}`, L.cx, L.phone ? L.by + 20 : 140, 16, '#fff8e6', 'center', 'bold');
  drawingInspect = true; ui.forEach(b => { if (b.role === 'close') drawButton(b); }); drawingInspect = false;
}
function drawFloaters() {
  for (const f of state.floaters) {
    const u = f.t / 1.4, a = 1 - u;
    let x, y;
    if (f.row !== undefined) { const r = rowSpot(f.row); x = r.x; y = r.y - u * 26; }
    else { const s = project(f.world.x, f.world.y, f.world.z); x = s.x; y = s.y - u * 50; }
    ctx.save(); ctx.globalAlpha = Math.max(0, a);
    ctx.font = `bold 18px ${FONT}`; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.textAlign = f.row !== undefined ? 'right' : 'center'; ctx.textBaseline = 'middle';
    ctx.strokeText(f.s, x, y); ctx.fillStyle = f.color; ctx.fillText(f.s, x, y);
    ctx.restore();
  }
}

// ---- The phone layout's own pieces: header, players, the button strip, the property sheet --------
/** Where a player's money shows: floaters rise from there. */
function rowSpot(pi: number): { x: number; y: number } {
  if (!L.phone) return { x: PX + PW - 26, y: 76 + pi * 72 + 40 };
  const c = phoneCard(pi);
  return { x: c.x + c.w - 10, y: c.y + 40 };
}
/** A player's card on the phone: two columns, two rows, under the board. */
function phoneCard(pi: number): { x: number; y: number; w: number; h: number } {
  return { x: 8 + (pi % 2) * 236, y: L.by + L.bh + 34 + Math.floor(pi / 2) * 64, w: 228, h: 58 };
}
/** The header, the log line, the players and the strip behind the buttons. */
function drawPhoneChrome() {
  lacquer(0, 0, W, L.by);
  text('TỶ PHÚ ĐẤT VIỆT', 14, L.by / 2, 19, '#f2c44a', 'left', 'bold');
  const roundTxt = state.mode === 'rounds' ? `Vòng ${Math.min(state.round, tune.max_rounds)}/${tune.max_rounds}` : `Vòng ${state.round}`;
  text(roundTxt + (roomCode ? ` · ${roomCode}` : ''), W - 64, L.by / 2, 15, '#e8d9b5', 'right');
  const top = L.by + L.bh;
  lacquer(0, top, W, H - top);
  const last = state.log[state.log.length - 1] || '';
  ctx.save(); ctx.font = `14px ${FONT}`;
  let line = last;
  while (line.length > 4 && ctx.measureText(line).width > W - 24) line = line.slice(0, -2);
  if (line !== last) line = line.slice(0, -1) + '…';
  ctx.restore();
  text(line, 12, top + 17, 14, '#e8d9b5', 'left');
  state.players.forEach((p, pi) => {
    const c = phoneCard(pi), cur = pi === state.cur && state.phase !== 'over';
    ctx.save(); ctx.globalAlpha = p.bankrupt ? 0.45 : 1;
    ctx.fillStyle = cur ? '#5a2a1c' : '#2c140f'; rrect(ctx, c.x, c.y, c.w, c.h, 10); ctx.fill();
    ctx.strokeStyle = cur ? '#f2c44a' : '#6a4a2a'; ctx.lineWidth = cur ? 3 : 1; ctx.stroke();
    ctx.fillStyle = p.color; rrect(ctx, c.x, c.y, 7, c.h, 4); ctx.fill();
    ctx.fillStyle = '#f4ead2'; ctx.beginPath(); ctx.arc(c.x + 30, c.y + c.h / 2, 19, 0, 7); ctx.fill();
    drawTokenIcon(p.token, c.x + 30, c.y + c.h / 2 + 2, 32, p.color);
    let name = p.name;
    ctx.font = `bold 16px ${FONT}`;
    while (name.length > 3 && ctx.measureText(name).width > c.w - 64) name = name.slice(0, -1);
    ctx.restore();
    ctx.save(); ctx.globalAlpha = p.bankrupt ? 0.45 : 1;
    text(name, c.x + 56, c.y + 18, 16, '#fff8e6', 'left', 'bold');
    text(money(p.cash), c.x + 56, c.y + 40, 16, p.cash < 0 ? '#ff8a7a' : '#f2c44a', 'left', 'bold');
    const tag = p.bankrupt ? 'phá sản' : p.inJail ? 'trong tù' : p.kind === 'remote' && p.offline ? 'mất mạng' : `${owned(pi).length} ô`;
    text(tag, c.x + c.w - 8, c.y + 18, 13, '#d9c8a6', 'right');
    ctx.restore();
  });
}
/** Phone: the button that opens the property sheet, under the turn's buttons. */
function buildSheetButton(pi: number) {
  btn(L.cx - 110, L.btnY + 64, 220, 44, `Tài sản (${owned(pi).length})`, () => { sheetOpen = true; propScroll = 0; }, '', true, '#6a4a2a');
}
const SHEET = { x: 10, y: 60, w: 460, rowY: 120, rowH: 46, rows: 15 };
/** Phone: the property sheet's buttons: sell, mortgage, unmortgage on the player's turn; a row's name opens its card. */
function buildSheetUI(pi: number) {
  const mine = owned(pi), p = state.players[pi];
  const act = humanTurn() && ['roll', 'end', 'debt', 'jail'].includes(state.phase);
  propScroll = Math.max(0, Math.min(propScroll, mine.length - SHEET.rows));
  mine.slice(propScroll, propScroll + SHEET.rows).forEach((i, r) => {
    const y = SHEET.rowY + r * SHEET.rowH;
    btn(SHEET.x + 4, y, 300, SHEET.rowH - 4, '', () => { inspect = i; }, 'hidden');
    if (!act) return;
    if (state.level[i] > 0) btn(SHEET.x + SHEET.w - 126, y + 4, 118, SHEET.rowH - 12, 'Bán 1 cấp', () => sellLevel(pi, i), 'row', true, undefined, `sell:${i}`);
    else if (state.mort[i]) btn(SHEET.x + SHEET.w - 126, y + 4, 118, SHEET.rowH - 12, 'Chuộc', () => unmortgage(pi, i), 'row', p.cash >= TILES[i].p! * tune.unmortgage_pct, undefined, `unmort:${i}`);
    else btn(SHEET.x + SHEET.w - 126, y + 4, 118, SHEET.rowH - 12, 'Cầm cố', () => mortgage(pi, i), 'row', true, undefined, `mort:${i}`);
  });
  const bottom = SHEET.rowY + SHEET.rows * SHEET.rowH + 8;
  if (mine.length > SHEET.rows) {
    btn(SHEET.x + 20, bottom, 120, 44, 'up', () => { propScroll = Math.max(0, propScroll - SHEET.rows); }, 'arrowUp', propScroll > 0);
    btn(SHEET.x + SHEET.w - 140, bottom, 120, 44, 'down', () => { propScroll += SHEET.rows; }, 'arrowDown', propScroll + SHEET.rows < mine.length);
  }
  btn(L.cx - 110, bottom + 56, 220, 52, 'Đóng', () => { sheetOpen = false; }, 'secondary', true, '#6a4a2a');
}
/** Phone: the property sheet itself, under its buttons. */
function drawSheet() {
  const pi = state.cur, p = curP(), mine = owned(pi);
  const h = SHEET.rowY + SHEET.rows * SHEET.rowH + 130 - SHEET.y;
  ctx.save(); ctx.fillStyle = 'rgba(10,5,3,0.6)'; ctx.fillRect(0, 0, W, H); ctx.restore();
  lacquer(SHEET.x, SHEET.y, SHEET.w, h);
  text(humanTurn() ? 'Tài sản của bạn' : `Tài sản của ${p.name}`, SHEET.x + SHEET.w / 2, SHEET.y + 30, 20, '#f2c44a', 'center', 'bold');
  if (!mine.length) text('Chưa có ô đất nào.', SHEET.x + SHEET.w / 2, SHEET.rowY + 30, 17, '#d9c8a6');
  mine.slice(propScroll, propScroll + SHEET.rows).forEach((i, r) => {
    const y = SHEET.rowY + r * SHEET.rowH, t = TILES[i];
    ctx.fillStyle = r % 2 ? '#2c140f' : '#34180f'; ctx.fillRect(SHEET.x + 8, y, SHEET.w - 16, SHEET.rowH - 4);
    ctx.fillStyle = t.t === 'prop' ? GROUPS[t.g!].color : '#9a8a6a'; ctx.fillRect(SHEET.x + 16, y + 11, 16, 20);
    text(t.n, SHEET.x + 42, y + 21, 17, state.mort[i] ? '#9a8a7a' : '#fff8e6', 'left');
    const tag = state.mort[i] ? 'cầm cố' : LEVEL_SHORT[state.level[i]];
    if (tag) text(tag, SHEET.x + 262, y + 21, 15, state.mort[i] ? '#ff9a8a' : '#7ee08a', 'center', 'bold');
  });
}

/** Where the title screen's buttons sit, wide or phone. */
function titleSpots() {
  return L.phone
    ? { seatX: 246, seatW: 226, seatH: 52, y0: 178, step: 64, modeDy: 8, start: [16, 560, 448, 60], online: [16, 632, 448, 56], leave: [16, 600, 448, 60] }
    : { seatX: BW / 2 - 20, seatW: 300, seatH: 50, y0: 250, step: 62, modeDy: 10, start: [BW / 2 - 290, 600, 280, 60], online: [BW / 2 + 10, 600, 280, 60], leave: [BW / 2 - 140, 600, 280, 60] };
}
/** Phone: the title screen, one column. */
function drawTitlePhone() {
  clear('#1d120c');
  drawBoardView();
  ctx.fillStyle = 'rgba(20,10,6,0.86)'; ctx.fillRect(0, 0, W, H);
  const T = titleSpots();
  text(TITLE.toUpperCase(), W / 2, 58, 34, '#f2c44a', 'center', 'bold');
  text('Cờ tỷ phú trên bản đồ Việt Nam · 2 đến 4 người', W / 2, 96, 15, '#e8d9b5');
  const hint = isGuest() ? (lobby ? `Phòng ${roomCode} · chờ ${lobby.hostName || 'chủ phòng'} bắt đầu ván` : `Đang vào phòng ${roomCode}...`)
    : isHost() ? `Gửi mã ${roomCode} cho bạn bè: họ sẽ vào chỗ "Chờ bạn online"` : 'Bấm từng chỗ ngồi để đổi người chơi';
  ctx.font = `15px ${FONT}`;
  wrapLines(ctx, hint, W - 40).slice(0, 2).forEach((l, j) => text(l, W / 2, 130 + j * 20, 15, isGuest() || isHost() ? '#f2c44a' : '#cbb994'));
  const seatsShown: Seat[] = isGuest() ? (lobby ? lobby.seats : []) : setup.seats;
  seatsShown.forEach((s, i) => {
    const y = T.y0 + i * T.step, cy = y + T.seatH / 2;
    ctx.fillStyle = '#f4ead2'; ctx.beginPath(); ctx.arc(34, cy, 22, 0, 7); ctx.fill();
    drawTokenIcon(i, 34, cy + 2, 36, PLAYER_COLORS[i]);
    text(`${PLAYER_COLOR_NAMES[i]} · ${TOKEN_NAMES[i]}`, 64, cy, 16, s.kind === 'off' ? '#7a6a5a' : '#fff8e6', 'left', 'bold');
    if (isGuest()) {
      ctx.save(); ctx.fillStyle = i === mySeat ? '#5a2a1c' : '#2c140f'; rrect(ctx, T.seatX, y, T.seatW, T.seatH, 12); ctx.fill();
      ctx.strokeStyle = i === mySeat ? '#f2c44a' : '#6a4a2a'; ctx.lineWidth = i === mySeat ? 3 : 1; ctx.stroke(); ctx.restore();
      text(seatLabel(s) + (i === mySeat ? ' (bạn)' : ''), T.seatX + T.seatW / 2, cy, 15, '#fff8e6', 'center', 'bold');
    }
  });
  const modeY = T.y0 + 4 * T.step + T.modeDy + T.seatH / 2;
  text('Kiểu ván', 64, modeY, 16, '#fff8e6', 'left', 'bold');
  if (isGuest() && lobby) text(lobby.mode === 'rounds' ? `${tune.max_rounds} vòng` : 'Tới khi phá sản', T.seatX + T.seatW / 2, modeY, 15, '#fff8e6', 'center', 'bold');
  ui.forEach(drawButton);
  if (roomCode) {
    ctx.save(); ctx.fillStyle = '#5a2a1c'; rrect(ctx, 60, 712, W - 120, 96, 14); ctx.fill(); ctx.strokeStyle = '#f2c44a'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
    text('MÃ PHÒNG', W / 2, 734, 15, '#e8d9b5', 'center', 'bold');
    text(roomCode, W / 2, 776, 42, '#f2c44a', 'center', 'bold');
  }
  const tips = ['Giữ nút để lắc xúc xắc, thả ra để ném.', 'Chạm vào một ô trên bàn cờ để xem thông tin.', 'Dẫm lại đất của mình: xây thêm 1 cấp.'];
  tips.forEach((t, j) => text(t, W / 2, 846 + j * 26, 14, '#cbb994'));
  drawNetBanner();
}
/** Phone: the end of the game, one column. */
function drawResultsPhone() {
  clear('#1d120c');
  drawBoardView();
  ctx.fillStyle = 'rgba(20,10,6,0.7)'; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.fillStyle = 'rgba(30,12,8,0.94)'; rrect(ctx, 10, 60, W - 20, 760, 20); ctx.fill(); ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
  for (let k = 0; k < 30; k++) { // a fanfare of drawn confetti
    const x = 30 + ((k * 137) % (W - 60)), y = 70 + ((k * 53 + state.t * 90 * (1 + k % 3)) % 740);
    ctx.fillStyle = PLAYER_COLORS[k % 4]; ctx.save(); ctx.translate(x, y); ctx.rotate(k + state.t * 3); ctx.fillRect(-5, -2, 10, 4); ctx.restore();
  }
  const w = state.players[state.ranking![0].i];
  ctx.font = `16px ${FONT}`;
  wrapLines(ctx, state.reason || '', W - 60).forEach((l, j) => text(l, W / 2, 100 + j * 22, 16, '#e8d9b5'));
  ctx.fillStyle = '#f4ead2'; ctx.beginPath(); ctx.arc(W / 2, 185, 44, 0, 7); ctx.fill();
  drawTokenIcon(w.token, W / 2, 188, 72, w.color);
  ctx.font = `bold 26px ${FONT}`;
  wrapLines(ctx, state.gained, W - 50).forEach((l, j) => text(l, W / 2, 262 + j * 32, 26, '#f2c44a', 'center', 'bold'));
  state.ranking!.forEach((r, j) => {
    const p = state.players[r.i], y = 350 + j * 62;
    ctx.fillStyle = j === 0 ? '#5a2a1c' : '#2c140f'; rrect(ctx, 26, y - 26, W - 52, 54, 8); ctx.fill();
    text(`${j + 1}.`, 48, y, 20, '#f2c44a', 'center', 'bold');
    ctx.fillStyle = p.color; ctx.fillRect(66, y - 12, 10, 24);
    text(p.name, 86, y - 10, 17, '#fff8e6', 'left', 'bold');
    text(r.bankrupt ? 'Phá sản' : `Tài sản ${money(r.worth)}`, 86, y + 13, 15, r.bankrupt ? '#ff9a8a' : '#e8d9b5', 'left');
  });
  if (isGuest()) text('Chờ chủ phòng bắt đầu ván mới...', W / 2, 866, 17, '#e8d9b5');
  ui.forEach(drawButton);
  drawNetBanner();
}

// ---- Scenes ------------------------------------------------------------------------------
const scenes: Record<string, { update(dt: number): void; draw(): void }> = {
  figures: {
    update(dt: number) { state.t += dt; },
    draw() {
      clear('#2a1a10');
      render3D(); ctx.drawImage(renderer!.domElement, 0, 0, BW, H);
      for (const it of figItems) { const s = project(it.x, 0, it.z + 0.42, figCamera); text(it.name, s.x, s.y, 16, '#fff8e6', 'center', 'bold'); }
      lacquer(PX, 0, PW, H);
      text('Quân cờ, nhà và Landmark', PX + PW / 2, 40, 20, '#f2c44a', 'center', 'bold');
      TOKEN_NAMES.forEach((n, k) => { drawTokenIcon(k, PX + 60, 110 + k * 70, 44, PLAYER_COLORS[k]); text(n, PX + 100, 110 + k * 70, 18, '#fff8e6', 'left'); });
    },
  },
  title: {
    update(dt: number) { state.t += dt; buildUI(); handleInput(); },
    draw() {
      if (L.phone) { drawTitlePhone(); return; }
      clear('#1d120c');
      drawBoardView();
      ctx.fillStyle = 'rgba(20,10,6,0.55)'; ctx.fillRect(0, 0, BW, H);
      ctx.save(); ctx.fillStyle = 'rgba(30,12,8,0.9)'; rrect(ctx, BW / 2 - 330, 40, 660, 640, 20); ctx.fill(); ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
      text(TITLE.toUpperCase(), BW / 2, 100, 50, '#f2c44a', 'center', 'bold');
      text('Cờ tỷ phú trên bản đồ Việt Nam · 2 đến 4 người', BW / 2, 150, 19, '#e8d9b5');
      const hint = isGuest() ? (lobby ? `Phòng ${roomCode} · chờ ${lobby.hostName || 'chủ phòng'} bắt đầu ván` : `Đang vào phòng ${roomCode}...`)
        : isHost() ? `Gửi mã phòng ${roomCode} cho bạn bè: họ sẽ vào chỗ "Chờ bạn online"` : 'Bấm từng chỗ ngồi để đổi: Người chơi, Máy (Dễ, Vừa, Khó), Không chơi';
      text(hint, BW / 2, 200, 16, isGuest() || isHost() ? '#f2c44a' : '#cbb994');
      const seatsShown: Seat[] = isGuest() ? (lobby ? lobby.seats : []) : setup.seats;
      if (isGuest()) seatsShown.forEach((s, i) => { // a guest sees the seats, not their buttons
        const y = 250 + i * 62;
        ctx.save(); ctx.fillStyle = i === mySeat ? '#5a2a1c' : '#2c140f'; rrect(ctx, BW / 2 - 20, y, 300, 50, 12); ctx.fill();
        ctx.strokeStyle = i === mySeat ? '#f2c44a' : '#6a4a2a'; ctx.lineWidth = i === mySeat ? 3 : 1; ctx.stroke(); ctx.restore();
        text(seatLabel(s) + (i === mySeat ? ' (bạn)' : ''), BW / 2 + 130, y + 26, 18, '#fff8e6', 'center', 'bold');
      });
      if (isGuest() && lobby) text(lobby.mode === 'rounds' ? `${tune.max_rounds} vòng, giàu nhất thắng` : 'Tới khi phá sản', BW / 2 + 130, 250 + 4 * 62 + 35, 18, '#fff8e6', 'center', 'bold');
      seatsShown.forEach((s, i) => {
        const y = 250 + i * 62 + 25;
        ctx.fillStyle = '#f4ead2'; ctx.beginPath(); ctx.arc(BW / 2 - 300 + 40, y, 24, 0, 7); ctx.fill();
        drawTokenIcon(i, BW / 2 - 300 + 40, y + 2, 40, PLAYER_COLORS[i]);
        text(`${PLAYER_COLOR_NAMES[i]} · ${TOKEN_NAMES[i]}`, BW / 2 - 300 + 76, y, 20, s.kind === 'off' ? '#7a6a5a' : '#fff8e6', 'left', 'bold');
      });
      text('Kiểu ván', BW / 2 - 300 + 76, 250 + 4 * 62 + 35, 20, '#fff8e6', 'left', 'bold');
      ui.forEach(drawButton);
      drawNetBanner();
      lacquer(PX, 0, PW, H);
      text('Cách chơi', PX + PW / 2, 44, 24, '#f2c44a', 'center', 'bold');
      const rules = ['Đổ 2 xúc xắc, đi quân, mua đất trống.', 'Vòng đầu (tới khi qua Xuất Phát):', '   chưa mua đất, miễn thuế.', 'Bấm vào một ô bất kỳ để xem thông tin.', 'Dẫm lại đất của mình: xây thêm 1 cấp.', 'Cấp xây: Nhà 1 tới Nhà 4, Khách sạn, Landmark.', 'Gom đủ một nhóm màu: tiền thuê × 2.', 'Tiền 2 ô thuế dồn vào hũ giữa bàn.', 'Dừng ở Bến Đỗ Tự Do: lấy cả hũ.', 'Thiếu tiền: bán nhà, cầm cố đất.', 'Hết tiền: phá sản, bị loại.'];
      rules.forEach((r, j) => text(r, PX + 24, 86 + j * 29, 16, '#e8d9b5', 'left'));
      text('Phím', PX + PW / 2, 420, 22, '#f2c44a', 'center', 'bold');
      CONTROLS.forEach((c, i) => text(c, PX + 24, 460 + i * 32, 16, '#e8d9b5', 'left'));
      if (roomCode) { // the room code, big enough to read out to a friend
        ctx.save(); ctx.fillStyle = '#5a2a1c'; rrect(ctx, PX + 20, 590, PW - 40, 100, 14); ctx.fill(); ctx.strokeStyle = '#f2c44a'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
        text('MÃ PHÒNG', PX + PW / 2, 612, 16, '#e8d9b5', 'center', 'bold');
        text(roomCode, PX + PW / 2, 655, 44, '#f2c44a', 'center', 'bold');
      }
    },
  },
  play: {
    update(dt: number) {
      if (!isGuest()) state.t += dt;
      buildUI(); handleInput();
      if (scene !== 'play') return;
      { // the tile under the mouse lights up and the cursor says it can be clicked
        const onBtn = ui.some(b => b.role !== 'hidden' && pointer.x >= b.x && pointer.x <= b.x + b.w && pointer.y >= b.y && pointer.y <= b.y + b.h);
        const pt = inBoard(pointer.x, pointer.y) && !onBtn ? boardPointAt(pointer.x, pointer.y) : null;
        hoverTile = pt ? tileAt(pt.x, pt.z) : -1;
        canvas.style.cursor = hoverTile >= 0 || onBtn ? 'pointer' : 'default';
      }
      if (isGuest()) { updateTokens(dt); syncBuildings(dt); return; } // the host runs the turns
      updateTurn(dt);
      updateTokens(dt); syncBuildings(dt);
      state.flash.t += dt;
      for (const f of state.floaters) f.t += dt;
      state.floaters = state.floaters.filter(f => f.t < 1.4);
    },
    draw() {
      clear('#1d120c');
      drawBoardView();
      if (L.phone) drawPhoneChrome(); else drawLog();
      drawPotLabel();
      drawDiceFeel();
      drawPopup();
      if (!L.phone) drawPanel();
      if (sheetOpen) drawSheet();
      ui.forEach(drawButton);
      drawFloaters();
      drawInspect();
      drawNetBanner();
    },
  },
  results: {
    update(dt: number) {
      if (!isGuest()) state.t += dt;
      buildUI(); handleInput();
      updateTokens(dt); syncBuildings(dt);
      if (isGuest()) return;
      for (const f of state.floaters) f.t += dt; state.floaters = state.floaters.filter(f => f.t < 1.4);
    },
    draw() {
      if (L.phone) { drawResultsPhone(); return; }
      clear('#1d120c');
      drawBoardView();
      ctx.fillStyle = 'rgba(20,10,6,0.55)'; ctx.fillRect(0, 0, BW, H);
      ctx.save(); ctx.fillStyle = 'rgba(30,12,8,0.94)'; rrect(ctx, BW / 2 - 320, 70, 640, 580, 20); ctx.fill(); ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
      // a fanfare of drawn confetti
      for (let k = 0; k < 40; k++) {
        const x = BW / 2 - 300 + ((k * 137) % 600), y = 80 + ((k * 53 + state.t * 90 * (1 + k % 3)) % 560);
        ctx.fillStyle = PLAYER_COLORS[k % 4]; ctx.save(); ctx.translate(x, y); ctx.rotate(k + state.t * 3); ctx.fillRect(-5, -2, 10, 4); ctx.restore();
      }
      const w = state.players[state.ranking![0].i];
      text(state.reason || '', BW / 2, 112, 18, '#e8d9b5');
      ctx.fillStyle = '#f4ead2'; ctx.beginPath(); ctx.arc(BW / 2, 185, 44, 0, 7); ctx.fill();
      drawTokenIcon(w.token, BW / 2, 188, 72, w.color);
      text(state.gained, BW / 2, 262, 30, '#f2c44a', 'center', 'bold');
      state.ranking!.forEach((r, j) => {
        const p = state.players[r.i], y = 320 + j * 50;
        ctx.fillStyle = j === 0 ? '#5a2a1c' : '#2c140f'; rrect(ctx, BW / 2 - 260, y - 20, 520, 42, 8); ctx.fill();
        text(`${j + 1}.`, BW / 2 - 236, y, 20, '#f2c44a', 'center', 'bold');
        ctx.fillStyle = p.color; ctx.fillRect(BW / 2 - 214, y - 10, 12, 20);
        text(p.name, BW / 2 - 194, y, 19, '#fff8e6', 'left', 'bold');
        text(r.bankrupt ? 'Phá sản' : `Tài sản ${money(r.worth)}`, BW / 2 + 246, y, 18, r.bankrupt ? '#ff9a8a' : '#e8d9b5', 'right');
      });
      ui.forEach(drawButton);
      drawPanel();
    },
  },
};
function updateTurn(dt: number) {
  const p = curP();
  state.timer += dt;
  if (state.diceShow) state.diceShow.t += dt;
  if (state.shaking) {
    const sh = state.shaking; sh.t += dt; sh.rattle -= dt;
    if (sh.rattle <= 0) { sfx.rattle(sh.t); sh.rattle = 0.09; }
    const held = sh.ai ? sh.t < sh.holdFor : sh.remote ? !sh.released && peerOnline(p.peer) : (pointerHeld || down.has('Space') || down.has('Enter'));
    if (!held || sh.t > tune.shake_max_time) throwDice();
    return;
  }
  if (state.phase === 'dice') {
    state.diceT += dt;
    if (state.diceT >= state.diceDur!) afterDice();
    return;
  }
  if (state.diceT < (state.diceDur || tune.dice_time)) state.diceT += dt;
  if (state.phase === 'move') {
    const hopDur = state.hopFast ? tune.hop_time * 0.6 : tune.hop_time;
    state.hopT += dt;
    if (state.hopT >= hopDur) {
      state.hopT = 0;
      const pi = state.cur, from = p.pos;
      p.pos = (p.pos + state.moveDir + 40) % 40;
      hop(pi, from, p.pos, hopDur * 0.95);
      sfx.tick();
      if (p.pos === 0 && state.moveDir > 0) p.laps++;
      if (p.pos === 0 && state.moveDir > 0 && p.noSalary) { p.noSalary = false; floatAtToken(pi, 'Mất lương!', '#ff5a4a'); log(`${p.name} qua Xuất Phát nhưng không được nhận lương (thẻ vào tù).`); sfx.pay(); }
      else if (p.pos === 0 && state.moveDir > 0) gain(pi, tune.salary, `${p.name} qua Xuất Phát: nhận lương ${money(tune.salary)}.`);
      state.moveLeft--;
      if (state.moveLeft <= 0) { state.phase = 'landing'; state.timer = 0; }
    }
    return;
  }
  if (state.phase === 'landing') { if (state.timer >= 0.25) resolveLanding(); return; }
  const auto = isAI(p) || (p.kind === 'remote' && !peerOnline(p.peer));
  if (auto && state.phase !== 'over' && state.timer >= tune.ai_delay) { state.timer = 0; aiAct(); }
}

// ---- Loop: fixed step, frame time clamped ---------------------------------------------
function step() {
  if (pressed('KeyM')) { setMuted(!muted()); hit.delete('KeyM'); }
  scenes[scene].update(STEP); netStep(); hit.clear();
}
let last = 0, acc = 0, ALPHA = 1;
function tick() {
  const now = clock.now();
  acc += Math.min(now - last, isHost() ? 1 : 0.25); last = now;
  while (acc >= STEP) { step(); acc -= STEP; }
  ALPHA = acc / STEP;
  drawFrame();
}
function drawFrame() { scenes[scene].draw(); }
function frame() { tick(); requestAnimationFrame(frame); }
function timer() { if ((document.visibilityState === 'visible' || isHost()) && clock.now() - last > 0.1) tick(); }

// ---- What a check can read and drive (?manual=1 stops the loop; players never see it) ----
install({
  get scene() { return scene; },
  get state() { return state; },
  press(code: string) { hit.add(code); },
  hold(code: string, on: boolean) { if (on) down.add(code); else down.delete(code); },
  get events() { return events; },
  step(n = 1, draw = true, alpha = 1) {
    for (let i = 0; i < n; i++) step();
    if (draw) { ALPHA = alpha; drawFrame(); }
  },
} as Parameters<typeof install>[0]);

fit();
build3D();
reset();
scene = params.get('scene') || 'title';
if (scene === 'play') clearVis();
last = clock.now();
if (params.get('manual') === '1') drawFrame();
else { requestAnimationFrame(frame); setInterval(timer, 50); }
