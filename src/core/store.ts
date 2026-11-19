// What the whole game shares: the game being played (state), which screen shows (scene) and the setup
// screen's choices (setup). Other files read them as they are (ES module bindings follow every change);
// only this file assigns them, through the setters, so every change of the whole object is easy to find.
import { tune } from '../config';
import { DEFAULT_ANIMALS } from '../game/data';
import { F } from './flags';
import type { GameState, Seat } from '../game/types';

/** The setup screen's choices: the seats, the kind of game and its length, teams, the animals. */
type Setup = { seats: Seat[]; mode: 'bankrupt' | 'rounds'; rounds: number; teams: boolean; teamOf: number[]; animals: number[] };

/** The game being played: everything the rules read and change. */
export let state: GameState;
/** The screen showing: 'title', 'play', 'results' (or 'figures', a view for checks). */
export let scene = 'title';
/** The setup screen's choices. */
export let setup: Setup = { seats: [{ kind: 'human' }, { kind: 'ai', lv: 1 }, { kind: 'ai', lv: 0 }, { kind: 'off' }], mode: 'bankrupt', rounds: tune.max_rounds, teams: false, teamOf: [0, 1, 0, 1], animals: [...DEFAULT_ANIMALS] };

/** Puts a whole new game state in place (a new game, the host's state online, a kept game). */
export function setState(s: GameState) { state = s; }
/** Shows another screen. A "leave the room?" menu belongs to the screen it was opened on: a room
 * that closes under it (or any other change of screen) must not leave it open over the next game. */
export function setScene(s: string) {
  if (s === scene) return;
  F.roomMenu = false; F.emoteMenu = false; scene = s;
  for (const fn of sceneWatchers) fn(s);
}
const sceneWatchers: ((s: string) => void)[] = [];
/** Runs fn with the new screen's name each time the screen changes (a game clearing what one screen
 * left behind, when its own screen opens again). */
export function onSceneChange(fn: (s: string) => void) { sceneWatchers.push(fn); }
/** Puts a whole new setup in place (a kept game's). */
export function setSetup(s: Setup) { setup = s; }
