// Turning and zooming a board with the fingers or the mouse, for every game on the hub. The game on screen
// says each step which board can be moved (useView: its view, its camera, its rectangle on the screen);
// main.ts hands the pointer and wheel events here first.
//
//   one finger / the left button dragged     turns the board (sideways) and tilts it (up and down)
//   two fingers                              pinch to zoom, twist to turn, move together to pan
//   right button (or Shift) dragged          pans
//   the mouse wheel                          zooms about the pointer
//
// A press on the board that does not move is still a tap: it reaches the game when the finger lifts (a
// press that becomes a drag never does). A press on a button is not the board's: it acts at once, as before.
import type * as THREE from 'three';
import type { OrbitView, Rect } from '../three/orbitView';
import { tune } from '../config';

/** A board the player may move now. */
export interface ActiveView { orbit: OrbitView; cam: () => THREE.PerspectiveCamera; rect: Rect }
let active: ActiveView | null = null, activeStamp = 0, stamp = 0;
/** The game on screen offers its board this step (or none). A board not offered for a few steps is let go. */
export function useView(v: ActiveView | null): void { active = v; activeStamp = stamp; }
/** Called once per step by main.ts: a board not offered since is let go (another screen is up). */
export function viewTick(): void { if (++stamp - activeStamp > 2) active = null; }
/** The board offered now, if any (for the view buttons and checks). */
export const activeView = (): ActiveView | null => active;

interface Touch { x0: number; y0: number; x: number; y: number; button: number; shift: boolean }
const touches = new Map<number, Touch>();
/** True once the press moved too far, or a second finger came: no tap when it lifts. */
let dragged = false;
const inside = (r: Rect, x: number, y: number): boolean => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/** A press. Returns true when it is the board's (the game hears it only as a tap, on release). */
export function viewDown(id: number, x: number, y: number, button: number, shift: boolean, onButton: boolean): boolean {
  if (!active || onButton || !inside(active.rect, x, y)) return false;
  if (!touches.size) dragged = false;
  touches.set(id, { x0: x, y0: y, x, y, button, shift });
  if (touches.size > 1) dragged = true;
  return true;
}
/** A move: turns, tilts, pans or zooms the board while it is held. */
export function viewMove(id: number, x: number, y: number): void {
  const t = touches.get(id);
  if (!t || !active) return;
  const px = t.x, py = t.y;
  t.x = x; t.y = y;
  if (!dragged && Math.hypot(x - t.x0, y - t.y0) > tune.view_tap_slop) dragged = true;
  if (!dragged) return;
  const { orbit, rect } = active, cam = active.cam();
  if (touches.size >= 2) { // two fingers: this one moved; the other stands where it is
    const other = [...touches.entries()].find(([k]) => k !== id)![1];
    const d0 = Math.hypot(px - other.x, py - other.y), d1 = Math.hypot(x - other.x, y - other.y);
    if (d0 > 4 && d1 > 4) orbit.zoomAt(d1 / d0, (x + other.x) / 2, (y + other.y) / 2, cam, rect);
    const a0 = Math.atan2(py - other.y, px - other.x), a1 = Math.atan2(y - other.y, x - other.x);
    let da = a1 - a0; if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2;
    orbit.twist(da); orbit.aim(cam);
    orbit.panBy((px + other.x) / 2, (py + other.y) / 2, (x + other.x) / 2, (y + other.y) / 2, cam, rect);
    return;
  }
  if (t.button === 1 || t.button === 2 || t.shift) orbit.panBy(px, py, x, y, cam, rect);
  else { orbit.drag(x - px, y - py); orbit.aim(cam); }
}
/** A release. Returns the tap's point when the press never moved (a tap on the board), else null. */
export function viewUp(id: number): { x: number; y: number } | null {
  const t = touches.get(id);
  if (!t) return null;
  touches.delete(id);
  return !dragged && !touches.size ? { x: t.x0, y: t.y0 } : null;
}
/** A press taken away (the browser's own gesture, the window lost): no tap. */
export function viewCancel(id: number): void { touches.delete(id); dragged = true; }
/** The wheel over the board: zooms about the pointer. Returns true when it was the board's. */
export function viewWheel(x: number, y: number, deltaY: number): boolean {
  if (!active || !inside(active.rect, x, y)) return false;
  active.orbit.zoomAt(Math.pow(tune.view_wheel_step, -Math.sign(deltaY)), x, y, active.cam(), active.rect);
  return true;
}
