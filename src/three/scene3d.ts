// The 3D table: renderer, camera, the board and its tiles, pieces, buildings rising, dice, the pot, and what changes each frame.
import * as THREE from 'three';
import { tune } from '../config';

import { H, BW, screenScale, afterFit } from '../screen';

import { TILES, OWNABLE, ANIMALS, DEFAULT_ANIMALS } from '../game/data';
import { makeAnimal } from '../animals';
import { BAND, BOARD_TOP, L as BOARD_SIZE, tileInfo, tokenSpot } from '../game/board';

import { state, scene } from '../core/store';

import { mat, canvasTex, woodTexture, mesh } from '../three/materials';
import { icon } from '../draw/icons';
import { boardTexture, pipTexture } from '../three/boardTexture';
import { makeHouse, makeHotel, makeLandmark } from '../three/buildings';

import type { Loose } from '../game/types';

import { shakePower, curP, ownsGroup } from '../game/turn';

import { rawSfx, isGuest } from '../net/room';

import { L, hoverTile } from '../main';
import { applyMood } from './moods';
import { CHEAP } from '../core/env';
import { CHIBI } from '../core/theme';
import { buildVillage, villageStep } from './village';
import { buildFlights, stepFlights } from './coinFlights';
import { sfx } from '../audio';

// ---- 3D: renderer, table, board ------------------------------------------------------
export let renderer: THREE.WebGLRenderer | null = null, scene3: THREE.Scene, camera: THREE.PerspectiveCamera, figScene: THREE.Scene, figCamera: THREE.PerspectiveCamera;
const tok3: THREE.Group[] = [];
export const tokAnim: (Loose | null)[] = [], tokVis: ({ x: number; y: number; z: number } | undefined)[] = [];
const tileGroups: THREE.Group[] = [];
export const tileShown: number[] = [], ownerMarks: THREE.Mesh<THREE.BufferGeometry, Loose>[] = [], riseAnims: { obj: THREE.Object3D; t: number; s: number }[] = [];
type LooseMesh = THREE.Mesh<THREE.BufferGeometry, Loose>; // a mesh whose material the code recolours
export let dice3: THREE.Mesh[] = [], ring3: LooseMesh, flash3: LooseMesh, pick3: LooseMesh, hover3: LooseMesh;
/** Frames the board for the layout: a phone's square view stands the camera a little further back. */
export function aimCamera() {
  camera.aspect = L.bw / L.bh;
  if (L.phone) { // a phone: steeper, so the board's far side is not squeezed, and back far enough to fit the width
    const tilt = PHONE_CAM_TILT, d = PHONE_CAM_DIST * Math.max(1, 1 / camera.aspect);
    camera.position.set(0, d * Math.sin(tilt), d * Math.cos(tilt) + 0.3); camera.lookAt(0, 0, 0.3);
  } else { camera.position.set(0, 19.7, 13.75); camera.lookAt(0, 0, 0.5); }
  camera.updateProjectionMatrix();
}
/** The phone camera: its angle above the table (radians) and its distance on a square view. */
const PHONE_CAM_TILT = 1.24, PHONE_CAM_DIST = 24.6;
function sizeRenderer() {
  renderer!.setPixelRatio(CHEAP ? 0.5 : Math.min(2, screenScale));
  renderer!.setSize(L.bw, L.bh, false);
}
afterFit(() => { if (renderer) sizeRenderer(); }); // the 3D view follows the window size

// ---- 3D figures: tokens, buildings, landmarks ----------------------------------------
/** A player's piece: their zodiac animal (src/animals.ts). */
function makeToken(animal: number, color: string) {
  const outer = new THREE.Group(), inner = makeAnimal(animal, color, !CHEAP);
  outer.add(inner); outer.userData.inner = inner; // the board moves the outer group, the piece's mood the inner one
  return outer;
}
const tokKind: number[] = []; // which animal each seat's 3D piece shows
/** Rebuilds a seat's 3D piece when its player has a different animal (a new game, or a friend's). */
function syncPieces() {
  for (const p of state.players) {
    if (tokKind[p.id] === p.token) continue;
    const old = tok3[p.id], t = makeToken(p.token, p.color);
    t.scale.setScalar(tune.piece_scale); t.visible = false; scene3.remove(old); scene3.add(t); tok3[p.id] = t; tokKind[p.id] = p.token;
  }
}

