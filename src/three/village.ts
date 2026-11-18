// The chibi look's 3D village around and on the board: a grass island on blue water, round trees on
// the island's rim, and a lotus pond in the field with two ducks swimming. Only built when CHIBI is on (src/core/theme.ts); villageStep moves the ducks.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BOARD_TOP, L as BOARD_SIZE } from '../game/board';
import { canvasTex } from './materials';
import { prefs } from '../core/prefs';

const soft = (color: number, rough = 0.85) => new THREE.MeshStandardMaterial({ color, roughness: rough });
/** Where the pond sits in the field (world units), and its size: in the lower half, under the buttons. */
const POND = { x: 0, z: 2.2, r: 1.25 };
const ducks: { g: THREE.Group; a: number; speed: number; r: number }[] = [];
let water: THREE.Texture | null = null;

/** The water's ripples: soft light rings on blue, tiled across the sea. */
function waterTexture(): THREE.Texture {
  const t = canvasTex(256, 256, (c, w) => {
    c.fillStyle = '#6cc6e0'; c.fillRect(0, 0, w, w);
    c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 3;
    for (const [x, y, r] of [[60, 70, 18], [180, 50, 12], [130, 160, 22], [40, 210, 10], [220, 200, 15]]) {
      c.beginPath(); c.arc(x, y, r, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 10);
  return t;
}
/** A round tree: a brown trunk and two green balls. */
function tree(s: number): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 8), soft(0x9a6a44)); trunk.position.y = 0.15; g.add(trunk);
  for (const [y, r, x] of [[0.42, 0.24, 0], [0.62, 0.17, 0.05]]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), soft(0x5fb84a)); b.position.set(x, y, 0); b.castShadow = true; g.add(b);
  }
  g.scale.setScalar(s); return g;
}
/** A duck: a yellow body, a head, an orange beak. */
function duck(): THREE.Group {
  const g = new THREE.Group(), yellow = soft(0xffd84a, 0.6);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), yellow); body.scale.set(1.25, 0.8, 1); body.position.y = 0.06; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), yellow); head.position.set(0.12, 0.17, 0); g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.08, 8), soft(0xff8a2a)); beak.rotation.z = -Math.PI / 2; beak.position.set(0.22, 0.16, 0); g.add(beak);
  for (const z of [-0.035, 0.035]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), soft(0x2a1a10)); eye.position.set(0.17, 0.2, z); g.add(eye); }
  g.traverse(o => { (o as THREE.Mesh).castShadow = true; });
  return g;
}
/** Builds the village into the scene: call once, with the board already in place. */
export function buildVillage(scene: THREE.Scene): void {
  scene.background = new THREE.Color(0xbfe6f5);
  water = waterTexture();
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ map: water, roughness: 0.35 }));
  sea.rotation.x = -Math.PI / 2; sea.position.y = -0.5; sea.receiveShadow = true; scene.add(sea);
  // the island: brown earth with a grass top, its corners rounded, the board sitting on it
  const earth = new THREE.Mesh(new RoundedBoxGeometry(BOARD_SIZE + 1.2, 0.8, BOARD_SIZE + 1.2, 4, 0.35), soft(0xc08a5a));
  earth.position.y = -0.42; scene.add(earth);
  const grass = new THREE.Mesh(new RoundedBoxGeometry(BOARD_SIZE + 1.3, 0.22, BOARD_SIZE + 1.3, 4, 0.1), soft(0x86c95e));
  grass.position.y = BOARD_TOP / 2 - 0.12; grass.receiveShadow = true; scene.add(grass);
  // trees on the rim: at the corners, clear of the tiles
  const e = BOARD_SIZE / 2 + 0.35;
  for (const [x, z, s] of [[-e, -e, 1.2], [e, -e, 1], [-e, e, 1], [e, e, 1.15], [0, -e, 0.9], [-e, 0, 0.9], [e, 0.4, 0.95]]) {
    const t = tree(s); t.position.set(x, BOARD_TOP - 0.02, z); scene.add(t);
  }
  // the pond with lotus leaves and flowers
  const pond = new THREE.Mesh(new THREE.CylinderGeometry(POND.r, POND.r, 0.04, 40), new THREE.MeshStandardMaterial({ color: 0x7fd3ea, roughness: 0.25 }));
  pond.position.set(POND.x, BOARD_TOP + 0.01, POND.z); pond.receiveShadow = true; scene.add(pond);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(POND.r, 0.06, 8, 40), soft(0xd8c08a)); rim.rotation.x = Math.PI / 2; rim.position.set(POND.x, BOARD_TOP + 0.03, POND.z); scene.add(rim);
  for (const [a, d, flower] of [[0.4, 0.75, true], [1.9, 0.85, false], [2.8, 0.6, true], [4.3, 0.9, false], [5.4, 0.7, false]] as [number, number, boolean][]) {
    const x = POND.x + Math.cos(a) * d, z = POND.z + Math.sin(a) * d * 0.8;
    const leaf = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 20, 1, false, 0.3, Math.PI * 1.85), soft(0x4fae4a));
    leaf.position.set(x, BOARD_TOP + 0.04, z); scene.add(leaf);
    if (flower) for (let p = 0; p < 6; p++) {
      const petal = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), soft(0xff9ec4, 0.6));
      petal.scale.set(0.6, 1.2, 0.6); petal.position.set(x + Math.cos(p) * 0.05, BOARD_TOP + 0.12, z + Math.sin(p) * 0.05);
      petal.rotation.set(Math.sin(p) * 0.6, 0, Math.cos(p) * 0.6); scene.add(petal);
    }
  }
  for (const [a, speed, r] of [[0, 0.35, 0.55], [Math.PI, 0.35, 0.55]]) {
    const g = duck(); g.scale.setScalar(1.7); g.position.y = BOARD_TOP + 0.03; scene.add(g); ducks.push({ g, a, speed, r });
  }
}

/** Moves the village one step: the ducks swim round the pond, the water ripples. */
export function villageStep(dt: number, t: number): void {
  if (!prefs.effects) return; // effects off: the ducks rest and the water lies still
  for (const d of ducks) {
    d.a += d.speed * dt;
    d.g.position.x = POND.x + Math.cos(d.a) * d.r; d.g.position.z = POND.z + Math.sin(d.a) * d.r * 0.8;
    d.g.rotation.y = -d.a - Math.PI / 2; // beak forward along the circle
    d.g.position.y = BOARD_TOP + 0.03 + Math.sin(t * 3 + d.a) * 0.01;
  }
  if (water) water.offset.x = (t * 0.01) % 1;
}
