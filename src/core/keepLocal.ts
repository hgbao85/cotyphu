// A game on one screen, kept in this browser about every second, offered back on the title screen.

import { tune } from '../config';

import { DEFAULT_ANIMALS } from '../game/data';

import { state, scene, setup, setState, setScene, setSetup } from '../core/store';

import type { Loose } from '../game/types';

import { log } from '../game/turn';
import { store, ROOM_MEMORY_MS, isHost, isGuest } from '../net/room';
import { clearVis } from '../ui/setupScreen';
import { CHEAP } from './env';

// ---- A game on one screen, kept: a reload or a closed tab does not lose it ---------------------------
const LOCAL_KEY = 'tpdv-local-game', LOCAL_MEMORY_MS = 7 * 24 * 3600 * 1000;
let keepLocalEvery = 0;
/** Every second or so of a game played on this screen alone, its state goes to this browser's storage. */
export function keepLocalGame() {
  if (isHost() || isGuest() || CHEAP || scene !== 'play' || ++keepLocalEvery < 60) return; // online games keep their own way; self-play keeps nothing
  keepLocalEvery = 0;
  try { store()?.setItem(LOCAL_KEY, JSON.stringify({ at: Date.now(), setup, state })); } catch { /* full or blocked: the game just is not kept */ }
}
export function forgetLocalGame() { try { store()?.removeItem(LOCAL_KEY); } catch { /* nothing kept */ } }
/** The game left unfinished on this screen, if there is one from the last week: its round, for the button. */
export function localGame(): { round: number } | null {
  let g: Loose = null;
  try { g = JSON.parse(store()?.getItem(LOCAL_KEY) || 'null'); } catch { g = null; }
  if (!g || !g.state || !g.state.players || Date.now() - g.at > LOCAL_MEMORY_MS) return null;
  return { round: g.state.round };
}
/** The unfinished game, back on the table where it was left. */
export function resumeLocalGame() {
  let g: Loose = null;
  try { g = JSON.parse(store()?.getItem(LOCAL_KEY) || 'null'); } catch { g = null; }
  if (!g || !g.state || !g.state.players) return;
  setSetup(g.setup);
  if (!Array.isArray(setup.animals) || setup.animals.length !== 4) setup.animals = [...DEFAULT_ANIMALS];
  if (!setup.rounds) setup.rounds = tune.max_rounds;
  setup.teams = !!setup.teams; if (!Array.isArray(setup.teamOf)) setup.teamOf = [0, 1, 0, 1];
  setState(g.state); state.vote = undefined; state.shaking = undefined;
  clearVis(); setScene('play');
  log(`Chơi tiếp ván trước, vòng ${state.round}.`);
}
/** Host: the kept game, back on the table. Friends in a room that was lost with the server come
 * back by name (seatPeer). */
export function restoreHostGame(code: string) {
  let g: Loose = null;
  try { g = JSON.parse(store()?.getItem('tpdv-host-game') || 'null'); } catch { g = null; }
  if (!g || Date.now() - g.at > ROOM_MEMORY_MS || !g.state || !g.state.players) return;
  const sameRoom = g.code === code;
  setSetup(g.setup); if (!Array.isArray(setup.animals) || setup.animals.length !== 4) setup.animals = [...DEFAULT_ANIMALS]; if (!setup.rounds) setup.rounds = tune.max_rounds; setState(g.state); setScene(g.scene === 'results' ? 'results' : 'play');
  state.vote = undefined; state.shaking = undefined;
  for (const p of state.players) if (p.kind === 'remote') {
    p.offline = true;
    if (!sameRoom) { delete p.peer; p.wasRemote = true; } // a new room: nobody has an id in it yet
  }
  setup.seats.forEach(st => { if (st.kind === 'remote' && !sameRoom) delete st.peer; });
  clearVis();
  log(sameRoom ? 'Chủ phòng đã quay lại: ván chơi tiếp.' : `Phòng mới ${code}: ván chơi tiếp, bạn bè vào lại bằng mã mới.`);
}

