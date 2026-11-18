// Online play from the host's side and the friend's: the room, seats, the state sent 20 times a second, coming back after a drop, the vote for a new game. The relay is net/net.ts.

import { tune } from '../config';

import { sfx } from '../audio';
import * as net from '../net/net';
import { W, H, ctx, text, rrect } from '../screen';

import { ANIMALS } from '../game/data';

import { state, scene, setup, setState, setScene } from '../core/store';

import { showHistory } from '../ui/pages';

import type { Loose, Player } from '../game/types';

import { nextAnimal, setAnimal, reset, log, curP, sellLevel, mortgage, unmortgage } from '../game/turn';
import { restoreHostGame } from '../core/keepLocal';
import { buildTurnUI, STEP, pointerHeld, down, btn, L } from '../main';
import { F } from '../core/flags';
import { clearVis } from '../ui/setupScreen';
import { drawButton } from '../ui/draw';
import { hostEmote, hostChat, bubbleLife } from '../ui/toolbar';

// ---- Online play -----------------------------------------------------------------------
// The host's browser runs the rules exactly as on one screen. A friend's seat is 'remote': when it
// is their turn the host builds that turn's buttons unseen, and the friend's acts press them. The
// host sends the whole game state about 20 times a second; a guest's browser draws it, animates
// the tokens, plays the sounds the host played, and sends its own presses back.
export const isHost = (): boolean => net.getRole() === 'host';
export const isGuest = (): boolean => net.getRole() === 'guest';
export let roomCode = '', myName = '', mySeat = -1, myPeerId = -1;
export let linkUp = false, hostOnline = true;
export let lobby: Loose = null;                     // guest: the host's seats before the game starts
const peers = new Map<number, { name: string; online: boolean }>();   // host: friends in the room
let pendingSfx: Loose[] = [];                // host: sounds played since the last state sent
let sendEvery = 0;
export const rawSfx: Record<string, (...a: Loose[]) => void> = {};
for (const k of Object.keys(sfx)) { // the host records each sound so the guests hear it too
  const f = (sfx as Loose)[k] as (...a: Loose[]) => void;
  rawSfx[k] = f;
  (sfx as Loose)[k] = (...a: Loose[]) => { if (isHost() && k !== 'click') pendingSfx.push([k, ...a]); f(...a); };
}
export const peerOnline = (id: number | undefined): boolean => id !== undefined && !!peers.get(id)?.online;

/** Guest: an act for the host (the name of a button, and a tile for 'pick'). */
export function sendAct(act: string, i?: number) {
  net.toHost({ k: 'act', act, i });
}

const handlers: net.NetHandlers = {
  onRoom(code, id) {
    roomCode = code; myPeerId = id; F.netError = '';
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
  onError(msg) { F.netError = msg; roomCode = ''; forgetRoom(); showOnlinePanel(true); },
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
export function sendLobby() {
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
  const saved = F.ui; F.ui = [];
  buildTurnUI();
  const b = F.ui.find(x => x.act === a.act && x.enabled);
  F.ui = saved;
  if (!b) return;
  b.fn();
  if (a.act === 'shake' && state.shaking) state.shaking.remote = true;
}

/** Guest: a message from the host. */
function onHostMsg(d: Loose) {
  if (!d) return;
  if (d.k === 'you') mySeat = d.seat;
  else if (d.k === 'full') { F.netError = d.msg; }
  else if (d.k === 'history') showHistory(d.list || []);
  else if (d.k === 'lobby') { if (lobby && mySeat > 0 && lobby.animals && d.animals && lobby.animals[mySeat] !== d.animals[mySeat]) rawSfx.animal(d.animals[mySeat]); lobby = d; if (scene !== 'title') { setScene('title'); clearVis(); } }
  else if (d.k === 'state') {
    const fresh = scene !== d.scene && d.scene === 'play' && scene === 'title';
    setState(d.state); setScene(d.scene);
    if (fresh) { clearVis(); F.propScroll = 0; }
    for (const s of d.sfx || []) rawSfx[s[0]]?.(...s.slice(1));
  }
}

/** Every step: the host sends the state; a guest lets go of the dice when the finger lifts. */
export function netStep() {
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
  if (isGuest() && F.guestShaking && !(pointerHeld || down.has('Space') || down.has('Enter'))) {
    F.guestShaking = false; sendAct('throw');
  }
}

// The online panel: plain HTML over the canvas, so phones get their own keyboard for the name and code.
export let onlinePanel: HTMLDivElement | null = null;
export function showOnlinePanel(on: boolean) {
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
  setErr(F.netError);
  onlinePanel.style.display = on ? 'flex' : 'none';
}
/** Leaves the room and goes back to playing on this screen. */
/** Leaves the room: a guest frees their seat, a host closes the room for everyone. */
export function leaveRoom() {
  if (isGuest()) net.quitRoom(); else if (isHost()) net.closeRoom(); else net.leave();
  goOffline('');
}
/** Back to playing on this screen, with a note on the title screen when there is one. */
function goOffline(note: string) {
  forgetRoom();
  roomCode = ''; mySeat = -1; lobby = null; peers.clear(); F.netError = note; F.roomMenu = false;
  setup.seats.forEach((s, i) => { if (s.kind === 'remote') setup.seats[i] = { kind: 'ai', lv: 1 }; });
  setScene('title'); reset(); clearVis();
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
export const ROOM_MEMORY_MS = 30 * 60 * 1000; // the server closes an empty room after the same time
export function store(): Storage | null { try { return localStorage; } catch { return null; } }
function rememberRoom(code: string, role: 'host' | 'guest') {
  store()?.setItem('tpdv-room', JSON.stringify({ code, role, at: Date.now() }));
}
function forgetRoom() {
  store()?.removeItem('tpdv-room'); store()?.removeItem('tpdv-host-game');
}
/** The last room, while it can still be open. */
export function lastRoom(): { code: string; role: 'host' | 'guest' } | null {
  try {
    const r = JSON.parse(store()?.getItem('tpdv-room') || 'null');
    return r && Date.now() - r.at < ROOM_MEMORY_MS ? r : null;
  } catch { return null; }
}
let pendingRestore = false; // host: put the kept game back once the room is open again
/** Goes back into the last room: a host reopens it (the server knows the host's key), a guest joins it. */
export function rejoinRoom() {
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
  reset(); clearVis(); setScene('play');
  log('Mọi người đồng ý: bắt đầu ván mới!');
}
/** Asks for a new game. A guest sends it to the host; with nobody else to ask, the game restarts at once. */
export function startVote() {
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
  F.roomMenu = false;
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
export function buildVoteUI() {
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
export function drawVote() {
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
  F.drawingMenu = true; F.ui.forEach(x => { if (x.role === 'menu' || x.role === 'menuSecondary') drawButton(x); }); F.drawingMenu = false;
}

