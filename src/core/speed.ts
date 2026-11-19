// Fast forward, one choice for every game on the hub: the computer's turns at ×1, ×2 or ×4. Cờ Tỷ Phú
// and Cá Ngựa both read and change it here, so ×4 picked in one is ×4 in the other at once (each used
// to keep its own copy, read once when the page opened). Kept in the browser for the next visit.
import { CHECKED } from './env';

const SPEEDS = [1, 2, 4];
const KEY = 'tpdv-speed';
let speed = 1;
try { const k = Number(localStorage.getItem(KEY)); speed = !CHECKED && SPEEDS.includes(k) ? k : 1; } catch { speed = 1; } // a check always runs at ×1

/** The chosen speed for the computer's turns: 1, 2 or 4. */
export const speedNow = (): number => speed;
/** The next speed (×1 → ×2 → ×4 → ×1), kept for the next visit. */
export function cycleSpeed(): void {
  speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
  try { localStorage.setItem(KEY, String(speed)); } catch { /* not kept: fine */ }
}
