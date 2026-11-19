// Cờ Tỷ Phú's 3D zodiac pieces (src/animals.ts makeAnimal) for the boards drawn in 2D (Cá Ngựa, Rắn và
// Thang): each animal in each colour is rendered once, from the tilted board's camera angle, into a small
// picture with a clear background, and the game draws that picture standing on the board. The same
// figures, the same plastic look and light as on Cờ Tỷ Phú's table, at the cost of one picture each.
// Without WebGL (an old phone, a blocked GPU) there is no picture, and the game keeps its flat token.
import * as THREE from 'three';
import { makeAnimal } from '../animals';
import { CHIBI } from '../core/theme';

/** A figure's picture: where its base's centre is in it (ax, ay) and how many pixels a unit of the model is. */
export interface Figure { img: HTMLCanvasElement; ax: number; ay: number; ppu: number }

const SIZE = 192; // the picture's side, in pixels: sharp at the biggest piece a board shows
/** The model's base: a disc of radius 0.24 (src/animals.ts), so 0.48 across. */
const BASE = 0.48;

let renderer: THREE.WebGLRenderer | null = null, failed = false;
const pictures = new Map<string, Figure | null>();

function setUp(): THREE.WebGLRenderer | null {
  if (renderer || failed) return renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(SIZE, SIZE, false); renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  } catch { failed = true; renderer = null; }
  return renderer;
}

/**
 * The picture of an animal's piece in a colour, seen from angle radians above the table (made once, then kept).
 * Null without WebGL.
 */
export function figure(animal: number, color: string, angle: number): Figure | null {
  const key = `${animal}:${color}:${angle.toFixed(3)}`;
  if (pictures.has(key)) return pictures.get(key)!;
  const r = setUp();
  if (!r) { pictures.set(key, null); return null; }
  const scene = new THREE.Scene();
  scene.add(CHIBI ? new THREE.HemisphereLight(0xffffff, 0x9ccb7a, 1.6) : new THREE.HemisphereLight(0xfff0d8, 0x5a6f9a, 1.35)); // Cờ Tỷ Phú's light
  const sun = CHIBI ? new THREE.DirectionalLight(0xfff4e0, 2.0) : new THREE.DirectionalLight(0xffe0b0, 2.3);
  sun.position.set(-6, 14, 7); scene.add(sun);
  const piece = makeAnimal(animal, color, false);
  piece.rotation.y = -Math.PI / 2 + 0.4; // facing the player, a little turned: the model faces +x
  scene.add(piece);
  // an orthographic camera at the board's angle, framing the whole figure
  const sphere = new THREE.Box3().setFromObject(piece).getBoundingSphere(new THREE.Sphere());
  const half = sphere.radius * 1.08, cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, 100);
  cam.position.set(sphere.center.x, sphere.center.y + Math.sin(angle) * 10, sphere.center.z + Math.cos(angle) * 10);
  cam.lookAt(sphere.center);
  r.render(scene, cam);
  const img = document.createElement('canvas'); img.width = img.height = SIZE;
  img.getContext('2d')!.drawImage(r.domElement, 0, 0);
  const base = new THREE.Vector3(0, 0, 0).project(cam); // the base's centre, in the picture
  const fig: Figure = { img, ax: (base.x + 1) / 2 * SIZE, ay: (1 - base.y) / 2 * SIZE, ppu: SIZE / (2 * half) };
  piece.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose(); });
  pictures.set(key, fig);
  return fig;
}

/** Draws a figure standing with its base's centre at (x, y), its base `across` pixels wide; lift raises it. */
export function drawFigure(c: CanvasRenderingContext2D, f: Figure, x: number, y: number, across: number, lift = 0): void {
  const s = across / (BASE * f.ppu);
  c.drawImage(f.img, x - f.ax * s, y - lift - f.ay * s, SIZE * s, SIZE * s);
}
