// The real 3D board of Cá Ngựa, Rắn và Thang and Cờ Caro: each game still draws its board flat once (its
// own canvas); here that picture becomes the face of a wooden board in a three.js scene, the pieces are
// Cờ Tỷ Phú's zodiac figures standing on it, and the camera is the player's own view (./orbitView.ts:
// turned, tilted, zoomed, panned).
//
// A frame is drawn in two layers, so each game keeps drawing its marks on the board in 2D:
//   drawBoard()  the board, seen from the camera (kept as a picture until the view or the board changes)
//   ...          the game draws what lies on the board (shadows, glows, hints, the winning row) in 2D,
//                at points from project()
//   piece()      queues each piece; flush() draws them all in 3D over that (kept while nothing moves)
//   ...          the game draws what floats above (words, numbers)
// Without WebGL there is no 3D: the board is the flat picture tilted (src/ui/tilt.ts) and the pieces are
// flat tokens, with no turning or zooming.
//
// The board is 1 x 1 world units, its face at y = 0: a board point (u across, v down the flat picture,
// each 0..1) is at x = u - 0.5, z = v - 0.5.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeAnimal } from '../animals';
import { CHIBI } from '../core/theme';
import { CHEAP } from '../core/env';
import { tune } from '../config';
import { screenScale } from '../screen';
import { drawTokenIcon } from '../ui/draw';
import { tiltOf, tiltAngle, type Spot, type Tilt } from '../ui/tilt';
import { OrbitView, type Rect } from './orbitView';

/** A point of the board on the screen (x, y), how many screen pixels a pixel of the flat board is there
 * (k), and the board point itself (u, v). */
export interface BoardSpot extends Spot { u: number; v: number }
/** One piece to draw: where (u, v), its size and lift in screen pixels there, its colours and animal. */
interface PieceReq { u: number; v: number; size: number; lift: number; color: string; dark: string; animal: number; mood?: 'happy' | 'sad'; sx: number; sy: number }

const FOV = 30;
const THICK = 0.03;
/** One renderer for every board game (a phone allows only a few WebGL screens). */
let renderer: THREE.WebGLRenderer | null = null, failed = false;
function gl(): THREE.WebGLRenderer | null {
  if (renderer || failed) return renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: !CHEAP, preserveDrawingBuffer: false });
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  } catch { failed = true; renderer = null; }
  return renderer;
}
function lights(s: THREE.Scene): void {
  s.add(CHIBI ? new THREE.HemisphereLight(0xffffff, 0x9ccb7a, 1.6) : new THREE.HemisphereLight(0xfff0d8, 0x5a6f9a, 1.35)); // Cờ Tỷ Phú's light
  const sun = CHIBI ? new THREE.DirectionalLight(0xfff4e0, 2.0) : new THREE.DirectionalLight(0xffe0b0, 2.3);
  sun.position.set(-6, 14, 7); s.add(sun);
}

// ---- The figures: each animal in each colour merged into one mesh (one draw each) ----------------
const shapes = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material }>();
function shape(animal: number, color: string): { geo: THREE.BufferGeometry; mat: THREE.Material } {
  const key = `${animal}:${color}`, had = shapes.get(key);
  if (had) return had;
  const g = makeAnimal(animal, color, false, tune.board3d_piece_detail);
  g.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  g.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const geo = m.geometry.clone(); geo.deleteAttribute('uv'); geo.applyMatrix4(m.matrixWorld);
    const col = (m.material as THREE.MeshPhongMaterial).color, n = geo.getAttribute('position').count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(geo);
    m.geometry.dispose();
  });
  const geo = mergeGeometries(parts.map(p => (p.index ? p.toNonIndexed() : p)))!;
  parts.forEach(p => p.dispose());
  const out = { geo, mat: new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 80, specular: 0x555555 }) };
  shapes.set(key, out);
  return out;
}