// ---- 3D scene assembly ---------------------------------------------------------------
let boardTop: THREE.MeshStandardMaterial | null = null;
/** Draws the board's face again: after a font arrives that the first drawing did not have yet. */
export function redrawBoardFace() { if (!boardTop) return; boardTop.map?.dispose(); boardTop.map = boardTexture(); boardTop.needsUpdate = true; }
export function build3D() {
  renderer = new THREE.WebGLRenderer({ antialias: !CHEAP, preserveDrawingBuffer: true, alpha: false });
  renderer.shadowMap.enabled = !CHEAP; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  sizeRenderer();
  scene3 = new THREE.Scene(); scene3.background = new THREE.Color(0x2a1a10);
  camera = new THREE.PerspectiveCamera(30, BW / 720, 0.1, 100);
  aimCamera();
  addLights(scene3);
  if (CHIBI) buildVillage(scene3); // the chibi look: water, a grass island, a pond (src/three/village.ts)
  else {
    const wood = woodTexture(); wood.wrapS = wood.wrapT = THREE.RepeatWrapping; wood.repeat.set(3, 3);
    const table = mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.75 }), 0, 0, 0);
    table.rotation.x = -Math.PI / 2; scene3.add(table);
  }
  const edge = CHIBI ? mat(0x86c95e, { roughness: 0.9 }) : mat(0x4a2c1a, { roughness: 0.5 });
  const top = boardTop = new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.65 });
  const board = mesh(new THREE.BoxGeometry(BOARD_SIZE, BOARD_TOP, BOARD_SIZE), [edge, edge, top, edge, edge, edge], 0, BOARD_TOP / 2, 0);
  scene3.add(board);
  // the two decks of cards in the centre
  for (const [dx, dz, kind] of [[-2.3, -2.9, 'co'], [2.3, -2.9, 'kv']] as [number, number, string][]) {
    const faceTex = canvasTex(256, 192, (c: CanvasRenderingContext2D, w: number, h: number) => {
      c.fillStyle = kind === 'co' ? '#f6d26a' : '#d8403a'; c.fillRect(0, 0, w, h);
      c.strokeStyle = kind === 'co' ? '#b3201e' : '#f2c44a'; c.lineWidth = 8; c.strokeRect(10, 10, w - 20, h - 20);
      if (kind === 'co') icon.lantern(c, w / 2, h / 2, 120); else icon.envelope(c, w / 2, h / 2, 130);
    });
    const deck = new THREE.Group();
    for (let k = 0; k < 6; k++) {
      const card = mesh(new THREE.BoxGeometry(1.7, 0.03, 1.25), k === 5 ? [mat(0xf4ead2), mat(0xf4ead2), new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.5 }), mat(0xf4ead2), mat(0xf4ead2), mat(0xf4ead2)] : mat(0xf4ead2), (k % 2) * 0.02, BOARD_TOP + 0.015 + k * 0.03, 0);
      deck.add(card);
    }
    deck.position.set(dx, 0, dz); deck.rotation.y = dx < 0 ? 0.12 : -0.12; scene3.add(deck);
  }
  buildFlights(scene3); // coins that fly with a payment
  // owner marks along each ownable tile's outer edge
  for (let i = 0; i < 40; i++) {
    tileGroups[i] = new THREE.Group(); scene3.add(tileGroups[i]); tileShown[i] = -1;
    if (!OWNABLE(TILES[i])) continue;
    const ti = tileInfo(i);
    const horiz = ti.side === 0 || ti.side === 2;
    const m = mesh(new THREE.BoxGeometry(horiz ? 0.84 : 0.14, 0.05, horiz ? 0.14 : 0.84), mat(0xffffff), ti.x + ti.ox * 0.68, BOARD_TOP + 0.025, ti.z + ti.oz * 0.68);
    m.visible = false; scene3.add(m); ownerMarks[i] = m;
    if (TILES[i].t === 'prop') { // the ×2 coin just inside the tile's colour band, on the field, shown while the owner holds the whole group
      const c = new THREE.Sprite(new THREE.SpriteMaterial({ map: coinTex(), sizeAttenuation: false, transparent: true, depthTest: false, depthWrite: false }) /* whole, never cut by the board it stands on */);
      // next to a corner, two sides' coins would touch: move it along the side, away from the corner
      const k = i % 10, mid = tileInfo(i - k + 5), away = k === 1 || k === 9 ? COIN_CORNER : 0;
      const dx = Math.sign(mid.x - ti.x) * (horiz ? away : 0), dz = Math.sign(mid.z - ti.z) * (horiz ? 0 : away);
      c.position.set(ti.x - ti.ox * (0.8 + COIN_IN) + dx, BOARD_TOP + COIN_LIFT, ti.z - ti.oz * (0.8 + COIN_IN) + dz); c.renderOrder = 2;
      c.visible = false; scene3.add(c); coins[i] = c;
    }
  }
  // tokens
  for (let k = 0; k < 4; k++) { const a = DEFAULT_ANIMALS[k]; const t = makeToken(a, ANIMALS[a].color); t.scale.setScalar(tune.piece_scale); t.visible = false; scene3.add(t); tok3[k] = t; tokKind[k] = a; }
  // dice
  const pips = [3, 4, 1, 6, 2, 5].map(n => new THREE.MeshStandardMaterial({ map: pipTexture(n), roughness: 0.35 }));
  for (let k = 0; k < 2; k++) { const d = mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), pips, 0, 0, 0); scene3.add(d); dice3.push(d); }
  // the current player's ring, the landing flash and the fly-to cursor
  ring3 = mesh(new THREE.TorusGeometry(0.3, 0.035, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffffff }), 0, BOARD_TOP + 0.02, 0); ring3.rotation.x = Math.PI / 2; ring3.castShadow = false; scene3.add(ring3);
  flash3 = mesh(new THREE.BoxGeometry(1, 0.02, 1), new THREE.MeshBasicMaterial({ color: 0xfff2a0, transparent: true, opacity: 0.5 }), 0, BOARD_TOP + 0.012, 0); flash3.castShadow = false; flash3.visible = false; scene3.add(flash3);
  buildPot();
  hover3 = mesh(new THREE.BoxGeometry(1, 0.02, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 }), 0, BOARD_TOP + 0.015, 0); hover3.castShadow = false; hover3.visible = false; scene3.add(hover3);
  pick3 = mesh(new THREE.BoxGeometry(1, 0.03, 1), new THREE.MeshBasicMaterial({ color: 0x3fcf5a, transparent: true, opacity: 0.55 }), 0, BOARD_TOP + 0.02, 0); pick3.castShadow = false; pick3.visible = false; scene3.add(pick3);
  buildFigures();
}
// The jar of money between the two decks: a glazed clay jar, with coins piling up beside it.
export const POT_X = 0, POT_Z = -2.75;
let potCoins: THREE.Mesh[] = [], potShown = -1;
function buildPot() {
  const pts = [[0, 0], [0.32, 0], [0.42, 0.12], [0.46, 0.32], [0.4, 0.52], [0.26, 0.62], [0.24, 0.7], [0.3, 0.74], [0.3, 0.78], [0, 0.78]].map(([x, y]) => new THREE.Vector2(x, y));
  const jar = mesh(new THREE.LatheGeometry(pts, 28), new THREE.MeshPhongMaterial({ color: 0x5b3a8a, shininess: 70, specular: 0x777777 }), POT_X, BOARD_TOP, POT_Z);
  scene3.add(jar);
  const band = mesh(new THREE.TorusGeometry(0.455, 0.02, 8, 32), mat(0xe8b33a, { metalness: 0.3 }), POT_X, BOARD_TOP + 0.32, POT_Z); band.rotation.x = Math.PI / 2; scene3.add(band);
  const mouth = mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.02, 24), mat(0x2a1a10), POT_X, BOARD_TOP + 0.77, POT_Z); scene3.add(mouth);
  const coinGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.04, 20), coinM = new THREE.MeshPhongMaterial({ color: 0xf2c44a, shininess: 100, specular: 0xffffff });
  for (let k = 0; k < 30; k++) {
    const stack = k % 3, h = Math.floor(k / 3);
    const c = mesh(coinGeo, coinM, POT_X + 0.62 + stack * 0.2 - (stack === 2 ? 0.1 : 0), BOARD_TOP + 0.02 + h * 0.042, POT_Z + (stack === 2 ? 0.2 : -0.05));
    c.visible = false; scene3.add(c); potCoins.push(c);
  }
}
function syncPot() {
  const n = Math.min(potCoins.length, Math.ceil(state.pot / 200));
  if (n === potShown) return;
  potCoins.forEach((c, k) => { c.visible = k < n; }); potShown = n;
}
function addLights(s: THREE.Scene) {
  s.add(CHIBI ? new THREE.HemisphereLight(0xffffff, 0x9ccb7a, 1.6) : new THREE.HemisphereLight(0xfff0d8, 0x5a6f9a, 1.35));
  const sun = CHIBI ? new THREE.DirectionalLight(0xfff4e0, 2.0) : new THREE.DirectionalLight(0xffe0b0, 2.3);
  sun.position.set(-6, 14, 7); sun.castShadow = !CHEAP;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
  sun.shadow.bias = -0.0005;
  s.add(sun);
}
function buildFigures() { // the figures scene: every token, building and landmark side by side
  figScene = new THREE.Scene(); figScene.background = new THREE.Color(0x2a1a10);
  addLights(figScene);
  const wood = woodTexture(); wood.wrapS = wood.wrapT = THREE.RepeatWrapping; wood.repeat.set(2, 2);
  const table = mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.75 })); table.rotation.x = -Math.PI / 2; figScene.add(table);
  figCamera = new THREE.PerspectiveCamera(30, BW / H, 0.1, 100); figCamera.position.set(0, 7.4, 8.2); figCamera.lookAt(0, 0, 0.2);
  figItems = [];
  const put = (obj: THREE.Object3D, x: number, z: number, name: string, s = 1) => { obj.position.set(x, 0, z); obj.scale.setScalar(s); figScene.add(obj); figItems.push({ x, z, name }); };
  ANIMALS.forEach((an, k) => put(makeToken(k, an.color), -2.6 + (k % 6) * 0.78, k < 6 ? -2.3 : -1.2, an.name, 1.3));
  put(makeHouse(), 2.3, -2.3, 'Nhà', 1.8); put(makeHotel(), 2.3, -1.2, 'Khách sạn', 1.2);
  TILES.filter(t => t.t === 'prop').forEach((t, j) => put(makeLandmark(t.lk!), -2.75 + (j % 8) * 0.78, 0.3 + Math.floor(j / 8) * 0.95, t.n, 0.85)); // every province's landmark
}
export let figItems: { x: number; z: number; name: string }[] = [];

