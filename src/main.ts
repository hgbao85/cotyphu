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
import { GROUPS, TILES, OWNABLE, LEVEL_NAMES, LEVEL_SHORT, MAX_LEVEL, PLAYER_COLORS, ANIMALS, DEFAULT_ANIMALS, AI_LEVELS, CARDS, EVENTS } from './game/data';
import { makeAnimal, drawAnimalIcon } from './animals';
import { HALF, CORNER, BAND, BOARD_TOP, L as BOARD_SIZE, tileInfo, tileAt, tokenSpot } from './game/board';
import * as R from './game/rules';
import { cleanChat } from './game/chat';
import { mat, canvasTex, woodTexture, mesh } from './three/materials';
import { icon, star } from './draw/icons';
import { boardTexture, pipTexture } from './three/boardTexture';
import { makeHouse, makeHotel, makeLandmark } from './three/buildings';
import { showRules, showHistory } from './ui/pages';
import { showChat, setChatSender } from './ui/chatBox';
import { money } from './game/rules';
import type { DeckKind, GameState, KeepAct, Loose, Player, Seat, Tile } from './game/types';

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
let checkSeed: number | null = null; // a seed a check set for the next games (window.game.configure)

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
let roomCode = '', myName = '', mySeat = -1, myPeerId = -1;
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
  onRoom(code, id) {
    roomCode = code; myPeerId = id; netError = '';
    rememberRoom(code, isHost() ? 'host' : 'guest');
    if (isHost() && pendingRestore) { pendingRestore = false; restoreHostGame(code); }
    if (isHost()) sendLobby();
  },
  onPeer(id, name, online, left) {
    if (left) { peerLeft(id, name); return; }
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
  onClosed() { goOffline('Chủ phòng đã giải tán phòng chơi.'); },
  onLink(up) { linkUp = up; },
  onError(msg) { netError = msg; roomCode = ''; forgetRoom(); showOnlinePanel(true); },
};

/** Host: a new friend takes the first empty or computer seat (seat 0 is the host's). */
function seatPeer(id: number, name: string) {
  // a friend whose seat is already theirs (a host who came back with the room as it was) keeps it
  if (setup.seats.some(st => st.kind === 'remote' && st.peer === id) || (scene !== 'title' && state.players.some(q => q.peer === id))) return;
  if (scene !== 'title') {
    const free = (q: Player): boolean => !q.bankrupt && ((q.kind === 'remote' && !peerOnline(q.peer)) || (q.kind === 'ai' && !!q.wasRemote));
    const p = state.players.find(q => free(q) && q.name === name)
      || state.players.find(q => free(q) && (q.peer === undefined || q.wasRemote));
    if (!p) { net.toOne(id, { k: 'full', msg: 'Ván đang chơi: bạn đang xem, chờ ván sau nhé.' }); return; }
    p.kind = 'remote'; p.peer = id; p.offline = false; p.wasRemote = false; p.name = name;
    setup.seats[p.id] = { kind: 'remote', peer: id, name };
    log(`${name} đã vào lại ghế ${ANIMALS[p.token].name}.`);
    return;
  }
  // a seat the host left waiting for a friend first, then the earliest seat that is a computer's or empty
  const order = [1, 2, 3];
  let i = order.find(k => setup.seats[k].kind === 'remote' && setup.seats[k].peer === undefined);
  if (i === undefined) i = order.find(k => setup.seats[k].kind === 'ai' || setup.seats[k].kind === 'off');
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
  net.toAll({ k: 'lobby', code: roomCode, mode: setup.mode, rounds: setup.rounds, teams: setup.teams, teamOf: [...setup.teamOf], hostName: myName, seats: setup.seats.map(s => ({ ...s })), animals: [...setup.animals] });
  for (const id of peers.keys()) sendYou(id);
}

/** Host: a friend pressed a button. Only their own turn's buttons count, checked as for a press here. */
function onGuestAct(from: number, a: Loose) {
  if (scene === 'title' && a.act === 'animal') { const i = setup.seats.findIndex(st => st.kind === 'remote' && st.peer === from); if (i > 0) nextAnimal(i); return; }
  if (scene === 'title' && a.act === 'animalSet') { const i = setup.seats.findIndex(st => st.kind === 'remote' && st.peer === from); if (i > 0) setAnimal(i, a.i); return; }
  if ((scene === 'play' || scene === 'results') && state.players && state.players.some(q => q.peer === from)) {
    if (a.act === 'voteStart') { hostStartVote('p' + from); return; }
    if (a.act === 'vote:yes' || a.act === 'vote:no') { hostCastVote('p' + from, a.act === 'vote:yes'); return; }
  }
  if (scene === 'play' && state.players && a.act === 'emote') { const q = state.players.find(x => x.peer === from); if (q) hostEmote(q.id, a.i); return; }
  if (scene === 'play' && state.players && a.act === 'chat') { const q = state.players.find(x => x.peer === from); if (q) hostChat(q.id, a.text); return; }
  if (a.act === 'history' && state.players) { net.toOne(from, { k: 'history', list: state.history || [] }); return; }
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
  else if (d.k === 'history') showHistory(d.list || []);
  else if (d.k === 'lobby') { if (lobby && mySeat > 0 && lobby.animals && d.animals && lobby.animals[mySeat] !== d.animals[mySeat]) rawSfx.animal(d.animals[mySeat]); lobby = d; if (scene !== 'title') { scene = 'title'; clearVis(); } }
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
    voteStep(STEP);
    if (state.emotes) { for (const e of state.emotes) e.t += STEP; state.emotes = state.emotes.filter(e => e.t < bubbleLife(e)); }
    keepHostGame();
    for (const p of state.players) if (p.kind === 'remote') p.offline = !peerOnline(p.peer);
    if (++sendEvery >= 3 || pendingSfx.length) { // about 20 times a second, at once when a sound plays
      sendEvery = 0;
      const { history: _h, ...shared } = state; // the history is long: a friend asks for it when they open it
      net.toAll({ k: 'state', scene, state: shared, sfx: pendingSfx });
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
      pendingRestore = false; store()?.removeItem('tpdv-host-game');
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
    d.addEventListener('pointerdown', e => e.stopPropagation()); // a press on the panel never reaches a button under it
  }
  const setErr = (m: string) => { (onlinePanel!.querySelector('#op-error') as HTMLElement).textContent = m; };
  setErr(netError);
  onlinePanel.style.display = on ? 'flex' : 'none';
}
/** Leaves the room and goes back to playing on this screen. */
/** Leaves the room: a guest frees their seat, a host closes the room for everyone. */
function leaveRoom() {
  if (isGuest()) net.quitRoom(); else if (isHost()) net.closeRoom(); else net.leave();
  goOffline('');
}
/** Back to playing on this screen, with a note on the title screen when there is one. */
function goOffline(note: string) {
  forgetRoom();
  roomCode = ''; mySeat = -1; lobby = null; peers.clear(); netError = note; roomMenu = false;
  setup.seats.forEach((s, i) => { if (s.kind === 'remote') setup.seats[i] = { kind: 'ai', lv: 1 }; });
  scene = 'title'; reset(); clearVis();
}
/** Host: a friend left the room for good. Before a game their seat waits for someone new; in a game
 * the computer plays it from now on. */
function peerLeft(id: number, name: string) {
  peers.delete(id);
  const i = setup.seats.findIndex(s => s.kind === 'remote' && s.peer === id);
  if (i >= 0) setup.seats[i] = { kind: 'remote' };
  if (scene !== 'title' && state && state.players) for (const p of state.players) {
    if (p.peer !== id) continue;
    p.kind = 'ai'; p.lv = 1; delete p.peer; p.offline = false; p.wasRemote = true;
    log(`${name || p.name} đã rời phòng, máy chơi thay.`);
  }
  sendLobby();
}

// ---- Coming back to a room ----------------------------------------------------------------
// The browser remembers the last room for ROOM_MEMORY_MS, so the title screen offers to go back in
// with one press. The host's browser also keeps the game every second, so a host who reloads
// picks the game up where it was. A friend who comes back under the same name gets their seat back.
const ROOM_MEMORY_MS = 30 * 60 * 1000; // the server closes an empty room after the same time
function store(): Storage | null { try { return localStorage; } catch { return null; } }
function rememberRoom(code: string, role: 'host' | 'guest') {
  store()?.setItem('tpdv-room', JSON.stringify({ code, role, at: Date.now() }));
}
function forgetRoom() {
  store()?.removeItem('tpdv-room'); store()?.removeItem('tpdv-host-game');
}
/** The last room, while it can still be open. */
function lastRoom(): { code: string; role: 'host' | 'guest' } | null {
  try {
    const r = JSON.parse(store()?.getItem('tpdv-room') || 'null');
    return r && Date.now() - r.at < ROOM_MEMORY_MS ? r : null;
  } catch { return null; }
}
let pendingRestore = false; // host: put the kept game back once the room is open again
/** Goes back into the last room: a host reopens it (the server knows the host's key), a guest joins it. */
function rejoinRoom() {
  const r = lastRoom();
  if (!r) return;
  myName = net.savedName() || myName || 'Bạn';
  if (r.role === 'host') { peers.clear(); setup.seats[0] = { kind: 'human' }; pendingRestore = true; net.createRoom(myName, handlers); }
  else { mySeat = -1; lobby = null; net.joinRoom(r.code, myName, handlers); }
}
let keepEvery = 0;
/** Host, every second of a game: keeps it in the browser, to pick up after a reload. */
function keepHostGame() {
  if (++keepEvery < 60) return;
  keepEvery = 0;
  try { store()?.setItem('tpdv-host-game', JSON.stringify({ code: roomCode, at: Date.now(), scene, setup, state })); } catch { /* full or blocked: the game just is not kept */ }
}
// ---- A game on one screen, kept: a reload or a closed tab does not lose it ---------------------------
const LOCAL_KEY = 'tpdv-local-game', LOCAL_MEMORY_MS = 7 * 24 * 3600 * 1000;
let keepLocalEvery = 0;
/** Every second or so of a game played on this screen alone, its state goes to this browser's storage. */
function keepLocalGame() {
  if (isHost() || isGuest() || CHEAP || scene !== 'play' || ++keepLocalEvery < 60) return; // online games keep their own way; self-play keeps nothing
  keepLocalEvery = 0;
  try { store()?.setItem(LOCAL_KEY, JSON.stringify({ at: Date.now(), setup, state })); } catch { /* full or blocked: the game just is not kept */ }
}
function forgetLocalGame() { try { store()?.removeItem(LOCAL_KEY); } catch { /* nothing kept */ } }
/** The game left unfinished on this screen, if there is one from the last week: its round, for the button. */
function localGame(): { round: number } | null {
  let g: Loose = null;
  try { g = JSON.parse(store()?.getItem(LOCAL_KEY) || 'null'); } catch { g = null; }
  if (!g || !g.state || !g.state.players || Date.now() - g.at > LOCAL_MEMORY_MS) return null;
  return { round: g.state.round };
}
/** The unfinished game, back on the table where it was left. */
function resumeLocalGame() {
  let g: Loose = null;
  try { g = JSON.parse(store()?.getItem(LOCAL_KEY) || 'null'); } catch { g = null; }
  if (!g || !g.state || !g.state.players) return;
  setup = g.setup;
  if (!Array.isArray(setup.animals) || setup.animals.length !== 4) setup.animals = [...DEFAULT_ANIMALS];
  if (!setup.rounds) setup.rounds = tune.max_rounds;
  setup.teams = !!setup.teams; if (!Array.isArray(setup.teamOf)) setup.teamOf = [0, 1, 0, 1];
  state = g.state; state.vote = undefined; state.shaking = undefined;
  clearVis(); scene = 'play';
  log(`Chơi tiếp ván trước, vòng ${state.round}.`);
}
/** Host: the kept game, back on the table. Friends in a room that was lost with the server come
 * back by name (seatPeer). */