/** One game's 3D board. */
export class Board3D {
  readonly orbit: OrbitView;
  readonly cam = new THREE.PerspectiveCamera(FOV, 1, 0.01, 50);
  /** The board's rectangle on the screen (the 3D picture fills it) and the square the usual view fits. */
  view: Rect = { x: 0, y: 0, w: 1, h: 1 };
  fit = { x: 0, y: 0, s: 1 };
  phone = false;
  private boardScene = new THREE.Scene();
  private pieceScene = new THREE.Scene();
  private top: THREE.MeshBasicMaterial;
  private tex: THREE.CanvasTexture | null = null;
  private texOf: HTMLCanvasElement | null = null;
  private boardImg = document.createElement('canvas');
  private pieceImg = document.createElement('canvas');
  private boardKey = ''; private pieceKey = '';
  private queue: PieceReq[] = [];
  private pool: THREE.Mesh[] = [];
  private fitKey = ''; private fitBase = { dist: 3, tx: 0, tz: 0 };
  private tilt: Tilt | null = null;

  /** @param key the game (each keeps its own view), @param edge the board's sides' colour */
  constructor(readonly key: string, edge: string) {
    this.orbit = new OrbitView(() => tiltAngle(this.phone), (yaw, pitch) => this.baseFor(yaw, pitch), 0.5, 0);
    lights(this.boardScene); lights(this.pieceScene);
    this.top = new THREE.MeshBasicMaterial({ color: 0xffffff, alphaTest: 0.5, toneMapped: false }); // the flat picture's own colours; its rounded corners cut out
    const side = new THREE.MeshLambertMaterial({ color: edge });
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, THICK, 1), [side, side, this.top, side, side, side]);
    box.position.y = -THICK / 2; this.boardScene.add(box);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.02, 1.02), new THREE.MeshBasicMaterial({ color: 0x28465a, transparent: true, opacity: 0.22, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.set(0.012, -THICK - 0.002, 0.02); this.boardScene.add(shadow); // on the water, a little to the near side
  }
  /** True when the board is drawn in 3D (WebGL works): it can be turned and zoomed. */
  get live(): boolean { return !!gl(); }

  /** Sets where the board is on the screen this frame: its rectangle, and the square its usual view fills. */
  frame(view: Rect, fit: { x: number; y: number; s: number }, phone: boolean): void {
    this.view = view; this.fit = fit; this.phone = phone;
    if (!this.live) { this.tilt = tiltOf(this.key, fit, phone); return; }
    this.cam.aspect = view.w / view.h; this.cam.updateProjectionMatrix();
    this.orbit.aim(this.cam);
  }

  /** The usual camera for a yaw and pitch: as far as the board needs to fill its square, centred on it. */
  private baseFor(yaw: number, pitch: number): { dist: number; tx: number; tz: number } {
    const key = `${yaw.toFixed(4)},${pitch.toFixed(4)},${this.view.x},${this.view.y},${this.view.w},${this.view.h},${this.fit.x},${this.fit.y},${this.fit.s}`;
    if (key === this.fitKey) return this.fitBase;
    const cam = new THREE.PerspectiveCamera(FOV, this.view.w / this.view.h, 0.01, 50);
    const place = (d: number, tx: number, tz: number) => {
      cam.position.set(tx + d * Math.sin(yaw) * Math.cos(pitch), d * Math.sin(pitch), tz + d * Math.cos(yaw) * Math.cos(pitch));
      cam.lookAt(tx, 0, tz); cam.updateMatrixWorld();
    };
    const box = (d: number, tx: number, tz: number) => {
      place(d, tx, tz);
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
        const p = new THREE.Vector3(x, 0, z).project(cam), sx = this.view.x + (p.x + 1) / 2 * this.view.w, sy = this.view.y + (1 - p.y) / 2 * this.view.h;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
      return { x0, x1, y0, y1 };
    };
    let tx = 0, tz = 0, d = 3;
    for (let pass = 0; pass < 4; pass++) {
      let lo = 0.5, hi = 20;
      for (let i = 0; i < 32; i++) { const m = (lo + hi) / 2, b = box(m, tx, tz); if (b.x1 - b.x0 <= this.fit.s && b.y1 - b.y0 <= this.fit.s) hi = m; else lo = m; }
      d = hi;
      const b = box(d, tx, tz), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      const want = { x: this.fit.x + this.fit.s / 2, y: this.fit.y + this.fit.s / 2 };
      // move the point looked at by the board distance between where the board's middle lands and where it should
      const o = new OrbitView(() => pitch, () => ({ dist: d, tx, tz }), 1);
      o.yaw = yaw; o.aim(cam);
      const a = o.groundAt(cx, cy, cam, this.view), w = o.groundAt(want.x, want.y, cam, this.view);
      if (a && w) { tx += a.x - w.x; tz += a.z - w.z; }
    }
    this.fitKey = key; this.fitBase = { dist: d, tx, tz };
    return this.fitBase;
  }

  /** A board point (u, v: 0..1 across and down the flat picture; h: a height above it, world units) on the screen. */
  project(u: number, v: number, h = 0): BoardSpot {
    if (!this.live) { const s = this.tilt!.project(u, v); return { ...s, u, v }; }
    const p = new THREE.Vector3(u - 0.5, h, v - 0.5), depth = p.clone().applyMatrix4(this.cam.matrixWorldInverse).z;
    p.project(this.cam);
    const f = this.view.h / 2 / Math.tan(THREE.MathUtils.degToRad(FOV) / 2);
    return { x: this.view.x + (p.x + 1) / 2 * this.view.w, y: this.view.y + (1 - p.y) / 2 * this.view.h, k: f / Math.max(1e-4, -depth) / this.fit.s, u, v };
  }
  /** The board point under a point of the screen (u, v: 0..1), or null off the board's plane. */
  unproject(x: number, y: number): { u: number; v: number } | null {
    if (!this.live) { // the tilt undone: the row from the height, then the column
      const T = this.tilt!;
      if (y < T.top || y > T.bottom) return null;
      let lo = 0, hi = 1;
      for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (T.project(0.5, m).y < y) lo = m; else hi = m; }
      const v = (lo + hi) / 2, a = T.project(0, v).x, b = T.project(1, v).x;
      return { u: (x - a) / (b - a), v };
    }
    const g = this.orbit.groundAt(x, y, this.cam, this.view);
    return g ? { u: g.x + 0.5, v: g.z + 0.5 } : null;
  }
  /** The highest point of the board on the screen. */
  topY(): number {
    if (!this.live) return this.tilt!.top;
    return Math.min(...[[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => this.project(u, v).y));
  }

  /** Draws the board: the flat picture as its face, seen from the view. */
  drawBoard(c: CanvasRenderingContext2D, flat: HTMLCanvasElement): void {
    if (!this.live) { this.tilt!.draw(c, flat); return; }
    if (this.texOf !== flat) {
      this.tex?.dispose();
      this.tex = new THREE.CanvasTexture(flat); this.tex.colorSpace = THREE.SRGBColorSpace;
      this.tex.anisotropy = gl()!.capabilities.getMaxAnisotropy(); this.tex.minFilter = THREE.LinearMipmapLinearFilter;
      this.top.map = this.tex; this.top.needsUpdate = true; this.texOf = flat; this.boardKey = '';
    }
    const key = this.camKey() + (this.tex?.id ?? '');
    if (key !== this.boardKey) { this.renderInto(this.boardScene, this.boardImg); this.boardKey = key; }
    c.drawImage(this.boardImg, this.view.x, this.view.y, this.view.w, this.view.h);
  }

  /**
   * Queues a piece at a board point: its size (the base's width is size * 1.1) and lift in screen pixels
   * there, its colour (dark: the flat token's rim), its animal, and how it feels. flush() draws them.
   */
  piece(at: BoardSpot, size: number, lift: number, color: string, dark: string, animal: number, mood?: 'happy' | 'sad'): void {
    this.queue.push({ u: at.u, v: at.v, size, lift, color, dark, animal, mood, sx: at.x, sy: at.y });
  }
  /** Draws the queued pieces over the board (and over what the game drew on it), then empties the queue. */
  flush(c: CanvasRenderingContext2D): void {
    const q = this.queue; this.queue = [];
    if (!this.live) { // flat tokens, the far ones first
      q.sort((a, b) => a.sy - b.sy);
      for (const p of q) flatToken(c, p);
      return;
    }
    const key = this.camKey() + '|' + q.map(p => `${p.u.toFixed(4)},${p.v.toFixed(4)},${p.size.toFixed(1)},${p.lift.toFixed(1)},${p.color},${p.animal},${p.mood ?? ''}`).join(';');
    if (key !== this.pieceKey) {
      while (this.pool.length < q.length) { const m = new THREE.Mesh(); this.pool.push(m); this.pieceScene.add(m); }
      this.pool.forEach((m, i) => {
        const p = q[i]; m.visible = !!p; if (!p) return;
        const s = shape(p.animal, p.color), at = this.project(p.u, p.v), unit = at.k * this.fit.s; // screen pixels per world unit there
        m.geometry = s.geo; m.material = s.mat;
        const scale = p.size * 1.1 / unit / 0.48; // the figure's base is 0.48 across
        m.scale.setScalar(scale);
        m.position.set(p.u - 0.5, p.lift / unit, p.v - 0.5);
        m.rotation.set(0, this.orbit.yaw - Math.PI / 2 + 0.4, p.mood === 'sad' ? 0.18 : 0); // facing the player, a little turned; a sad one droops
      });
      this.renderInto(this.pieceScene, this.pieceImg);
      this.pieceKey = key;
    }
    c.drawImage(this.pieceImg, this.view.x, this.view.y, this.view.w, this.view.h);
  }

  private camKey(): string {
    const p = this.cam.position;
    return `${p.x.toFixed(5)},${p.y.toFixed(5)},${p.z.toFixed(5)},${this.view.x},${this.view.y},${this.view.w},${this.view.h},${screenScale}`;
  }
  /** Renders a scene at the view's size and keeps the picture. */
  private renderInto(s: THREE.Scene, img: HTMLCanvasElement): void {
    const r = gl()!, ratio = Math.min(2, screenScale) * (CHEAP ? 0.5 : 1);
    const w = Math.max(1, Math.round(this.view.w * ratio)), h = Math.max(1, Math.round(this.view.h * ratio));
    if (r.domElement.width !== w || r.domElement.height !== h) r.setSize(w, h, false);
    r.render(s, this.cam);
    if (img.width !== w || img.height !== h) { img.width = w; img.height = h; }
    const g = img.getContext('2d')!; g.clearRect(0, 0, w, h); g.drawImage(r.domElement, 0, 0);
  }
}

/** A flat token (no WebGL): a round base in the colour, the animal's face on it. */
function flatToken(c: CanvasRenderingContext2D, p: PieceReq): void {
  const x = p.sx, y = p.sy, size = p.size, lift = p.lift;
  c.save();
  c.fillStyle = p.dark; c.beginPath(); c.arc(x, y - lift + size * 0.06, size * 0.46, 0, 7); c.fill();
  c.fillStyle = p.color; c.beginPath(); c.arc(x, y - lift, size * 0.46, 0, 7); c.fill();
  c.strokeStyle = '#fff6e2'; c.lineWidth = size * 0.06; c.stroke();
  c.restore();
  drawTokenIcon(p.animal, x, y - lift - size * 0.02, size * 0.86, p.color, p.mood);
}

const boards = new Map<string, Board3D>();
/** A game's board (made once, then kept with its view). */
export function board3d(key: string, edge: string): Board3D {
  let b = boards.get(key);
  if (!b) { b = new Board3D(key, edge); boards.set(key, b); }
  return b;
}
