// Houses, hotels and each province's Landmark as small 3D models (about 0.9 tall).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mat, mesh } from './materials';
import { CHIBI } from '../core/theme';

export function makeHouse() {
  if (CHIBI) return toyHouse();
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.17, 0.13, 0.17), mat(0xf4ead2), 0, 0.065, 0));
  const roof = mesh(new THREE.ConeGeometry(0.15, 0.11, 4), mat(0xc0502a), 0, 0.185, 0); roof.rotation.y = Math.PI / 4; g.add(roof);
  g.add(mesh(new THREE.BoxGeometry(0.05, 0.07, 0.01), mat(0x6a3a1a), 0, 0.035, 0.086));
  return g;
}
export function makeHotel() {
  if (CHIBI) return toyHotel();
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.62, 0.34, 0.26), mat(0x3d7fb8), 0, 0.17, 0));
  g.add(mesh(new THREE.BoxGeometry(0.66, 0.04, 0.3), mat(0xf4ead2), 0, 0.36, 0));
  for (let r = 0; r < 2; r++) for (let k = -2; k <= 2; k++) g.add(mesh(new THREE.BoxGeometry(0.07, 0.07, 0.01), mat(0xfff0b0, { emissive: 0x332200 }), k * 0.11, 0.1 + r * 0.13, 0.131));
  g.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.28, 6), mat(0x888888), 0.26, 0.52, 0));
  g.add(mesh(new THREE.BoxGeometry(0.14, 0.08, 0.005), mat(0xd8403a), 0.33, 0.62, 0));
  return g;
}
export function makeLandmark(kind: string) { // ~0.9 tall, a toy model of the province's landmark
  const g = new THREE.Group();
  const stone = mat(0xe8dcc0), gold = mat(0xe8b33a, { metalness: 0.3, roughness: 0.4 }), red = mat(0xb3201e), roofM = mat(0x8a3a24);
  const green = mat(0x3f8a3a), blue = mat(0x3a8fd0), white = mat(0xf7f3ea), brick = mat(0xb8602e), grey = mat(0x8a8a8a);
  const base = mesh(new THREE.BoxGeometry(0.8, 0.05, 0.36), mat(0xd9c48a), 0, 0.025, 0); g.add(base);
  const curvedRoof = (w: number, d: number, y: number, m?: THREE.Material) => { // a hipped roof: a 4-sided cone squashed to w x d
    const r = new THREE.Group(), c = mesh(new THREE.ConeGeometry(0.71, 0.12, 4), m || roofM); c.rotation.y = Math.PI / 4; r.add(c);
    r.position.set(0, y, 0); r.scale.set(w, 1, d); return r;
  };
  const rod = (a: number[], b: number[], r: number, m: THREE.Material) => { // a thin bar from a to b: cables, pylons
    const A = new THREE.Vector3(a[0], a[1], a[2]), B = new THREE.Vector3(b[0], b[1], b[2]);
    const o = mesh(new THREE.CylinderGeometry(r, r, A.distanceTo(B), 5), m);
    o.position.copy(A).add(B).multiplyScalar(0.5); o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    return o;
  };
  if (kind === 'cotco') { // flag tower on a hill
    g.add(mesh(new THREE.ConeGeometry(0.36, 0.2, 7), green, 0, 0.15, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.38, 8), stone, 0, 0.44, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 6), grey, 0, 0.84, 0));
    const flag = mesh(new THREE.BoxGeometry(0.26, 0.17, 0.008), red, 0.13, 0.96, 0); g.add(flag);
    const st = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.01, 5), gold, 0.13, 0.96, 0.007); st.rotation.x = Math.PI / 2; g.add(st);
  } else if (kind === 'thac') { // waterfall over stepped cliffs
    for (let k = 0; k < 3; k++) g.add(mesh(new THREE.BoxGeometry(0.75 - k * 0.12, 0.2, 0.3 - k * 0.04), mat(0x5a6a4a), 0, 0.12 + k * 0.2, -0.02 - k * 0.02));
    for (let k = 0; k < 3; k++) g.add(mesh(new THREE.BoxGeometry(0.5 - k * 0.1, 0.2, 0.02), blue, 0, 0.12 + k * 0.2, 0.14 - k * 0.02));
    g.add(mesh(new THREE.BoxGeometry(0.78, 0.03, 0.12), mat(0x9fd6f0), 0, 0.05, 0.13));
    for (const x of [-0.3, 0.3]) g.add(mesh(new THREE.ConeGeometry(0.08, 0.22, 8), green, x, 0.72, -0.06));
  } else if (kind === 'nui') { // a peak with snow and a little pagoda
    g.add(mesh(new THREE.ConeGeometry(0.38, 0.75, 7), mat(0x4f7a3a), 0, 0.42, 0));
    g.add(mesh(new THREE.ConeGeometry(0.13, 0.25, 7), white, 0, 0.67, 0));
    g.add(mesh(new THREE.BoxGeometry(0.1, 0.08, 0.1), red, 0.24, 0.15, 0.14));
    g.add(curvedRoof(0.16, 0.16, 0.22, roofM).translateX(0.24).translateZ(0.14));
  } else if (kind === 'dao') { // two karst islets rising from the sea
    g.add(mesh(new THREE.BoxGeometry(0.8, 0.03, 0.36), mat(0x3aa6c8), 0, 0.055, 0));
    const a = mesh(new THREE.CylinderGeometry(0.08, 0.15, 0.62, 7), mat(0x6f7f5a), -0.13, 0.36, 0); a.rotation.z = 0.08; g.add(a);
    const b = mesh(new THREE.CylinderGeometry(0.07, 0.13, 0.5, 7), mat(0x6f7f5a), 0.15, 0.3, 0.02); b.rotation.z = -0.1; g.add(b);
    g.add(mesh(new THREE.SphereGeometry(0.09, 10, 8), green, -0.13, 0.68, 0)); g.add(mesh(new THREE.SphereGeometry(0.08, 10, 8), green, 0.17, 0.56, 0.02));
  } else if (kind === 'thap') { // a tiered tower
    for (let k = 0; k < 6; k++) {
      const s = 0.3 - k * 0.04;
      g.add(mesh(new THREE.BoxGeometry(s, 0.11, s), brick, 0, 0.1 + k * 0.13, 0));
      g.add(mesh(new THREE.BoxGeometry(s + 0.06, 0.02, s + 0.06), stone, 0, 0.165 + k * 0.13, 0));
    }
    g.add(mesh(new THREE.ConeGeometry(0.05, 0.16, 8), gold, 0, 0.94, 0));
  } else if (kind === 'chua') { // a small temple on a single pillar over a lotus pond
    g.add(mesh(new THREE.BoxGeometry(0.62, 0.03, 0.32), mat(0x3aa6c8), 0, 0.055, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.36, 10), stone, 0, 0.25, 0));
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.04, 0.3), mat(0x8a5a2a), 0, 0.44, 0));
    g.add(mesh(new THREE.BoxGeometry(0.22, 0.16, 0.22), mat(0x9a3a1a), 0, 0.54, 0));
    g.add(curvedRoof(0.42, 0.42, 0.7, roofM));
    g.add(mesh(new THREE.SphereGeometry(0.03, 8, 6), gold, 0, 0.78, 0));
    for (const [x, z] of [[-0.22, 0.08], [0.22, -0.08], [0.2, 0.1]]) g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.01, 10), green, x, 0.075, z));
  } else if (kind === 'cong') { // a citadel gate with a pavilion
    g.add(mesh(new THREE.BoxGeometry(0.76, 0.32, 0.3), mat(0x9a8a6a), 0, 0.21, 0));
    g.add(mesh(new THREE.BoxGeometry(0.16, 0.2, 0.31), mat(0x2a1d12), 0, 0.15, 0));
    g.add(mesh(new THREE.BoxGeometry(0.44, 0.14, 0.2), red, 0, 0.44, 0));
    g.add(curvedRoof(0.56, 0.3, 0.57, mat(0xd8a020)));
    g.add(mesh(new THREE.BoxGeometry(0.26, 0.1, 0.14), red, 0, 0.66, 0));
    g.add(curvedRoof(0.36, 0.22, 0.76, mat(0xd8a020)));
  } else if (kind === 'cau') { // a bridge with a golden dragon arching over it
    g.add(mesh(new THREE.BoxGeometry(0.8, 0.03, 0.36), mat(0x3aa6c8), 0, 0.055, 0));
    g.add(mesh(new THREE.BoxGeometry(0.82, 0.05, 0.14), stone, 0, 0.22, 0));
    for (const x of [-0.3, 0, 0.3]) g.add(mesh(new THREE.BoxGeometry(0.05, 0.16, 0.1), stone, x, 0.12, 0));
    for (let k = 0; k < 3; k++) { const arc = mesh(new THREE.TorusGeometry(0.13, 0.03, 8, 20, Math.PI), gold, -0.26 + k * 0.26, 0.25, 0); g.add(arc); }
    const head = mesh(new THREE.ConeGeometry(0.05, 0.14, 8), gold, 0.42, 0.3, 0); head.rotation.z = -1.2; g.add(head);
  } else if (kind === 'haidang') { // a striped lighthouse
    for (let k = 0; k < 5; k++) g.add(mesh(new THREE.CylinderGeometry(0.09 - k * 0.008, 0.1 - k * 0.008, 0.14, 14), k % 2 ? red : white, 0, 0.12 + k * 0.14, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 12), mat(0xfff2a0, { emissive: 0xffc840, emissiveIntensity: 0.8 }), 0, 0.82, 0));
    g.add(mesh(new THREE.ConeGeometry(0.09, 0.1, 12), red, 0, 0.91, 0));
    g.add(mesh(new THREE.BoxGeometry(0.2, 0.1, 0.16), white, 0.24, 0.1, 0.05));
  } else if (kind === 'thapdh') { // a market hall with a clock tower
    g.add(mesh(new THREE.BoxGeometry(0.76, 0.24, 0.28), mat(0xf0e2b0), 0, 0.17, 0));
    g.add(curvedRoof(0.8, 0.32, 0.33, mat(0x6a7f8a)));
    g.add(mesh(new THREE.BoxGeometry(0.18, 0.5, 0.18), mat(0xf6ecc8), 0, 0.42, 0.02));
    const clockFace = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 20), white, 0, 0.58, 0.115); clockFace.rotation.x = Math.PI / 2; g.add(clockFace);
    g.add(mesh(new THREE.BoxGeometry(0.008, 0.045, 0.004), mat(0x222222), 0, 0.595, 0.123));
    g.add(mesh(new THREE.ConeGeometry(0.13, 0.16, 4), mat(0x6a7f8a), 0, 0.75, 0.02).rotateY(Math.PI / 4));
  } else if (kind === 'phongnha') { // a limestone mountain with a cave mouth over a river, a boat going in
    g.add(mesh(new THREE.BoxGeometry(0.8, 0.03, 0.15), mat(0x3aa6c8), 0, 0.055, 0.1));
    const rock = mat(0x7f8c70);
    const m1 = mesh(new THREE.CylinderGeometry(0.13, 0.3, 0.62, 7), rock, -0.06, 0.36, -0.06); m1.scale.z = 0.62; g.add(m1);
    const m2 = mesh(new THREE.CylinderGeometry(0.08, 0.2, 0.42, 7), rock, 0.24, 0.26, -0.07); m2.scale.z = 0.6; g.add(m2);
    g.add(mesh(new THREE.SphereGeometry(0.13, 10, 8), green, -0.06, 0.68, -0.06)); g.add(mesh(new THREE.SphereGeometry(0.09, 10, 8), green, 0.24, 0.48, -0.07));
    const cave = mesh(new THREE.SphereGeometry(0.1, 14, 10), mat(0x1a1410), -0.06, 0.08, 0.1); cave.scale.set(1.1, 1.2, 0.35); g.add(cave);
    g.add(mesh(new THREE.BoxGeometry(0.13, 0.03, 0.05), mat(0x7a4a22), 0.2, 0.085, 0.11));
    g.add(curvedRoof(0.08, 0.05, 0.12, mat(0x3a5a8a)).translateX(0.2).translateZ(0.11));
  } else if (kind === 'honthom') { // a sandy island with palms and a cable car line out to sea
    g.add(mesh(new THREE.BoxGeometry(0.8, 0.03, 0.36), mat(0x3ab0d0), 0, 0.055, 0));
    const sand = mesh(new THREE.SphereGeometry(0.26, 16, 10), mat(0xf0d89a), -0.08, 0.06, 0); sand.scale.set(1.1, 0.35, 0.8); g.add(sand);
    for (const [x, z, tilt] of [[-0.2, -0.04, 0.25], [0.02, 0.06, -0.2]]) {
      const trunk = mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.36, 6), mat(0x8a5a2a), x, 0.27, z); trunk.rotation.z = tilt; g.add(trunk);
      const tx = x - Math.sin(tilt) * 0.18;
      for (let k = 0; k < 5; k++) { const leaf = mesh(new THREE.ConeGeometry(0.035, 0.18, 4), green, tx + Math.cos(k * 1.26) * 0.07, 0.44, z + Math.sin(k * 1.26) * 0.07); leaf.rotation.set(Math.sin(k * 1.26) * 1.2, 0, -Math.cos(k * 1.26) * 1.2); g.add(leaf); }
    }
    g.add(mesh(new THREE.BoxGeometry(0.04, 0.7, 0.04), mat(0xd0d0d0), 0.32, 0.4, -0.05));
    g.add(rod([0.32, 0.74, -0.05], [-0.38, 0.5, -0.05], 0.005, mat(0x333333)));
    g.add(mesh(new THREE.BoxGeometry(0.08, 0.06, 0.06), red, 0.04, 0.6, -0.05));
  } else if (kind === 'baidinh') { // a great pagoda hall with double golden roofs and a tall stupa behind
    g.add(mesh(new THREE.BoxGeometry(0.66, 0.06, 0.3), stone, 0, 0.08, 0.02));
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.18, 0.2), mat(0x8a3020), 0.06, 0.2, 0.04));
    g.add(curvedRoof(0.66, 0.32, 0.34, gold));
    g.add(mesh(new THREE.BoxGeometry(0.34, 0.08, 0.14), mat(0x8a3020), 0.06, 0.44, 0.04));
    g.add(curvedRoof(0.46, 0.24, 0.53, gold));
    for (let k = 0; k < 6; k++) { // the stupa
      const s = 0.12 - k * 0.012;
      g.add(mesh(new THREE.BoxGeometry(s, 0.09, s), white, -0.3, 0.13 + k * 0.11, -0.08));
      g.add(curvedRoof(s * 1.9, s * 1.9, 0.19 + k * 0.11, roofM).translateX(-0.3).translateZ(-0.08));
    }
    g.add(mesh(new THREE.ConeGeometry(0.03, 0.12, 8), gold, -0.3, 0.86, -0.08));
  } else if (kind === 'thapdoi') { // two Cham brick towers side by side, one taller
    for (const [x, h] of [[-0.17, 1], [0.17, 0.82]]) {
      const champa = mat(0xa8482a);
      g.add(mesh(new THREE.BoxGeometry(0.22, 0.3 * h, 0.22), champa, x, 0.05 + 0.15 * h, 0));
      g.add(mesh(new THREE.BoxGeometry(0.07, 0.16 * h, 0.01), mat(0x3a1a10), x, 0.05 + 0.1 * h, 0.115));
      for (let k = 0; k < 3; k++) {
        const s = 0.18 - k * 0.04, y = 0.05 + 0.3 * h + k * 0.11 * h;
        g.add(mesh(new THREE.BoxGeometry(s, 0.1 * h, s), champa, x, y + 0.05 * h, 0));
        for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(mesh(new THREE.ConeGeometry(0.018, 0.05, 6), champa, x + cx * s / 2, y + 0.12 * h, cz * s / 2));
      }
      g.add(mesh(new THREE.ConeGeometry(0.05, 0.14 * h, 4), champa, x, 0.05 + 0.63 * h + 0.07 * h, 0).rotateY(Math.PI / 4));
    }
  } else if (kind === 'ponagar') { // a Cham tower up a hill of steps, a small one beside it
    const hill = mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.16, 10), mat(0x7a8a5a), 0, 0.13, -0.02); hill.scale.z = 0.5; g.add(hill);
    for (let k = 0; k < 4; k++) g.add(mesh(new THREE.BoxGeometry(0.16, 0.035, 0.05), stone, 0, 0.07 + k * 0.035, 0.16 - k * 0.04));
    const champa = mat(0xb04e2c);
    g.add(mesh(new THREE.BoxGeometry(0.2, 0.32, 0.18), champa, 0, 0.37, -0.04));
    g.add(mesh(new THREE.BoxGeometry(0.06, 0.15, 0.01), mat(0x3a1a10), 0, 0.29, 0.055));
    for (let k = 0; k < 3; k++) g.add(mesh(new THREE.BoxGeometry(0.16 - k * 0.04, 0.1, 0.15 - k * 0.04), champa, 0, 0.58 + k * 0.1, -0.04));
    g.add(mesh(new THREE.SphereGeometry(0.035, 8, 6), stone, 0, 0.88, -0.04));
    g.add(mesh(new THREE.BoxGeometry(0.1, 0.18, 0.1), champa, 0.25, 0.3, -0.05));
    g.add(mesh(new THREE.ConeGeometry(0.05, 0.12, 4), champa, 0.25, 0.45, -0.05).rotateY(Math.PI / 4));
  } else if (kind === 'binhta') { // the old brick foundations, a small stupa and a linga under a banyan
    g.add(mesh(new THREE.BoxGeometry(0.56, 0.08, 0.28), brick, -0.04, 0.09, 0));
    g.add(mesh(new THREE.BoxGeometry(0.4, 0.08, 0.2), brick, -0.04, 0.17, 0));
    const stupa = mesh(new THREE.SphereGeometry(0.11, 14, 10), mat(0xc0703a), -0.04, 0.25, 0); stupa.scale.y = 0.9; g.add(stupa);
    g.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 10), stone, -0.04, 0.4, 0));
    g.add(mesh(new THREE.SphereGeometry(0.025, 8, 6), stone, -0.04, 0.47, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.4, 7), mat(0x6a4a2a), 0.3, 0.25, -0.05));
    for (const [dx, dy] of [[0, 0.55], [-0.08, 0.48], [0.08, 0.5]]) g.add(mesh(new THREE.SphereGeometry(0.11, 10, 8), green, 0.3 + dx, dy, -0.05));
  } else if (kind === 'phattich') { // a temple hall with the row of stone animals before it
    g.add(mesh(new THREE.BoxGeometry(0.7, 0.05, 0.32), stone, 0, 0.075, 0));
    g.add(mesh(new THREE.BoxGeometry(0.46, 0.2, 0.16), mat(0x9a3a1a), 0, 0.2, -0.06));
    for (const x of [-0.18, -0.06, 0.06, 0.18]) g.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.2, 6), red, x, 0.2, 0.025));
    g.add(curvedRoof(0.64, 0.28, 0.36, roofM));
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.02, 0.02), gold, 0, 0.43, -0.04));
    for (let k = 0; k < 5; k++) { // the stone animals: elephants, lions, rhinos
      const x = -0.24 + k * 0.12;
      g.add(mesh(new THREE.BoxGeometry(0.06, 0.02, 0.05), grey, x, 0.11, 0.12));
      const b = mesh(new THREE.SphereGeometry(0.035, 10, 8), mat(0x9a9a92), x, 0.15, 0.12); b.scale.set(1.3, 0.9, 0.8); g.add(b);
      g.add(mesh(new THREE.SphereGeometry(0.022, 8, 6), mat(0x9a9a92), x + 0.04, 0.17, 0.12));
    }
  } else if (kind === 'thanhnhaho') { // a wall of great stone blocks with three arched gates
    const rock = mat(0x8e9484);
    g.add(mesh(new THREE.BoxGeometry(0.78, 0.4, 0.26), rock, 0, 0.25, 0));
    for (let k = 1; k < 4; k++) g.add(mesh(new THREE.BoxGeometry(0.79, 0.008, 0.27), mat(0x6a7062), 0, 0.05 + k * 0.1, 0));
    for (let k = 0; k < 7; k++) g.add(mesh(new THREE.BoxGeometry(0.008, 0.4, 0.27), mat(0x6a7062), -0.33 + k * 0.11, 0.25, 0));
    for (const [x, r] of [[-0.24, 0.06], [0, 0.08], [0.24, 0.06]]) {
      g.add(mesh(new THREE.BoxGeometry(r * 2, r * 1.6, 0.02), mat(0x1e1812), x, 0.05 + r * 0.8, 0.125));
      const top = mesh(new THREE.CylinderGeometry(r, r, 0.02, 16, 1, false, 0, Math.PI), mat(0x1e1812), x, 0.05 + r * 1.6, 0.125); top.rotation.set(Math.PI / 2, Math.PI / 2, 0); g.add(top);
    }
    for (let k = 0; k < 6; k++) g.add(mesh(new THREE.BoxGeometry(0.09, 0.06, 0.24), rock, -0.33 + k * 0.132, 0.48, 0));
  } else if (kind === 'chuacau') { // the covered bridge: pink walls, a tiled roof, the little shrine in the middle
    g.add(mesh(new THREE.BoxGeometry(0.8, 0.03, 0.36), mat(0x3aa6c8), 0, 0.055, 0));
    for (const x of [-0.3, 0.3]) g.add(mesh(new THREE.BoxGeometry(0.08, 0.14, 0.2), stone, x, 0.12, 0));
    g.add(mesh(new THREE.BoxGeometry(0.72, 0.04, 0.2), mat(0x7a4a22), 0, 0.2, 0));
    g.add(mesh(new THREE.BoxGeometry(0.66, 0.16, 0.16), mat(0xe8a0a0), 0, 0.3, 0));
    for (let k = 0; k < 5; k++) g.add(mesh(new THREE.BoxGeometry(0.06, 0.07, 0.01), mat(0x3a2a1a), -0.24 + k * 0.12, 0.3, 0.082));
    g.add(curvedRoof(0.8, 0.28, 0.44, mat(0x9a4a2a)));
    g.add(mesh(new THREE.BoxGeometry(0.14, 0.12, 0.12), mat(0xe8c060), 0, 0.3, 0.13));
    g.add(curvedRoof(0.2, 0.16, 0.4, mat(0x9a4a2a)).translateZ(0.13));
  } else if (kind === 'caucantho') { // a cable-stayed bridge: two tall pylons, fans of cables
    g.add(mesh(new THREE.BoxGeometry(0.8, 0.03, 0.36), mat(0x3a90b0), 0, 0.055, 0));
    g.add(mesh(new THREE.BoxGeometry(0.84, 0.035, 0.12), white, 0, 0.24, 0));
    const steel = mat(0xe0e0e0), cable = mat(0xf2c44a);
    for (const px of [-0.2, 0.2]) {
      for (const s of [-1, 1]) g.add(rod([px, 0.06, s * 0.08], [px, 0.86, 0], 0.016, steel));
      g.add(mesh(new THREE.BoxGeometry(0.04, 0.03, 0.18), steel, px, 0.22, 0));
      for (let k = 1; k <= 3; k++) for (const d of [-1, 1]) g.add(rod([px, 0.82 - k * 0.07, 0], [px + d * k * 0.065, 0.26, 0], 0.004, cable));
    }
  } else if (kind === 'vungtau') { // a white lighthouse on a green hill, the keeper's house beside it
    const hill = mesh(new THREE.ConeGeometry(0.4, 0.3, 10), mat(0x4f8a3a), 0, 0.2, 0); hill.scale.z = 0.5; g.add(hill);
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.42, 8), white, 0, 0.55, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.02, 8), mat(0x333333), 0, 0.77, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.07, 10), mat(0xfff2a0, { emissive: 0xffc840, emissiveIntensity: 0.8 }), 0, 0.81, 0));
    g.add(mesh(new THREE.ConeGeometry(0.065, 0.08, 10), mat(0x333333), 0, 0.88, 0));
    g.add(mesh(new THREE.BoxGeometry(0.14, 0.08, 0.1), white, 0.2, 0.2, 0.05));
    g.add(curvedRoof(0.18, 0.13, 0.27, red).translateX(0.2).translateZ(0.05));
  } else if (kind === 'gadalat') { // the station with three steep pointed roofs, and a little red engine
    g.add(mesh(new THREE.BoxGeometry(0.72, 0.2, 0.2), mat(0xf2e6c4), 0, 0.15, -0.05));
    for (const [x, h] of [[-0.24, 0.32], [0, 0.4], [0.24, 0.32]]) {
      const roof = mesh(new THREE.ConeGeometry(0.15, h, 4), mat(0xb8562e), x, 0.25 + h / 2, -0.05); roof.rotation.y = Math.PI / 4; roof.scale.z = 0.75; g.add(roof);
      g.add(mesh(new THREE.BoxGeometry(0.05, 0.08, 0.01), mat(0x5a9ad0), x, 0.36, 0.0));
    }
    for (let k = 0; k < 5; k++) g.add(mesh(new THREE.BoxGeometry(0.06, 0.08, 0.01), mat(0x5a9ad0), -0.26 + k * 0.13, 0.15, 0.052));
    g.add(mesh(new THREE.BoxGeometry(0.2, 0.08, 0.08), red, 0.14, 0.1, 0.13));
    g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 8), mat(0x2a2a2a), 0.2, 0.17, 0.13));
    g.add(mesh(new THREE.BoxGeometry(0.07, 0.07, 0.08), red, 0.07, 0.17, 0.13));
  }
  if (CHIBI) { const toy = new THREE.Group(); g.scale.set(1.1, 0.88, 1.1); toy.add(g); return toy; } // chibi: a little squatter and rounder
  return g;
}

