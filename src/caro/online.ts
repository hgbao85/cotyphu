// Cờ Caro online: the same room server as the other games (server/server.mjs only relays), its own
// messages, each kind starting with 'caro'. The host's screen runs the game (./game.ts) and sends G a
// few times a second with the sounds it played; a friend's screen draws it and sends its taps.
//
//   host -> friend   { k: 'caroLobby', code, hostName, seats, rules, playing }   the seats and the rules' switches (playing: a game is on)
//                    { k: 'caroYou', seat }                       which seat is yours
//                    { k: 'caro', scene, g, sfx }                 the game, and the sounds since the last
//                    { k: 'caroFull', msg }
//                    { k: 'caroHistory', list }
//   friend -> host   { k: 'caroAct', act: 'place', cell } | { act: 'animal' } | { act: 'history' } | the room extras' acts

import * as net from '../net/net';
import { tune, CONFIG } from '../config';
import { rawSfx } from '../net/room';
import { scene, setScene } from '../core/store';
import type { Loose } from '../game/types';
import { G, setG, caroSetup, newGame, playAgain, tryPlace, curP, sounds, recordSounds, RULE_KEYS, history, log } from './game';
import { makeRoomExtras, type RoomGame } from '../net/roomExtras';
import { showHistory } from '../ui/pages';
import type { CaroSeat } from './rules';
import { keepRoom, lastRoom, hostGame, keepHostGame, keepLocal } from './keep';

export const isHost = (): boolean => net.getRole() === 'host' && active;
export const isGuest = (): boolean => net.getRole() === 'guest' && active;
/** True while this screen is in a Cờ Caro room. */
let active = false;
export let roomCode = '', myName = '', mySeat = -1;
export let linkUp = false, hostOnline = true;
/** A note for the setup screen (a room that was closed, an error). */
export let note = '';
export function setNote(s: string): void { note = s; }
/** Friend's screen: the host's seats before the game. */
export let lobby: { hostName: string; seats: CaroSeat[] } | null = null;
const peers = new Map<number, { name: string; online: boolean }>();
export const peerOnline = (id?: number): boolean => id !== undefined && !!peers.get(id)?.online;
let sendEvery = 0;
/** The rules' switches the host picks on its setup screen, sent to the friend so both screens read the same. */
const SHARED = ['caro_block_two'];
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
      if (k) { setG(k.g); caroSetup.seats = k.seats.map(s => ({ ...s })); caroSetup.seats[0] = { ...caroSetup.seats[0], kind: 'human', name: myName }; setScene('caro'); }
      else if (restoringCode && restoringCode !== code) note = `Phòng ${restoringCode} đã đóng: đây là phòng mới ${code}, gửi mã mới cho bạn bè nhé.`;
    }
    if (isHost()) sendLobby();
  },
  onPeer(id, name, online, left) {
    if (left) { peerLeft(id, name); return; }
    const known = peers.has(id);
    peers.set(id, { name, online });
    if (!known) seatPeer(id, name);
    const st = caroSetup.seats.find(s => s.kind === 'remote' && s.peer === id); if (st) st.name = name;
    if (G?.players) for (const p of G.players) if (p.peer === id && online) p.name = name;
    sendLobby();
  },
  onFromPeer(from, d) { if (d && d.k === 'caroAct') onAct(from, d); },
  onFromHost(d) { onHostMsg(d); },
  onHost(online) { hostOnline = online; },
  onClosed() { goOffline('Chủ phòng đã giải tán phòng Cờ Caro.'); },
  onLink(up) { linkUp = up; },
  onError(msg) { goOffline(msg); },
};

