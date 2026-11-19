// Rắn và Thang online: the same room server as the other games (server/server.mjs only relays), its
// own messages, each kind starting with 'snake'. The host's screen runs the game (./game.ts) and sends
// G about 20 times a second with the sounds it played; a friend's screen draws it and sends its presses.
//
//   host -> friends   { k: 'snakeLobby', code, hostName, seats, rules, playing }   the seats and the rules' switches (playing: a game is on)
//                     { k: 'snakeYou', seat }                       which seat is yours
//                     { k: 'snake', scene, g, sfx }                 the game, and the sounds since the last
//                     { k: 'snakeFull', msg }
//   friend -> host    { k: 'snakeAct', act: 'shake' | 'throw' | 'animal' }   (animal: the next animal for my seat)

import * as net from '../net/net';
import { tune, CONFIG } from '../config';
import { rawSfx } from '../net/room';
import { scene, setScene } from '../core/store';
import type { Loose } from '../game/types';
import { G, setG, snakeSetup, newGame, startShake, curP, sounds, recordSounds, RULE_KEYS, history, log } from './game';
import { makeRoomExtras, type RoomGame } from '../net/roomExtras';
import { showHistory } from '../ui/pages';
import type { SnakeSeat } from './rules';
import { keepRoom, lastRoom, hostGame, keepHostGame, keepLocal } from './keep';

export const isHost = (): boolean => net.getRole() === 'host' && active;
export const isGuest = (): boolean => net.getRole() === 'guest' && active;
/** True while this screen is in a Rắn và Thang room. */
let active = false;
export let roomCode = '', myName = '', mySeat = -1;
export let linkUp = false, hostOnline = true;
/** A note for the setup screen (a room that was closed, an error). */
export let note = '';
export function setNote(s: string): void { note = s; }
/** Friend's screen: the host's seats before the game. */
export let lobby: { hostName: string; seats: SnakeSeat[] } | null = null;
const peers = new Map<number, { name: string; online: boolean }>();
export const peerOnline = (id?: number): boolean => id !== undefined && !!peers.get(id)?.online;
let sendEvery = 0;
/** The rules' switches the host picks on its setup screen, sent to the friends so their screens read the same. */
const SHARED = ['snake_dice', 'snake_six_to_start', 'snake_exact_finish'];
/** Friend: holding the shake button, waiting to let go. */
export let guestShaking = false;
/** How the setup screen names an animal and finds the next free one (set by ./scene.ts). */
let names: { animalName: (a: number) => string; nextAnimal: (i: number) => void } = { animalName: a => String(a), nextAnimal: () => {} };
export function useNames(n: typeof names): void { names = n; }

const handlers: net.NetHandlers = {
  onRoom(code) {
    roomCode = code; note = '';
    keepRoom({ code, role: isHost() ? 'host' : 'guest', name: myName, at: Date.now() });
    if (isHost() && restoring) { // a host back after a reload: the game kept for this room, if the server still had it
      restoring = false;
      const k = hostGame(code);
      if (k) { setG(k.g); snakeSetup.seats = k.seats.map(s => ({ ...s })); snakeSetup.seats[0] = { ...snakeSetup.seats[0], kind: 'human', name: myName }; setScene('snake'); }
      else if (restoringCode && restoringCode !== code) note = `Phòng ${restoringCode} đã đóng: đây là phòng mới ${code}, gửi mã mới cho bạn bè nhé.`;
    }
    if (isHost()) sendLobby();
  },
  onPeer(id, name, online, left) {
    if (left) { peerLeft(id, name); return; }
    const known = peers.has(id);
    peers.set(id, { name, online });
    if (!known) seatPeer(id, name);
    const st = snakeSetup.seats.find(s => s.kind === 'remote' && s.peer === id); if (st) st.name = name;
    if (G?.players) for (const p of G.players) if (p.peer === id && online) p.name = name;
    sendLobby();
  },
  onFromPeer(from, d) { if (d && d.k === 'snakeAct') onAct(from, d); },
  onFromHost(d) { onHostMsg(d); },
  onHost(online) { hostOnline = online; },
  onClosed() { goOffline('Chủ phòng đã giải tán phòng Rắn và Thang.'); },
  onLink(up) { linkUp = up; },
  onError(msg) { goOffline(msg); },
};

