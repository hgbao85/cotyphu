// Fast forward, one choice for every game on the hub: the computer's turns at ×1 or one of two fast
// speeds (×2 and ×4: data/config.json fast_speed_1, fast_speed_2). Cờ Tỷ Phú and Cá Ngựa both read and
// change it here, so ×4 picked in one is ×4 in the other at once. Kept in the browser for the next visit.
import { tune } from '../config';
import { CHECKED } from './env';

/** ×1, then the two fast speeds from data/config.json (fast_speed_1, fast_speed_2). */
const speeds = (): number[] => [1, tune.fast_speed_1, tune.fast_speed_2];
const KEY = 'tpdv-speed';
let speed = 1;
try { const k = Number(localStorage.getItem(KEY)); speed = !CHECKED && speeds().includes(k) ? k : 1; } catch { speed = 1; } // a check always runs at ×1

/** The chosen speed for the computer's turns: 1 or one of the two fast speeds. */
export const speedNow = (): number => speed;
/** The next speed (×1 → fast_speed_1 → fast_speed_2 → ×1), kept for the next visit. */
export function cycleSpeed(): void {
  const all = speeds();
  speed = all[(all.indexOf(speed) + 1) % all.length]; // a speed no longer offered (the values changed) goes back to ×1
  try { localStorage.setItem(KEY, String(speed)); } catch { /* not kept: fine */ }
}
