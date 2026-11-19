// Cá Ngựa kept in this browser, so a reload or a closed tab is not the end of a game:
//   tpdv-ludo-local   a game on one screen, while it is not over
//   tpdv-ludo-room    the last Cá Ngựa room (its code, this screen's role and name), for "Vào lại phòng"
//   tpdv-ludo-host    the host's game in that room, so a host who reloads gets the game back
// Each is kept for ROOM_MEMORY_MS (the server closes an empty room after the same time), except the
// game on one screen, which stays until it ends or another starts. Storage may be blocked: then
// nothing is kept, and the game plays as before.

import { CONFIG } from '../config';
import type { LudoGame } from './game';
import type { LudoSeat } from './rules';

const LOCAL = 'tpdv-ludo-local', ROOM = 'tpdv-ludo-room', HOST = 'tpdv-ludo-host';
/** How long a room is remembered: the room server's own idle limit (server/server.mjs ROOM_IDLE_MS). */
export const ROOM_MEMORY_MS = 30 * 60 * 1000;

function read<T>(key: string): T | null {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) as T : null; } catch { return null; }
}
function write(key: string, v: unknown): void {
  try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)); } catch { /* not kept: fine */ }
}

/** The rules a person picks on the setup screen. They live in CONFIG, not in the game, so a kept game
 * carries its own: a game played with "Nhanh" goes on with "Nhanh" after a reload. */
const PICKED_RULES = ['ludo_home_strict'];
/** This game's picked rules, to keep with it. */
export function pickedRules(): Record<string, number> {
  return Object.fromEntries(PICKED_RULES.filter(k => CONFIG[k]).map(k => [k, CONFIG[k].value]));
}
/** Puts a kept game's picked rules back (a game kept before they were kept: the rules as they are). */
export function restoreRules(r: Record<string, number> | undefined): void {
  for (const k of PICKED_RULES) if (r && typeof r[k] === 'number' && CONFIG[k]) CONFIG[k].value = r[k];
}

/** A game on one screen, with the seats it was set up with and its picked rules. */
export interface KeptGame { g: LudoGame; rng?: number; history?: string[]; seats: LudoSeat[]; rules?: Record<string, number> }
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
