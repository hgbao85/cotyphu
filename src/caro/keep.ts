// Cờ Caro kept in this browser, so a reload or a closed tab is not the end of a game:
//   tpdv-caro-local   a game on one screen, while it is not over
//   tpdv-caro-room    the last Cờ Caro room (its code, this screen's role and name), for "Vào lại phòng"
//   tpdv-caro-host    the host's game in that room, so a host who reloads gets the game back
// Each is kept for ROOM_MEMORY_MS (the server closes an empty room after the same time), except the
// game on one screen, which stays until it ends or another starts. Storage may be blocked: then
// nothing is kept, and the game plays as before.

import type { CaroGame } from './game';
import type { CaroSeat } from './rules';

const LOCAL = 'tpdv-caro-local', ROOM = 'tpdv-caro-room', HOST = 'tpdv-caro-host';
/** How long a room is remembered: the room server's own idle limit (server/server.mjs ROOM_IDLE_MS). */
export const ROOM_MEMORY_MS = 30 * 60 * 1000;

function read<T>(key: string): T | null {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) as T : null; } catch { return null; }
}
function write(key: string, v: unknown): void {
  try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)); } catch { /* not kept: fine */ }
}

/** A game on one screen, with the seats it was set up with. */
export interface KeptGame { g: CaroGame; seats: CaroSeat[] }
/** The game on one screen left unfinished, if any. */
export function localGame(): KeptGame | null {
  const k = read<KeptGame>(LOCAL);
  return k && k.g && Array.isArray(k.g.players) && k.g.phase !== 'over' ? k : null;
}
/** Keeps (or, with null, forgets) the game on one screen. */
export function keepLocal(k: KeptGame | null): void { write(LOCAL, k); }

/** The last room: its code, whether this screen hosted it, the name used, when. */
export interface KeptRoom { code: string; role: 'host' | 'guest'; name: string; at: number }
/** The last room, while the server may still have it. */
export function lastRoom(): KeptRoom | null {
  const r = read<KeptRoom>(ROOM);
  return r && r.code && Date.now() - r.at < ROOM_MEMORY_MS ? r : null;
}
/** Remembers the room (or forgets it, with null; the host's game goes with it). */
export function keepRoom(r: KeptRoom | null): void { write(ROOM, r); if (!r) write(HOST, null); }

/** The host's game in a room. */
export interface KeptHostGame extends KeptGame { code: string; at: number }
/** The host's game in this room, if one was kept and is not over. */
export function hostGame(code: string): KeptHostGame | null {
  const k = read<KeptHostGame>(HOST);
  return k && k.code === code && k.g && Array.isArray(k.g.players) && k.g.phase !== 'over' && Date.now() - k.at < ROOM_MEMORY_MS ? k : null;
}
/** Keeps the host's game in the room it is played in. */
export function keepHostGame(k: KeptHostGame | null): void { write(HOST, k); }
