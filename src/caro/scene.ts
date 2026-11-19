// Cờ Caro's screens: the setup screen (who plays, with which animal, the blocked-at-both-ends rule)
// and the game (the 15x15 board seen tilted, Cờ Tỷ Phú's 3D zodiac pieces on it, the players' panel),
// with the end of the game drawn over it. The turns are in ./game.ts, online play in ./online.ts, the
// rules in ./rules.ts.

import { inZone } from '../game/dice';
import { tune, CONFIG } from '../config';
import { sfx } from '../audio';
import { W, H, FONT, ctx, text, rrect, clear, screenScale, wrapLines } from '../screen';
import { setScene, scene } from '../core/store';
import { F } from '../core/flags';
import { prefs } from '../core/prefs';
import type { Loose } from '../game/types';
import { ANIMALS } from '../game/data';
import { btn, clicks, pressed, pointer, pointerHeld, down, L, checkSeed as mainSeed } from '../main';
import { drawButton, drawTokenIcon, lacquer, messageBox } from '../ui/draw';
import { openPicker, buildPicker, drawPicker } from '../ui/setupScreen';
import { openPage } from '../ui/pages';
import { openSettings } from '../ui/settings';
import { LEAVE_LOCAL, CHANGE_PLAYERS } from '../ui/words';
import { wideSpeedSpot, phoneRow, resultsBox, drawSummary, drawOrderMark, drawMeter, METER_W } from '../ui/gameChrome';
import { makeTips } from '../ui/gameTips';
import { board3d, type BoardSpot } from '../three/board3d';
import { buildViewButtons, viewKeys, viewRow } from '../ui/viewButtons';
import { useView } from '../ui/viewGestures';
import { speedNow, cycleSpeed } from '../core/speed';
import { showOnlinePanel } from '../net/room';
import { G, setG, SEATS, LV_NAMES, caroSetup, newGame, playAgain, tryPlace, startShake, shakePower, orderDice, curP, step as gameStep, rulesNow, autoPlays, cellName } from './game';
import { EMPTY, rank, type CaroSeat } from './rules';
import * as on from './online';
import { localGame, lastRoom, type KeptGame } from './keep';

/** First-game tips, as Cờ Tỷ Phú's: the first move. */
const tips = makeTips('caro:', {
  order: 'Giữ nút đỏ để lắc, thả ra để thảy: thanh lực chạy lên xuống, thả lúc cao dễ ra số lớn. Ai được điểm cao hơn đi trước.',
  turn: 'Bấm một ô trống để đặt quân. Ai có 5 quân liền ngang, dọc hoặc chéo trước thì thắng.',
  block: 'Luật Việt Nam: 5 quân liền mà bị quân đối thủ chặn cả hai đầu thì chưa thắng. Mép bàn không tính là chặn.',
});

const animalName = (a: number): string => ANIMALS[a]?.name ?? 'Quân';
/** Gives seat i the next animal the other seat does not have. */
function nextAnimal(i: number): void {
  const used = new Set(caroSetup.seats.filter((_, k) => k !== i).map(s => s.animal));
  let a = caroSetup.seats[i].animal;
  for (let k = 0; k < 12; k++) { a = (a + 1) % 12; if (!used.has(a)) break; }
  caroSetup.seats[i].animal = a;
  sfx.animal(a);
}
on.useNames({ animalName, nextAnimal });

// ---- Layout ------------------------------------------------------------------------------------
const phone = (): boolean => L.phone;
/** The board's square on the screen. */
function boardRect(): { x: number; y: number; s: number } {
  return phone() ? { x: 4, y: 52, s: 472 } : { x: 30, y: 20, s: 680 };
}
/** The wide layout's panel. */
const PX = 740, PWD = 1280 - 740;
/** The board's side in cells: the game's own, or data/config.json's before a game. */
const N = (): number => G?.size ?? rulesNow().size;
const cellSize = (): number => boardRect().s / N();
/** The flat board's margin around the grid (its frame and the column letters), a share of its side. */
const PAD = 0.05;
/** The board in 3D (src/three/board3d.ts): the flat picture with its margin as the face of a wooden board,
 * seen from the player's own view (turned, tilted, zoomed). */
const B = board3d('caro', '#b07a34');
/** Where the board is on the screen: the 3D picture fills the board's side of the screen; the usual view fits the grid and its margin. */
const viewRect = () => (phone() ? { x: 0, y: 46, w: W, h: 482 } : { x: 0, y: 0, w: PX, h: H });
function syncView(): void { const b = boardRect(), p = b.s * PAD; B.frame(viewRect(), { x: b.x - p, y: b.y - p, s: b.s + p * 2 }, phone()); }
/** A point of the grid (rows and columns, as fractions) on the screen, and how big things are there. */
function at(r: number, c: number): BoardSpot { const n = 1 + PAD * 2, k = N(); return B.project((PAD + c / k) / n, (PAD + r / k) / n); }
/** The centre of a cell on the screen. */
const cellSpot = (cell: number): BoardSpot => at(Math.floor(cell / N()) + 0.5, (cell % N()) + 0.5);
/** The cell under a point of the screen, or -1. */
function cellAt(x: number, y: number): number {
  const q = B.unproject(x, y), n = 1 + PAD * 2, k = N();
  if (!q) return -1;
  const r = Math.floor((q.v * n - PAD) * k), c = Math.floor((q.u * n - PAD) * k);
  return r >= 0 && c >= 0 && r < k && c < k ? r * k + c : -1;
}

