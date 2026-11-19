// Cá Ngựa online: the same room server as Cờ tỷ phú (server/server.mjs only relays), its own
// messages, each kind starting with 'ludo'. The host's screen runs the game (./game.ts) and sends G
// about 20 times a second with the sounds it played; a friend's screen draws it and sends its presses.
//
//   host -> friends   { k: 'ludoLobby', code, hostName, seats, strict, playing }   the seats (playing: a game is on)
//                     { k: 'ludoYou', seat }                       which seat is yours
//                     { k: 'ludo', scene, g, sfx }                 the game, and the sounds since the last
//                     { k: 'ludoFull', msg }
//   friend -> host    { k: 'ludoAct', act: 'shake' | 'throw' | 'pick' | 'again', h?, d? }   (pick: horse h with die d)

import * as net from '../net/net';
import { tune, CONFIG } from '../config';
import { rawSfx } from '../net/room';
import { scene, setScene } from '../core/store';
import type { Loose } from '../game/types';
import { G, setG, ludoSetup, newGame, startShake, pickHorse, curP, sounds, recordSounds } from './game';
import type { LudoSeat } from './rules';
import { keepRoom, lastRoom, hostGame, keepHostGame, keepLocal, pickedRules, restoreRules } from './keep';

export const isHost = (): boolean => net.getRole() === 'host' && active;
export const isGuest = (): boolean => net.getRole() === 'guest' && active;
/** True while this screen is in a Cá Ngựa room. */
let active = false;
export let roomCode = '', myName = '', mySeat = -1;
export let linkUp = false, hostOnline = true;
/** A note for the setup screen (a room that was closed, an error). */
export let note = '';
export function setNote(s: string): void { note = s; }
/** Friend's screen: the host's seats before the game. */
export let lobby: { hostName: string; seats: LudoSeat[] } | null = null;
const peers = new Map<number, { name: string; online: boolean }>();
export const peerOnline = (id?: number): boolean => id !== undefined && !!peers.get(id)?.online;
let sendEvery = 0;
/** Friend: holding the shake button, waiting to let go. */
export let guestShaking = false;

const handlers: net.NetHandlers = {
  onRoom(code) {
    roomCode = code; note = '';
    keepRoom({ code, role: isHost() ? 'host' : 'guest', name: myName, at: Date.now() });
    if (isHost() && restoring) { // a host back after a reload: the game kept for this room, if the server still had it
      restoring = false;
      const k = hostGame(code);
      if (k) { restoreRules(k.rules); setG(k.g); ludoSetup.seats = k.seats.map(s => ({ ...s })); ludoSetup.seats[0] = { kind: 'human', name: myName }; setScene('ludo'); }
      else if (restoringCode && restoringCode !== code) note = `Phòng ${restoringCode} đã đóng: đây là phòng mới ${code}, gửi mã mới cho bạn bè nhé.`;
    }
    if (isHost()) sendLobby();
  },
  onPeer(id, name, online, left) {
    if (left) { peerLeft(id, name); return; }
    const known = peers.has(id);
    peers.set(id, { name, online });
    if (!known) seatPeer(id, name);
    const st = ludoSetup.seats.find(s => s.kind === 'remote' && s.peer === id); if (st) st.name = name;
    if (G?.players) for (const p of G.players) if (p.peer === id && online) p.name = name;
    sendLobby();
  },
  onFromPeer(from, d) { if (d && d.k === 'ludoAct') onAct(from, d); },
  onFromHost(d) { onHostMsg(d); },
  onHost(online) { hostOnline = online; },
  onClosed() { goOffline('Chủ phòng đã giải tán phòng Cá Ngựa.'); },
  onLink(up) { linkUp = up; },
  onError(msg) { goOffline(msg); },
};

/** True while a host who came back waits for its room, to put the kept game back. */
let restoring = false, restoringCode = '';
/** Opens a Cá Ngựa room; this screen hosts it and plays seat 1. */
export function createRoom(name: string, fresh = true): void { // fresh: a new room; false: the last one back
  active = true; myName = name; peers.clear(); roomCode = ''; note = '';
  ludoSetup.seats[0] = { kind: 'human', name };
  recordSounds(true);
  net.createRoom(name, handlers, 'ludo', fresh);
}
/** Joins a friend's Cá Ngựa room by its code. */
/** A friend's own picked rules, kept while the host's are in force in the room; put back on leaving. */
let ownRules: Record<string, number> | null = null;
export function joinRoom(code: string, name: string): void {
  ownRules ??= pickedRules(); // the host's rules come with its lobby; these are this screen's own
  active = true; myName = name; mySeat = -1; lobby = null; roomCode = code.trim().toUpperCase(); note = '';
  net.joinRoom(code, name, handlers, 'ludo');
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
  if (ownRules) { restoreRules(ownRules); ownRules = null; } // a friend back on their own: their own rules again
  recordSounds(false);
  ludoSetup.seats.forEach((s, i) => { if (s.kind === 'remote') ludoSetup.seats[i] = { kind: 'ai', lv: 1 }; });
  if (scene === 'ludo') setScene('ludoSetup');
}

