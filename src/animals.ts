// The twelve zodiac animals as pieces: chibi 3D figures (a big head on a small body, shiny eyes, pink
// cheeks) for the board, and flat faces for the HUD. Every figure faces +x and stands on a round base,
// like the old pieces, so it turns along the board the same way.
import * as THREE from 'three';

type Mat = THREE.Material;
const plastic = (c: THREE.ColorRepresentation): Mat => new THREE.MeshPhongMaterial({ color: c, shininess: 80, specular: 0x555555 });

/**
 * Builds one animal piece.
 * @param a the animal, 0 Chuột ... 11 Heo (ANIMALS in game/data.ts)
 * @param color its colour
 * @param shadows whether the parts cast and take shadows
 */
export function makeAnimal(a: number, color: string, shadows = true): THREE.Group {
  const g = new THREE.Group();
  const col = new THREE.Color(color), dark = col.clone().multiplyScalar(0.62), light = col.clone().lerp(new THREE.Color(0xffffff), 0.45);
  const m = plastic(col), md = plastic(dark), ml = plastic(light);
  const cream = plastic(0xfff1d6), pink = plastic(0xff8fa8), black = plastic(0x1e1a18), white = plastic(0xffffff), gold = plastic(0xf2c44a), red = plastic(0xe0302a);
  const add = (geo: THREE.BufferGeometry, mt: Mat, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0): THREE.Mesh => {
    const o = new THREE.Mesh(geo, mt); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.rotation.set(rx, ry, rz);
    o.castShadow = shadows; o.receiveShadow = shadows; g.add(o); return o;
  };
  const S = (r: number) => new THREE.SphereGeometry(r, 18, 14);
  const both = (f: (s: number) => void) => { f(-1); f(1); };

  add(new THREE.CylinderGeometry(0.2, 0.24, 0.07, 24), md, 0, 0.035, 0); // the base
  // the head: where it sits and how big, so the face lands on it
  let hx = 0.05, hy = 0.4, hr = 0.15;
  if (a === 5) { hx = 0.06; hy = 0.36; hr = 0.13; } // the snake rises from its coils
  if (a === 9) { hy = 0.42; hr = 0.13; }            // the rooster has a small head on a round body

  if (a === 5) { // Rắn: two coils
    add(new THREE.TorusGeometry(0.13, 0.055, 12, 28), m, 0, 0.12, 0, 1, 1, 1, Math.PI / 2);
    add(new THREE.TorusGeometry(0.085, 0.05, 12, 24), m, -0.01, 0.21, 0, 1, 1, 1, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 12), m, 0.04, 0.27, 0, 1, 1, 1, 0, 0, -0.4);
  } else { // a round body with two little front feet
    add(S(a === 9 ? 0.15 : 0.13), m, -0.03, 0.2, 0, 1.1, 0.95, 0.95);
    add(S(0.09), a === 9 ? ml : cream, 0.05, 0.19, 0, 0.6, 0.85, 0.85); // the belly
    both(s => add(S(0.045), md, 0.08, 0.08, s * 0.065, 1.2, 0.7, 1));
  }
  add(S(hr), m, hx, hy, 0); // the head

  // the face, on the front of the head
  const fx = hx + hr * 0.82;
  both(s => {
    add(S(hr * 0.19), black, fx, hy + hr * 0.18, s * hr * 0.42);
    add(S(hr * 0.06), white, fx + hr * 0.13, hy + hr * 0.27, s * hr * 0.4);
    add(S(hr * 0.15), pink, fx - hr * 0.08, hy - hr * 0.12, s * hr * 0.66, 0.4, 0.7, 1);
  });
  const muzzle = (w: number, h: number, mt: Mat = cream) => add(S(hr * 0.42), mt, hx + hr * 0.86, hy - hr * 0.28, 0, 0.55, h, w);
  const nose = (mt: Mat = black, r = 0.05) => add(S(hr * r * 3), mt, hx + hr * 1.08, hy - hr * 0.12, 0);
  const roundEars = (r: number, inner = true) => both(s => {
    add(S(r), m, hx - hr * 0.15, hy + hr * 0.82, s * hr * 0.72, 0.4, 1, 1, s * 0.5);
    if (inner) add(S(r * 0.62), pink, hx - hr * 0.08, hy + hr * 0.82, s * hr * 0.74, 0.3, 1, 1, s * 0.5);
  });
  const pointyEars = (h: number, tilt: number) => both(s => {
    add(new THREE.ConeGeometry(hr * 0.36, h, 12), m, hx - hr * 0.12, hy + hr * 0.9, s * hr * 0.55, 1, 1, 0.55, s * tilt);
    add(new THREE.ConeGeometry(hr * 0.2, h * 0.6, 10), pink, hx - hr * 0.02, hy + hr * 0.86, s * hr * 0.55, 1, 1, 0.4, s * tilt);
  });
  const tail = (mt: Mat, r: number, t: number, y: number, rz: number) => add(new THREE.TorusGeometry(r, t, 8, 18, Math.PI * 1.2), mt, -0.16, y, 0, 1, 1, 1, 0, 0, rz);

  switch (a) {
    case 0: // Chuột: big round ears, pink nose, a long thin tail
      roundEars(0.07); muzzle(0.8, 0.7); nose(pink, 0.06);
      tail(pink, 0.1, 0.012, 0.16, 1.6);
      break;
    case 1: // Trâu: a white crescent of horns, a wide muzzle with nostrils
      add(new THREE.TorusGeometry(hr * 0.95, 0.024, 8, 24, Math.PI), cream, hx - hr * 0.1, hy + hr * 0.75, 0, 1, 1, 1, 0, Math.PI / 2, Math.PI);
      both(s => add(S(0.04), md, hx - hr * 0.2, hy + hr * 0.35, s * hr * 1.0, 0.6, 0.5, 1.3));
      muzzle(1.15, 0.85);
      both(s => add(S(0.012), black, hx + hr * 1.12, hy - hr * 0.25, s * hr * 0.2));
      tail(md, 0.08, 0.012, 0.22, 2.4);
      break;
    case 2: // Hổ: round ears, stripes on the forehead, a striped tail
      roundEars(0.05); muzzle(1, 0.8); nose(pink, 0.05);
      for (let k = -1; k <= 1; k++) add(new THREE.BoxGeometry(0.03, 0.012, 0.1 - Math.abs(k) * 0.025), md, hx + k * 0.05, hy + hr * 0.95 - Math.abs(k) * 0.012, 0, 1, 1, 1, 0, 0, -k * 0.45);
      tail(m, 0.09, 0.022, 0.24, 2.2);
      for (const y of [0.14, 0.24]) add(new THREE.BoxGeometry(0.06, 0.016, 0.07), md, -0.13, y, 0);
      break;
    case 3: // Mèo: pointed ears, whiskers, a tail curling up
      pointyEars(0.11, 0.18); muzzle(0.9, 0.65); nose(pink, 0.045);
      both(s => { for (const dy of [-0.01, 0.015]) add(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 4), black, hx + hr * 0.95, hy - hr * 0.2 + dy, s * hr * 0.75, 1, 1, 1, Math.PI / 2 + s * dy * 6); });
      tail(m, 0.1, 0.022, 0.26, 2.0);
      break;
    case 4: // Rồng: golden horns, spikes down the back, long whiskers
      both(s => add(new THREE.ConeGeometry(0.025, 0.13, 10), gold, hx - hr * 0.35, hy + hr * 1.0, s * hr * 0.45, 0, 0, 0, s * 0.25, 0, 0.45));
      muzzle(1, 0.8); nose(md, 0.05);
      for (let k = 0; k < 4; k++) add(new THREE.ConeGeometry(0.03, 0.07, 8), ml, hx - hr * 0.95 - k * 0.07, hy + 0.06 - k * 0.07, 0, 1, 1, 0.5, 0, 0, 0.9);
      both(s => add(new THREE.CylinderGeometry(0.006, 0.004, 0.18, 5), gold, hx + hr * 1.15, hy - hr * 0.3, s * hr * 0.6, 1, 1, 1, s * 1.1, 0, 0.6));
      tail(m, 0.1, 0.03, 0.2, 2.4);
      break;
    case 5: // Rắn: a forked red tongue and a pale chin
      muzzle(1.05, 0.6, ml);
      add(new THREE.BoxGeometry(0.08, 0.008, 0.016), red, hx + hr * 1.25, hy - hr * 0.42, 0);
      both(s => add(new THREE.BoxGeometry(0.03, 0.008, 0.01), red, hx + hr * 1.25 + 0.05, hy - hr * 0.42, s * 0.01, 1, 1, 1, 0, s * 0.5));
      for (let k = 0; k < 5; k++) add(S(0.018), md, Math.cos(k * 1.26) * 0.13, 0.17, Math.sin(k * 1.26) * 0.13);
      break;
    case 6: // Ngựa: a long muzzle, small upright ears, a dark mane
      pointyEars(0.09, 0.05);
      add(S(hr * 0.55), ml, hx + hr * 0.9, hy - hr * 0.3, 0, 1.15, 0.8, 0.9);
      both(s => add(S(0.012), black, hx + hr * 1.48, hy - hr * 0.28, s * hr * 0.2));
      for (let k = 0; k < 5; k++) add(S(0.035), md, hx - hr * 0.7 - k * 0.025, hy + hr * 0.75 - k * 0.07, 0, 1, 1, 0.6);
      tail(md, 0.09, 0.028, 0.22, 2.3);
      break;
    case 7: // Dê: little curled horns, side ears, a beard
      both(s => add(new THREE.TorusGeometry(0.04, 0.016, 8, 14, Math.PI * 1.3), cream, hx - hr * 0.3, hy + hr * 0.85, s * hr * 0.42, 0, Math.PI / 2, 0.5));
      both(s => add(S(0.045), m, hx - hr * 0.1, hy + hr * 0.25, s * hr * 1.05, 0.6, 0.45, 1.3));
      muzzle(0.85, 0.7); nose(pink, 0.04);
      add(new THREE.ConeGeometry(0.03, 0.08, 10), cream, hx + hr * 0.75, hy - hr * 1.05, 0, 1, 1, 1, Math.PI);
      break;
    case 8: // Khỉ: big side ears, a pale heart of a face, a curly tail
      both(s => { add(S(0.06), m, hx - hr * 0.05, hy + hr * 0.1, s * hr * 1.08, 0.5, 1, 1); add(S(0.04), cream, hx + 0.005, hy + hr * 0.1, s * hr * 1.1, 0.4, 1, 1); });
      add(S(hr * 0.75), cream, hx + hr * 0.45, hy - hr * 0.05, 0, 0.6, 0.95, 1.1);
      nose(md, 0.035);
      tail(m, 0.11, 0.02, 0.3, 1.4);
      break;
    case 9: // Gà: a red comb, a yellow beak, a wattle, tail feathers fanned up
      for (let k = 0; k < 3; k++) add(S(0.035), red, hx - 0.03 + k * 0.035, hy + hr * 1.05 - Math.abs(k - 1) * 0.015, 0, 1, 1, 0.5);
      add(new THREE.ConeGeometry(0.035, 0.08, 10), gold, hx + hr * 1.15, hy - hr * 0.1, 0, 1, 1, 1, 0, 0, -Math.PI / 2);
      add(S(0.025), red, hx + hr * 1.0, hy - hr * 0.55, 0, 0.6, 1.2, 0.7);
      for (let k = -1; k <= 1; k++) add(S(0.06), k === 0 ? md : ml, -0.2, 0.33 + Math.abs(k) * -0.03, k * 0.06, 0.45, 1.5, 0.35, k * 0.4, 0, 0.5);
      both(s => add(S(0.07), md, -0.03, 0.22, s * 0.14, 1.3, 0.8, 0.35));
      break;
    case 10: // Chó: floppy ears, a black nose, a wagging tail
      both(s => add(S(0.055), md, hx - hr * 0.35, hy + hr * 0.25, s * hr * 0.9, 0.6, 1.4, 0.4, s * 0.3));
      muzzle(0.95, 0.75); nose(black, 0.06);
      add(S(0.04), pink, hx + hr * 0.95, hy - hr * 0.6, 0, 0.6, 0.45, 0.8); // a little tongue
      tail(m, 0.08, 0.025, 0.28, 1.7);
      break;
    default: { // Heo: a round snout with nostrils, folded ears, a curly tail
      add(new THREE.CylinderGeometry(hr * 0.38, hr * 0.42, 0.06, 20), ml, hx + hr * 0.98, hy - hr * 0.15, 0, 1, 1, 1, 0, 0, Math.PI / 2);
      both(s => add(S(0.014), md, hx + hr * 1.2, hy - hr * 0.15, s * hr * 0.15));
      both(s => add(new THREE.ConeGeometry(hr * 0.32, 0.08, 4), m, hx - hr * 0.05, hy + hr * 0.92, s * hr * 0.6, 0.3, 0, 0.5, s * 0.4));
      add(new THREE.TorusGeometry(0.03, 0.01, 8, 16, Math.PI * 1.8), md, -0.17, 0.23, 0, 1, 1, 1, 0, Math.PI / 2, 0);
    }
  }
  return g;
}