// ---- The full-group coin ----------------------------------------------------------------
// A gold coin with the rent multiplier sits on the field just inside each province's colour band while
// its owner (or team) holds the whole group: clear of the tile's name, price and houses. A sprite: it
// faces the player and keeps one size on the screen on every side of the board, near or far. When a group fills up its
// coins pop in one after another with the gong; one lost (a mortgage, a sale) they drop away.
const coins: THREE.Sprite[] = [];
/** The coin's size as a share of the board view's height (×2·tan(fov/2): a sprite's unattenuated scale). */
const COIN_SIZE = 0.042, COIN_IN = 0.2, COIN_CORNER = 0.22, COIN_LIFT = 0.06, COIN_POP = 0.45, COIN_STAGGER = 0.12;
const coinScale = (): number => COIN_SIZE * 2 * Math.tan((camera.fov * Math.PI) / 360);
let coinTexCache: THREE.Texture | null = null;
/** The coin: gold with a brown rim and the multiplier, the same on every band colour. */
function coinTex(): THREE.Texture {
  return coinTexCache ||= canvasTex(128, 128, (c, w) => {
    const r = w / 2, g = c.createRadialGradient(r * 0.75, r * 0.7, r * 0.1, r, r, r);
    g.addColorStop(0, '#fff2b0'); g.addColorStop(0.55, '#f2c44a'); g.addColorStop(1, '#b8861e');
    c.fillStyle = '#5a2a1c'; c.beginPath(); c.arc(r, r, r - 2, 0, 7); c.fill();
    c.fillStyle = g; c.beginPath(); c.arc(r, r, r - 10, 0, 7); c.fill();
    c.strokeStyle = 'rgba(120,70,20,0.6)'; c.lineWidth = 3; c.beginPath(); c.arc(r, r, r - 20, 0, 7); c.stroke();
    c.fillStyle = '#5a2a1c'; c.font = 'bold 56px "Segoe UI", Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(`×${tune.full_group_mult}`, r, r + 4);
  });
}
const coinOn: boolean[] = [], coinT: number[] = []; // shown now; seconds since it popped in (negative: waiting its turn)
let coinsReady = false; // false after a new, resumed or joined game: its coins show at once, with no gong
/** A new game on this screen (clearVis): the next sync shows the coins as they are, without popping them. */
export function resetCoins() { coinsReady = false; }
/** Shows, pops and drops the coins to match who holds a full group. */
function syncCoins(dt: number) {
  const fresh = !coinsReady; coinsReady = true;
  const order: number[] = [], rang: boolean[] = []; // per group: the next coin's turn, and its gong
  for (let i = 0; i < 40; i++) {
    const c = coins[i]; if (!c) continue;
    const o = state.owner[i], on = o >= 0 && ownsGroup(o, TILES[i].g!);
    if (on !== !!coinOn[i]) {
      coinOn[i] = on;
      const g = TILES[i].g!;
      if (on && !fresh) { coinT[i] = -(order[g] = (order[g] ?? -1) + 1) * COIN_STAGGER; if (!rang[g] && !isGuest()) { sfx.landmark(); rang[g] = true; } } else coinT[i] = COIN_POP; // the host's gong reaches friends online
    }
    c.visible = on && coinT[i] >= 0;
    if (!on) continue;
    coinT[i] += dt;
    const t = Math.min(1, coinT[i] / COIN_POP), pop = t < 1 ? Math.sin(t * Math.PI * 0.75) / Math.sin(Math.PI * 0.75) : 1; // overshoots, then settles
    c.scale.setScalar(coinScale() * Math.max(0, pop));
  }
}

