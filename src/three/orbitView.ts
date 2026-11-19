// The player's own view of a board, shared by every game on the hub: how far it is turned (yaw), how
// steeply it is seen (pitch), how close (zoom), and where the view is centred (pan). Each game gives its
// usual camera (a base: the angle, the distance, the point looked at); this file moves the camera around
// that, so a turned, zoomed board is still the same board. A view belongs to one screen: online, each
// player turns and zooms their own (nothing here is sent to the room).
//
// Gestures and buttons change targets; step() eases the view toward them, so a press on "↻" turns the
// board smoothly, while a finger moves it at once.
import * as THREE from 'three';
import { tune } from '../config';

/** The game's usual camera for a yaw and pitch: the distance, and the point on the board looked at. */
export interface ViewBase { dist: number; tx: number; tz: number }
/** A rectangle of the logical screen. */
export interface Rect { x: number; y: number; w: number; h: number }

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** A board's view: the player's turn, tilt, zoom and pan around a game's usual camera. */
export class OrbitView {
  /** Now, and where the buttons send it (gestures move both). */
  yaw = 0; pitch = 0; zoom = 1; panX = 0; panZ = 0;
  yawT = 0; pitchT = 0; zoomT = 1;
  /**
   * @param basePitch the game's usual angle above the table (radians)
   * @param base the game's usual camera for a yaw and pitch
   * @param half how far from the centre the view may be panned (the board's half side, world units)
   * @param planeY the height of the board's face (taps land there)
   */
  constructor(public basePitch: () => number, public base: (yaw: number, pitch: number) => ViewBase, public half: number, public planeY = 0) {}

  /** The angle above the table now. */
  pitchNow(): number { return clamp(this.basePitch() + this.pitch, tune.view_pitch_min, tune.view_pitch_max); }
  /** True when the view is the game's usual one (the "Gốc" button hides). A whole turn round is home too. */
  isHome(): boolean { return 1 - Math.cos(this.yawT) < 1e-6 && Math.abs(this.pitchT) < 1e-3 && Math.abs(this.zoomT - 1) < 1e-3 && Math.abs(this.panX) + Math.abs(this.panZ) < 1e-4; }
  /** Back to the game's usual view (eased). */
  home(): void { this.yawT = Math.round(this.yaw / (Math.PI * 2)) * Math.PI * 2; this.pitchT = 0; this.zoomT = 1; this.panTo = { x: 0, z: 0 }; }
  /** Turns the board a quarter (eased): dir 1 one way, -1 the other. */
  turn(dir: number): void { this.yawT = Math.round((this.yawT + dir * Math.PI / 2) / (Math.PI / 2)) * (Math.PI / 2); }
  /** Zooms in (f > 1) or out (eased), about the middle of the view. */
  zoomBy(f: number): void { this.zoomT = clamp(this.zoomT * f, 1, tune.view_zoom_max); }
  private panTo: { x: number; z: number } | null = null;

  /** Eases the view toward its targets. Returns true while it still moves. */
  step(dt: number): boolean {
    const k = 1 - Math.exp(-dt * tune.view_ease);
    const before = this.yaw + this.pitch + this.zoom + this.panX + this.panZ;
    this.yaw += (this.yawT - this.yaw) * k; this.pitch += (this.pitchT - this.pitch) * k; this.zoom += (this.zoomT - this.zoom) * k;
    if (this.panTo) { this.panX += (this.panTo.x - this.panX) * k; this.panZ += (this.panTo.z - this.panZ) * k; if (Math.hypot(this.panTo.x - this.panX, this.panTo.z - this.panZ) < 1e-4) { this.panX = this.panTo.x; this.panZ = this.panTo.z; this.panTo = null; } }
    if (Math.abs(this.yawT - this.yaw) < 1e-4) this.yaw = this.yawT;
    if (Math.abs(this.zoomT - this.zoom) < 1e-4) this.zoom = this.zoomT;
    if (Math.abs(this.pitchT - this.pitch) < 1e-4) this.pitch = this.pitchT;
    this.clampPan();
    return Math.abs(this.yaw + this.pitch + this.zoom + this.panX + this.panZ - before) > 1e-6;
  }
  private clampPan(): void {
    const lim = this.half * (1 - 1 / Math.max(1, this.zoom)) + this.half * 0.15; // zoomed out, the board stays near the middle
    this.panX = clamp(this.panX, -lim, lim); this.panZ = clamp(this.panZ, -lim, lim);
  }

  /** Puts the camera where the view says. */
  aim(cam: THREE.PerspectiveCamera): void {
    const pitch = this.pitchNow(), b = this.base(this.yaw, pitch), d = b.dist / this.zoom;
    const tx = b.tx + this.panX, tz = b.tz + this.panZ;
    cam.position.set(tx + d * Math.sin(this.yaw) * Math.cos(pitch), this.planeY + d * Math.sin(pitch), tz + d * Math.cos(this.yaw) * Math.cos(pitch));
    cam.up.set(0, 1, 0);
    cam.lookAt(tx, this.planeY, tz);
    cam.updateMatrixWorld();
  }

  // ---- Gestures: each moves the view at once (targets too) ----------------------------------------
  /** A drag: turns (dx) and tilts (dy) by screen pixels. */
  drag(dx: number, dy: number): void {
    this.yaw -= dx * tune.view_turn_speed; this.yawT = this.yaw;
    this.pitch = clamp(this.basePitch() + this.pitch + dy * tune.view_tilt_speed, tune.view_pitch_min, tune.view_pitch_max) - this.basePitch(); this.pitchT = this.pitch;
  }
  /** Twists the board by an angle (two fingers turning). */
  twist(a: number): void { this.yaw -= a; this.yawT = this.yaw; }
  /** Zooms by f keeping the board point under (x, y) where it is. */
  zoomAt(f: number, x: number, y: number, cam: THREE.PerspectiveCamera, rect: Rect): void {
    const before = this.groundAt(x, y, cam, rect);
    this.zoom = clamp(this.zoom * f, 1, tune.view_zoom_max); this.zoomT = this.zoom;
    this.aim(cam);
    const after = this.groundAt(x, y, cam, rect);
    if (before && after) { this.panX += before.x - after.x; this.panZ += before.z - after.z; }
    this.panTo = null; this.clampPan(); this.aim(cam);
  }
  /** Moves the view so the board point under (x0, y0) comes under (x1, y1). */
  panBy(x0: number, y0: number, x1: number, y1: number, cam: THREE.PerspectiveCamera, rect: Rect): void {
    const a = this.groundAt(x0, y0, cam, rect), b = this.groundAt(x1, y1, cam, rect);
    if (!a || !b) return;
    this.panX += a.x - b.x; this.panZ += a.z - b.z; this.panTo = null; this.clampPan(); this.aim(cam);
  }
  /** The board point (world x, z on the board's face) under a screen point, or null (the sky). */
  groundAt(x: number, y: number, cam: THREE.PerspectiveCamera, rect: Rect): { x: number; z: number } | null {
    const ndc = new THREE.Vector2((x - rect.x) / rect.w * 2 - 1, -((y - rect.y) / rect.h * 2 - 1));
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, cam);
    const pt = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.planeY), pt) ? { x: pt.x, z: pt.z } : null;
  }
}