// ---- The board, drawn once into its own canvas ---------------------------------------------------
let boardCache: HTMLCanvasElement | null = null, cacheKey = '';
function drawBoardInto(c: CanvasRenderingContext2D, s: number, k: number): void {
  const cs = s / k, m = s * PAD;
  c.fillStyle = '#c98f3a'; rrect(c, -m, -m, s + m * 2, s + m * 2, m * 0.8); c.fill(); // the wooden frame
  c.fillStyle = '#e8b866'; rrect(c, -m * 0.75, -m * 0.75, s + m * 1.5, s + m * 1.5, m * 0.6); c.fill();
  for (let r = 0; r < k; r++) for (let col = 0; col < k; col++) { // the cells: cream paper, light and dark by turns
    c.fillStyle = (r + col) % 2 ? '#fff3d8' : '#fffaf0';
    c.fillRect(col * cs, r * cs, cs, cs);
  }
  c.strokeStyle = '#d9a86a'; c.lineWidth = Math.max(1, cs * 0.04);
  for (let i = 0; i <= k; i++) { c.beginPath(); c.moveTo(i * cs, 0); c.lineTo(i * cs, s); c.stroke(); c.beginPath(); c.moveTo(0, i * cs); c.lineTo(s, i * cs); c.stroke(); }
  c.strokeStyle = '#9a6a26'; c.lineWidth = Math.max(2, cs * 0.08); c.strokeRect(0, 0, s, s);
  const mid = Math.floor(k / 2), q = Math.min(3, Math.floor(k / 4)); // the star points: the middle and four around it
  c.fillStyle = '#c98f3a';
  for (const [r, col] of [[mid, mid], [q, q], [q, k - 1 - q], [k - 1 - q, q], [k - 1 - q, k - 1 - q]]) { c.beginPath(); c.arc((col + 0.5) * cs, (r + 0.5) * cs, cs * 0.09, 0, 7); c.fill(); }
  c.fillStyle = '#6a4a26'; c.font = `bold ${Math.round(Math.min(m * 0.55, cs * 0.42))}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
  for (let i = 0; i < k; i++) { // column letters along the far and near edges, row numbers down the sides (as the log names cells)
    const L1 = String.fromCharCode(65 + i), n1 = String(i + 1);
    c.fillText(L1, (i + 0.5) * cs, -m * 0.4); c.fillText(L1, (i + 0.5) * cs, s + m * 0.42);
    c.fillText(n1, -m * 0.42, (i + 0.5) * cs); c.fillText(n1, s + m * 0.42, (i + 0.5) * cs);
  }
}
/** Copies the board, drawn once at the screen's pixel size. */
function drawBoard(): void {
  const b = boardRect(), px = Math.min(2048, Math.round(b.s * screenScale * (B.live ? 2 : 1))), key = `${px}:${N()}`;
  if (!boardCache || key !== cacheKey) {
    const pad = Math.round(px * PAD);
    boardCache = document.createElement('canvas'); boardCache.width = boardCache.height = px + pad * 2;
    const c = boardCache.getContext('2d')!; c.translate(pad, pad); c.scale(px / b.s, px / b.s);
    drawBoardInto(c, b.s, N()); cacheKey = key;
  }
  B.drawBoard(ctx, boardCache);
}

// ---- Pieces ------------------------------------------------------------------------------------
/** One piece, flat: a round base in the seat's colour, the player's animal on it (cards, setup, results). */
function drawPiece(x: number, y: number, size: number, seat: number, animal: number, lift = 0, glow = 0, mood?: 'happy' | 'sad'): void {
  const S = SEATS[seat];
  ctx.save();
  ctx.fillStyle = 'rgba(40,60,30,0.28)'; ctx.beginPath(); ctx.ellipse(x, y + size * 0.42, size * 0.42, size * 0.14, 0, 0, 7); ctx.fill();
  if (glow) { ctx.strokeStyle = `rgba(255,236,120,${0.5 + 0.5 * glow})`; ctx.lineWidth = size * 0.12; ctx.beginPath(); ctx.arc(x, y - lift, size * 0.58, 0, 7); ctx.stroke(); }
  ctx.fillStyle = S.dark; ctx.beginPath(); ctx.arc(x, y - lift + size * 0.06, size * 0.46, 0, 7); ctx.fill();
  ctx.fillStyle = S.color; ctx.beginPath(); ctx.arc(x, y - lift, size * 0.46, 0, 7); ctx.fill();
  ctx.strokeStyle = '#fff6e2'; ctx.lineWidth = size * 0.06; ctx.stroke();
  ctx.restore();
  drawTokenIcon(animal, x, y - lift - size * 0.02, size * 0.86, S.color, mood ?? (glow ? 'happy' : undefined));
}
/** A piece standing on the board: its shadow and (glow) a ring drawn on the board now, the 3D figure queued
 * (B.flush draws the figures over the board's marks). */
function drawBoardPiece(at: BoardSpot, size: number, seat: number, animal: number, lift: number, glow: number, mood?: 'happy' | 'sad'): void {
  const x = at.x, y = at.y;
  ctx.save();
  ctx.fillStyle = 'rgba(40,60,30,0.3)'; ctx.beginPath(); ctx.ellipse(x, y, size * 0.4 * (1 - Math.min(0.5, lift / (size * 3))), size * 0.17, 0, 0, 7); ctx.fill();
  if (glow) { ctx.strokeStyle = `rgba(255,236,120,${0.5 + 0.5 * glow})`; ctx.lineWidth = size * 0.12; ctx.beginPath(); ctx.ellipse(x, y, size * 0.52, size * 0.24, 0, 0, 7); ctx.stroke(); }
  ctx.restore();
  B.piece(at, size, lift, SEATS[seat].color, SEATS[seat].dark, animal, mood);
}
/** The winning row: a golden band through its cells, under the pieces. */
function drawWinLine(): void {
  if (!G.line || G.line.length < 2) return;
  const a = cellSpot(G.line[0]), b = cellSpot(G.line[G.line.length - 1]), cs = cellSize();
  ctx.save(); ctx.lineCap = 'round';
  ctx.strokeStyle = `rgba(255,216,74,${0.55 + 0.35 * Math.sin(G.t * 6)})`; ctx.lineWidth = cs * 0.55 * (a.k + b.k) / 2;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
}
/** The last piece placed: a ring on its cell. Your turn: the cell under the pointer (or the keyboard's cursor) glows. */
function drawMarks(): void {
  const cs = cellSize();
  if (G.last >= 0 && G.phase !== 'drop') {
    const s = cellSpot(G.last);
    ctx.save(); ctx.strokeStyle = '#d9442b'; ctx.lineWidth = Math.max(2, cs * 0.08 * s.k); ctx.beginPath(); ctx.ellipse(s.x, s.y, cs * 0.42 * s.k, cs * 0.3 * s.k, 0, 0, 7); ctx.stroke(); ctx.restore();
  }
  const aim = aimCell();
  if (aim >= 0) {
    const s = cellSpot(aim), S = SEATS[curP().seat];
    ctx.save(); ctx.globalAlpha = 0.45 + 0.2 * Math.sin(G.t * 6); ctx.fillStyle = S.color;
    ctx.beginPath(); ctx.ellipse(s.x, s.y, cs * 0.38 * s.k, cs * 0.27 * s.k, 0, 0, 7); ctx.fill(); ctx.restore();
  }
}
/** The empty cell this screen would play now (the pointer's, or the keyboard cursor's), or -1. */
function aimCell(): number {
  if (!boardLive || !myTurn() || G.phase !== 'turn') return -1;
  const c = useCursor ? cursor : cellAt(pointer.x, pointer.y);
  return c >= 0 && G.board[c] === EMPTY ? c : -1;
}
function drawPieces(): void {
  const cs = cellSize(), list: { cell: number; who: number; s: BoardSpot }[] = [];
  G.board.forEach((who, cell) => { if (who !== EMPTY) list.push({ cell, who, s: cellSpot(cell) }); });
  list.sort((a, b) => a.s.y - b.s.y); // the far ones first
  const win = new Set(G.line ?? []);
  for (const it of list) {
    const p = G.players[it.who], ck = cs * it.s.k;
    let lift = 0;
    if (G.drop?.cell === it.cell) { const u = Math.min(1, G.drop.t / tune.caro_place_time); lift = (1 - u) * (1 - u) * ck * 3; }
    const glow = win.has(it.cell) ? 0.5 + 0.5 * Math.sin(G.t * 6) : 0;
    const mood = G.phase === 'over' && !G.draw ? (it.who === G.winner ? 'happy' : 'sad') : undefined;
    drawBoardPiece(it.s, ck * 0.82, p.seat, p.animal, lift, glow, mood);
  }
  B.flush(ctx); // the figures, over the board's marks; the words float above them
  for (const f of G.floaters) {
    const u = f.t / 1.6, s = cellSpot(f.cell), y = s.y - cs * 1.2 - u * cs;
    ctx.save(); ctx.globalAlpha = 1 - Math.max(0, u - 0.6) / 0.4;
    ctx.font = `bold ${Math.round(Math.max(18, cs * 0.6))}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 6; ctx.strokeStyle = '#fff6e2'; ctx.strokeText(f.text, s.x, y);
    ctx.fillStyle = f.color; ctx.fillText(f.text, s.x, y); ctx.restore();
  }
}

