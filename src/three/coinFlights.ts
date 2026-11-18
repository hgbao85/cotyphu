// Coins that fly with a payment: when one player pays another (or the jar in the middle, or the jar pays
// out), a few gold coins hop in an arc from the payer's piece to the payee's, one after another, and
// bounce once where they land. The rules record each payment in state.flights (game/turn.ts, fly());
// this file only draws them, so a friend online sees the same coins from the synced state.
import * as THREE from 'three';
import { state } from '../core/store';
import { BOARD_TOP } from '../game/board';
import { canvasTex } from './materials';
import { prefs } from '../core/prefs';

/** How long a flight lasts from the first coin leaving to the last one landing (seconds). */
export const FLIGHT_TIME = 1.2;
const COINS = 5, GAP = 0.09, HOP = 0.6, BOUNCE = 0.18, ARC = 1.1, SIZE = 0.34, POOL = 20;
const sprites: THREE.Sprite[] = [];

/** A plain gold coin with a đ. */
function coinTexture(): THREE.Texture {
  return canvasTex(64, 64, (c, w) => {
    const r = w / 2, g = c.createRadialGradient(r * 0.75, r * 0.7, 2, r, r, r);
    g.addColorStop(0, '#fff2b0'); g.addColorStop(0.6, '#f2c44a'); g.addColorStop(1, '#b8861e');
    c.fillStyle = '#8a5a1a'; c.beginPath(); c.arc(r, r, r - 1, 0, 7); c.fill();
    c.fillStyle = g; c.beginPath(); c.arc(r, r, r - 5, 0, 7); c.fill();
    c.fillStyle = '#8a5a1a'; c.font = 'bold 34px "Segoe UI", Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('đ', r, r + 2);
  });
}
/** Builds the pool of coin sprites: call once with the 3D scene. */
export function buildFlights(scene: THREE.Scene): void {
  const mat = new THREE.SpriteMaterial({ map: coinTexture(), depthTest: false, depthWrite: false });
  for (let k = 0; k < POOL; k++) { const s = new THREE.Sprite(mat); s.scale.setScalar(SIZE); s.visible = false; s.renderOrder = 3; scene.add(s); sprites.push(s); }
}
/**
 * Places the flying coins for this frame.
 * @param seatAt where a seat's piece stands now; jarAt where the jar is.
 * @example stepFlights(k => tokVis[k], { x: POT_X, y: 0.8, z: POT_Z })
 */
export function stepFlights(seatAt: (k: number) => { x: number; y: number; z: number } | undefined, jarAt: { x: number; y: number; z: number }): void {
  let used = 0;
  for (const f of prefs.effects ? state.flights || [] : []) { // effects off: no coins fly
    const a = f.from < 0 ? jarAt : seatAt(f.from), b = f.to < 0 ? jarAt : seatAt(f.to);
    if (!a || !b) continue;
    for (let j = 0; j < COINS && used < POOL; j++) {
      const t = state.t - f.at - j * GAP;
      if (t < 0 || t > HOP + BOUNCE) continue;
      const s = sprites[used++], u = Math.min(1, t / HOP);
      const bounce = t > HOP ? Math.sin(((t - HOP) / BOUNCE) * Math.PI) * 0.18 : 0; // one small hop where it lands
      s.position.set(a.x + (b.x - a.x) * u, BOARD_TOP + 0.5 + Math.sin(u * Math.PI) * ARC + bounce, a.z + (b.z - a.z) * u);
      s.visible = true;
    }
  }
  for (let k = used; k < POOL; k++) sprites[k].visible = false;
}
