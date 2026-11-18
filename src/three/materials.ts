// Materials, canvas textures and the mesh helper the 3D figures share. Shadows are off in a cheap render
// (?render=cheap, the headless checks and self-play), as in the rest of the game.
import * as THREE from 'three';
import { CHEAP } from '../core/env';


/** A plain material, shared by every model asking for the same colour and options: the renderer then
 * switches materials less often. Never change one it hands out; make a new material for that. */
export function mat(color: THREE.ColorRepresentation, opts: Record<string, number | boolean | string> = {}) {
  const key = `${String(color)}|${JSON.stringify(opts)}`;
  let m = shared.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.55, metalness: 0.0 }, opts)); shared.set(key, m); }
  return m;
}
const shared = new Map<string, THREE.MeshStandardMaterial>();
export function plastic(color: THREE.ColorRepresentation) { return new THREE.MeshPhongMaterial({ color, shininess: 90, specular: 0x666666 }); }
export function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
export function woodTexture() {
  return canvasTex(1024, 1024, (c: CanvasRenderingContext2D, w: number, h: number) => {
    c.fillStyle = '#8a5a34'; c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) { // grain: wavy darker and lighter lines, from a fixed pattern
      const k = Math.sin(y * 0.05) * 0.5 + Math.sin(y * 0.013 + 1.7) * 0.5;
      c.strokeStyle = k > 0.2 ? 'rgba(60,32,14,0.18)' : 'rgba(255,214,160,0.06)';
      c.beginPath(); c.moveTo(0, y);
      for (let x = 0; x <= w; x += 32) c.lineTo(x, y + Math.sin(x * 0.01 + y * 0.03) * 3);
      c.stroke();
    }
    for (let p = 0; p < 7; p++) { // planks
      c.fillStyle = 'rgba(40,20,8,0.35)'; c.fillRect(0, p * (h / 7), w, 3);
    }
  });
}

// Icons painted on the board and on cards: each drawn with paths, never a font glyph.
export function mesh(geo: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0) { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = !CHEAP; o.receiveShadow = !CHEAP; return o; }