function restoreHostGame(code: string) {
  let g: Loose = null;
  try { g = JSON.parse(store()?.getItem('tpdv-host-game') || 'null'); } catch { g = null; }
  if (!g || Date.now() - g.at > ROOM_MEMORY_MS || !g.state || !g.state.players) return;
  const sameRoom = g.code === code;
  setup = g.setup; if (!Array.isArray(setup.animals) || setup.animals.length !== 4) setup.animals = [...DEFAULT_ANIMALS]; if (!setup.rounds) setup.rounds = tune.max_rounds; state = g.state; scene = g.scene === 'results' ? 'results' : 'play';
  state.vote = undefined; state.shaking = undefined;
  for (const p of state.players) if (p.kind === 'remote') {
    p.offline = true;
    if (!sameRoom) { delete p.peer; p.wasRemote = true; } // a new room: nobody has an id in it yet
  }
  setup.seats.forEach(st => { if (st.kind === 'remote' && !sameRoom) delete st.peer; });
  clearVis();
  log(sameRoom ? 'Chủ phòng đã quay lại: ván chơi tiếp.' : `Phòng mới ${code}: ván chơi tiếp, bạn bè vào lại bằng mã mới.`);
}
let roomMenu = false; // the room menu: leave (a friend) or close the room (the host), asked twice

// ---- The vote for a new game (online) ----------------------------------------------------
// Anyone at the table can ask for a new game, mid-game from the room menu or from the results
// screen. Every real player still in the room must agree: the host for their screen, and each
// friend online. One "no", or the time running out, keeps the game as it is. The computer has no vote.
/** This browser's voter id: 'host', or 'p' + the guest's id in the room. */
const myVoter = (): string => isHost() ? 'host' : isGuest() ? 'p' + myPeerId : 'host';
/** Host: who votes: the host, then each friend online who has a seat in this game. */
function voters(): { id: string; name: string }[] {
  const list = [{ id: 'host', name: myName || 'Chủ phòng' }];
  for (const [id, peer] of peers) {
    if (peer.online && state.players.some(q => q.peer === id)) list.push({ id: 'p' + id, name: peer.name });
  }
  return list;
}
/** Host: a new game with the same seats. */
function restartGame() {
  reset(); clearVis(); scene = 'play';
  log('Mọi người đồng ý: bắt đầu ván mới!');
}
/** Asks for a new game. A guest sends it to the host; with nobody else to ask, the game restarts at once. */
function startVote() {
  if (isGuest()) { sendAct('voteStart'); return; }
  hostStartVote('host');
}
function hostStartVote(by: string) {
  if (state.vote) return;
  const list = voters();
  if (list.length <= 1) { restartGame(); return; }
  const who = list.find(v => v.id === by);
  if (!who) return;
  state.vote = { by: who.name, t: 0, list: list.map(v => ({ ...v, ans: v.id === by ? true : null })) };
  log(`${who.name} đề nghị chơi lại ván mới.`);
  roomMenu = false;
}
/** Casts this browser's vote. */
function castVote(yes: boolean) {
  if (isGuest()) { sendAct(yes ? 'vote:yes' : 'vote:no'); return; }
  hostCastVote('host', yes);
}
function hostCastVote(id: string, yes: boolean) {
  const v = state.vote;
  if (!v) return;
  const me = v.list.find((e: Loose) => e.id === id);
  if (!me || me.ans !== null) return;
  me.ans = yes;
  if (!yes) { state.vote = undefined; log(`${me.name} không đồng ý chơi lại: ván tiếp tục.`); return; }
  if (v.list.every((e: Loose) => e.ans === true)) restartGame();
}
/** Host, every step: the vote's clock, and friends who left drop out of it. */
function voteStep(dt: number) {
  const v = state.vote;
  if (!v) return;
  v.t += dt;
  v.list = v.list.filter((e: Loose) => e.id === 'host' || peerOnline(Number(e.id.slice(1))));
  if (v.t >= tune.vote_time) { state.vote = undefined; log('Hết giờ bỏ phiếu: ván tiếp tục.'); return; }
  if (v.list.length <= 1 || v.list.every((e: Loose) => e.ans === true)) restartGame();
}
/** The vote's two buttons, for a voter who has not answered yet. */
function buildVoteUI() {
  const v = state.vote, me = v.list.find((e: Loose) => e.id === myVoter());
  if (!me || me.ans !== null) return;
  const y = voteBox().y + voteBox().h - 70;
  btn(L.cx - 210, y, 200, 54, 'Đồng ý', () => castVote(true), 'menu', true, '#2f8a3a');
  btn(L.cx + 10, y, 200, 54, 'Không', () => castVote(false), 'menuSecondary', true, '#6a4a2a');
}
function voteBox(): { x: number; y: number; w: number; h: number } {
  const h = 210 + (state.vote ? state.vote.list.length : 0) * 30, w = Math.min(460, L.maxW);
  return { x: L.cx - w / 2, y: (L.phone ? 470 : 360) - h / 2, w, h };
}
/** The vote over everything: who asked, each voter's answer, the time left, and the buttons. */
function drawVote() {
  const v = state.vote;
  if (!v) return;
  const b = voteBox();
  ctx.save(); ctx.fillStyle = 'rgba(10,5,3,0.55)'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(30,12,8,0.96)'; rrect(ctx, b.x, b.y, b.w, b.h, 16); ctx.fill();
  ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
  text('Bỏ phiếu chơi lại ván mới', L.cx, b.y + 30, 22, '#f2c44a', 'center', 'bold');
  text(`${v.by} đề nghị · còn ${Math.max(0, Math.ceil(tune.vote_time - v.t))} giây`, L.cx, b.y + 60, 16, '#e8d9b5');
  v.list.forEach((e: Loose, j: number) => {
    const y = b.y + 98 + j * 30;
    text(e.name + (e.id === myVoter() ? ' (bạn)' : ''), b.x + 30, y, 17, '#fff8e6', 'left');
    const [say, col] = e.ans === true ? ['Đồng ý', '#7ee08a'] : e.ans === false ? ['Không', '#ff9a8a'] : ['Đang chờ...', '#cbb994'];
    text(say, b.x + b.w - 30, y, 17, col, 'right', 'bold');
  });
  drawingMenu = true; ui.forEach(x => { if (x.role === 'menu' || x.role === 'menuSecondary') drawButton(x); }); drawingMenu = false;
}


// ---- Rules --------------------------------------------------------------------------
let setup: { seats: Seat[]; mode: 'bankrupt' | 'rounds'; rounds: number; teams: boolean; teamOf: number[]; animals: number[] } = { seats: [{ kind: 'human' }, { kind: 'ai', lv: 1 }, { kind: 'ai', lv: 0 }, { kind: 'off' }], mode: 'bankrupt', rounds: tune.max_rounds, teams: false, teamOf: [0, 1, 0, 1], animals: [...DEFAULT_ANIMALS] };
/** The kinds of game on the setup button, in turn: a short limited game, a long one, until one is left. */
/** This game's round limit: what the host chose, or the short one for a game saved before there was a choice. */
const maxRounds = (): number => state.maxRounds ?? tune.max_rounds;
/** The setup button's words for a kind of game. */
function kindLabel(mode: string, rounds: number, long: boolean, teams = false): string {
  const k = mode === 'rounds' ? (long && !teams ? `${rounds} vòng, giàu nhất thắng` : `${rounds} vòng`) : (teams ? 'tới khi phá sản' : 'Tới khi phá sản');
  return teams ? `2 đội · ${k}` : k;
}
/** A seat's team in a team game: what the host chose (seats 1 and 3 against 2 and 4 to begin with). */
const teamOfSeat = (i: number): number => (isGuest() ? lobby?.teamOf?.[i] : setup.teamOf?.[i]) ?? i % 2;
const teamTag = (team: number | undefined): string => (team === undefined ? '' : `Đội ${team + 1}`);
/** Gives seat i animal a, when it is a real animal no other seat has. */
function setAnimal(i: number, a: unknown) {
  if (typeof a !== 'number' || !Number.isInteger(a) || a < 0 || a >= ANIMALS.length) return;
  if (setup.animals.some((x, k) => k !== i && x === a)) return;
  setup.animals[i] = a; sendLobby();
}
/** Gives seat i the next zodiac animal that no other seat has. */
function nextAnimal(i: number) {
  const taken = setup.animals.filter((_, k) => k !== i);
  let a = setup.animals[i];
  do a = (a + 1) % ANIMALS.length; while (taken.includes(a));
  setup.animals[i] = a;
  sendLobby();
}
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
  state = {
    t: 0, score: 0, gained: '', players, cur: 0, round: 1, mode: setup.mode, maxRounds: setup.rounds, teams: setup.teams || undefined,
    owner: Array(40).fill(-1), level: Array(40).fill(0), mort: Array(40).fill(false),
    phase: 'roll', timer: 0, dice: [3, 4], diceT: 9, rolledDouble: false, moveLeft: 0, moveDir: 1, hopT: 0,
    popup: null, debt: null, pick: 0, log: [], floaters: [], decks: { co: shuffled(CARDS.co.length), kv: shuffled(CARDS.kv.length) }, used: { co: [], kv: [] },
    flash: { tile: -1, t: 0 }, ranking: null, turns: 0, pot: tune.pot_start,
  };
  log(`Ván mới: ${players.length} người chơi, ${setup.teams ? '2 đội, ' : ''}${setup.mode === 'rounds' ? `${setup.rounds} vòng` : 'chơi tới khi phá sản'}.`);
  if (setup.teams) log(`Đội 1: ${players.filter(p => p.team === 0).map(p => p.name).join(' và ')}. Đội 2: ${players.filter(p => p.team === 1).map(p => p.name).join(' và ')}. Đất đồng đội không mất tiền thuê.`);
  if (tune.order_roll && players.length > 1) startOrder(); else startTurn();
}

// ---- First-game tips -----------------------------------------------------------------------------------
// A small box with one tip, the first time each moment comes on this screen (the first throw, the first
// land to buy...). "Đã hiểu" puts it away for good, "Tắt hướng dẫn" puts them all away. Checks run without
// them (so a same-seed replay draws the same), unless the address asks with ?tutorial=1.
const TIPS: Record<string, string> = {
  roll: 'Giữ nút đỏ để lắc xúc xắc, thả ra để ném. Giữ càng lâu, xúc xắc lăn càng mạnh.',
  buy: 'Mua đất để thu tiền thuê khi người khác dẫm vào. Gom đủ cả nhóm màu thì tiền thuê nhân đôi.',
  inspect: 'Bấm vào một ô bất kỳ trên bàn cờ để xem giá, tiền thuê, đặc sản và chủ của ô.',
  build: 'Dẫm lại đất của mình thì được xây thêm 1 cấp: nhà, khách sạn, rồi Landmark.',
  debt: 'Thiếu tiền: bán bớt nhà hoặc cầm cố đất ở danh sách tài sản, rồi bấm Trả nợ.',
  jail: 'Ở tù: đổ được đôi thì ra ngay. Ở đủ 3 lượt thì lượt sau được ra.',
};
const tipsOn = !(params.has('seed') || CHEAP || params.get('manual') === '1' || !!window.GAME_CLOCK) || params.get('tutorial') === '1'; // as checkedRun, declared further down
const tipsSeen = new Set<string>((() => { try { return JSON.parse(localStorage.getItem('tpdv-tips') || '[]'); } catch { return []; } })());
let tipNow: string | null = null;
function keepTipsSeen() { try { localStorage.setItem('tpdv-tips', JSON.stringify([...tipsSeen])); } catch { /* not kept: fine */ } }
/** The tip this moment calls for, if this screen has not seen it. */
function tipFor(): string | null {
  if (!tipsOn || scene !== 'play' || !state.players || state.ordering || !humanTurn()) return null;
  const p = curP(), pi = state.cur;
  const want = state.phase === 'roll' && !state.shaking ? (tipsSeen.has('roll') && owned(pi).length ? 'inspect' : 'roll')
    : state.phase === 'buy' ? 'buy' : state.phase === 'build' ? 'build' : state.phase === 'debt' ? 'debt' : state.phase === 'jail' && p.inJail ? 'jail' : null;
  return want && !tipsSeen.has(want) ? want : null;
}
/** Where the tip box sits: the board's top right on a wide screen, under the toolbar on a phone. */
function tipBox(): { x: number; y: number; w: number; h: number } {
  return L.phone ? { x: 12, y: L.by + 44, w: W - 24, h: 104 } : { x: BW - 360, y: 64, w: 350, h: 124 };
}
function buildTip() {
  tipNow = tipFor();
  if (!tipNow) return;
  const b = tipBox(), key = tipNow;
  btn(b.x + b.w - 214, b.y + b.h - 40, 110, 32, 'Đã hiểu', () => { tipsSeen.add(key); keepTipsSeen(); }, 'room');
  btn(b.x + b.w - 98, b.y + b.h - 40, 88, 32, 'Tắt', () => { for (const k of Object.keys(TIPS)) tipsSeen.add(k); keepTipsSeen(); }, 'room');
}
function drawTip() {
  if (!tipNow) return;
  const b = tipBox();
  ctx.save(); ctx.fillStyle = 'rgba(255,248,230,0.97)'; rrect(ctx, b.x, b.y, b.w, b.h, 12); ctx.fill(); ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
  text('Mẹo', b.x + 14, b.y + 16, 15, '#8a3a24', 'left', 'bold');
  ctx.font = `15px ${FONT}`;
  wrapLines(ctx, TIPS[tipNow], b.w - 28).slice(0, 3).forEach((l, j) => text(l, b.x + 14, b.y + 38 + j * 19, 15, '#2b1d12', 'left'));
  ui.forEach(x => { if (x.label === 'Đã hiểu' || (x.label === 'Tắt' && x.role === 'room')) drawButton(x); });
}