// ---- The first game's throws for who goes first --------------------------------------------------------
const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};
/** A cream die with paw-print pips, as the other games' dice. */
function drawDieFace(x: number, y: number, s: number, n: number, rot: number): void {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = 'rgba(40,60,30,0.25)'; rrect(ctx, -s / 2 + 4, -s / 2 + 8, s, s, s * 0.22); ctx.fill();
  const g = ctx.createLinearGradient(0, -s / 2, 0, s / 2); g.addColorStop(0, '#fffaf0'); g.addColorStop(1, '#fbe6c4');
  ctx.fillStyle = g; rrect(ctx, -s / 2, -s / 2, s, s, s * 0.22); ctx.fill();
  ctx.strokeStyle = '#d9a86a'; ctx.lineWidth = Math.max(1.5, s * 0.03); ctx.stroke();
  ctx.fillStyle = n === 1 || n === 6 ? '#d9442b' : '#5a3a26';
  for (const [dx, dy] of PIPS[n] || []) {
    const px = dx * s * 0.27, py = dy * s * 0.27, r = s * (n === 1 ? 0.17 : 0.1);
    ctx.beginPath(); ctx.ellipse(px, py + r * 0.25, r * 0.55, r * 0.45, 0, 0, 7); ctx.fill();
    for (const [a, b] of [[-0.55, -0.45], [0, -0.72], [0.55, -0.45]]) { ctx.beginPath(); ctx.arc(px + a * r, py + b * r, r * 0.22, 0, 7); ctx.fill(); }
  }
  ctx.restore();
}
/** The shake button's row (the dice at its right end): in the panel under the turn line, on a phone above its row of buttons. */
function controls(): { bx: number; by: number; bw: number } {
  return phone() ? { bx: 16, by: H - 176, bw: W - 32 } : { bx: PX + 34, by: 420, bw: PWD - 68 };
}
/** The dice of the throws for the order: shaking in the hand, tumbling, then the total, big, as they stop. */
function drawOrderDice(): void {
  if (!G.order) return;
  const c = controls(), n = orderDice(), s = n > 1 ? 52 : 64, x0 = c.bx + c.bw - (n > 1 ? 62 : 40), y0 = c.by + 31;
  const last = G.dice.length === n ? G.dice : Array(n).fill(6);
  for (let k = 0; k < n; k++) {
    const ox = n > 1 ? (k ? 1 : -1) * s * 0.58 : 0, ph = k * 1.7;
    let face = last[k], rot = 0, dy = 0, dx = 0;
    if (G.phase === 'shake' && G.shake) {
      const t = G.shake.t; face = 1 + (Math.floor(t * 14 + k * 3) % 6);
      dx = Math.sin(t * 47 + ph) * 4; dy = Math.cos(t * 39 + ph) * 3; rot = Math.sin(t * 31 + ph) * 0.25;
    } else if (G.phase === 'dice' && G.throwAt) {
      const th = G.throwAt, u = Math.min(1, th.t / th.dur);
      face = u > 0.85 ? last[k] : th.faces[Math.min(th.faces.length - 1, Math.floor(u * th.faces.length))][k] ?? last[k];
      dy = -Math.abs(Math.sin(u * Math.PI * (3 + k * 0.5) + ph * 0.3)) * (1 - u) * (24 + th.power * 30);
      rot = th.spin * (k ? -1 : 1) * (1 - u) * (1 - u) * 3;
    } else if (prefs.effects) dy = -Math.abs(Math.sin(G.t * 2 + ph)) * 2;
    drawDieFace(x0 + ox + dx, y0 + dy, s, face, rot);
  }
  if (G.show && G.show.t < 1.4 && G.phase === 'shown') {
    const total = G.show.dice.reduce((a, b) => a + b, 0), t = G.show.t;
    const pop = t < 0.15 ? 0.5 + t / 0.15 * 0.7 : 1.2 - Math.min(0.2, (t - 0.15) * 0.8), alpha = t > 1 ? 1 - (t - 1) / 0.4 : 1;
    ctx.save(); ctx.globalAlpha = Math.max(0, alpha); ctx.translate(x0, y0 - s * 0.1); ctx.scale(pop, pop);
    ctx.font = `bold 40px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 8; ctx.strokeStyle = '#fff6e2'; ctx.strokeText(String(total), 0, 0);
    ctx.fillStyle = '#4a3020'; ctx.fillText(String(total), 0, 0); ctx.restore();
  }
  if (G.phase === 'shake' && G.shake && !G.shake.ai && myTurn()) { // the power bar under the button
    const w = c.bw, h = 10, pw = shakePower();
    const own = on.isGuest() && on.guestShaking; // a friend: its own clock, no lag
    drawMeter(c.bx + (c.bw - (orderDice() > 1 ? 136 : 92) - METER_W) / 2, c.by + 68, METER_W, h, own ? on.guestPower() : pw, G.shake.zone, 0, false, false); // centred under the shake button, one length in every game; its words are on the button
  }
}
/** The shake button's words while shaking: "let go now" over the sweet zone, else the seconds left. */
function shakeLabel(): string {
  const own = on.isGuest() && on.guestShaking, pos = own ? on.guestPower() : shakePower();
  if (inZone(pos, G.shake?.zone)) return 'Thả ngay: vùng đẹp!';
  return `Thả ra để thảy! · còn ${Math.max(0, Math.ceil(tune.shake_max_time - (own ? on.guestShakeT() : G.shake?.t ?? 0)))} giây`;
}
/** The person shaking still holds the dice (a finger, the mouse, Space or Enter). */
export const holding = (): boolean => pointerHeld || down.has('Space') || down.has('Enter');

// ---- Words -------------------------------------------------------------------------------------
/** True when this screen places the current player's piece. */
function myTurn(): boolean {
  if (!G || G.phase === 'over') return false;
  const p = curP();
  if (on.isGuest()) return p.seat === on.mySeat && p.kind === 'remote';
  return p.kind === 'human';
}
function turnLine(): string {
  if (!G || !G.players.length) return '';
  const p = curP(), me = myTurn();
  switch (G.phase) {
    case 'roll': return me ? (G.players.every(q => q.kind === 'human') && !on.isGuest() ? `${p.name}: giữ nút để lắc chọn lượt` : 'Tung chọn lượt: giữ nút để lắc, cao nhất đi trước') : `${p.name} chuẩn bị tung chọn lượt...`;
    case 'shake': return me ? 'Thả ra để thảy!' : `${p.name} đang lắc...`;
    case 'dice': return 'Xúc xắc đang lăn...';
    case 'shown': return `${me ? 'Bạn' : p.name} tung được ${G.dice.reduce((a, b) => a + b, 0)}`;
    case 'turn': return me ? (G.players.every(q => q.kind === 'human') ? `${p.name}: bấm một ô trống để đặt quân` : 'Lượt bạn: bấm một ô trống để đặt quân') : `${p.name} đang nghĩ...`;
    case 'drop': return `${me ? 'Bạn' : p.name} đi ${cellName(G.last)}`;
    default: return '';
  }
}
const blockName = (): string => (tune.caro_block_two >= 1 ? 'Không tính thắng' : 'Vẫn thắng');
function kindName(s: CaroSeat, i: number): string {
  if (s.kind === 'human' && i === 0 && (on.isHost() || on.isGuest())) return `Chủ phòng · ${on.isHost() ? on.myName : on.lobby?.hostName || ''}`;
  if (s.kind === 'human') return 'Người chơi';
  if (s.kind === 'ai') return `Máy · ${LV_NAMES[s.lv ?? 1]}`;
  if (s.kind === 'remote') return s.peer === undefined && !s.name ? 'Chờ bạn online...' : `Online · ${s.name || 'Bạn'}`;
  return 'Không chơi';
}

// ---- Buttons and taps --------------------------------------------------------------------------
/** True when a tap on the board places a piece this step (no menu or dialog over it). */
let boardLive = false;
/** The keyboard's cursor on the board, and whether the keys (not the pointer) aim now. */
let cursor = -1, useCursor = false;
function press(b: Loose): void {
  sfx.click();
  if (on.isGuest() && b.act) { on.sendAct(b.act); return; }
  b.fn();
}
/** This screen places a piece: here (a person on this screen, or the host) or by asking the host (a friend). */
function placeHere(cell: number): void {
  if (cell < 0 || G.board[cell] !== EMPTY) return;
  if (on.isGuest()) on.sendAct('place', { cell }); else tryPlace(cell);
}
function handleTaps(): void {
  for (const c of clicks) {
    const b = F.ui.find(x => c.x >= x.x && c.x <= x.x + x.w && c.y >= x.y && c.y <= x.y + x.h);
    if (b && b.enabled) press(b);
    else if (!b && scene === 'caro' && boardLive && myTurn() && G.phase === 'turn' && !tips.covers(c.x, c.y, phone(), PX)) { useCursor = false; placeHere(cellAt(c.x, c.y)); } // a tap on the tip box is not a move
  }
  clicks.length = 0;
  if (F.picker && (pressed('Escape') || pressed('Enter'))) { F.picker = null; return; }
  if (scene === 'caro' && boardLive && myTurn() && G.phase === 'turn') { // the arrows move a cursor; Space or Enter places
    const k = N();
    if (cursor < 0) cursor = G.last >= 0 ? G.last : Math.floor(k / 2) * k + Math.floor(k / 2);
    const r = Math.floor(cursor / k), c = cursor % k;
    const mv = (dr: number, dc: number) => { cursor = Math.max(0, Math.min(k - 1, r + dr)) * k + Math.max(0, Math.min(k - 1, c + dc)); useCursor = true; };
    if (pressed('ArrowUp')) mv(-1, 0); else if (pressed('ArrowDown')) mv(1, 0); else if (pressed('ArrowLeft')) mv(0, -1); else if (pressed('ArrowRight')) mv(0, 1);
    if (useCursor && (pressed('Space') || pressed('Enter'))) { placeHere(cursor); return; }
  }
  if (pressed('Space') || pressed('Enter')) { const b = F.ui.find(x => x.role === 'primary' && x.enabled); if (b) press(b); }
  if (pressed('Escape') || pressed('KeyN')) { const b = F.ui.find(x => (x.role === 'secondary' || x.role === 'menuSecondary') && x.enabled); if (b) press(b); }
}

/** The rules page of Cờ Caro, numbers from data/config.json. */
function showCaroRules(): void {
  const R = rulesNow();
  openPage('Luật Cờ Caro', `
    <h3>Mục tiêu</h3><ul><li>Bàn <b>${R.size}×${R.size}</b> ô, hai người lần lượt đặt quân vào một ô trống. Ai có <b>${R.win} quân liền</b> ngang, dọc hoặc chéo trước thì <b>thắng</b>. Liền nhiều hơn ${R.win} cũng thắng.</li>
    <li>Hết chỗ đặt mà chưa ai thắng thì <b>hoà</b>.</li></ul>
    <h3>Chặn hai đầu</h3><ul><li>${R.blockTwo ? `Luật Việt Nam: ${R.win} quân liền mà <b>bị quân đối thủ chặn cả hai đầu</b> thì <b>không tính thắng</b>. Mép bàn không tính là chặn.` : `Ván này không xét chặn: cứ ${R.win} quân liền là thắng.`}</li></ul>
    <h3>Ai đi trước</h3><ul><li>Ván đầu hai bên <b>thảy xúc xắc</b>, ai lớn hơn đi trước (khi giữ, <b>thanh lực chạy lên xuống</b>; thả lúc thanh cao thì dễ ra số lớn, thấp thì dễ ra số nhỏ (mặt nào cũng vẫn có thể ra). Thả trúng <b>vùng vàng</b> trên thanh thì <b>may hơn một chút</b>. Có 10 giây để canh). Các ván sau <b>người thua đi trước</b> (hoà thì người đi sau ván trước đi trước).</li></ul>
    <h3>Máy</h3><ul><li><b>Dễ</b> hay đi lung tung · <b>Vừa</b> biết chặn khi bạn sắp có 4 · <b>Khó</b> chặn cả 3 quân mở.</li></ul>
    <h3>Phím</h3><ul><li>Mũi tên: chọn ô · Space / Enter: đặt quân · M: tắt tiếng</li></ul>`);
}

// ---- The setup screen --------------------------------------------------------------------------
function setupSpots() {
  return phone()
    ? { cx: 240, y0: 200, step: 64, rowH: 50, pieceX: 44, kindX: 200, kindW: 264, ruleY: 344, ruleH: 46, start: [16, 430, 448, 56], online: [16, 494, 448, 52], resume: [16, 556, 448, 48], rejoin: [16, 612, 448, 48], back: [12, 8, 92, 32], rules: [W - 104, 8, 92, 32], settings: [W - 202, 8, 92, 32], code: 584 }
    : { cx: 640, y0: 196, step: 60, rowH: 48, pieceX: 380, kindX: 650, kindW: 300, ruleY: 340, ruleH: 46, start: [370, 430, 260, 54], online: [650, 430, 260, 54], resume: [370, 494, 260, 40], rejoin: [650, 494, 260, 40], back: [326, 56, 100, 32], rules: [854, 56, 100, 32], settings: [746, 56, 100, 32], code: 520 };
}
function seatsShown(): CaroSeat[] { return on.isGuest() ? (on.lobby?.seats ?? []) : caroSetup.seats; }
function buildSetup(): void {
  F.ui = []; boardLive = false;
  const T = setupSpots();
  const b4 = (r: number[], label: string, fn: () => void, role: string, color: string) => btn(r[0], r[1], r[2], r[3], label, fn, role, true, color);
  b4(T.back, '‹ Sảnh', () => { if (on.isHost() || on.isGuest()) on.leaveRoom(); setScene('hub'); }, 'room', '');
  b4(T.rules, 'Luật', showCaroRules, 'room', '');
  b4(T.settings, 'Cài đặt', openSettings, 'room', '');
  seatsShown().forEach((s, i) => { // a tap on the piece changes its animal (your own seat, online)
    const y = T.y0 + i * T.step, mine = on.isGuest() ? i === on.mySeat : !(s.kind === 'remote' && on.peerOnline(s.peer));
    if (mine) btn(T.pieceX - 26, y - 2, 160, T.rowH + 4, '', () => { if (on.isGuest()) on.sendAct('animal'); else { nextAnimal(i); on.sendLobby(); } }, 'hidden');
  });
  if (on.isGuest()) { b4(T.online, 'Rời phòng', on.leaveRoom, 'secondary', '#6a4a2a'); return; }
  caroSetup.seats.forEach((s, i) => {
    const locked = on.isHost() && (i === 0 || (s.kind === 'remote' && on.peerOnline(s.peer)));
    const r = { x: T.kindX, y: T.y0 + i * T.step, w: T.kindW, h: T.rowH };
    btn(r.x, r.y, r.w, r.h, kindName(s, i) + (locked ? '' : ' ▾'), () => {
      const items: { label: string; value: string }[] = [{ label: 'Người chơi', value: 'human' }];
      if (on.isHost()) items.push({ label: 'Chờ bạn online', value: 'remote' });
      LV_NAMES.forEach((n, lv) => items.push({ label: `Máy · ${n}`, value: 'ai' + lv }));
      openPicker(r, items, s.kind === 'ai' ? 'ai' + (s.lv ?? 1) : s.kind, v => {
        const k = String(v);
        caroSetup.seats[i] = k.startsWith('ai') ? { kind: 'ai', lv: Number(k[2]), animal: s.animal } : { kind: k as CaroSeat['kind'], animal: s.animal };
        on.setNote(''); on.sendLobby();
      });
    }, 'seat', !locked);
  });
  const r = { x: T.kindX, y: T.ruleY, w: T.kindW, h: T.ruleH };
  btn(r.x, r.y, r.w, r.h, `${blockName()} ▾`, () => openPicker(r, [{ label: 'Không tính thắng', value: 1 }, { label: 'Vẫn thắng', value: 0 }], tune.caro_block_two >= 1 ? 1 : 0, v => { CONFIG.caro_block_two.value = Number(v); on.sendLobby(); }), 'seat');
  b4(T.start, phone() ? 'Bắt đầu' : 'Bắt đầu (Enter)', startCaro, 'primary', '#c8201f');
  if (on.isHost()) b4(T.online, `Giải tán phòng ${on.roomCode}`, on.leaveRoom, '', '#6a4a2a');
  else b4(T.online, 'Chơi online', () => showOnlinePanel(true, { create: on.createRoom, join: on.joinRoom }), '', '#2b6cd6');
  if (!on.isHost()) {
    const kept = localGame(), room = lastRoom();
    if (kept) b4(T.resume, 'Chơi tiếp ván trước', () => resumeLocal(kept), '', '#2f8a3a');
    if (room) b4(kept ? T.rejoin : T.resume, `Vào lại phòng ${room.code}`, on.rejoinRoom, '', '#2f8a3a');
  }
  buildPicker();
}
/** Puts the game left on this screen back, where it was. */
function resumeLocal(k: KeptGame): void {
  F.picker = null; on.setNote('');
  caroSetup.seats = k.seats.map(x => ({ ...x }));
  setG(k.g); resultsHidden = false; setScene('caro');
}
function startCaro(): void {
  F.picker = null;
  if (caroSetup.seats.some(s => s.kind === 'remote' && s.peer === undefined)) { on.setNote('Chỗ "Chờ bạn online" chưa có ai: đổi chỗ đó hoặc chờ bạn vào.'); return; }
  on.setNote(''); resultsHidden = false; cursor = -1;
  if (on.isHost()) on.hostNewGame(); else newGame(checkSeed(), [], animalName);
  setScene('caro');
}
/** A seed a check set (?seed=), so a check replays the same game. */
/** A check's seed for the next game: one set through window.game.configure (each game its own), else ?seed=. */
function checkSeed(): number | undefined {
  if (mainSeed !== null) return mainSeed;
  const s = new URLSearchParams(location.search).get('seed'); return s ? Number(s) : undefined;
}

function drawSetup(): void {
  clear('#bfe6f5');
  const T = setupSpots();
  drawBoard(); ctx.fillStyle = 'rgba(191,230,245,0.72)'; ctx.fillRect(0, 0, W, H);
  const extra = !on.isHost() && !on.isGuest() && (localGame() || lastRoom());
  const cardX = phone() ? 8 : 310, cardW = phone() ? W - 16 : 660, cardY = phone() ? 48 : 40;
  const cardH = phone() ? (extra ? 630 : on.roomCode ? 580 : 520) : extra ? 510 : on.roomCode ? 520 : 470;
  ctx.save(); ctx.fillStyle = 'rgba(255,249,234,0.97)'; rrect(ctx, cardX, cardY, cardW, cardH, 22); ctx.fill(); ctx.strokeStyle = '#e8a86a'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
  const R = rulesNow();
  text('CỜ CARO', T.cx, cardY + (phone() ? 50 : 62), phone() ? 34 : 44, '#d9622b', 'center', 'bold');
  text(`Bàn ${R.size}×${R.size} · ${R.win} quân liền là thắng · 2 người`, T.cx, cardY + (phone() ? 90 : 108), phone() ? 14 : 18, '#6a4a32');
  const hint = on.isGuest() ? (on.lobby ? `Phòng ${on.roomCode} · chờ ${on.lobby.hostName || 'chủ phòng'} bắt đầu ván · bấm con vật của bạn để đổi` : `Đang vào phòng ${on.roomCode}...`)
    : on.isHost() ? (on.roomCode ? `Gửi mã ${on.roomCode} cho bạn: họ vào bằng Cờ Caro › Chơi online` : 'Đang mở phòng, chờ chút nhé...') : 'Bấm con vật để đổi quân, bấm chỗ ngồi để chọn người hoặc máy';
  ctx.font = `15px ${FONT}`;
  wrapLines(ctx, hint, cardW - 40).slice(0, 2).forEach((l, j) => text(l, T.cx, cardY + (phone() ? 118 : 140) + j * 20, phone() ? 14 : 16, on.isGuest() || on.isHost() ? '#d9622b' : '#8a6a4a'));
  seatsShown().forEach((s, i) => {
    const y = T.y0 + i * T.step + T.rowH / 2;
    drawPiece(T.pieceX, y + 4, 46, i, s.animal, prefs.effects ? Math.abs(Math.sin(performance.now() / 400 + i)) * 4 : 0);
    text(animalName(s.animal), T.pieceX + 34, y - 6, phone() ? 18 : 20, '#4a3020', 'left', 'bold');
    text('bấm để đổi', T.pieceX + 34, y + 15, 12, '#a08060', 'left');
    if (on.isGuest()) {
      const me = i === on.mySeat;
      ctx.save(); ctx.fillStyle = me ? '#ffd99a' : '#fff6e2'; rrect(ctx, T.kindX, y - T.rowH / 2, T.kindW, T.rowH, 12); ctx.fill(); ctx.strokeStyle = me ? '#d9622b' : '#e8c9a0'; ctx.lineWidth = me ? 3 : 1.5; ctx.stroke(); ctx.restore();
      text(kindName(s, i) + (me ? ' (bạn)' : ''), T.kindX + T.kindW / 2, y, 17, '#4a3020', 'center', 'bold');
    }
  });
  const ry = T.ruleY + T.ruleH / 2;
  text('Chặn hai đầu', T.pieceX - 22, ry - 6, phone() ? 18 : 20, '#4a3020', 'left', 'bold');
  text(tune.caro_block_two >= 1 ? 'luật Việt Nam' : 'cứ 5 liền là thắng', T.pieceX - 22, ry + 15, 13, '#8a6a4a', 'left');
  if (on.isGuest()) text(blockName(), T.kindX + T.kindW / 2, ry, 17, '#4a3020', 'center', 'bold');
  if (on.roomCode) text(`MÃ PHÒNG  ${on.roomCode}`, T.cx, T.code, phone() ? 30 : 34, '#d9622b', 'center', 'bold');
  F.ui.forEach(drawButton);
  if (on.note) messageBox([on.note], T.cx, phone() ? H - 110 : 650, 600);
  else drawLink(T.cx);
  drawPicker();
}
function drawLink(cx: number): void {
  if ((on.isHost() || on.isGuest()) && !on.linkUp) messageBox(['Đang mở phòng, máy chủ đang thức dậy... (tới 30 giây)'], cx, phone() ? H - 110 : 650, 600);
  else if (on.isGuest() && !on.hostOnline) messageBox(['Chủ phòng mất kết nối, đang chờ quay lại...'], cx, phone() ? H - 110 : 650, 600);
}

// ---- The game ----------------------------------------------------------------------------------
Object.assign(on.roomUi, { btn, cx: (): number => (phone() ? W / 2 : PX / 2), phone });
/** The results card can be put away to look at the board. */
let resultsHidden = false;
/** The wide panel's "Diễn biến" line, its history button beside it. */
const LOG_Y = 524;
/** Where a player's card is (its top middle), for the bubbles over it. */
function cardSpot(i: number): { x: number; y: number } {
  if (!phone()) return { x: PX + PWD / 2, y: 76 + i * 70 };
  const cw = (W - 24) / 2;
  return { x: 8 + i * (cw + 8) + cw / 2, y: 540 };
}
/** True once a game is over and its row has had its moment on the board. */
const resultsShown = (): boolean => G.phase === 'over' && G.timer >= tune.caro_result_delay;
function buildPlay(): void {
  F.ui = []; boardLive = false;
  const ph = phone(), inRoom = on.isHost() || on.isGuest();
  btn(ph ? 8 : PX + 14, ph ? 8 : 14, ph ? 82 : 92, 32, '‹ Sảnh', () => { F.roomMenu = true; }, 'room', true, '');
  btn(ph ? 96 : PX + 114, ph ? 8 : 14, ph ? 62 : 64, 32, 'Luật', showCaroRules, 'room', true, '');
  btn(W - 52, ph ? 6 : 12, 40, 34, '', openSettings, 'mute');
  const speedOn = !on.isGuest() && G.players.some(p => p.kind !== 'human');
  if (ph) {
    const r = phoneRow();
    btn(r.left, r.y, r.w, r.h, 'Lịch sử', on.openHistory, '', true, '#6a4a2a');
    if (speedOn) btn(r.right, r.y, r.w, r.h, `Tốc độ ×${speedNow()}`, cycleSpeed, '', true, '#6a4a2a');
  } else {
    if (speedOn) { const r = wideSpeedSpot(); btn(r.x, r.y, r.w, r.h, `×${speedNow()}`, cycleSpeed, 'room', true, ''); }
    btn(W - 118, LOG_Y - 14, 88, 28, 'Lịch sử', on.openHistory, 'room', true, '');
  }
  if (inRoom) {
    if (ph) { const r = phoneRow(); btn(W / 2 - 52, r.y, 104, r.h, 'Biểu cảm', on.extras.toggleEmotes, '', true, '#8a5a2a'); }
    else btn(W - 214, LOG_Y - 14, 88, 28, 'Biểu cảm', on.extras.toggleEmotes, 'room', true, '');
  }
  if (B.live) { // the view: zoom, turn, back (a phone pinches to zoom: turn and back sit in its row's gaps)
    const r = phoneRow();
    buildViewButtons(btn, B.orbit, ph ? [null, null, { x: 124, y: r.y, w: 56, h: r.h }, { x: 300, y: r.y, w: 56, h: r.h }] : viewRow(14, 676), ph ? '' : 'room', ph ? '#6a4a2a' : '');
  }
  if (G.vote) { on.extras.buildOverlay(); return; }
  if (F.roomMenu) {
    const y = ph ? H / 2 : 400;
    const go = on.isHost() ? 'Giải tán & về sảnh' : on.isGuest() ? 'Rời phòng' : 'Về sảnh';
    btn(W / 2 - 210, y, 200, 54, go, () => { F.roomMenu = false; if (on.isHost() || on.isGuest()) on.leaveRoom(); setScene('hub'); }, 'menu', true, '#c8201f');
    btn(W / 2 + 10, y, 200, 54, 'Ở lại', () => { F.roomMenu = false; }, 'menuSecondary', true, '#6a4a2a');
    if (inRoom) btn(W / 2 - 210, y + 66, 420, 50, 'Bỏ phiếu chơi lại ván mới', on.extras.startVote, 'menu', true, '#2b6cd6');
    return;
  }
  if (on.extras.buildOverlay()) return;
  if (G.phase !== 'over') resultsHidden = false; // a new game (the vote, online): its results show again
  if (G.phase !== 'over') tips.build(myTurn() && G.phase === 'roll' ? 'order' : myTurn() && G.phase === 'turn' ? (G.moves < 2 ? 'turn' : rulesNow().blockTwo && G.moves >= 6 ? 'block' : null) : null, ph, PX, btn);
  if (G.phase === 'over') {
    if (!resultsShown()) return;
    const box = resultsBox(G.players.length, ph, PX / 2), cy = box.by, mid = box.cx;
    if (resultsHidden) { btn(mid - 110, ph ? 470 : 640, 220, 50, 'Xem kết quả', () => { resultsHidden = false; }, 'primary', true, '#c8201f'); return; }
    btn(box.x + box.w - 132, box.y + 12, 120, 30, 'Xem bàn cờ', () => { resultsHidden = true; }, 'room', true, '');
    if (on.isGuest()) {
      btn(mid - 230, cy, 220, 54, 'Chơi lại', on.extras.startVote, 'primary', true, '#c8201f');
      btn(mid + 10, cy, 220, 54, 'Rời phòng', () => { on.leaveRoom(); setScene('hub'); }, 'secondary', true, '#6a4a2a');
    } else {
      btn(mid - 230, cy, 220, 54, 'Chơi lại (Enter)', () => { if (on.isHost()) on.extras.startVote(); else { playAgain(); cursor = -1; } }, 'primary', true, '#c8201f');
      btn(mid + 10, cy, 220, 54, CHANGE_PLAYERS, () => { setScene('caroSetup'); on.sendLobby(); }, 'secondary', true, '#6a4a2a');
    }
    return;
  }
  if (G.order && myTurn() && (G.phase === 'roll' || G.phase === 'shake')) { // the throw for the order, as the other games' shake button
    const c = controls(), diceW = orderDice() > 1 ? 136 : 92;
    btn(c.bx, c.by, c.bw - diceW, 62, G.phase === 'shake' ? shakeLabel() : 'Giữ để lắc chọn lượt', () => startShake(), 'primary', G.phase === 'roll', '#c8201f', 'shake');
  }
  boardLive = true;
}
const ready = (): boolean => !!G && !!G.players && G.players.length > 0;
function drawPlay(): void {
  clear('#bfe6f5');
  drawWater();
  drawBoard();
  drawWinLine();
  drawMarks();
  drawPieces();
  if (phone()) drawPhonePanel(); else drawWidePanel();
  drawOrderDice();
  if (resultsShown() && !resultsHidden) drawResults();
  F.ui.forEach(b => { if (b.role !== 'menu' && b.role !== 'menuSecondary') drawButton(b); });
  tips.draw(phone(), PX, F.ui);
  on.extras.drawBubbles(i => (G.players[i] ? cardSpot(i) : null), i => SEATS[G.players[i]?.seat ?? 0].dark);
  on.extras.drawOverlay(F.ui);
  if (F.roomMenu && !G.vote) {
    ctx.save(); ctx.fillStyle = 'rgba(70,110,130,0.35)'; ctx.fillRect(0, 0, W, H); ctx.restore();
    messageBox([on.isHost() ? 'Giải tán phòng? Mọi người sẽ ra khỏi ván.' : on.isGuest() ? 'Rời phòng? Máy sẽ chơi thay bạn.' : LEAVE_LOCAL], W / 2, (phone() ? H / 2 : 400) - 60, 460);
    F.drawingMenu = true; F.ui.forEach(b => { if (b.role === 'menu' || b.role === 'menuSecondary') drawButton(b); }); F.drawingMenu = false;
  }
  drawLink(phone() ? W / 2 : PX + PWD / 2);
}
function drawWater(): void {
  if (!prefs.effects) return;
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2;
  for (let k = 0; k < 7; k++) {
    const x = (k * 197 + G.t * 12) % W, y = 30 + ((k * 131) % Math.max(60, H - 60));
    ctx.beginPath(); ctx.arc(x, y, 10 + (k % 3) * 4, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
  }
  ctx.restore();
}
function playerCard(i: number, x: number, y: number, w: number, h: number): void {
  const p = G.players[i], cur = i === G.cur && G.phase !== 'over', S = SEATS[p.seat];
  const me = on.isGuest() && p.seat === on.mySeat;
  ctx.save();
  ctx.fillStyle = cur ? '#ffe9b8' : '#fff6e2'; rrect(ctx, x, y, w, h, 12); ctx.fill();
  ctx.strokeStyle = cur ? S.dark : '#e8c9a0'; ctx.lineWidth = cur ? 3 : 1.5; ctx.stroke(); ctx.restore();
  drawPiece(x + h / 2, y + h / 2 + 2, h * 0.7, p.seat, p.animal, cur && prefs.effects ? Math.abs(Math.sin(G.t * 4)) * 3 : 0);
  const off = p.kind === 'remote' && on.isHost() && !on.peerOnline(p.peer);
  ctx.font = `bold ${Math.min(18, h * 0.32)}px ${FONT}`;
  text(wrapLines(ctx, p.name + (me ? ' (bạn)' : '') + (off ? ' (máy thay)' : ''), w - h - 10)[0], x + h + 2, y + h * 0.32, Math.min(18, h * 0.32), '#4a3020', 'left', 'bold');
  text(`${p.moves} nước · thắng ${p.wins}`, x + h + 2, y + h * 0.7, phone() ? 13 : 15, '#6a4a32', 'left', 'bold');
  if (G.order) drawOrderMark(G.order, i, i === G.cur, x, y, w, h); // the throws for the order of play
  else if (!phone() && p.kind === 'ai') text(`Máy · ${LV_NAMES[p.lv]}`, x + w - 14, y + h * 0.7, 14, '#8a6a4a', 'right');
}
/** "Tổng kết ván": how it ended, how long it took, the score in this sitting. */
function summaryLines(): string[] {
  const [a, b] = G.players, win = G.players[G.winner];
  return [
    G.draw ? `Hoà sau ${G.moves} nước: hết chỗ đặt quân.` : `${win.name} thắng sau ${win.moves} nước (${G.line?.length ?? 0} quân liền).`,
    `Tỷ số sau ${G.round} ván: ${a.name} ${a.wins} – ${b.wins} ${b.name}`,
    `Ván sau: ${G.draw ? 'người đi sau ván này' : G.players[1 - G.winner].name} đi trước.`,
  ];
}
function drawWidePanel(): void {
  lacquer(PX, 0, PWD, H);
  text('CỜ CARO', PX + PWD / 2 + 70, 31, 24, '#d9622b', 'center', 'bold');
  if (on.roomCode) text(`Phòng ${on.roomCode}`, W - 70, 62, 16, '#d9622b', 'right', 'bold');
  G.players.forEach((_, i) => playerCard(i, PX + 24, 76 + i * 70, PWD - 48, 60));
  const R = rulesNow();
  text(`Ván ${G.round} · bàn ${G.size}×${G.size} · ${R.win} liền thắng · chặn hai đầu: ${R.blockTwo ? 'không tính' : 'vẫn thắng'}`, PX + PWD / 2, 232, 14, '#8a6a4a', 'center');
  const line = turnLine();
  if (G.phase === 'over') drawSummary(PX + 24, 280, PWD - 48, summaryLines());
  else if (line) {
    const p = curP();
    if (G.phase === 'turn' || G.phase === 'drop') drawPiece(PX + PWD / 2, 300, 50, p.seat, p.animal, prefs.effects ? Math.abs(Math.sin(G.t * 4)) * 4 : 0);
    ctx.font = `bold 20px ${FONT}`; wrapLines(ctx, line, PWD - 60).slice(0, 2).forEach((l, j) => text(l, PX + PWD / 2, 362 + j * 24, 20, '#4a3020', 'center', 'bold'));
    if (myTurn() && G.phase === 'turn') text('Mũi tên chọn ô · Enter đặt quân', PX + PWD / 2, 420, 14, '#8a6a4a', 'center');
  }
  text('Diễn biến', PX + 30, LOG_Y, 17, '#b0501f', 'left', 'bold');
  G.log.slice(0, 6).forEach((l, j) => { ctx.font = `15px ${FONT}`; text(wrapLines(ctx, l, PWD - 60)[0], PX + 30, 552 + j * 25, 15, j ? '#8a6a4a' : '#4a3020', 'left'); });
}
function drawPhonePanel(): void {
  lacquer(0, 0, W, 46);
  text('CỜ CARO', W / 2 + 40, 24, 20, '#d9622b', 'center', 'bold');
  if (on.roomCode) text(on.roomCode, W - 62, 24, 15, '#d9622b', 'right', 'bold');
  const y0 = 540, cw = (W - 24) / 2;
  lacquer(0, y0 - 12, W, H - y0 + 12);
  G.players.forEach((_, i) => playerCard(i, 8 + i * (cw + 8), y0, cw, 56));
  if (G.phase === 'over') { if (!resultsShown() || resultsHidden) drawSummary(12, 612, W - 24, summaryLines()); return; } // the results card covers this strip
  const line = turnLine(), ly = 628;
  if (line) { ctx.font = `bold 18px ${FONT}`; wrapLines(ctx, line, W - 30).slice(0, 2).forEach((l, j) => text(l, W / 2, ly + j * 24, 18, '#4a3020', 'center', 'bold')); }
  const logY = 690;
  G.log.slice(0, G.order ? 3 : 6).forEach((l, j) => { ctx.font = `14px ${FONT}`; text(wrapLines(ctx, l, W - 30)[0], 16, logY + j * 22, 14, j ? '#8a6a4a' : '#4a3020', 'left'); });
}
function drawResults(): void {
  const ph = phone(), order = rank(G.players, G.winner), win = order[0], { x, y, w, h, cx } = resultsBox(order.length, ph, PX / 2);
  ctx.save(); ctx.fillStyle = 'rgba(70,110,130,0.3)'; ctx.fillRect(0, 0, ph ? W : PX, H);
  ctx.fillStyle = 'rgba(255,249,234,0.97)'; rrect(ctx, x, y, w, h, 22); ctx.fill(); ctx.strokeStyle = '#e8a86a'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
  if (prefs.effects && !G.draw) {
    ctx.save(); rrect(ctx, x, y, w, h, 22); ctx.clip();
    for (let k = 0; k < 36; k++) {
      const fx = x + ((k * 97) % w), fy = y + ((k * 53 + G.timer * (40 + (k % 5) * 12)) % h);
      ctx.fillStyle = ['#ff9ec4', '#ffd84a', '#8fd16a', '#8cc4f5', '#ffb59a'][k % 5];
      ctx.beginPath(); ctx.ellipse(fx, fy, 5, 3, G.timer * 2 + k, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
  text(G.draw ? 'Hết chỗ đặt quân' : `${G.line?.length ?? 5} quân liền!`, cx, y + 26, 15, '#8a6a4a', 'center');
  if (G.draw) {
    G.players.forEach((p, j) => drawPiece(cx + (j ? 70 : -70), y + 90, 64, p.seat, p.animal));
    text('Hoà!', cx, y + 160, ph ? 28 : 32, '#d9622b', 'center', 'bold');
  } else {
    drawPiece(cx + 120, y + 96, 44, order[1].seat, order[1].animal, 0, 0, 'sad');
    drawPiece(cx, y + 86, 72, win.seat, win.animal, prefs.effects ? Math.abs(Math.sin(G.timer * 5)) * 14 : 0, 1);
    text(`${win.name} thắng!`, cx, y + 160, ph ? 28 : 32, '#d9622b', 'center', 'bold');
  }
  order.forEach((p, j) => {
    const ry = y + 206 + j * 52;
    ctx.save(); ctx.fillStyle = j === 0 && !G.draw ? '#ffd99a' : '#fff6e2'; rrect(ctx, x + 20, ry - 22, w - 40, 44, 10); ctx.fill(); ctx.restore();
    text(G.draw ? '=' : `${j + 1}.`, x + 42, ry, 19, '#d9622b', 'center', 'bold');
    drawPiece(x + 76, ry + 2, 32, p.seat, p.animal);
    text(p.name, x + 100, ry, ph ? 16 : 18, '#4a3020', 'left', 'bold');
    text(`${p.moves} nước · thắng ${p.wins}/${G.round} ván`, x + w - 34, ry, ph ? 13 : 15, '#6a4a32', 'right');
  });
}

// ---- Fast forward: the computer's turns at the chosen speed (src/core/speed.ts) ----------------
function turnSpeed(): number {
  if (!G?.players || G.phase === 'over') return 1;
  return autoPlays(curP(), on.peerOnline) ? speedNow() : 1;
}

/** The two screens of Cờ Caro, for main.ts's scene table. */
export const caroScenes: Record<string, { update(dt: number): void; draw(): void }> = {
  caroSetup: {
    update() { syncView(); buildSetup(); handleTaps(); },
    draw() { syncView(); drawSetup(); },
  },
  caro: {
    update(dt: number) {
      if (!ready()) { if (on.isGuest()) return; setScene('caroSetup'); return; }
      syncView(); B.orbit.step(dt);
      buildPlay(); handleTaps();
      if (scene !== 'caro') return;
      if (B.live && !F.roomMenu && !G.vote && !F.emoteMenu && !F.picker) { useView({ orbit: B.orbit, cam: () => B.cam, rect: viewRect() }); viewKeys(B.orbit, pressed); } // the player turns and zooms their own view
      on.extras.step(dt);
      if (on.isGuest()) { G.t += dt; G.timer += dt; if (G.drop) G.drop.t = Math.min(G.drop.t + dt, tune.caro_place_time); if (G.throwAt) G.throwAt.t += dt; if (G.shake) G.shake.t += dt; if (G.show) G.show.t += dt; for (const f of G.floaters) f.t += dt; return; }
      gameStep(dt * turnSpeed(), holding(), on.peerOnline);
    },
    draw() {
      if (!ready()) { clear('#bfe6f5'); text('Đang tải ván...', W / 2, H / 2, 22, '#4a3020', 'center', 'bold'); return; }
      syncView(); drawPlay();
    },
  },
};
/** Runs the Cờ Caro room's messages each step (main.ts calls it after the scene). */
export function caroNet(): void { on.caroNetStep(holding()); }
/** For checks: a cell's centre on the screen, in the layout's own coordinates (to tap it). */
export function caroSpot(cell: number): { x: number; y: number } { const s = cellSpot(cell); return { x: s.x, y: s.y }; }
/** For checks: the board, whose turn it is, how the game ended, read-only. */
export function caroView(): Loose {
  return G ? { phase: G.phase, cur: G.cur, size: G.size, board: [...G.board], last: G.last, moves: G.moves, winner: G.winner, draw: G.draw, line: G.line, round: G.round, wins: G.players.map(p => p.wins), auto: G.players.map(p => autoPlays(p, on.peerOnline)), names: G.players.map(p => p.name), bubbles: (G.emotes || []).map(e => e.text ?? e.i), vote: G.vote ? G.vote.list.map(e => e.ans) : null, tip: tips.now, ordering: !!G.order, dice: G.dice, results: resultsShown() && !resultsHidden, online: { role: on.isHost() ? 'host' : on.isGuest() ? 'guest' : 'off', code: on.roomCode, mySeat: on.mySeat, lobby: on.lobby?.seats ?? null } } : { online: { role: on.isHost() ? 'host' : on.isGuest() ? 'guest' : 'off', code: on.roomCode, mySeat: on.mySeat, lobby: on.lobby?.seats ?? null } };
}