/** True while a host who came back waits for its room, to put the kept game back. */
let restoring = false, restoringCode = '';
/** Opens a Cờ Caro room; this screen hosts it and plays seat 1. */
export function createRoom(name: string, fresh = true): void { // fresh: a new room; false: the last one back
  active = true; myName = name; peers.clear(); roomCode = ''; note = '';
  caroSetup.seats[0] = { ...caroSetup.seats[0], kind: 'human', name };
  recordSounds(true);
  net.createRoom(name, handlers, 'caro', fresh);
}
/** A friend's own rules' switches, kept while the host's are in force in the room; put back on leaving. */
let ownRules: Record<string, number> | null = null;
/** Joins a friend's Cờ Caro room by its code. */
export function joinRoom(code: string, name: string): void {
  ownRules ??= Object.fromEntries(RULE_KEYS.map(k => [k, tune[k]]));
  active = true; myName = name; mySeat = -1; lobby = null; roomCode = code.trim().toUpperCase(); note = '';
  net.joinRoom(code, name, handlers, 'caro');
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
  active = false; roomCode = ''; mySeat = -1; lobby = null; peers.clear(); note = msg; restoring = false;
  keepRoom(null);
  if (ownRules) { for (const k of RULE_KEYS) CONFIG[k].value = ownRules[k]; ownRules = null; } // a friend back on their own: their own rules again
  recordSounds(false);
  caroSetup.seats.forEach((s, i) => { if (s.kind === 'remote') caroSetup.seats[i] = { kind: 'ai', lv: 1, animal: s.animal }; });
  if (scene === 'caro') setScene('caroSetup');
}

/** Host: the friend takes the second seat (a friend who dropped out of a game gets it back). */
function seatPeer(id: number, name: string): void {
  if (scene === 'caro' && G?.players && G.phase !== 'over') {
    if (G.players.some(q => q.peer === id)) return;
    const p = G.players.find(q => q.kind === 'remote' && !peerOnline(q.peer));
    if (!p) { net.toOne(id, { k: 'caroFull', msg: 'Ván đang chơi: chờ ván sau nhé.' }); return; }
    p.peer = id; p.name = name;
    caroSetup.seats[p.seat] = { ...caroSetup.seats[p.seat], kind: 'remote', peer: id, name };
    return;
  }
  if (caroSetup.seats.some(s => s.kind === 'remote' && s.peer === id)) return;
  const s = caroSetup.seats[1];
  if (s.kind === 'remote' && s.peer !== undefined && peerOnline(s.peer)) { net.toOne(id, { k: 'caroFull', msg: 'Phòng đã đủ hai người.' }); return; }
  caroSetup.seats[1] = { ...s, kind: 'remote', peer: id, name };
}
/** Host: the friend left for good: before a game the seat waits for someone new; in a game the computer plays it. */
function peerLeft(id: number, name: string): void {
  peers.delete(id);
  const i = caroSetup.seats.findIndex(s => s.kind === 'remote' && s.peer === id);
  if (i >= 0) caroSetup.seats[i] = { kind: 'remote', animal: caroSetup.seats[i].animal };
  if (G?.players) for (const p of G.players) if (p.peer === id) { p.kind = 'ai'; p.lv = 1; delete p.peer; G.log.unshift(`${name || p.name} đã rời phòng, máy chơi thay.`); }
  sendLobby();
}
/** Host: the seats, and the friend's own seat. */
export function sendLobby(): void {
  if (!isHost()) return;
  net.toAll({ k: 'caroLobby', code: roomCode, hostName: myName, seats: caroSetup.seats.map(s => ({ ...s })), rules: Object.fromEntries(SHARED.map(k => [k, tune[k]])), playing: scene === 'caro' });
  for (const id of peers.keys()) {
    const p = G?.players?.find(q => q.peer === id);
    net.toOne(id, { k: 'caroYou', seat: p ? p.seat : caroSetup.seats.findIndex(s => s.kind === 'remote' && s.peer === id) });
  }
}
/** What the room screen's buttons need from the scene: set by src/caro/scene.ts. */
export const roomUi = { btn: (() => {}) as (x: number, y: number, w: number, h: number, label: string, fn: () => void, role: string, enabled?: boolean, color?: string) => void, cx: () => 0, phone: () => false };
/** Emotes, chat and the vote for a new game, as Cờ Tỷ Phú's room has them (src/net/roomExtras.ts). */
export const extras = makeRoomExtras({
  G: () => (G?.players ? G as unknown as RoomGame : null),
  isHost, isGuest, peerOnline,
  mySlot: () => (G?.players ? G.players.findIndex(p => p.seat === (isGuest() ? mySeat : 0)) : -1),
  sendAct: (act, extra) => net.toHost({ k: 'caroAct', act, ...extra }),
  restart: () => { if (G?.players && G.players.length === 2) playAgain(); else hostNewGame(); },
  log,
  btn: (...a) => roomUi.btn(...a), cx: () => roomUi.cx(), phone: () => roomUi.phone(),
});
/** Host: starts the game for everyone; the friend's name comes from their seat. */
export function hostNewGame(): void {
  newGame(undefined, caroSetup.seats.map(s => s.name), names.animalName);
}