/** True while a host who came back waits for its room, to put the kept game back. */
let restoring = false, restoringCode = '';
/** Opens a Rắn và Thang room; this screen hosts it and plays seat 1. */
export function createRoom(name: string, fresh = true): void { // fresh: a new room; false: the last one back
  active = true; myName = name; peers.clear(); roomCode = ''; note = '';
  snakeSetup.seats[0] = { ...snakeSetup.seats[0], kind: 'human', name };
  recordSounds(true);
  net.createRoom(name, handlers, 'snake', fresh);
}
/** Joins a friend's Rắn và Thang room by its code. */
/** A friend's own rules' switches, kept while the host's are in force in the room; put back on leaving. */
let ownRules: Record<string, number> | null = null;
export function joinRoom(code: string, name: string): void {
  ownRules ??= Object.fromEntries(RULE_KEYS.map(k => [k, tune[k]])); // the host's rules come with its lobby and game
  active = true; myName = name; mySeat = -1; lobby = null; roomCode = code.trim().toUpperCase(); note = '';
  net.joinRoom(code, name, handlers, 'snake');
}
/** Goes back into the last room: a host gets its room and its game back, a friend their seat. */
export function rejoinRoom(): void {
  const r = lastRoom(); if (!r) return;
  if (r.role === 'host') { restoring = true; createRoom(r.name, false); restoringCode = r.code; } else joinRoom(r.code, r.name);
}
/** Leaves the room (a friend), or closes it for everyone (the host). */
export function leaveRoom(): void {
  if (isGuest()) net.quitRoom(); else if (isHost()) net.closeRoom();
  goOffline('');
}
function goOffline(msg: string): void {
  if (active && net.getRole() !== 'off') net.leave();
  active = false; roomCode = ''; mySeat = -1; lobby = null; peers.clear(); note = msg; guestShaking = false; restoring = false;
  keepRoom(null); // left on purpose, or the room is gone: nothing to go back into
  if (ownRules) { for (const k of RULE_KEYS) CONFIG[k].value = ownRules[k]; ownRules = null; } // a friend back on their own: their own rules again
  recordSounds(false);
  snakeSetup.seats.forEach((s, i) => { if (s.kind === 'remote') snakeSetup.seats[i] = { kind: 'ai', animal: s.animal }; });
  if (scene === 'snake') setScene('snakeSetup');
}

/** Host: a new friend takes the first seat waiting for a friend, else the first computer or empty seat. */
function seatPeer(id: number, name: string): void {
  if (scene === 'snake' && G?.players && G.phase !== 'over') { // a game is on: a friend who dropped gets their seat back
    if (G.players.some(q => q.peer === id)) return;
    const p = G.players.find(q => q.kind === 'remote' && !peerOnline(q.peer) && q.name === name) || G.players.find(q => q.kind === 'remote' && !peerOnline(q.peer));
    if (!p) { net.toOne(id, { k: 'snakeFull', msg: 'Ván đang chơi: chờ ván sau nhé.' }); return; }
    p.peer = id; p.name = name;
    snakeSetup.seats[p.seat] = { ...snakeSetup.seats[p.seat], kind: 'remote', peer: id, name };
    return;
  }
  if (snakeSetup.seats.some(s => s.kind === 'remote' && s.peer === id)) return;
  let i = [1, 2, 3].find(k => snakeSetup.seats[k].kind === 'remote' && snakeSetup.seats[k].peer === undefined);
  if (i === undefined) i = [1, 2, 3].find(k => snakeSetup.seats[k].kind === 'ai' || snakeSetup.seats[k].kind === 'off');
  if (i === undefined) { net.toOne(id, { k: 'snakeFull', msg: 'Phòng đã đủ người.' }); return; }
  snakeSetup.seats[i] = { ...snakeSetup.seats[i], kind: 'remote', peer: id, name };
}
/** Host: a friend left for good: before a game the seat waits for someone new; in a game the computer plays it. */
function peerLeft(id: number, name: string): void {
  peers.delete(id);
  const i = snakeSetup.seats.findIndex(s => s.kind === 'remote' && s.peer === id);
  if (i >= 0) snakeSetup.seats[i] = { kind: 'remote', animal: snakeSetup.seats[i].animal };
  if (G?.players) for (const p of G.players) if (p.peer === id) { p.kind = 'ai'; delete p.peer; G.log.unshift(`${name || p.name} đã rời phòng, máy chơi thay.`); }
  sendLobby();
}
/** Host: the seats, and each friend's own seat. */
export function sendLobby(): void {
  if (!isHost()) return;
  net.toAll({ k: 'snakeLobby', code: roomCode, hostName: myName, seats: snakeSetup.seats.map(s => ({ ...s })), rules: Object.fromEntries(SHARED.map(k => [k, tune[k]])), playing: scene === 'snake' });
  for (const id of peers.keys()) {
    const p = G?.players?.find(q => q.peer === id);
    net.toOne(id, { k: 'snakeYou', seat: p ? p.seat : snakeSetup.seats.findIndex(s => s.kind === 'remote' && s.peer === id) });
  }
}
/** What the room screen's buttons need from the scene: set by src/snake/scene.ts. */
export const roomUi = { btn: (() => {}) as (x: number, y: number, w: number, h: number, label: string, fn: () => void, role: string, enabled?: boolean, color?: string) => void, cx: () => 0, phone: () => false };
/** Emotes, chat and the vote for a new game, as Cờ Tỷ Phú's room has them (src/net/roomExtras.ts). */
export const extras = makeRoomExtras({
  G: () => (G?.players ? G as unknown as RoomGame : null),
  isHost, isGuest, peerOnline,
  mySlot: () => (G?.players ? G.players.findIndex(p => p.seat === (isGuest() ? mySeat : 0)) : -1),
  sendAct: (act, extra) => net.toHost({ k: 'snakeAct', act, ...extra }),
  restart: () => hostNewGame(),
  log,
  btn: (...a) => roomUi.btn(...a), cx: () => roomUi.cx(), phone: () => roomUi.phone(),
});
/** Host: starts the game for everyone; friends' names come from their seats. */
export function hostNewGame(): void {
  newGame(undefined, snakeSetup.seats.map(s => s.name), names.animalName);
}