/**
 * Draws one animal's face, flat, for the HUD and the seat pickers.
 * @param ctx the canvas
 * @param a the animal, 0 Chuột ... 11 Heo
 * @param x the centre
 * @param y the centre
 * @param s the size: the face is about s wide
 * @param color its colour
 */
/** A face an animal icon can make: happy (^ ^), sad (a tear), asleep (closed eyes and a z). */
export type IconMood = 'happy' | 'sad' | 'sleep';
export function drawAnimalIcon(ctx: CanvasRenderingContext2D, a: number, x: number, y: number, s: number, color: string, mood?: IconMood): void {
  const r = s * 0.34, dark = shade(color, 0.62), light = shade(color, 1.35);
  ctx.save(); ctx.translate(x, y + s * 0.04); ctx.lineWidth = Math.max(1, s * 0.035); ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  const blob = (cx: number, cy: number, rx: number, ry: number, fill: string, stroke = true, rot = 0) => {
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); if (stroke) ctx.stroke();
  };
  const tri = (pts: number[], fill: string, stroke = true) => {
    ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1]); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill(); if (stroke) ctx.stroke();
  };
  const sides = (f: (k: number) => void) => { f(-1); f(1); };
  // behind the head: ears, horns, mane
  switch (a) {
    case 0: sides(k => { blob(k * r * 0.85, -r * 0.8, r * 0.48, r * 0.48, color); blob(k * r * 0.85, -r * 0.8, r * 0.28, r * 0.28, '#ff9db0', false); }); break;
    case 1: sides(k => { ctx.beginPath(); ctx.moveTo(k * r * 0.5, -r * 0.6); ctx.quadraticCurveTo(k * r * 1.6, -r * 0.7, k * r * 1.3, -r * 1.35); ctx.quadraticCurveTo(k * r * 1.2, -r * 0.85, k * r * 0.35, -r * 0.85); ctx.closePath(); ctx.fillStyle = '#fff1d6'; ctx.fill(); ctx.stroke(); blob(k * r * 1.05, -r * 0.15, r * 0.3, r * 0.18, dark, true, k * 0.3); }); break;
    case 2: sides(k => { blob(k * r * 0.75, -r * 0.8, r * 0.34, r * 0.34, color); blob(k * r * 0.75, -r * 0.8, r * 0.18, r * 0.18, '#ff9db0', false); }); break;
    case 3: sides(k => { tri([k * r * 0.25, -r * 0.8, k * r * 0.95, -r * 1.35, k * r * 0.95, -r * 0.35], color); tri([k * r * 0.45, -r * 0.75, k * r * 0.85, -r * 1.1, k * r * 0.85, -r * 0.5], '#ff9db0', false); }); break;
    case 4: sides(k => tri([k * r * 0.3, -r * 0.8, k * r * 0.75, -r * 1.5, k * r * 0.6, -r * 0.7], '#f2c44a')); tri([-r * 0.15, -r * 0.95, 0, -r * 1.3, r * 0.15, -r * 0.95], light); break;
    case 6: sides(k => tri([k * r * 0.3, -r * 0.75, k * r * 0.6, -r * 1.3, k * r * 0.8, -r * 0.55], color)); for (let k = 0; k < 4; k++) blob(-r * 0.2 + k * r * 0.15, -r * 0.95 + k * 0.02 * r, r * 0.2, r * 0.2, dark, false); break;
    case 7: sides(k => { ctx.beginPath(); ctx.arc(k * r * 0.6, -r * 1.0, r * 0.28, 0, Math.PI * 2); ctx.strokeStyle = '#fff1d6'; ctx.lineWidth = r * 0.16; ctx.stroke(); ctx.lineWidth = Math.max(1, s * 0.035); ctx.strokeStyle = 'rgba(0,0,0,0.45)'; blob(k * r * 1.1, -r * 0.1, r * 0.38, r * 0.18, color, true, k * 0.25); }); break;
    case 8: sides(k => { blob(k * r * 1.0, -r * 0.05, r * 0.36, r * 0.4, color); blob(k * r * 1.0, -r * 0.05, r * 0.2, r * 0.24, '#fff1d6', false); }); break;
    case 9: for (let k = -1; k <= 1; k++) blob(k * r * 0.32, -r * 1.0 + Math.abs(k) * r * 0.1, r * 0.22, r * 0.26, '#e0302a'); break;
    case 10: sides(k => blob(k * r * 0.95, -r * 0.05, r * 0.3, r * 0.6, dark, true, k * 0.35)); break;
    case 11: sides(k => tri([k * r * 0.3, -r * 0.8, k * r * 0.95, -r * 1.15, k * r * 0.85, -r * 0.4], color)); break;
  }
  // the head
  if (a === 5) blob(0, 0, r * 1.05, r * 0.88, color); else blob(0, 0, r, r, color);
  if (a === 10) sides(k => blob(k * r * 0.95, -r * 0.05, r * 0.3, r * 0.6, dark, true, k * 0.35)); // the dog's ears hang over
  // the face
  if (a === 2) for (let k = -1; k <= 1; k++) { ctx.fillStyle = dark; ctx.fillRect(k * r * 0.28 - r * 0.06, -r * 0.95, r * 0.12, r * 0.38 - Math.abs(k) * r * 0.1); }
  if (a === 8) blob(0, r * 0.12, r * 0.72, r * 0.68, '#fff1d6', false);
  const muzzle = a === 0 || a === 1 || a === 2 || a === 3 || a === 4 || a === 7 || a === 10;
  if (muzzle) blob(0, r * 0.42, a === 1 ? r * 0.62 : r * 0.42, a === 1 ? r * 0.36 : r * 0.3, '#fff1d6', false);
  if (a === 6) blob(0, r * 0.4, r * 0.5, r * 0.36, light, false);
  if (a === 5) blob(0, r * 0.45, r * 0.6, r * 0.28, light, false);
  if (a === 11) { blob(0, r * 0.4, r * 0.42, r * 0.3, light); sides(k => blob(k * r * 0.15, r * 0.4, r * 0.07, r * 0.11, dark, false)); }
  sides(k => {
    if (mood === 'happy' || mood === 'sleep') { // ^ ^ when happy, ‿ ‿ when asleep
      ctx.save(); ctx.strokeStyle = '#1e1a18'; ctx.lineWidth = Math.max(1.5, r * 0.09); ctx.lineCap = 'round'; ctx.beginPath();
      if (mood === 'happy') ctx.arc(k * r * 0.38, -r * 0.02, r * 0.14, Math.PI * 1.1, Math.PI * 1.9); else ctx.arc(k * r * 0.38, -r * 0.14, r * 0.14, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke(); ctx.restore();
    } else {
      blob(k * r * 0.38, -r * 0.08, r * 0.15, r * 0.17, '#1e1a18', false);
      blob(k * r * 0.38 + r * 0.05, -r * 0.15, r * 0.055, r * 0.055, '#ffffff', false);
    }
    if (mood === 'sad') { // brows tilted up in the middle
      ctx.save(); ctx.strokeStyle = '#1e1a18'; ctx.lineWidth = Math.max(1.2, r * 0.07); ctx.lineCap = 'round'; ctx.beginPath();
      ctx.moveTo(k * r * 0.22, -r * 0.4); ctx.lineTo(k * r * 0.55, -r * 0.3); ctx.stroke(); ctx.restore();
    }
    blob(k * r * 0.62, r * 0.25, r * 0.15, r * 0.09, mood === 'happy' ? 'rgba(255,90,130,0.9)' : 'rgba(255,120,150,0.75)', false);
  });
  if (mood === 'sad') { ctx.beginPath(); ctx.moveTo(-r * 0.4, r * 0.08); ctx.quadraticCurveTo(-r * 0.52, r * 0.3, -r * 0.4, r * 0.34); ctx.quadraticCurveTo(-r * 0.28, r * 0.3, -r * 0.4, r * 0.08); ctx.fillStyle = '#6cc6ff'; ctx.fill(); } // a tear
  if (mood === 'sleep') { ctx.fillStyle = '#5a7ab0'; ctx.font = `bold ${Math.round(r * 0.55)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('z', r * 0.95, -r * 0.95); ctx.font = `bold ${Math.round(r * 0.38)}px sans-serif`; ctx.fillText('z', r * 1.25, -r * 1.3); }
  if (a === 0 || a === 2 || a === 3 || a === 7) blob(0, r * 0.3, r * 0.1, r * 0.07, '#ff7f9a', false);
  if (a === 10 || a === 4) blob(0, r * 0.3, r * 0.13, r * 0.09, '#1e1a18', false);
  if (a === 1 || a === 6) sides(k => blob(k * r * 0.2, r * 0.45, r * 0.06, r * 0.08, '#1e1a18', false));
  if (a === 9) { tri([-r * 0.2, r * 0.18, r * 0.2, r * 0.18, 0, r * 0.55], '#f2c44a'); blob(0, r * 0.7, r * 0.1, r * 0.16, '#e0302a', false); }
  if (a === 5) { ctx.strokeStyle = '#e0302a'; ctx.lineWidth = r * 0.08; ctx.beginPath(); ctx.moveTo(0, r * 0.65); ctx.lineTo(0, r * 0.95); ctx.moveTo(0, r * 0.95); ctx.lineTo(-r * 0.12, r * 1.08); ctx.moveTo(0, r * 0.95); ctx.lineTo(r * 0.12, r * 1.08); ctx.stroke(); }
  if (a === 7) tri([-r * 0.12, r * 0.85, r * 0.12, r * 0.85, 0, r * 1.25], '#fff1d6', false);
  if (a === 3) { ctx.strokeStyle = 'rgba(30,26,24,0.7)'; ctx.lineWidth = Math.max(1, r * 0.04); sides(k => { for (const dy of [0.32, 0.45]) { ctx.beginPath(); ctx.moveTo(k * r * 0.35, r * dy); ctx.lineTo(k * r * 0.95, r * (dy - 0.06 + (dy - 0.38) * 0.6)); ctx.stroke(); } }); }
  ctx.restore();
}

/** A colour made darker (f < 1) or lighter (f > 1), as a CSS string. */
function shade(color: string, f: number): string {
  const c = new THREE.Color(color);
  if (f > 1) c.lerp(new THREE.Color(0xffffff), f - 1); else c.multiplyScalar(f);
  return `#${c.getHexString()}`;
}