// ---- 3D per-frame sync ---------------------------------------------------------------
export function syncBuildings(dt: number) {
  syncCoins(dt);
  if (CHIBI) villageStep(dt, state.t);
  stepFlights(k => tokVis[k] ?? tok3[k]?.position, { x: POT_X, y: 0, z: POT_Z });
  for (let i = 0; i < 40; i++) {
    if (!OWNABLE(TILES[i])) continue;
    const o = state.owner[i];
    const m = ownerMarks[i];
    m.visible = o >= 0;
    if (o >= 0) { m.material.color.set(state.mort[i] ? '#8a8378' : state.players[o].color); }
    const lvl = TILES[i].t === 'prop' && o >= 0 ? state.level[i] : 0;
    if (tileShown[i] === lvl) continue;
    const g = tileGroups[i]; g.clear();
    const ti = tileInfo(i);
    const inX = ti.x - ti.ox * (0.8 - BAND / 2), inZ = ti.z - ti.oz * (0.8 - BAND / 2); // the band's centre
    const rotY = ti.side === 0 ? 0 : ti.side === 1 ? -Math.PI / 2 : ti.side === 2 ? Math.PI : Math.PI / 2;
    let obj = null;
    if (lvl >= 1 && lvl <= 4) {
      obj = new THREE.Group();
      for (let h = 0; h < lvl; h++) { const hs = makeHouse(); hs.position.x = -0.33 + h * 0.22; obj.add(hs); }
    } else if (lvl === 5) obj = makeHotel();
    else if (lvl === 6) obj = makeLandmark(TILES[i].lk!);
    if (obj) {
      obj.position.set(inX, BOARD_TOP, inZ); obj.rotation.y = rotY;
      if (lvl === 6) obj.scale.setScalar(1.05);
      g.add(obj);
      if (lvl > tileShown[i] && tileShown[i] >= 0) riseAnims.push({ obj, t: 0, s: obj.scale.x });
    }
    tileShown[i] = lvl;
  }
  for (let k = riseAnims.length - 1; k >= 0; k--) {
    const a = riseAnims[k]; a.t += dt;
    const u = Math.min(1, a.t / 0.45), e = 1 - Math.pow(1 - u, 3);
    a.obj.scale.set(a.s, a.s * Math.max(0.02, e) * (1 + 0.15 * Math.sin(u * Math.PI)), a.s);
    if (u >= 1) { a.obj.scale.setScalar(a.s); riseAnims.splice(k, 1); }
  }
}
export const lastPos: number[] = [];
export function updateTokens(dt: number) {
  state.players.forEach(p => {
    const k = p.id, tgt = tokenSpot(k, p.pos, p.inJail);
    if (!tokVis[k]) tokVis[k] = { x: tgt.x, y: 0, z: tgt.z };
    if (isGuest() && lastPos[k] !== undefined && lastPos[k] !== p.pos && !tokAnim[k]) { // a guest sees the host's moves as hops
      const step1 = (p.pos - lastPos[k] + 40) % 40 === 1 || (lastPos[k] - p.pos + 40) % 40 === 1;
      tokAnim[k] = { from: { x: tokVis[k]!.x, z: tokVis[k]!.z }, to: tgt, t: 0, dur: step1 ? tune.hop_time * 0.95 : 0.7, h: step1 ? 0.45 : 1.8 };
      if (step1) rawSfx.tick();
    }
    lastPos[k] = p.pos;
    const a = tokAnim[k];
    if (a) {
      a.t += dt; const u = Math.min(1, a.t / a.dur);
      tokVis[k].x = a.from.x + (a.to.x - a.from.x) * u; tokVis[k].z = a.from.z + (a.to.z - a.from.z) * u;
      tokVis[k].y = Math.sin(u * Math.PI) * a.h;
      if (u >= 1) tokAnim[k] = null;
    } else {
      tokVis[k].x += (tgt.x - tokVis[k].x) * Math.min(1, dt * 10); tokVis[k].z += (tgt.z - tokVis[k].z) * Math.min(1, dt * 10); tokVis[k].y = 0;
    }
  });
}
export function hop(pi: number, fromPos: number, toPos: number, dur: number) {
  const p = state.players[pi];
  tokAnim[p.id] = { from: tokenSpot(p.id, fromPos, false), to: tokenSpot(p.id, toPos, false), t: 0, dur, h: 0.45 };
}
function diceFinalQuat(v: number, yaw: number) {
  const e = ({ 1: [0, 0, 0], 6: [Math.PI, 0, 0], 2: [-Math.PI / 2, 0, 0], 5: [Math.PI / 2, 0, 0], 3: [0, 0, Math.PI / 2], 4: [0, 0, -Math.PI / 2] } as Record<number, number[]>)[v];
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2]));
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(q);
}
const SHAKE_AT = [{ x: -0.3, y: 1.9, z: 0.9 }, { x: 0.3, y: 2.0, z: 1.0 }];
function placeDice() {
  if (state && state.shaking) { // rattling in the air: the harder the shake, the wilder the jiggle
    const t = state.shaking.t, pw = shakePower(), amp = 0.06 + 0.22 * pw;
    for (let k = 0; k < 2; k++) {
      const d = dice3[k], h = SHAKE_AT[k], f = 22 + k * 5;
      d.position.set(h.x + Math.sin(t * f + k) * amp, h.y + Math.abs(Math.sin(t * (f + 9))) * amp * 1.2, h.z + Math.cos(t * (f - 4) + k * 2) * amp);
      d.rotation.set(t * (9 + 6 * pw) + k, t * (7 + 5 * pw) * (k ? -1 : 1), Math.sin(t * 13) * 1.5);
    }
    return;
  }
  const dur = state && state.diceDur || tune.dice_time, pw = state && state.throwPower !== undefined ? state.throwPower : 0.5;
  const u = Math.min(1, state.diceT / dur), ease = 1 - Math.pow(1 - u, 3);
  const bounces = 2 + 2.5 * pw, height = 1.2 + 1.6 * pw;
  for (let k = 0; k < 2; k++) {
    const d = dice3[k], spin = state.diceSpin ? state.diceSpin[k] : { ax: 0, ay: 1, az: 0, yaw: 0.3 + k, n: 0 };
    const sx = SHAKE_AT[k].x, sz = SHAKE_AT[k].z, ex = -0.5 + k * 1.0, ez = -1.7 + k * 0.25;
    const over = Math.sin(u * Math.PI) * 0.35 * pw; // a hard throw skids a little past and slides back
    d.position.x = sx + (ex - sx) * ease + over * (k ? 1 : -1) * 0.4; d.position.z = sz + (ez - sz) * ease - over;
    const fall = u < 0.18 ? (SHAKE_AT[k].y - BOARD_TOP - 0.275) * (1 - u / 0.18) : 0;
    d.position.y = BOARD_TOP + 0.275 + Math.max(fall, height * Math.pow(1 - u, 1.6) * Math.abs(Math.cos(u * Math.PI * bounces)) * Math.min(1, u / 0.18));
    const qf = diceFinalQuat(state.dice[k], spin.yaw);
    const ax = new THREE.Vector3(spin.ax, spin.ay, spin.az).normalize();
    const extra = new THREE.Quaternion().setFromAxisAngle(ax, (1 - ease) * spin.n * Math.PI * 2);
    d.quaternion.copy(extra.multiply(qf));
  }
}
export function render3D() {
  if (!renderer) return;
  if (scene === 'figures') { renderer.render(figScene, figCamera); return; }
  const showGame = state && state.players;
  for (let k = 0; k < 4; k++) tok3[k].visible = false;
  if (showGame && scene !== 'title') {
    syncPieces();
    state.players.forEach((p) => {
      const t = tok3[p.id], v = tokVis[p.id];
      if (!v || p.bankrupt) return;
      t.visible = true; t.position.set(v.x, BOARD_TOP + v.y, v.z);
      const ti = tileInfo(p.pos); t.rotation.y = Math.atan2(ti.ox, ti.oz) + Math.PI;
      applyMood(t.userData.inner, p);
    });
    const cp = curP(), cv = tokVis[cp.id];
    ring3.visible = !!cv && state.phase !== 'over';
    if (cv) { ring3.position.set(cv.x, BOARD_TOP + 0.02 + cv.y, cv.z); ring3.material.color.set(cp.color); const s = 1 + 0.12 * Math.sin(state.t * 6); ring3.scale.set(s, s, s); }
    placeDice(); syncPot();
    flash3.visible = state.flash.tile >= 0 && state.flash.t < 1.2;
    if (flash3.visible) { const ti = tileInfo(state.flash.tile); flash3.position.x = ti.x; flash3.position.z = ti.z; const hz = ti.side === 0 || ti.side === 2; flash3.scale.set(ti.side < 0 ? 1.6 : hz ? 1 : 1.6, 1, ti.side < 0 ? 1.6 : hz ? 1.6 : 1); flash3.material.opacity = 0.55 * (1 - state.flash.t / 1.2); }
    hover3.visible = hoverTile >= 0 && state.phase !== 'pick';
    if (hover3.visible) { const ti = tileInfo(hoverTile); const hz = ti.side === 0 || ti.side === 2; hover3.position.set(ti.x, BOARD_TOP + 0.015, ti.z); hover3.scale.set(ti.side < 0 ? 1.6 : hz ? 1 : 1.6, 1, ti.side < 0 ? 1.6 : hz ? 1.6 : 1); }
    pick3.visible = state.phase === 'pick';
    if (pick3.visible) { const ti = tileInfo(state.pick); const hz = ti.side === 0 || ti.side === 2; pick3.position.set(ti.x, BOARD_TOP + 0.02, ti.z); pick3.scale.set(ti.side < 0 ? 1.6 : hz ? 1 : 1.6, 1, ti.side < 0 ? 1.6 : hz ? 1.6 : 1); pick3.material.opacity = 0.35 + 0.25 * Math.sin(state.t * 8); }
  } else { ring3.visible = false; flash3.visible = false; pick3.visible = false; placeDice(); }
  renderer.render(scene3, camera);
}
export function project(x: number, y: number, z: number, cam = camera) {
  const v = new THREE.Vector3(x, y, z).project(cam);
  return cam === camera ? { x: L.bx + (v.x + 1) / 2 * L.bw, y: L.by + (1 - v.y) / 2 * L.bh } : { x: (v.x + 1) / 2 * BW, y: (1 - v.y) / 2 * 720 };
}
export function boardPointAt(lx: number, ly: number) {
  const ndc = new THREE.Vector2((lx - L.bx) / L.bw * 2 - 1, -((ly - L.by) / L.bh * 2 - 1));
  const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, camera);
  const pt = new THREE.Vector3();
  return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -BOARD_TOP), pt) ? pt : null;
}