/** Host: a friend's press, counted only on their own turn (or their own seat, for the animal). */
function onAct(from: number, a: Loose): void {
  if (a.act === 'history') { if (scene === 'snake') net.toOne(from, { k: 'snakeHistory', list: history }); return; } // "Lịch sử" on a friend's screen
  if (scene === 'snake' && extras.onAct(from, a)) return; // an emote, a line, a vote: any friend in the game, any time
  if (a.act === 'animal') {
    const i = snakeSetup.seats.findIndex(s => s.kind === 'remote' && s.peer === from);
    if (i >= 0 && scene === 'snakeSetup') { names.nextAnimal(i); sendLobby(); }
    return;
  }
  if (scene !== 'snake' || !G?.players) return;
  const p = curP();
  if (p.kind !== 'remote' || p.peer !== from) return;
  if (a.act === 'shake' && G.phase === 'roll') { startShake(); if (G.shake) G.shake.remote = true; }
  else if (a.act === 'throw' && G.shake?.remote) G.shake.released = true;
}
/** Friend: a press for the host. */
/** "Lịch sử": the whole game's lines (a friend asks the host, who keeps them). */
export function openHistory(): void { if (isGuest()) sendAct('history'); else showHistory(history); }
export function sendAct(act: string): void {
  net.toHost({ k: 'snakeAct', act });
  if (act === 'shake') guestShaking = true;
}

/** Friend: a message from the host. */
function onHostMsg(d: Loose): void {
  if (!d || typeof d.k !== 'string') return;
  if (!d.k.startsWith('snake')) {
    const other = d.k.startsWith('ludo') ? 'Cá Ngựa' : d.k.startsWith('caro') ? 'Cờ Caro' : 'Cờ Tỷ Phú';
    goOffline(`Mã này là phòng ${other}: về sảnh, chọn ${other} rồi vào phòng nhé.`); setScene('snakeSetup'); return;
  }
  if (d.k === 'snakeYou') mySeat = d.seat;
  else if (d.k === 'snakeHistory') showHistory(Array.isArray(d.list) ? d.list : []);
  else if (d.k === 'snakeFull') note = d.msg;
  else if (d.k === 'snakeLobby') { lobby = { hostName: d.hostName, seats: d.seats }; for (const k of SHARED) if (typeof d.rules?.[k] === 'number') CONFIG[k].value = d.rules[k]; if (scene === 'snake' && !d.playing) setScene('snakeSetup'); }
  else if (d.k === 'snake') {
    setG(d.g);
    if (scene !== d.scene && (scene === 'snake' || scene === 'snakeSetup')) setScene(d.scene);
    for (const s of d.sfx || []) rawSfx[s[0]]?.(...s.slice(1));
  }
}

let keepEvery = 0;
/** About once a second: the room is remembered as still in use, the host's game and a game on one
 * screen are kept (a game over is forgotten). */
function keepStep(): void {
  if (++keepEvery < 60) return;
  keepEvery = 0;
  if (active && roomCode) keepRoom({ code: roomCode, role: isHost() ? 'host' : 'guest', name: myName, at: Date.now() });
  if (scene !== 'snake' || !G?.players) return;
  if (isHost()) keepHostGame(G.phase === 'over' ? null : { code: roomCode, g: G, seats: snakeSetup.seats.map(s => ({ ...s })), at: Date.now() });
  else if (!active) keepLocal(G.phase === 'over' ? null : { g: G, seats: snakeSetup.seats.map(s => ({ ...s })) });
}
/** Every step: the host sends the game; a friend lets go of the die when the finger lifts; the game is kept. */
export function snakeNetStep(held: boolean): void {
  keepStep();
  if (isHost()) {
    if (scene === 'snake' && G?.players) {
      if (++sendEvery >= 3 || sounds.length) { sendEvery = 0; net.toAll({ k: 'snake', scene, g: G, sfx: sounds.splice(0) }); }
    } else if (++sendEvery >= 30) { sendEvery = 0; sendLobby(); }
  }
  if (isGuest() && guestShaking && !held) { guestShaking = false; sendAct('throw'); }
}