// ---- The chibi look's toy buildings: rounded, pastel, a little chubby ----------------------------
const PASTEL_ROOFS = [0xff8a6a, 0x7ab8f0, 0x9ad66a, 0xffc14a];
let roofTurn = 0;
/** A toy house: a rounded cream body, a round window, a soft roof in one of four pastel colours. */
function toyHouse() {
  const g = new THREE.Group();
  g.add(mesh(new RoundedBoxGeometry(0.19, 0.15, 0.19, 3, 0.045), mat(0xfff4e0, { roughness: 0.8 }), 0, 0.075, 0));
  const roof = mesh(new THREE.ConeGeometry(0.16, 0.12, 4), mat(PASTEL_ROOFS[roofTurn++ % PASTEL_ROOFS.length], { roughness: 0.7 }), 0, 0.2, 0); roof.rotation.y = Math.PI / 4; g.add(roof);
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.01, 16), mat(0xffd84a, { emissive: 0x332200 }), 0, 0.085, 0.097).rotateX(Math.PI / 2));
  return g;
}
/** A toy hotel: a peach rounded block with round windows and a striped awning. */
function toyHotel() {
  const g = new THREE.Group();
  g.add(mesh(new RoundedBoxGeometry(0.6, 0.34, 0.26, 4, 0.07), mat(0xffb59a, { roughness: 0.8 }), 0, 0.17, 0));
  g.add(mesh(new RoundedBoxGeometry(0.64, 0.06, 0.3, 3, 0.03), mat(0xfff4e0), 0, 0.36, 0));
  for (let r = 0; r < 2; r++) for (let k = -2; k <= 2; k++) g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.01, 14), mat(0xfff0b0, { emissive: 0x332200 }), k * 0.11, 0.1 + r * 0.13, 0.132).rotateX(Math.PI / 2));
  g.add(mesh(new THREE.SphereGeometry(0.05, 14, 10), mat(0xff6a8a), 0.24, 0.42, 0)); // a round sign on top
  return g;
}