// ---- The end-of-game summary --------------------------------------------------------------------------
/** A few lines about the game just played: who collected most rent, the tile that hurt most, the unluckiest. */
function summaryLines(): string[] {
  const st = state.stats;
  if (!st) return [];
  const name = (seat: number) => state.players.find(p => p.id === seat)?.name ?? '';
  const best = (a: number[]) => a.reduce((b, v, k) => (v > a[b] ? k : b), 0);
  const out: string[] = [];
  const g = best(st.got), pd = best(st.paid);
  if (st.got[g] > 0) out.push(`Thu tiền thuê nhiều nhất: ${name(g)} (${money(st.got[g])})`);
  const tiles = Object.entries(st.tile).sort((a, b) => b[1] - a[1]);
  if (tiles.length) out.push(`Ô đáng sợ nhất: ${TILES[Number(tiles[0][0])].n} (thu ${money(tiles[0][1])})`);
  if (st.paid[pd] > 0) out.push(`Xui nhất: ${name(pd)} (trả ${money(st.paid[pd])} tiền thuê)`);
  return out;
}
function drawSummary(x: number, y: number, w: number, minH = 0) {
  const lines = summaryLines();
  if (!lines.length) return;
  const h = Math.max(minH, 48 + lines.length * 30);
  ctx.save(); ctx.fillStyle = '#2c140f'; rrect(ctx, x, y, w, h, 12); ctx.fill(); ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
  text('Tổng kết ván', x + w / 2, y + 22, 18, '#f2c44a', 'center', 'bold');
  lines.forEach((l, j) => fitText(l, x + w / 2, y + 52 + j * 30, w - 20, 16, '#fff8e6', ''));
}

