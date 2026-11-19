// Vitest: the board view every game shares (src/three/orbitView.ts) and the gestures that move it
// (src/ui/viewGestures.ts): turning, zooming about a point, going back, and telling a tap from a drag.
import { describe, expect, it, beforeEach } from 'vitest';
import * as THREE from 'three';
import { OrbitView } from '../../src/three/orbitView';
import { useView, viewTick, viewDown, viewMove, viewUp, viewWheel, viewCancel } from '../../src/ui/viewGestures';
import { tune } from '../../src/config';

const RECT = { x: 0, y: 0, w: 800, h: 600 };
const PITCH = 1;
/** A view of a 10 x 10 board, its usual camera 20 away looking at the middle. */
function makeView(): { o: OrbitView; cam: THREE.PerspectiveCamera } {
  const o = new OrbitView(() => PITCH, () => ({ dist: 20, tx: 0, tz: 0 }), 5, 0);
  const cam = new THREE.PerspectiveCamera(30, RECT.w / RECT.h, 0.1, 100);
  o.aim(cam);
  return { o, cam };
}
/** Steps the view's easing until it settles. */
const settle = (o: OrbitView): void => { for (let i = 0; i < 600; i++) o.step(1 / 60); };

describe('the view', () => {
  it('starts at the game\'s usual camera: its angle and distance', () => {
    const { o, cam } = makeView();
    expect(o.isHome()).toBe(true);
    expect(cam.position.length()).toBeCloseTo(20, 5);
    expect(Math.asin(cam.position.y / 20)).toBeCloseTo(PITCH, 5);
  });
  it('a turn is a quarter, eased; two turns the other way come back', () => {
    const { o } = makeView();
    o.turn(1); expect(o.yaw).toBe(0); settle(o);
    expect(o.yaw).toBeCloseTo(Math.PI / 2, 4);
    o.turn(-1); settle(o);
    expect(o.yaw).toBeCloseTo(0, 4);
  });
  it('zoom stays between the usual view and view_zoom_max', () => {
    const { o } = makeView();
    o.zoomBy(0.5); settle(o); expect(o.zoom).toBeCloseTo(1, 4);
    for (let i = 0; i < 30; i++) o.zoomBy(2);
    settle(o); expect(o.zoom).toBeCloseTo(tune.view_zoom_max, 4);
  });
  it('zooming about a point keeps the board point under it in place', () => {
    const { o, cam } = makeView();
    const before = o.groundAt(600, 400, cam, RECT)!;
    o.zoomAt(2, 600, 400, cam, RECT);
    const after = o.groundAt(600, 400, cam, RECT)!;
    expect(o.zoom).toBeCloseTo(2, 5);
    expect(after.x).toBeCloseTo(before.x, 3);
    expect(after.z).toBeCloseTo(before.z, 3);
  });
  it('the tilt stays between view_pitch_min and view_pitch_max', () => {
    const { o } = makeView();
    o.drag(0, 100000); expect(o.pitchNow()).toBeCloseTo(tune.view_pitch_max, 5);
    o.drag(0, -100000); expect(o.pitchNow()).toBeCloseTo(tune.view_pitch_min, 5);
  });
  it('"Gốc" brings it all back', () => {
    const { o, cam } = makeView();
    o.turn(1); o.zoomAt(2.5, 700, 500, cam, RECT); o.drag(40, 30); settle(o);
    expect(o.isHome()).toBe(false);
    o.home(); settle(o);
    expect(o.isHome()).toBe(true);
    expect(Math.cos(o.yaw)).toBeCloseTo(1, 4);
  });
});

describe('the gestures', () => {
  let v: ReturnType<typeof makeView>;
  beforeEach(() => {
    v = makeView();
    for (const id of [1, 2, 3]) viewCancel(id); // nothing held from another test
    viewTick(); useView({ orbit: v.o, cam: () => v.cam, rect: RECT });
  });
  it('a press that does not move is a tap, heard when it lifts', () => {
    expect(viewDown(1, 300, 200, 0, false, false)).toBe(true);
    viewMove(1, 302, 201);
    expect(viewUp(1)).toEqual({ x: 300, y: 200 });
    expect(v.o.isHome()).toBe(true);
  });
  it('a drag turns the board and is no tap', () => {
    viewDown(1, 300, 200, 0, false, false);
    viewMove(1, 360, 200);
    expect(viewUp(1)).toBeNull();
    expect(v.o.yaw).toBeCloseTo(-60 * tune.view_turn_speed, 6);
  });
  it('a press on a button, or off the board, is not the board\'s', () => {
    expect(viewDown(1, 300, 200, 0, false, true)).toBe(false);
    expect(viewDown(1, 900, 200, 0, false, false)).toBe(false);
  });
  it('two fingers spreading apart zoom in, and leave no tap', () => {
    viewDown(1, 300, 300, 0, false, false); viewDown(2, 500, 300, 0, false, false);
    viewMove(2, 600, 300);
    expect(v.o.zoom).toBeCloseTo(1.5, 3);
    expect(viewUp(2)).toBeNull(); expect(viewUp(1)).toBeNull();
  });
  it('the wheel zooms over the board only', () => {
    expect(viewWheel(400, 300, -1)).toBe(true);
    expect(v.o.zoom).toBeCloseTo(tune.view_wheel_step, 5);
    expect(viewWheel(900, 300, -1)).toBe(false);
  });
  it('no board offered: every press is a plain click', () => {
    viewTick(); viewTick(); viewTick(); // the game stopped offering its board (another screen is up)
    expect(viewDown(1, 300, 200, 0, false, false)).toBe(false);
  });
});