/** Host: a friend's tap, counted only on their own turn (or their own seat, for the animal). */
function onAct(from: number, a: Loose): void {
  if (a.act === 'history') { if (scene === 'caro') net.toOne(from, { k: 'caroHistory', list: history }); return; }
  if (scene === 'caro' && extras.onAct(from, a)) return; // an emote, a line, a vote
  if (a.act === 'animal') {
    const i = caroSetup.seats.findIndex(s => s.kind === 'remote' && s.peer === from);
    if (i >= 0 && scene === 'caroSetup') { names.nextAnimal(i); sendLobby(); }
    return;
  }
  if (scene !== 'caro' || !G?.players) return;
  const p = curP();
  if (p.kind !== 'remote' || p.peer !== from) return;
  if (a.act === 'place' && typeof a.cell === 'number' && Number.isInteger(a.cell)) tryPlace(a.cell);
}
/** "Lịch sử": the whole game's lines (a friend asks the host, who keeps them). */
export function openHistory(): void { if (isGuest()) sendAct('history'); else showHistory(history); }
/** Friend: a tap for the host. */
export function sendAct(act: string, extra: Record<string, unknown> = {}): void { net.toHost({ k: 'caroAct', act, ...extra }); }

/** Friend: a message from the host. */
function onHostMsg(d: Loose): void {
  if (!d || typeof d.k !== 'string') return;
  if (!d.k.startsWith('caro')) {
    const other = d.k.startsWith('ludo') ? 'Cá Ngựa' : d.k.startsWith('snake') ? 'Rắn và Thang' : 'Cờ Tỷ Phú';
    goOffline(`Mã này là phòng ${other}: về sảnh, chọn ${other} rồi vào phòng nhé.`); setScene('caroSetup'); return;
  }
  if (d.k === 'caroYou') mySeat = d.seat;
  else if (d.k === 'caroHistory') showHistory(Array.isArray(d.list) ? d.list : []);
  else if (d.k === 'caroFull') note = d.msg;
  else if (d.k === 'caroLobby') { lobby = { hostName: d.hostName, seats: d.seats }; for (const k of SHARED) if (typeof d.rules?.[k] === 'number') CONFIG[k].value = d.rules[k]; if (scene === 'caro' && !d.playing) setScene('caroSetup'); }
  else if (d.k === 'caro') {
    setG(d.g);
    if (scene !== d.scene && (scene === 'caro' || scene === 'caroSetup')) setScene(d.scene);
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
  if (scene !== 'caro' || !G?.players) return;
  if (isHost()) keepHostGame(G.phase === 'over' ? null : { code: roomCode, g: G, seats: caroSetup.seats.map(s => ({ ...s })), at: Date.now() });
  else if (!active) keepLocal(G.phase === 'over' ? null : { g: G, seats: caroSetup.seats.map(s => ({ ...s })) });
}
/** Every step: the host sends the game (the board changes rarely, so less often than the dice games); the game is kept. */
export function caroNetStep(): void {
  keepStep();
  if (isHost()) {
    if (scene === 'caro' && G?.players) {
      if (++sendEvery >= 6 || sounds.length) { sendEvery = 0; net.toAll({ k: 'caro', scene, g: G, sfx: sounds.splice(0) }); }
    } else if (++sendEvery >= 30) { sendEvery = 0; sendLobby(); }
  }
}