// ---- Rare cards kept for later: Thẻ Miễn Thuê and Thẻ Đổ Lại -----------------------------------------
/** In a team game, whether players a and b (indexes in state.players) are partners. */
const sameTeam = (a: number, b: number): boolean => !!state.teams && a !== b && state.players[a].team === state.players[b].team;
const hasKeep = (p: Player, act: KeepAct): boolean => !!p.keep && p.keep.some(k => k.act === act);
/** Takes a kept card from a player's hand and puts it back under its deck. */
function spendKeep(p: Player, act: KeepAct) {
  const k = p.keep!.findIndex(x => x.act === act), card = p.keep!.splice(k, 1)[0];
  state.used[card.deck].push(CARDS[card.deck].findIndex(c => c.act === act));
}
/** The rent of tile i, paid to its owner. */
function payRent(i: number, rent: number, o: number) {
  const p = curP(), pi = state.cur, owner = state.players[o];
  events.push({ type: 'rent', tile: i, amt: rent, from: pi, to: o }); // for checks: which land earns what, who pays whom
  const st = (state.stats ||= { paid: [0, 0, 0, 0], got: [0, 0, 0, 0], tile: {} }); // for the end-of-game summary, by seat
  st.paid[p.id] += rent; st.got[owner.id] += rent; st.tile[i] = (st.tile[i] || 0) + rent;
  state.popup = { kind: 'rent', tile: i, rent, owner: o };
  charge([{ to: o, amt: rent }], `${p.name} trả ${owner.name} ${money(rent)} tiền thuê ở ${TILES[i].n}.`, () => { state.phase = 'rentShow'; state.timer = 0; });
}
/** Thẻ Miễn Thuê: this rent is not paid. */
function useNoRent() {
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
function useReroll() {
  const p = curP(), [a, b] = state.dice;
  spendKeep(p, 'reroll');
  if (a === b) p.doubles = Math.max(0, p.doubles - 1); // the double taken back does not count
  state.rolledDouble = false; state.popup = null; state.diceShow = undefined;
  log(`${p.name} dùng Thẻ Đổ Lại: đổ xúc xắc lại.`);
  sfx.card(); state.phase = 'roll'; state.timer = 0;
  if (isAI(p)) aiTurnStart(p);
}
/** The computer uses a kept card when the rent hurts: at least ai_keep_rent_share of its cash, or ai_keep_rent_min. */
const aiUsesKeep = (p: Player, rent: number): boolean => rent >= Math.min(tune.ai_keep_rent_min, Math.max(0, p.cash) * tune.ai_keep_rent_share) || rent > p.cash;

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
function buildPrice(i: number, to: number): number {
  const e = activeEvent();
  return Math.round(buildCost(i, to) * (e && e.kind === 'build' ? e.v : 1));
}
/** The salary for passing Xuất Phát now: doubled at Tết. */
function salaryNow(): number {
  const e = activeEvent();
  return Math.round(tune.salary * (e && e.kind === 'salary' ? e.v : 1));
}
/** The event's banner: big for a few seconds when it begins, then a small card in the corner while it lasts. */
function drawEvent() {
  const e = activeEvent();
  if (!e || !state.event || inspect >= 0) return;
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
  const toolbarEnd = 12 + 84 + 8 + (roomCode ? 96 + 8 : 0);
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
  log('Tung xúc xắc chọn thứ tự đi: ai cao nhất đi trước, thấp nhất đi cuối.');
  nextOrderThrow();
}
/** The next player who still has to throw, or the order decided. */
function nextOrderThrow() {
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
/** Everyone has thrown: ties throw again; otherwise the players are put in order, highest first, lowest last. */
function finishOrder() {
  const totals = state.order as number[];
  const tied = totals.map((v, i) => i).filter(i => totals.filter(v => v === totals[i]).length > 1);
  if (tied.length) {
    log(`Hòa điểm: ${tied.map(i => state.players[i].name).join(', ')} tung lại.`);
    for (const i of tied) state.order![i] = null;
    nextOrderThrow();
    return;
  }
  const idx = totals.map((v, i) => i).sort((a, b) => totals[b] - totals[a]);
  state.players = idx.map(i => state.players[i]);
  state.ordering = false; state.order = undefined;
  log(`Thứ tự đi: ${state.players.map(p => p.name).join(' → ')}.`);
  state.cur = 0;
  startTurn();
}
/** The board of throws while the order is chosen. */
function drawOrder() {
  // A slim table low on the board, so the dice thrown above it stay in view.
  if (!state.ordering) return;
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
const curP = () => state.players[state.cur];
const firstLap = (p: Player) => (p.laps || 0) < tune.first_lap_count; // still on the first lap: no buying, no tax
const isAI = (p: Player) => p.kind === 'ai';
function log(s: string) { (state.history ||= []).push(`V${state.round}: ${s}`); if (state.history.length > 300) state.history.shift(); state.log.push(s); if (state.log.length > 5) state.log.shift(); events.push({ type: 'log', text: s }); }
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
  state.gained = state.teams ? `${teamTag(w.team)} thắng: ${state.players.filter(q => q.team === w.team).map(q => q.name).join(' và ')}!` : `${w.name} là Tỷ Phú Đất Việt!`;
  state.score = Math.round(ranking[0].worth);
  state.reason = reason;
  log(state.gained);
  events.push({ type: 'over', winner: ranking[0].i });
  sfx.win();
  scene = 'results'; state.t = 0;
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
    if (state.mode === 'rounds' && state.round > maxRounds()) { endGame(`Hết ${maxRounds()} vòng: ai giàu nhất thắng!`); return; }
    if (state.mode === 'rounds' && state.round === maxRounds()) log('Vòng cuối cùng!');
    roundEvents();
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
    charge([{ to: -1, amt, pot: true }], `${p.name} đóng ${t.n}: ${money(amt)} (${Math.round(tune.prop_tax_pct * 100)}% tiền mặt, tối đa ${money(tune.prop_tax_flat)}; vào hũ).`, afterAction); return;
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
  const to = state.level[i] + 1, cost = free ? 0 : buildPrice(i, to);
  if (to > MAX_LEVEL || p.cash < cost) return;
  p.cash -= cost; state.level[i] = to;
  if (cost) floatAtRow(pi, '-' + money(cost), '#ff9a8a');
  log(`${p.name} xây ${LEVEL_NAMES[to]}${to === 6 ? ' ' + TILES[i].lm : ''} ở ${TILES[i].n}${free ? ' (miễn phí)' : ''}.`);
  if (to === MAX_LEVEL) sfx.landmark(); else sfx.build(); // a Landmark rises to a gong and drums
  events.push({ type: 'build', who: pi, tile: i, level: to });
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
    case 'norent': case 'reroll': (p.keep ||= []).push({ act: c.act, deck: deckKind }); afterAction(); return;
    case 'repair': charge([{ to: -1, amt: Math.min(tune.card_max, c.v * levelsOf(pi)) }], '', afterAction); return;
    case 'payeach': charge(state.players.map((q, j) => ({ to: j, amt: (j !== pi && !q.bankrupt) ? c.v : 0 })).filter(x => x.amt > 0), '', afterAction); return;
    case 'collect':
      state.players.forEach((q, j) => {
        if (j === pi || q.bankrupt) return;
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
function flyTo(target: number) {
  const p = curP();
  beginMove((target - p.pos + 40) % 40 || 40, 1, true);
  log(`${p.name} bay tới ${TILES[target].n}.`);
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
  if (p.lv === 2) { // Hard: buy back the land that earns most first, while the cash covers the danger ahead
    const back = owned(pi).filter(i => state.mort[i]).sort((a, b) => earnWhenFree(pi, b) - earnWhenFree(pi, a));
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
function earnWhenFree(pi: number, i: number) {
  const was = state.mort[i]; state.mort[i] = false;
  const r = rentOf(i, 7); state.mort[i] = was;
  return r;
}
/** Hard: what a free tile is worth to this player beyond its price: ports, a group to finish, a group to spoil. */
function hardWantsTile(pi: number, i: number): 'must' | 'good' | 'plain' {
  const t = TILES[i];
  if (t.t === 'port') return 'must'; // the ports earned the most in self-play
  if (t.t !== 'prop') return 'plain';
  const group = TILES.map((u, j) => j).filter(j => TILES[j].t === 'prop' && TILES[j].g === t.g);
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
function raiseCash(pi: number, need: number) {
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
  const p = state.players[pi], cost = buildPrice(i, state.level[i] + 1);
  if (p.cash < cost) return false;
  if (p.lv === 0) return rng() < 0.7;
  const keep = p.lv === 2 ? hardReserve(pi) * tune.ai_hard_build_keep : tune.ai_reserve_mid + 300;
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

// ---- 3D figures: tokens, buildings, landmarks ----------------------------------------
/** A player's piece: their zodiac animal (src/animals.ts). */
function makeToken(animal: number, color: string) {
  const outer = new THREE.Group(), inner = makeAnimal(animal, color, !CHEAP);
  outer.add(inner); outer.userData.inner = inner; // the board moves the outer group, the piece's mood the inner one
  return outer;
}
const tokKind: number[] = []; // which animal each seat's 3D piece shows
/** Rebuilds a seat's 3D piece when its player has a different animal (a new game, or a friend's). */
function syncPieces() {
  for (const p of state.players) {
    if (tokKind[p.id] === p.token) continue;
    const old = tok3[p.id], t = makeToken(p.token, p.color);
    t.scale.setScalar(tune.piece_scale); t.visible = false; scene3.remove(old); scene3.add(t); tok3[p.id] = t; tokKind[p.id] = p.token;
  }
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
  for (let k = 0; k < 4; k++) { const a = DEFAULT_ANIMALS[k]; const t = makeToken(a, ANIMALS[a].color); t.scale.setScalar(tune.piece_scale); t.visible = false; scene3.add(t); tok3[k] = t; tokKind[k] = a; }
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
  ANIMALS.forEach((an, k) => put(makeToken(k, an.color), -2.6 + (k % 6) * 0.78, k < 6 ? -2.3 : -1.2, an.name, 1.3));
  put(makeHouse(), 2.3, -2.3, 'Nhà', 1.8); put(makeHotel(), 2.3, -1.2, 'Khách sạn', 1.2);
  TILES.filter(t => t.t === 'prop').forEach((t, j) => put(makeLandmark(t.lk!), -2.75 + (j % 8) * 0.78, 0.3 + Math.floor(j / 8) * 0.95, t.n, 0.85)); // every province's landmark
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
    syncPieces();
    state.players.forEach((p) => {
      const t = tok3[p.id], v = tokVis[p.id];
      if (!v || p.bankrupt) return;
      t.visible = true; t.position.set(v.x, BOARD_TOP + v.y, v.z);
      const ti = tileInfo(p.pos); t.rotation.y = Math.atan2(ti.ox, ti.oz) + Math.PI;
      applyMood(t.userData.inner, p);
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
    if (state.vote) { buildVoteUI(); return; }
    if (isGuest()) { // a friend asks for a new game, or leaves; only the host goes back to the title
      btn(L.cx - 200, L.phone ? 840 : 560, 190, 52, 'Chơi lại', startVote, 'primary');
      btn(L.cx + 10, L.phone ? 840 : 560, 190, 52, 'Rời phòng', leaveRoom, 'secondary', true, '#6a4a2a');
      return;
    }
    btn(L.cx - 200, L.phone ? 840 : 560, 190, 52, 'Chơi lại (Enter)', () => { if (roomCode) startVote(); else { reset(); clearVis(); scene = 'play'; } }, 'primary');
    btn(L.cx + 10, L.phone ? 840 : 560, 190, 52, 'Ván mới (N)', () => { scene = 'title'; }, 'secondary');
    return;
  }
  if (scene !== 'play') return;
  btn(W - 52, 12, 40, 34, '', () => setMuted(!muted()), 'mute');
  { const r = rulesSpot(); btn(r.x, r.y, r.w, r.h, 'Luật', () => showRules(true), 'room'); }
  if (!isGuest() && state.players.some(p => p.kind !== 'human')) { const r = speedSpot(); btn(r.x, r.y, r.w, r.h, `×${gameSpeed}`, cycleSpeed, 'room'); }
  if (roomCode) {
    const r = roomPill();
    btn(r.x, r.y, r.w, r.h, `Phòng ${roomCode}`, () => { roomMenu = true; emoteMenu = false; inspect = -1; sheetOpen = false; }, 'room');
  }
  buildToolbar();
  buildTip();
  if (state.vote) { buildVoteUI(); return; }
  if (roomMenu) { buildRoomMenu(); return; }
  if (emoteMenu) { buildEmoteMenu(); return; }
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
    case 'order': btn(ax - 130, ay, 260, 58, state.shaking ? 'Thả ra để ném!' : 'Giữ để lắc chọn lượt', () => startShake(), 'primary', true, '#c8201f', 'shake'); break;
    case 'roll': btn(ax - 130, ay, 260, 58, state.shaking ? 'Thả ra để ném!' : 'Giữ để lắc xúc xắc', () => startShake(), 'primary', true, '#c8201f', 'shake'); break;
    case 'jail': {
      btn(ax - 230, ay, 220, 54, state.shaking ? 'Thả ra để ném!' : 'Giữ lắc tìm đôi', () => startShake(), 'primary', true, '#c8201f', 'shake');
      if (p.freeCards.length > 0) btn(ax + 10, ay, 220, 54, 'Dùng thẻ ra tù', payJail, 'secondary', true, undefined, 'jailCard');
      break;
    }
    case 'buy': { const t = TILES[state.popup.tile]; btn(ax - 230, by, 220, 54, `Mua ${money(t.p!)}`, doBuy, 'primary', p.cash >= t.p!, '#2f8a3a', 'buy'); btn(ax + 10, by, 220, 54, 'Bỏ qua', () => { log(`${p.name} bỏ qua ${t.n}.`); skip(); }, 'secondary', true, undefined, 'skip'); break; }
    case 'build': {
      const i = state.popup.tile, to = state.level[i] + 1, cost = buildPrice(i, to);
      btn(ax - 230, by, 220, 54, `Xây ${LEVEL_NAMES[to]}: ${money(cost)}`, () => { doBuild(i); state.popup = null; afterAction(); }, 'primary', p.cash >= cost, '#2f8a3a', 'build');
      btn(ax + 10, by, 220, 54, 'Không xây', () => { state.popup = null; afterAction(); }, 'secondary', true, undefined, 'noBuild');
      break;
    }
    case 'card': btn(ax - 110, by, 220, 54, 'Đồng ý', applyCard, 'primary', true, '#c8201f', 'cardOk'); break;
    case 'rentShow': btn(ax - 110, by, 220, 54, 'Tiếp tục', () => { state.popup = null; afterAction(); }, 'primary', true, undefined, 'continue'); break;
    case 'rentChoice': {
      const pop = state.popup;
      btn(ax - 230, by, 220, 54, 'Dùng Thẻ Miễn Thuê', useNoRent, 'primary', true, '#2f8a3a', 'noRent');
      btn(ax + 10, by, 220, 54, `Trả ${money(pop.rent)}`, () => payRent(pop.tile, pop.rent, pop.owner), 'secondary', true, undefined, 'payRent');
      break;
    }
    case 'rerollChoice': {
      const n = state.popup.n;
      btn(ax - 230, by, 220, 54, 'Dùng Thẻ Đổ Lại', useReroll, 'primary', true, '#2f8a3a', 'reroll');
      btn(ax + 10, by, 220, 54, 'Đi tiếp', () => { state.popup = null; beginMove(n); }, 'secondary', true, undefined, 'goOn');
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
/** Where the room code's button sits: the panel's top line, or the phone's header. */
function roomPill(): { x: number; y: number; w: number; h: number } {
  return L.phone ? { x: W - 162, y: 9, w: 100, h: 32 } : { x: W - 186, y: 44, w: 126, h: 30 };
}
/** The room menu's two buttons, over everything. */
function buildRoomMenu() {
  const y = (L.phone ? 470 : 360) + 46;
  const go = isHost() ? 'Giải tán phòng' : 'Rời phòng';
  btn(L.cx - 210, y + 66, 420, 50, 'Bỏ phiếu chơi lại ván mới', startVote, 'menu', true, '#2b6cd6');
  btn(L.cx - 210, y, 200, 54, go, leaveRoom, 'menu', true, '#c8201f');
  btn(L.cx + 10, y, 200, 54, 'Ở lại', () => { roomMenu = false; }, 'menuSecondary', true, '#6a4a2a');
}
let drawingMenu = false;
/** The room menu: what leaving does, then the two buttons. */
function drawRoomMenu() {
  if (!roomMenu || !roomCode) return;
  ctx.save(); ctx.fillStyle = 'rgba(10,5,3,0.6)'; ctx.fillRect(0, 0, W, H); ctx.restore();
  const y = L.phone ? 470 : 360;
  const say = isHost() ? [`Phòng ${roomCode}`, 'Giải tán phòng? Mọi người sẽ ra khỏi ván và về màn hình đầu.']
    : [`Phòng ${roomCode}`, 'Rời phòng? Máy sẽ chơi thay chỗ của bạn trong ván này.'];
  messageBox(say, L.cx, y - 40, 460);
  drawingMenu = true; ui.forEach(b => { if (b.role === 'menu' || b.role === 'menuSecondary') drawButton(b); }); drawingMenu = false;
}
function seatLabel(s: Seat, i = -1): string {
  // online, seat 0 is the host's own seat
  if (s.kind === 'human' && i === 0 && (isHost() || isGuest())) return `Chủ phòng · ${(isHost() ? myName : lobby?.hostName) || 'chủ phòng'}`;
  if (s.kind === 'human') return 'Người chơi';
  if (s.kind === 'remote') return s.peer === undefined ? 'Chờ bạn online...' : `Online · ${s.name || 'Bạn'}${peerOnline(s.peer) || isGuest() ? '' : ' (đã rời)'}`;
  if (s.kind === 'ai') return `Máy · ${AI_LEVELS[s.lv!]}`;
  return 'Không chơi';
}
/** Starts the game from the title screen, when at least two seats play. */
function startGame() {
  picker = null;
  if (setup.seats.filter(s => s.kind !== 'off').length < 2) { netError = 'Cần ít nhất 2 người chơi để bắt đầu.'; sfx.click(); return; }
  if (setup.teams && setup.seats.some(s => s.kind === 'off')) { netError = 'Chơi 2 đội cần đủ 4 người.'; sfx.click(); return; }
  if (setup.teams && setup.teamOf.filter(t => t === 0).length !== 2) { netError = 'Chơi 2 đội: mỗi đội cần đúng 2 người.'; sfx.click(); return; }
  if (netError.startsWith('Cần ít nhất 2') || netError.startsWith('Chơi 2 đội')) netError = '';
  if (!isHost()) forgetLocalGame(); // a new game on this screen replaces the one left unfinished; an online game does not
  reset(); clearVis(); scene = 'play';
}
/** Whether the title screen shows a team game: the host's choice, or what the host sent a friend. */
const titleTeams = (): boolean => (isGuest() ? !!lobby?.teams : setup.teams);
/** A seat's animal on the title screen: the host's choice, or what the host sent a friend. */
function seatAnimal(i: number): number {
  return isGuest() ? (lobby?.animals?.[i] ?? DEFAULT_ANIMALS[i]) : setup.animals[i];
}
/** Where a seat's animal sits on the title screen. */
function animalSpot(i: number): { x: number; y: number; r: number } {
  const T = titleSpots();
  return L.phone ? { x: 34, y: T.y0 + i * T.step + T.seatH / 2, r: 24 } : { x: BW / 2 - 260, y: 250 + i * 62 + 25, r: 26 };
}
/** Who may change this seat's animal here: the host or the one screen for every seat but a friend's;
 * a friend only their own. */
function canPickAnimal(i: number, s: Seat): boolean {
  if (isGuest()) return i === mySeat;
  return !(s.kind === 'remote' && peerOnline(s.peer));
}
/** A seat's animal in its round frame, with a small mark when a tap changes it. */
function drawSeatAnimal(i: number, x: number, y: number, r: number, s: Seat) {
  const a = seatAnimal(i), off = s.kind === 'off';
  ctx.save(); ctx.globalAlpha = off ? 0.45 : 1;
  ctx.fillStyle = '#f4ead2'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  ctx.strokeStyle = ANIMALS[a].color; ctx.lineWidth = 3; ctx.stroke();
  drawTokenIcon(a, x, y + 1, r * 1.55, ANIMALS[a].color);
  if (canPickAnimal(i, s) && !off) { // a little gold arrow: tap to change
    ctx.fillStyle = '#f2c44a'; ctx.beginPath(); ctx.arc(x + r * 0.8, y + r * 0.8, r * 0.36, 0, 7); ctx.fill();
    ctx.strokeStyle = '#5a2a1c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x + r * 0.8, y + r * 0.8, r * 0.18, -2.4, 1.6); ctx.stroke();
  }
  ctx.restore();
}
function buildTitleUI() {
  const T = titleSpots();
  (isGuest() ? (lobby ? lobby.seats as Seat[] : []) : setup.seats).forEach((s, i) => { // tap an animal: the list of animals
    if (!canPickAnimal(i, s) || s.kind === 'off') return;
    const c = animalSpot(i), anchor = { x: c.x - c.r - 4, y: c.y - c.r - 4, w: c.r * 2 + 8, h: c.r * 2 + 8 };
    btn(anchor.x, anchor.y, anchor.w, anchor.h, '', () => openAnimalPicker(i, anchor), 'hidden');
  });
  { const r = rulesSpot(); btn(r.x, r.y, r.w, r.h, 'Luật chơi', () => showRules(true), 'room'); }
  const b4 = (r: number[], label: string, fn: () => void, role: string, color: string) => btn(r[0], r[1], r[2], r[3], label, fn, role, true, color);
  if (isGuest()) { b4(T.leave, 'Rời phòng', leaveRoom, 'secondary', '#6a4a2a'); buildPicker(); return; }
  setup.seats.forEach((s, i) => {
    // online, the host plays seat 0, and a friend who is in the room keeps their seat
    const locked = isHost() && (i === 0 || (s.kind === 'remote' && peerOnline(s.peer)));
    const at = { x: T.seatX, y: T.y0 + i * T.step, w: T.seatW, h: T.seatH };
    btn(at.x, at.y, at.w, at.h, seatLabel(s, i) + (locked ? '' : ' ▾'), () => openSeatPicker(i, at), 'seat', !locked);
    if (setup.teams) { // the seat's team, between its animal and its kind
      const tp = teamSpot(i);
      btn(tp.x, tp.y, tp.w, tp.h, `${teamTag(setup.teamOf[i])} ▾`, () => openPicker(tp, [0, 1].map(t => ({ label: teamTag(t), value: t })), setup.teamOf[i], v => { setup.teamOf[i] = v as number; clearSetupNote(); sendLobby(); }), 'room');
    }
  });
  // the kind of game: two lists side by side, single or teams, and how long
  const kindY = T.y0 + 4 * T.step + T.modeDy, half = (T.seatW - 8) / 2;
  const single = { x: T.seatX, y: kindY, w: half, h: T.seatH }, length = { x: T.seatX + half + 8, y: kindY, w: half, h: T.seatH };
  btn(single.x, single.y, single.w, single.h, `${setup.teams ? 'Đội' : 'Đơn'} ▾`, () => openPicker(single, [{ label: 'Đơn', value: 0 }, { label: 'Đội (2 đấu 2)', value: 1 }], setup.teams ? 1 : 0, v => { setup.teams = v === 1; clearSetupNote(); sendLobby(); }), 'seat');
  const lengths = [{ label: `${tune.max_rounds} vòng`, value: 'r' + tune.max_rounds }, { label: `${tune.max_rounds_long} vòng`, value: 'r' + tune.max_rounds_long }, { label: 'Tới khi phá sản', value: 'bankrupt' }];
  const curLen = setup.mode === 'bankrupt' ? 'bankrupt' : 'r' + setup.rounds;
  btn(length.x, length.y, length.w, length.h, `${setup.mode === 'bankrupt' ? 'Phá sản' : `${setup.rounds} vòng`} ▾`, () => openPicker(length, lengths, curLen, v => {
    if (v === 'bankrupt') setup.mode = 'bankrupt'; else { setup.mode = 'rounds'; setup.rounds = Number(String(v).slice(1)); }
    sendLobby();
  }), 'seat');
  b4(T.start, L.phone ? 'Bắt đầu' : 'Bắt đầu (Enter)', startGame, 'primary', '#c8201f');
  if (isHost()) b4(T.online, `Giải tán phòng ${roomCode}`, leaveRoom, '', '#6a4a2a');
  else b4(T.online, 'Chơi online', () => showOnlinePanel(true), '', '#2b6cd6');
  const last = !isHost() && !isGuest() ? lastRoom() : null, kept = !isHost() && !isGuest() ? localGame() : null;
  if (kept) b4(T.rejoin, `Chơi tiếp ván trước (vòng ${kept.round})`, resumeLocalGame, '', '#2f8a3a');
  if (last) b4(kept ? T.rejoin2 : T.rejoin, `Vào lại phòng ${last.code}`, rejoinRoom, '', '#2f8a3a');
  buildPicker();
}
// ---- Dropdowns on the setup screen ----------------------------------------------------------------
// A tap on a choice opens its list just under it (above when there is no room); a tap on an item picks
// it, a tap anywhere else closes the list. Items the player cannot take (an animal another seat has) show
// dimmed. Drawn on the canvas like everything else, so it looks the same on a phone.
type PickItem = { label: string; value: number | string; enabled?: boolean; animal?: number };
let picker: { x: number; y: number; w: number; cols: number; itemH: number; items: PickItem[]; current: number | string; onPick: (v: number | string) => void; rects: { x: number; y: number; w: number; h: number }[] } | null = null;
/** Opens a list under the anchor button. */
function openPicker(anchor: { x: number; y: number; w: number; h: number }, items: PickItem[], current: number | string, onPick: (v: number | string) => void, cols = 1) {
  const itemH = 44, rows = Math.ceil(items.length / cols), h = rows * itemH + 10;
  const w = Math.min(W - 16, Math.max(anchor.w, cols > 1 ? cols * 140 + 10 : 160));
  const x = Math.max(8, Math.min(anchor.x, W - 8 - w));
  let y = anchor.y + anchor.h + 4;
  if (y + h > H - 8) y = Math.max(8, anchor.y - 4 - h);
  const cw = (w - 10) / cols;
  const rects = items.map((_, k) => ({ x: x + 5 + (k % cols) * cw, y: y + 5 + Math.floor(k / cols) * itemH, w: cw, h: itemH }));
  picker = { x, y, w, cols, itemH, items, current, onPick, rects };
  sfx.click();
}
/** The list's taps, in front of every other button: its items, then the rest of the screen to close it. */
function buildPicker() {
  if (!picker) return;
  const pk = picker, saved = ui; ui = [];
  pk.items.forEach((it, k) => { const r = pk.rects[k]; btn(r.x, r.y, r.w, r.h, '', () => { picker = null; pk.onPick(it.value); }, 'hidden', it.enabled !== false); });
  btn(pk.x, pk.y, pk.w, pk.rects.length ? pk.rects[pk.rects.length - 1].y + pk.itemH + 5 - pk.y : 0, '', () => { /* the list's own frame */ }, 'hidden');
  btn(0, 0, W, H, '', () => { picker = null; }, 'hidden');
  ui = [...ui, ...saved];
}
function drawPicker() {
  if (!picker) return;
  const pk = picker, last = pk.rects[pk.rects.length - 1], h = last.y + pk.itemH + 5 - pk.y;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; rrect(ctx, pk.x + 4, pk.y + 6, pk.w, h, 12); ctx.fill();
  ctx.fillStyle = '#2c140f'; rrect(ctx, pk.x, pk.y, pk.w, h, 12); ctx.fill(); ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 2; ctx.stroke();
  pk.items.forEach((it, k) => {
    const r = pk.rects[k], on = it.value === pk.current, ok = it.enabled !== false;
    const hover = pointer.x >= r.x && pointer.x <= r.x + r.w && pointer.y >= r.y && pointer.y <= r.y + r.h;
    if (on || (hover && ok)) { ctx.fillStyle = on ? '#5a2a1c' : 'rgba(255,255,255,0.08)'; rrect(ctx, r.x + 2, r.y + 2, r.w - 4, r.h - 4, 8); ctx.fill(); }
    ctx.globalAlpha = ok ? 1 : 0.35;
    if (it.animal !== undefined) {
      ctx.fillStyle = '#f4ead2'; ctx.beginPath(); ctx.arc(r.x + 22, r.y + r.h / 2, 17, 0, 7); ctx.fill();
      drawTokenIcon(it.animal, r.x + 22, r.y + r.h / 2 + 1, 28, ANIMALS[it.animal].color);
      text(it.label, r.x + 46, r.y + r.h / 2, 16, on ? '#f2c44a' : '#fff8e6', 'left', 'bold');
    } else text(it.label, r.x + 14, r.y + r.h / 2, 17, on ? '#f2c44a' : '#fff8e6', 'left', 'bold');
    ctx.globalAlpha = 1;
  });
  ctx.restore();
}
/** The list of what a seat can be: a person, a friend online (a host), a computer, or empty (not seat 1). */
function openSeatPicker(i: number, at: { x: number; y: number; w: number; h: number }) {
  const s = setup.seats[i], cur = s.kind === 'ai' ? 'ai' + s.lv : s.kind;
  const items: PickItem[] = [{ label: 'Người chơi', value: 'human' }];
  if (isHost()) items.push({ label: 'Chờ bạn online', value: 'remote' });
  AI_LEVELS.forEach((n, lv) => items.push({ label: `Máy · ${n}`, value: 'ai' + lv }));
  if (i > 0) items.push({ label: 'Không chơi', value: 'off' });
  openPicker(at, items, cur, v => {
    const k = String(v);
    setup.seats[i] = k.startsWith('ai') ? { kind: 'ai', lv: Number(k[2]) } : { kind: k as Seat['kind'] };
    clearSetupNote(); sendLobby();
  });
}
/** The list of the twelve animals; the ones other seats have are dimmed. */
function openAnimalPicker(i: number, at: { x: number; y: number; w: number; h: number }) {
  const mine = seatAnimal(i), taken = new Set([0, 1, 2, 3].filter(k => k !== i).map(seatAnimal));
  const items: PickItem[] = ANIMALS.map((an, a) => ({ label: an.name, value: a, animal: a, enabled: !taken.has(a) }));
  openPicker(at, items, mine, v => { if (isGuest()) sendAct('animalSet', v as number); else { setAnimal(i, v); rawSfx.animal(v as number); } }, L.phone ? 2 : 3);
}
/** Where a seat's team choice sits: between its animal's name and its kind. */
function teamSpot(i: number): { x: number; y: number; w: number; h: number } {
  const T = titleSpots(), y = T.y0 + i * T.step + (T.seatH - 34) / 2;
  return L.phone ? { x: T.seatX - 96, y, w: 88, h: 34 } : { x: T.seatX - 104, y, w: 94, h: 34 };
}
/** The seats changed: the note about too few players (or uneven teams) goes. */
function clearSetupNote() { if (netError.startsWith('Cần ít nhất 2') || netError.startsWith('Chơi 2 đội')) netError = ''; }
/** One centred line of text, its font made smaller (down to 10 px) until it fits maxW. */
function fitText(s: string, x: number, y: number, maxW: number, size: number, color: string, weight = 'bold') {
  let sz = size;
  ctx.save(); ctx.font = `${weight} ${sz}px ${FONT}`;
  while (sz > 10 && ctx.measureText(s).width > maxW) { sz--; ctx.font = `${weight} ${sz}px ${FONT}`; }
  ctx.restore();
  text(s, x, y, sz, color, 'center', weight);
}
/** A line about the connection, over the board, when something is wrong with it. */
function drawNetBanner() {
  let msg = '';
  if (net.getRole() !== 'off' && !linkUp) msg = 'Mất kết nối mạng, đang nối lại...';
  else if (isGuest() && !hostOnline) msg = 'Chủ phòng mất kết nối, đang chờ quay lại...';
  else if (netError && !(onlinePanel && onlinePanel.style.display === 'flex')) msg = netError;
  if (msg) messageBox([msg], L.cx, L.bannerY, 620);
}
function clearVis() { moods.length = 0; moodPrev.length = 0; inspect = -1; lastPos.length = 0; tokVis.length = 0; tokAnim.length = 0; for (let i = 0; i < 40; i++) tileShown[i] = -1; riseAnims.length = 0; }
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
    if (roomMenu) continue; // the room menu is open: only its buttons answer
    if (scene === 'play' && inspect >= 0) { inspect = -1; continue; } // a tile card is open: a tap anywhere closes it, and opens nothing
    if (scene === 'play' && state.phase === 'pick' && humanTurn() && inBoard(c.x, c.y)) {
      const pt = boardPointAt(c.x, c.y);
      if (pt) { const i = tileAt(pt.x, pt.z); if (i >= 0) { if (i === state.pick) pressAct('fly', () => flyTo(i)); else pickTile(i); } }
    } else if (scene === 'play' && inBoard(c.x, c.y)) { // anywhere else on the board: open that tile's card
      const pt = boardPointAt(c.x, c.y), i = pt ? tileAt(pt.x, pt.z) : -1;
      if (i >= 0) { inspect = i; sfx.card(); }
    }
  }
  clicks.length = 0;
  if (inspect >= 0 && (pressed('Space') || pressed('Enter') || pressed('Escape') || pressed('KeyN'))) { inspect = -1; return; }
  if (wheel && scene === 'play') { propScroll = Math.max(0, propScroll + wheel); wheel = 0; }
  if (picker && (pressed('Space') || pressed('Enter') || pressed('Escape'))) { picker = null; return; } // a list open: the keys close it
  if (pressed('Space') || pressed('Enter')) { const b = ui.find(b => b.role === 'primary' && b.enabled); if (b) { pressBtn(b); return; } }
  if (pressed('KeyN') || pressed('Escape')) { const b = ui.find(b => (b.role === 'secondary' || b.role === 'menuSecondary') && b.enabled); if (b) { pressBtn(b); return; } }
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
  if ((b.role === 'menu' || b.role === 'menuSecondary') && !drawingMenu) return;
  if (b.role === 'room') { // the room code: a small gold pill
    ctx.save(); ctx.fillStyle = '#5a2a1c'; rrect(ctx, b.x, b.y, b.w, b.h, b.h / 2); ctx.fill();
    ctx.strokeStyle = '#f2c44a'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
    text(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1, L.phone ? 15 : 15, '#f2c44a', 'center', 'bold');
    return;
  }
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
/** A piece's face for the HUD: its zodiac animal (src/animals.ts). */
function drawTokenIcon(animal: number, x: number, y: number, s: number, color: string) { drawAnimalIcon(ctx, animal, x, y, s, color); }
function drawPanel() {
  lacquer(PX, 0, PW, H);
  text('TỶ PHÚ ĐẤT VIỆT', PX + PW / 2 + 14, 30, 24, '#f2c44a', 'center', 'bold');
  const roundTxt = state.mode === 'rounds' ? `Vòng ${Math.min(state.round, maxRounds())} / ${maxRounds()}` : `Vòng ${state.round} · tới khi phá sản`;
  if (roomCode) text(state.mode === 'rounds' ? `Vòng ${Math.min(state.round, maxRounds())}/${maxRounds()}` : `Vòng ${state.round}`, PX + 24, 59, 16, '#e8d9b5', 'left');
  else text(roundTxt, PX + PW / 2, 58, 16, '#e8d9b5');
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
    const sub = (state.teams ? `${teamTag(p.team)} · ` : '') + (isAI(p) ? `Máy ${AI_LEVELS[p.lv]}` : p.kind === 'remote' ? (p.offline ? 'Online · mất kết nối' : 'Online') : 'Người chơi') + ` · ${owned(pi).length} ô` + (firstLap(p) && !p.bankrupt ? ' · vòng đầu' : '') + (p.inJail ? ' · trong tù' : '') + (p.noSalary ? ' · mất lương' : '') + (p.freeCards.length ? ' · có thẻ ra tù' : '') + (hasKeep(p, 'norent') ? ' · thẻ miễn thuê' : '') + (hasKeep(p, 'reroll') ? ' · thẻ đổ lại' : '') + (p.bankrupt ? ' · phá sản' : '');
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
  const t = TILES[i], w = 330, h = t.sp ? 382 : 360, x = cx - w / 2, y = cy - h / 2;
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
      const r = Math.round(t.p! * rentPct(l) * tune.rent_scale); // the same exact sum rentOf charges
      const here = state.owner[i] >= 0 && state.level[i] === l;
      if (here) { ctx.fillStyle = 'rgba(242,196,74,0.35)'; ctx.fillRect(x + 16, yy - 11, w - 32, 22); }
      text(LEVEL_NAMES[l] + (l === 6 ? `: ${t.lm}` : ''), x + 22, yy, 15, '#3a2416', 'left');
      text(money(r), x + w - 22, yy, 15, '#3a2416', 'right', here ? 'bold' : '');
      yy += 22;
    }
    text(`Gom đủ nhóm: thuê × ${tune.full_group_mult}`, cx, yy + 6, 15, '#8a3a24', 'center', 'bold'); yy += 30;
    if (t.sp) text(`Đặc sản: ${t.sp}`, cx, yy + 4, 15, '#5a3d2b', 'center', 'italic');
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
  drawOrder();
  if (state.phase === 'roll' && human && !state.shaking) messageBox([`Lượt của ${p.name}${state.rolledDouble ? ': đổ đôi, được đổ tiếp!' : ''}`], cx, my(322), 460);
  if (state.phase === 'jail' && human && !state.shaking) messageBox([`${p.name} đang ở tù. Đổ được đôi thì ra ngay (lượt ${p.jailTries + 1}/3; ở đủ 3 lượt thì lượt sau được ra).${p.noSalary ? (p.freeCards.length ? ' Dùng Thẻ Ra Tù thì được nhận lương lại!' : ' Lần qua Xuất Phát tới sẽ mất lương.') : ''}`], cx, my(312), 520);
  if (state.phase === 'end' && human) messageBox([`${p.name}: hết lượt. Quản lý tài sản ${L.phone ? 'ở nút Tài sản' : 'ở bên phải'} nếu cần.`], cx, my(318), 640);
  if (!pop && state.phase !== 'pick' && state.phase !== 'debt') return;
  if (state.phase === 'pick') { messageBox([human ? 'Vé máy bay: bấm một ô trên bàn cờ (hoặc dùng phím mũi tên) để bay tới.' : `${p.name} đang chọn nơi bay tới...`], cx, my(545), 600); return; }
  if (state.phase === 'debt') { const d = state.debt; messageBox([`${p.name} cần trả ${money(d.total)}, đang có ${money(p.cash)}.`, `Bán bớt nhà hoặc cầm cố đất ${L.phone ? 'ở nút Tài sản' : 'ở danh sách bên phải'}, rồi bấm Trả nợ.`], cx, L.phone ? L.msgY - 24 : 520, 620); return; }
  if (pop.kind === 'rentChoice' || pop.kind === 'reroll') {
    tileCard(pop.tile, cx, cy - 10);
    messageBox([pop.kind === 'rentChoice' ? `${p.name} phải trả ${money(pop.rent)}. Dùng Thẻ Miễn Thuê?` : `Sắp dẫm vào ${TILES[pop.tile].n}: trả ${money(pop.rent)}. Dùng Thẻ Đổ Lại?`], cx, my(548), 600);
    if (!human) messageBox([`${p.name} đang suy nghĩ...`], cx, my(600), 420);
    return;
  }
  if (pop.kind === 'notax') { messageBox([`Vòng đầu tiên (chưa qua Xuất Phát): miễn ${TILES[pop.tile].n}!`], cx, L.phone ? L.popCy : 330, 560); return; }
  if (pop.kind === 'buy' || pop.kind === 'build' || pop.kind === 'rent' || pop.kind === 'nobuy') {
    tileCard(pop.tile, cx, cy - 10);
    if (pop.kind === 'rent') messageBox([`${p.name} trả ${state.players[pop.owner].name} ${money(pop.rent)}`], cx, my(548), 520);
    if (pop.kind === 'build') messageBox([`Đất của bạn! Xây thêm 1 cấp?`], cx, my(548), 420);
    if (pop.kind === 'nobuy') messageBox([`Vòng đầu tiên (chưa qua Xuất Phát): chưa được mua, chỉ ghé xem.`], cx, my(548), 600);
    if (!human && pop.kind !== 'rent' && pop.kind !== 'nobuy') messageBox([`${p.name} đang suy nghĩ...`], cx, my(548), 420);
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
  tax: (t: Tile) => [t.kind === 'income' ? `Trả cố định ${money(tune.income_tax)}. Tiền vào hũ giữa bàn.` : `Trả ${Math.round(tune.prop_tax_pct * 100)}% tiền mặt đang có, tối đa ${money(tune.prop_tax_flat)}. Tiền vào hũ giữa bàn.`, 'Vòng đầu (chưa qua Xuất Phát lần nào): được miễn.'],
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
  // a phone puts it between the toolbar and the card, a wide screen above the card; long lists shrink to fit
  if (here.length) fitText(`Đang đứng ở đây: ${here.join(', ')}`, L.cx, L.phone ? L.by + 60 : 140, W - 24, 16, '#fff8e6');
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
  text('TỶ PHÚ ĐẤT VIỆT', 12, L.by / 2, 17, '#f2c44a', 'left', 'bold');
  const roundTxt = state.mode === 'rounds' ? `Vòng ${Math.min(state.round, maxRounds())}/${maxRounds()}` : `Vòng ${state.round}`;
  if (roomCode) { // in the gap between the rules pill and the room pill, smaller if it does not fit
    const r = rulesSpot(), left = r.x + r.w + 6, right = roomPill().x - 6;
    fitText(roundTxt, (left + right) / 2, L.by / 2, right - left, 15, '#e8d9b5', '');
  } else text(roundTxt, W - 64, L.by / 2, 15, '#e8d9b5', 'right');
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
    const tag = (state.teams ? `Đ${(p.team ?? 0) + 1} · ` : '') + (p.bankrupt ? 'phá sản' : p.inJail ? 'trong tù' : p.kind === 'remote' && p.offline ? 'mất mạng' : `${owned(pi).length} ô`);
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
    ? { seatX: 246, seatW: 226, seatH: 52, y0: 178, step: 64, modeDy: 8, start: [16, 560, 448, 60], online: [16, 632, 448, 56], leave: [16, 600, 448, 60], rejoin: [16, 700, 448, 56], rejoin2: [16, 766, 448, 48] }
    : { seatX: BW / 2 - 20, seatW: 300, seatH: 50, y0: 250, step: 62, modeDy: 10, start: [BW / 2 - 290, 600, 280, 60], online: [BW / 2 + 10, 600, 280, 60], leave: [BW / 2 - 140, 600, 280, 60], rejoin: [PX + 24, 610, PW - 48, 56], rejoin2: [PX + 24, 672, PW - 48, 40] };
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
    : isHost() ? `Gửi mã ${roomCode} cho bạn bè: họ sẽ vào chỗ "Chờ bạn online"` : 'Bấm vào chỗ ngồi, con vật hay kiểu ván để chọn từ danh sách';
  ctx.font = `15px ${FONT}`;
  wrapLines(ctx, hint, W - 40).slice(0, 2).forEach((l, j) => text(l, W / 2, 130 + j * 20, 15, isGuest() || isHost() ? '#f2c44a' : '#cbb994'));
  const seatsShown: Seat[] = isGuest() ? (lobby ? lobby.seats : []) : setup.seats;
  seatsShown.forEach((s, i) => {
    const y = T.y0 + i * T.step, cy = y + T.seatH / 2;
    drawSeatAnimal(i, 34, cy, 24, s);
    text(ANIMALS[seatAnimal(i)].name, 66, cy, 17, s.kind === 'off' ? '#7a6a5a' : '#fff8e6', 'left', 'bold');
    if (isGuest() && titleTeams()) text(teamTag(teamOfSeat(i)), T.seatX - 52, cy, 15, '#f2c44a', 'center', 'bold');
    if (isGuest()) {
      ctx.save(); ctx.fillStyle = i === mySeat ? '#5a2a1c' : '#2c140f'; rrect(ctx, T.seatX, y, T.seatW, T.seatH, 12); ctx.fill();
      ctx.strokeStyle = i === mySeat ? '#f2c44a' : '#6a4a2a'; ctx.lineWidth = i === mySeat ? 3 : 1; ctx.stroke(); ctx.restore();
      text(seatLabel(s, i) + (i === mySeat ? ' (bạn)' : ''), T.seatX + T.seatW / 2, cy, 15, '#fff8e6', 'center', 'bold');
    }
  });
  const modeY = T.y0 + 4 * T.step + T.modeDy + T.seatH / 2;
  text('Kiểu ván', 64, modeY, 16, '#fff8e6', 'left', 'bold');
  if (isGuest() && lobby) text(kindLabel(lobby.mode, lobby.rounds ?? tune.max_rounds, false, !!lobby.teams), T.seatX + T.seatW / 2, modeY, 15, '#fff8e6', 'center', 'bold');
  ui.forEach(drawButton);
  if (roomCode) {
    ctx.save(); ctx.fillStyle = '#5a2a1c'; rrect(ctx, 60, 712, W - 120, 96, 14); ctx.fill(); ctx.strokeStyle = '#f2c44a'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
    text('MÃ PHÒNG', W / 2, 734, 15, '#e8d9b5', 'center', 'bold');
    text(roomCode, W / 2, 776, 42, '#f2c44a', 'center', 'bold');
  }
  const tips = ['Giữ nút để lắc xúc xắc, thả ra để ném.', 'Chạm vào một ô trên bàn cờ để xem thông tin.', 'Dẫm lại đất của mình: xây thêm 1 cấp.'];
  tips.forEach((t, j) => text(t, W / 2, 846 + j * 26, 14, '#cbb994'));
  drawNetBanner();
  drawPicker();
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
    text(p.name + (state.teams ? ` · ${teamTag(p.team)}` : ''), 86, y - 10, 17, '#fff8e6', 'left', 'bold');
    text(r.bankrupt ? 'Phá sản' : `Tài sản ${money(r.worth)}`, 86, y + 13, 15, r.bankrupt ? '#ff9a8a' : '#e8d9b5', 'left');
  });
  drawSummary(26, 350 + state.ranking!.length * 62, W - 52);
  if (isGuest() && !state.vote) text('Bấm Chơi lại để bỏ phiếu ván mới', W / 2, 800, 16, '#e8d9b5');
  ui.forEach(drawButton);
  drawNetBanner();
  drawVote();
}

// ---- Fast forward ---------------------------------------------------------------------------
// A button runs the computer's turns at ×2 or ×4: its shake, its throw, its hops and its thinking.
// A person's turn always runs at its own pace. Online, the host's button sets it for everyone.
const SPEEDS = [1, 2, 4];
let gameSpeed = 1;
const checkedRun = params.has('seed') || CHEAP || params.get('manual') === '1' || !!window.GAME_CLOCK; // a check always runs at ×1
try { gameSpeed = !checkedRun && SPEEDS.includes(Number(localStorage.getItem('tpdv-speed'))) ? Number(localStorage.getItem('tpdv-speed')) : 1; } catch { gameSpeed = 1; }
/** How much faster this step runs: the computer's turns at the chosen speed, everything else at 1. */
function turnSpeed(): number {
  if (!state || !state.players || state.phase === 'over' || state.vote) return 1;
  const p = curP();
  const computer = isAI(p) || (p.kind === 'remote' && !peerOnline(p.peer));
  return computer ? gameSpeed : 1;
}
function cycleSpeed() {
  gameSpeed = SPEEDS[(SPEEDS.indexOf(gameSpeed) + 1) % SPEEDS.length];
  try { localStorage.setItem('tpdv-speed', String(gameSpeed)); } catch { /* not kept: fine */ }
}
/** Where the speed button sits: under the sound button, or beside the phone's property button. */
function speedSpot(): { x: number; y: number; w: number; h: number } {
  return L.phone ? { x: W - 78, y: L.btnY + 64, w: 64, h: 44 } : { x: W - 60, y: 48, w: 48, h: 26 };
}

// ---- The pieces' moods ---------------------------------------------------------------------------
// Every screen works them out from the state it sees, so a friend online sees the same: a piece
// breathes, bounces while its player is to throw, jumps and spins when it buys or builds, hops when
// money comes in, shivers when it pays, hangs its head in jail, and the winner dances at the end.
type MoodKind = 'happy' | 'hop' | 'shiver';
const MOOD_TIME: Record<MoodKind, number> = { happy: 1.0, hop: 0.5, shiver: 0.6 };
const MOOD_RANK: Record<MoodKind, number> = { hop: 0, shiver: 1, happy: 2 };
const moods: ({ kind: MoodKind; t: number } | null)[] = [];                       // by seat
const moodPrev: ({ props: number; levels: number; cash: number } | undefined)[] = []; // by seat
let animT = 0; // the pieces' own clock, stepped with the game so the checks repeat
function setMood(k: number, kind: MoodKind) {
  const m = moods[k];
  if (m && MOOD_RANK[m.kind] > MOOD_RANK[kind]) return;
  moods[k] = { kind, t: 0 };
}
/** Notices what just happened to each player and sets their piece's mood. */
function moodStep(dt: number) {
  animT += dt;
  if (!state.players) return;
  state.players.forEach((p, pi) => {
    const k = p.id, props = state.owner.filter(o => o === pi).length, levels = levelsOf(pi), was = moodPrev[k];
    if (was && !state.ordering && !p.bankrupt) {
      if (props > was.props || levels > was.levels) { setMood(k, 'happy'); rawSfx.animal(p.token); }
      else if (was.cash - p.cash >= tune.mood_loss) setMood(k, 'shiver');
      else if (p.cash - was.cash >= tune.mood_gain) setMood(k, 'hop');
    }
    moodPrev[k] = { props, levels, cash: p.cash };
    const m = moods[k];
    if (m) { m.t += dt; if (m.t >= MOOD_TIME[m.kind]) moods[k] = null; }
  });
}
/** Moves a piece's inner figure for its mood: lift, spin, tilt and squash. */
function applyMood(inner: THREE.Object3D | undefined, p: Player) {
  if (!inner) return;
  const k = p.id, ph = k * 1.7, moving = !!tokAnim[k], cur = p === curP() && state.phase !== 'over';
  let y = 0, spin = 0, tilt = 0, roll = 0, sy = 1 + 0.035 * Math.sin(animT * 3 + ph), sx = 1 - 0.018 * Math.sin(animT * 3 + ph);
  if (p.inJail) { tilt = -0.3; roll = 0.07 * Math.sin(animT * 1.3 + ph); sy *= 0.93; }
  else if (cur && !moving && (state.phase === 'roll' || state.phase === 'order')) y = Math.abs(Math.sin(animT * 4.5)) * 0.06;
  if (cur && state.shaking) roll = 0.14 * Math.sin(animT * 32);
  const m = moods[k];
  if (m && !moving) {
    const u = Math.min(1, m.t / MOOD_TIME[m.kind]);
    if (m.kind === 'happy') {
      y = Math.sin(Math.PI * u) * 0.3; spin = (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2) * Math.PI * 2;
      const land = u < 0.12 ? 1 - u / 0.12 : u > 0.88 ? (u - 0.88) / 0.12 : 0; sy *= 1 - 0.18 * land; sx *= 1 + 0.1 * land;
    } else if (m.kind === 'hop') y = Math.sin(Math.PI * u) * 0.12;
    else { roll = Math.sin(u * 42) * 0.2 * (1 - u); sy *= 0.94; }
  }
  const champ = state.ranking ? state.players[state.ranking[0].i] : undefined;
  if (scene === 'results' && champ && (champ === p || (state.teams && champ.team === p.team))) { // the winner (a whole team) dances
    y = Math.abs(Math.sin(animT * 3.6)) * 0.22; spin = Math.sin(animT * 1.8) * 0.9; tilt = 0;
  }
  inner.position.y = y; inner.rotation.set(roll, spin, tilt); inner.scale.set(sx, sy, sx);
}

// ---- The toolbar: the game's history, quick emotes online ----------------------------------
/** The row of small pills: over the board's top-left corner on a phone, its bottom-left on a wide screen. */
function buildToolbar() {
  let x = 12; const y = L.phone ? L.by + 6 : H - 42, h = L.phone ? 32 : 30;
  const pill = (w: number, label: string, fn: () => void) => { btn(x, y, w, h, label, fn, 'room'); x += w + 8; };
  pill(84, 'Lịch sử', () => { if (isGuest()) sendAct('history'); else showHistory(state.history || []); });
  if (roomCode) pill(96, 'Biểu cảm', () => { emoteMenu = !emoteMenu; roomMenu = false; inspect = -1; sheetOpen = false; });
}
const EMOTES = ['Haha!', 'Trả tiền đi!', 'Hên quá!', 'Xui thế!', 'Nhanh lên!', 'Cảm ơn nha!', 'Chờ đó!', 'Hay lắm!'];
let emoteMenu = false;
const emoteLast: number[] = [];       // host: when each seat last sent one, so nobody floods the table
const emoteSeen = new Set<string>();  // the bubbles already heard here, so each pops once
/** Host: a player sends a quick emote; it shows over their piece for everyone. */
function hostEmote(seat: number, i: unknown) {
  if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= EMOTES.length) return;
  if (state.t - (emoteLast[seat] ?? -99) < tune.emote_gap) return;
  emoteLast[seat] = state.t;
  (state.emotes ||= []).push({ seat, i, t: 0, id: `${seat}:${state.t.toFixed(2)}` });
}
/** How long a bubble stays: a typed line longer than a ready-made emote. */
const bubbleLife = (e: { text?: string }): number => (e.text ? tune.chat_time : tune.emote_time);
const chatLast: number[] = []; // host: when each seat last chatted
const chatPrev: string[] = []; // host: each seat's last line, so the same line is not sent twice in a row
/** Host: a player's typed line, cleaned (src/game/chat.ts) and shown over their piece and in the log. */
function hostChat(seat: number, raw: unknown) {
  const text = cleanChat(raw, tune.chat_max_len), p = state.players.find(q => q.id === seat);
  if (!text || !p) return;
  if (state.t - (chatLast[seat] ?? -99) < tune.chat_gap) return;   // too soon after the last one
  if (text === chatPrev[seat] && state.t - (chatLast[seat] ?? -99) < 30) return; // the same line again
  chatLast[seat] = state.t; chatPrev[seat] = text;
  (state.emotes ||= []).push({ seat, i: -1, text, t: 0, id: `c${seat}:${state.t.toFixed(2)}` });
  log(`${p.name}: ${text}`);
}
/** This screen's player sends a line: the host shows it, a friend sends it to the host. */
function sendChat(raw: string) {
  if (isGuest()) net.toHost({ k: 'act', act: 'chat', text: String(raw).slice(0, tune.chat_max_len * 2) });
  else hostChat(0, raw); // the host always sits in seat 0
}
setChatSender(sendChat);
function sendEmote(i: number) {
  emoteMenu = false;
  if (isGuest()) sendAct('emote', i); else hostEmote(0, i); // the host always sits in seat 0
}
function buildEmoteMenu() {
  const bw = L.phone ? 200 : 180, bh = 48, cols = L.phone ? 2 : 4, x0 = L.cx - (cols * bw + (cols - 1) * 10) / 2, y0 = L.phone ? 400 : 270;
  EMOTES.forEach((e, k) => btn(x0 + (k % cols) * (bw + 10), y0 + Math.floor(k / cols) * (bh + 10), bw, bh, e, () => sendEmote(k), 'menu', true, '#8a5a2a'));
  const rows = Math.ceil(EMOTES.length / cols);
  btn(L.cx - 170, y0 + rows * (bh + 10) + 6, 160, 46, 'Nhắn tin…', () => { emoteMenu = false; showChat(true); }, 'menu', true, '#2b6cd6');
  btn(L.cx + 10, y0 + rows * (bh + 10) + 6, 160, 46, 'Đóng', () => { emoteMenu = false; }, 'menuSecondary', true, '#6a4a2a');
}
function drawEmoteMenu() {
  if (!emoteMenu || !roomCode) return;
  ctx.save(); ctx.fillStyle = 'rgba(10,5,3,0.55)'; ctx.fillRect(0, 0, W, H); ctx.restore();
  text('Gửi biểu cảm', L.cx, L.phone ? 370 : 240, 24, '#f2c44a', 'center', 'bold');
  drawingMenu = true; ui.forEach(b => { if (b.role === 'menu' || b.role === 'menuSecondary') drawButton(b); }); drawingMenu = false;
}
/** The speech bubbles over the pieces, with a pop the first time each one shows. */
function drawEmotes() {
  for (const e of state.emotes || []) {
    const v = tokVis[e.seat], p = state.players[e.seat];
    if (!v || !p) continue;
    if (!emoteSeen.has(e.id)) { if (emoteSeen.size > 200) emoteSeen.clear(); emoteSeen.add(e.id); rawSfx.emote(); }
    const s = project(v.x, BOARD_TOP + v.y + 1.1, v.z), msg = e.text ?? (EMOTES[e.i] || ''), fs = e.text ? (L.phone ? 15 : 16) : (L.phone ? 17 : 18);
    const pop = Math.min(1, e.t / 0.15), fade = Math.max(0, Math.min(1, (bubbleLife(e) - e.t) / 0.4));
    ctx.save(); ctx.globalAlpha = fade;
    ctx.font = `bold ${fs}px "Segoe UI", Arial, sans-serif`;
    let lines = wrapLines(ctx, msg, L.phone ? 260 : 300);
    if (lines.length > 3) { lines = lines.slice(0, 3); lines[2] = lines[2].replace(/.{0,2}$/u, '…'); }
    const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 24, h = 14 + lines.length * (fs + 4), x = Math.max(6, Math.min(W - 6 - w, s.x - w / 2)), y = s.y - h - 10 - (1 - pop) * 8;
    ctx.fillStyle = '#fff8e6'; ctx.strokeStyle = p.color; ctx.lineWidth = 3;
    rrect(ctx, x, y, w, h, 14); ctx.fill(); ctx.stroke();
    const tx = Math.max(x + 16, Math.min(x + w - 16, s.x));
    ctx.beginPath(); ctx.moveTo(tx - 8, y + h - 1); ctx.lineTo(tx + 8, y + h - 1); ctx.lineTo(s.x, y + h + 10); ctx.closePath(); ctx.fill();
    lines.forEach((l, j) => text(l, x + w / 2, y + 7 + (fs + 4) * (j + 0.5) + 1, fs, '#2a1a10', 'center', 'bold'));
    ctx.restore();
  }
}

// ---- Installing as an app, and keeping the screen on -------------------------------------------
// Served over http(s), the page offers its manifest and service worker, so a phone can add it to the
// home screen and open it full screen. Opened from a file (the checks), none of this is asked for.
if (location.protocol.startsWith('http') && !import.meta.env.DEV) {
  const add = (rel: string, href: string) => { const l = document.createElement('link'); l.rel = rel; l.href = href; document.head.appendChild(l); };
  add('manifest', './manifest.webmanifest');
  add('apple-touch-icon', './icons/apple-touch-icon.png');
  for (const [name, content] of [['apple-mobile-web-app-capable', 'yes'], ['mobile-web-app-capable', 'yes'], ['apple-mobile-web-app-title', 'Tỷ Phú'], ['apple-mobile-web-app-status-bar-style', 'black-translucent']]) {
    const m = document.createElement('meta'); m.name = name; m.content = content; document.head.appendChild(m);
  }
  if ('serviceWorker' in navigator) {
    const register = () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* no app install: the game still plays */ }); };
    if (document.readyState === 'complete') register(); else addEventListener('load', register); // the game may start after the page's load event
  }
}
let wakeLock: { release(): Promise<void> } | null = null;
/** Keeps a phone's screen on while a game is being played, and lets it sleep otherwise. */
async function keepAwake() {
  const want = scene === 'play' && document.visibilityState === 'visible';
  const nav = navigator as Loose;
  if (want && !wakeLock && nav.wakeLock) {
    try { wakeLock = await nav.wakeLock.request('screen'); (wakeLock as Loose).addEventListener?.('release', () => { wakeLock = null; }); } catch { wakeLock = null; }
  } else if (!want && wakeLock) {
    const w = wakeLock; wakeLock = null; w.release().catch(() => { /* already released */ });
  }
}
setInterval(keepAwake, 2000);
document.addEventListener('visibilitychange', () => { keepAwake(); });

/** Where the rules button sits: the title's corner, the panel's top, or the phone's header. */
function rulesSpot(): { x: number; y: number; w: number; h: number } {
  if (scene === 'title') return L.phone ? { x: W - 92, y: 6, w: 80, h: 30 } : { x: PX + PW - 104, y: 28, w: 84, h: 32 };
  return L.phone ? { x: 186, y: 9, w: 56, h: 32 } : { x: PX + 14, y: 14, w: 64, h: 30 };
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
      ANIMALS.forEach((an, k) => { drawTokenIcon(k, PX + 50 + (k % 2) * 150, 100 + Math.floor(k / 2) * 56, 40, an.color); text(an.name, PX + 80 + (k % 2) * 150, 100 + Math.floor(k / 2) * 56, 18, '#fff8e6', 'left'); });
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
        : isHost() ? `Gửi mã phòng ${roomCode} cho bạn bè: họ sẽ vào chỗ "Chờ bạn online"` : 'Bấm vào chỗ ngồi, con vật hay kiểu ván để chọn từ danh sách';
      text(hint, BW / 2, 200, 16, isGuest() || isHost() ? '#f2c44a' : '#cbb994');
      const seatsShown: Seat[] = isGuest() ? (lobby ? lobby.seats : []) : setup.seats;
      if (isGuest()) seatsShown.forEach((s, i) => { // a guest sees the seats, not their buttons
        const y = 250 + i * 62;
        ctx.save(); ctx.fillStyle = i === mySeat ? '#5a2a1c' : '#2c140f'; rrect(ctx, BW / 2 - 20, y, 300, 50, 12); ctx.fill();
        ctx.strokeStyle = i === mySeat ? '#f2c44a' : '#6a4a2a'; ctx.lineWidth = i === mySeat ? 3 : 1; ctx.stroke(); ctx.restore();
        text(seatLabel(s, i) + (i === mySeat ? ' (bạn)' : ''), BW / 2 + 130, y + 26, 18, '#fff8e6', 'center', 'bold');
      });
      if (isGuest() && lobby) text(kindLabel(lobby.mode, lobby.rounds ?? tune.max_rounds, true, !!lobby.teams), BW / 2 + 130, 250 + 4 * 62 + 35, 18, '#fff8e6', 'center', 'bold');
      seatsShown.forEach((s, i) => {
        const y = 250 + i * 62 + 25;
        drawSeatAnimal(i, BW / 2 - 300 + 40, y, 26, s);
        text(ANIMALS[seatAnimal(i)].name, BW / 2 - 300 + 78, y, 20, s.kind === 'off' ? '#7a6a5a' : '#fff8e6', 'left', 'bold');
        if (isGuest() && titleTeams()) text(teamTag(teamOfSeat(i)), BW / 2 - 77, y, 18, '#f2c44a', 'center', 'bold');
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
      ui.forEach(b => { if (b.role === 'room') drawButton(b); }); // the rules button sits on the panel
      drawPicker();
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
      if (isGuest()) { updateTokens(dt); syncBuildings(dt); moodStep(dt); return; } // the host runs the turns
      const k = turnSpeed(); // the computer's turns can run faster
      updateTurn(dt * k);
      updateTokens(dt * k); syncBuildings(dt); moodStep(dt);
      keepLocalGame();
      if (state.event) state.event.t += dt;
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
      drawEvent();
      drawTip();
      drawEmotes();
      drawEmoteMenu();
      drawRoomMenu();
      drawVote();
    },
  },
  results: {
    update(dt: number) {
      if (!isGuest()) state.t += dt;
      buildUI(); handleInput();
      updateTokens(dt); syncBuildings(dt); moodStep(dt);
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
        text(p.name + (state.teams ? ` · ${teamTag(p.team)}` : ''), BW / 2 - 194, y, 19, '#fff8e6', 'left', 'bold');
        text(r.bankrupt ? 'Phá sản' : `Tài sản ${money(r.worth)}`, BW / 2 + 246, y, 18, r.bankrupt ? '#ff9a8a' : '#e8d9b5', 'right');
      });
      ui.forEach(drawButton);
      drawPanel();
      drawSummary(PX + 14, 372, PW - 28, H - 16 - 372); // covers the panel's land list, which means little once the game is over
      drawVote();
    },
  },
};
function updateTurn(dt: number) {
  const p = curP();
  if (state.vote) return; // the table is voting: the game waits
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
      else if (p.pos === 0 && state.moveDir > 0) { const pay = salaryNow(); gain(pi, pay, `${p.name} qua Xuất Phát: nhận lương ${money(pay)}${pay !== tune.salary ? ' (Tết: lương × 2)' : ''}.`); }
      state.moveLeft--;
      if (state.moveLeft <= 0) { state.phase = 'landing'; state.timer = 0; }
    }
    return;
  }
  if (state.phase === 'landing') { if (state.timer >= 0.25) resolveLanding(); return; }
  if (state.phase === 'orderShow') { if (state.timer >= tune.order_show_time) nextOrderThrow(); return; }
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
  /** For checks and the balance tools: the seats, the kind of game, the seed and tuning values for the next game, and
   * back to the title screen, where Enter starts it. */
  configure(o: { seats?: Seat[]; mode?: 'bankrupt' | 'rounds'; rounds?: number; teams?: boolean; teamOf?: number[]; seed?: number; tune?: Record<string, number> }) {
    for (const [k, v] of Object.entries(o.tune || {})) if (CONFIG[k] && typeof v === 'number') CONFIG[k].value = v; // try other values
    if (o.seats) setup.seats = o.seats.map(x => ({ ...x }));
    if (o.mode) setup.mode = o.mode;
    if (o.rounds) setup.rounds = o.rounds;
    if (o.teams !== undefined) setup.teams = o.teams;
    if (o.teamOf) setup.teamOf = [...o.teamOf];
    picker = null;
    if (o.seed !== undefined) checkSeed = o.seed;
    scene = 'title'; clearVis();
  },
  get view() { return { inspect, tip: tipNow, picker: picker ? picker.items.map((it, k) => ({ label: it.label, enabled: it.enabled !== false, ...picker!.rects[k] })) : null }; },
  get online() {
    return { role: net.getRole(), code: roomCode, mySeat, seats: isGuest() ? lobby?.seats ?? null : setup.seats, animals: isGuest() ? lobby?.animals ?? null : setup.animals, mode: isGuest() ? lobby?.mode ?? null : setup.mode, rounds: isGuest() ? lobby?.rounds ?? null : setup.rounds, teams: isGuest() ? !!lobby?.teams : setup.teams };
  },
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