/** Host: a new friend takes the first seat waiting for a friend, else the first computer or empty seat. */
function seatPeer(id: number, name: string): void {
  if (scene === 'ludo' && G?.players && G.phase !== 'over') { // a game is on: a friend who dropped gets their seat back
    if (G.players.some(q => q.peer === id)) return; // already theirs (a host back with the kept game)
    const p = G.players.find(q => q.kind === 'remote' && !peerOnline(q.peer) && q.name === name) || G.players.find(q => q.kind === 'remote' && !peerOnline(q.peer));
    if (!p) { net.toOne(id, { k: 'ludoFull', msg: 'Ván đang chơi: chờ ván sau nhé.' }); return; }
    p.peer = id; p.name = name;
    ludoSetup.seats[p.side] = { kind: 'remote', peer: id, name };
    return;
  }
  if (ludoSetup.seats.some(s => s.kind === 'remote' && s.peer === id)) return;
  let i = [1, 2, 3].find(k => ludoSetup.seats[k].kind === 'remote' && ludoSetup.seats[k].peer === undefined);
  if (i === undefined) i = [1, 2, 3].find(k => ludoSetup.seats[k].kind === 'ai' || ludoSetup.seats[k].kind === 'off');
  if (i === undefined) { net.toOne(id, { k: 'ludoFull', msg: 'Phòng đã đủ người.' }); return; }
  ludoSetup.seats[i] = { kind: 'remote', peer: id, name };
}
/** Host: a friend left for good: before a game the seat waits for someone new; in a game the computer plays it. */
function peerLeft(id: number, name: string): void {
  peers.delete(id);
  const i = ludoSetup.seats.findIndex(s => s.kind === 'remote' && s.peer === id);
  if (i >= 0) ludoSetup.seats[i] = { kind: 'remote' };
  if (G?.players) for (const p of G.players) if (p.peer === id) { p.kind = 'ai'; p.lv = 1; delete p.peer; G.log.unshift(`${name || p.name} đã rời phòng, máy chơi thay.`); }
  sendLobby();
}
/** Host: the seats, and each friend's own seat. */
export function sendLobby(): void {
  if (!isHost()) return;
  net.toAll({ k: 'ludoLobby', code: roomCode, hostName: myName, seats: ludoSetup.seats.map(s => ({ ...s })), strict: tune.ludo_home_strict, playing: scene === 'ludo' });
  for (const id of peers.keys()) {
    const p = G?.players?.find(q => q.peer === id);
    net.toOne(id, { k: 'ludoYou', seat: p ? p.side : ludoSetup.seats.findIndex(s => s.kind === 'remote' && s.peer === id) });
  }
}
/** Host: starts the game for everyone; friends' names come from their seats. */
export function hostNewGame(): void {
  newGame(undefined, ludoSetup.seats.map(s => s.name));
}

/** Host: a friend's press, counted only on their own turn. */
function onAct(from: number, a: Loose): void {
  if (scene !== 'ludo' || !G?.players) return;
  if (a.act === 'again') return; // only the host starts another game
  const p = curP();
  if (p.kind !== 'remote' || p.peer !== from) return;
  if (a.act === 'shake' && G.phase === 'roll') { startShake(); if (G.shake) G.shake.remote = true; }
  else if (a.act === 'throw' && G.shake?.remote) G.shake.released = true;
  else if (a.act === 'pick' && Number.isInteger(a.h)) pickHorse(a.h, Number.isInteger(a.d) ? a.d : undefined);
}
/** Friend: a press for the host. */
export function sendAct(act: string, h?: number, d?: number): void {
  net.toHost({ k: 'ludoAct', act, h, d });
  if (act === 'shake') guestShaking = true;
}

/** Friend: a message from the host. */
function onHostMsg(d: Loose): void {
  if (!d || typeof d.k !== 'string') return;
  if (!d.k.startsWith('ludo')) { const other = d.k.startsWith('snake') ? 'Rắn và Thang' : 'Cờ Tỷ Phú'; goOffline(`Mã này là phòng ${other}: về sảnh, chọn ${other} rồi vào phòng nhé.`); setScene('ludoSetup'); return; }
  if (d.k === 'ludoYou') mySeat = d.seat;
  else if (d.k === 'ludoFull') note = d.msg;
  else if (d.k === 'ludoLobby') { lobby = { hostName: d.hostName, seats: d.seats }; if (typeof d.strict === 'number') CONFIG.ludo_home_strict.value = d.strict; if (scene === 'ludo' && !d.playing) setScene('ludoSetup'); }
  else if (d.k === 'ludo') {
    setG(d.g);
    if (scene !== d.scene && (scene === 'ludo' || scene === 'ludoSetup')) setScene(d.scene);
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
  if (scene !== 'ludo' || !G?.players) return;
  if (isHost()) keepHostGame(G.phase === 'over' ? null : { code: roomCode, g: G, seats: ludoSetup.seats.map(s => ({ ...s })), rules: pickedRules(), at: Date.now() });
  else if (!active) keepLocal(G.phase === 'over' ? null : { g: G, seats: ludoSetup.seats.map(s => ({ ...s })), rules: pickedRules() });
}
/** Every step: the host sends the game; a friend lets go of the die when the finger lifts; the game is kept. */
export function ludoNetStep(held: boolean): void {
  keepStep();
  if (isHost()) {
    if (scene === 'ludo' && G?.players) {
      if (++sendEvery >= 3 || sounds.length) { sendEvery = 0; net.toAll({ k: 'ludo', scene, g: G, sfx: sounds.splice(0) }); }
    } else if (++sendEvery >= 30) { sendEvery = 0; sendLobby(); }
  }
  if (isGuest() && guestShaking && !held) { guestShaking = false; sendAct('throw'); }
}
