// Rắn và Thang's screens: the setup screen (who plays, with which animal) and the game (the 100-cell
// board, bamboo ladders and chibi snakes, the die beside the shake button, the players' panel), with
// the end of the game drawn over it. The turns are in ./game.ts, online play in ./online.ts, the rules
// in ./rules.ts.

import { inZone } from '../game/dice';
import { tune, CONFIG } from '../config';
import { sfx } from '../audio';
import { W, H, FONT, ctx, text, rrect, clear, screenScale, wrapLines } from '../screen';
import { setScene, scene } from '../core/store';
import { F } from '../core/flags';
import { prefs } from '../core/prefs';
import type { Loose } from '../game/types';
import { ANIMALS } from '../game/data';
import { btn, clicks, pressed, down, pointerHeld, L, checkSeed as mainSeed } from '../main';
import { drawButton, drawTokenIcon, lacquer, messageBox } from '../ui/draw';
import { openPicker, buildPicker, drawPicker } from '../ui/setupScreen';
import { openPage } from '../ui/pages';
import { openSettings } from '../ui/settings';
import { LEAVE_LOCAL, CHANGE_PLAYERS } from '../ui/words';
import { wideSpeedSpot, phoneRow, resultsBox, mostOf, drawSummary, drawOrderMark, drawGauge, GAUGE_R } from '../ui/gameChrome';
import { makeTips } from '../ui/gameTips';
import { board3d, type BoardSpot } from '../three/board3d';
import { buildViewButtons, viewKeys, viewRow } from '../ui/viewButtons';
import { useView } from '../ui/viewGestures';

/** First-game tips, as Cờ Tỷ Phú's: the first throw, and waiting to come on when that rule is on. */
const tips = makeTips('snake:', {
  roll: 'Giữ nút đỏ: thanh lực chạy lên xuống. Thả lúc cao dễ ra số lớn; trúng vùng vàng thì may hơn. Leo thang, né đầu rắn!',
  enter: 'Ván này phải đổ đúng số mới được vào bàn: một viên cần số 6, hai viên cần đổ đôi.',
});
import { speedNow, cycleSpeed } from '../core/speed';
import { showOnlinePanel } from '../net/room';
import { G, setG, restoreKept, diceText, SEATS, snakeSetup, newGame, startShake, curP, step as gameStep, shakePower, rulesNow, autoPlays } from './game';
import { gridOf, LINKS, LAST, rank, type Link, type SnakeSeat } from './rules';
import * as on from './online';
import { localGame, lastRoom, type KeptGame } from './keep';

const animalName = (a: number): string => ANIMALS[a]?.name ?? 'Quân';
/** Gives seat i the next animal no other seat has. */
function nextAnimal(i: number): void {
  const used = new Set(snakeSetup.seats.filter((s, k) => k !== i && s.kind !== 'off').map(s => s.animal));
  let a = snakeSetup.seats[i].animal;
  for (let k = 0; k < 12; k++) { a = (a + 1) % 12; if (!used.has(a)) break; }
  snakeSetup.seats[i].animal = a;
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
const cellSize = (): number => boardRect().s / 10;
/** The flat board's margin around the grid (its frame and the snakes' heads), a share of its side. */
const PAD = 0.03;
/** The board in 3D (src/three/board3d.ts): the flat picture with its margin as the face of a board,
 * seen from the player's own view (turned, tilted, zoomed). */
const B = board3d('snake', '#5f9e45');
/** Where the board is on the screen: the 3D picture fills the board's side; the usual view fits the grid and its margin. */
const viewRect = () => (phone() ? { x: 0, y: 46, w: W, h: 482 } : { x: 0, y: 0, w: PX, h: H });
function syncView(): void { const b = boardRect(), p = b.s * PAD; B.frame(viewRect(), { x: b.x - p, y: b.y - p, s: b.s + p * 2 }, phone()); }
/** A point of the grid (rows and columns, as fractions) on the screen, and how big things are there (k:
 * 1 is the flat board's size; the far side smaller). */
function at(r: number, c: number): BoardSpot { const n = 1 + PAD * 2; return B.project((PAD + c / 10) / n, (PAD + r / 10) / n); }
/** The centre of cell n, as grid fractions. */
function centre(n: number): { r: number; c: number } { const g = gridOf(Math.max(1, n)); return { r: g.r + 0.5, c: g.c + 0.5 }; }

// ---- Ladders and snakes: their shape, as grid fractions ---------------------------------------
/** A point along a ladder or snake, u from 0 (its start: a ladder's foot, a snake's head) to 1. */
function linkPoint(l: Link, u: number): { r: number; c: number } {
  const a = centre(l.from), b = centre(l.to);
  if (l.kind === 'ladder') return { r: a.r + (b.r - a.r) * u, c: a.c + (b.c - a.c) * u };
  // a snake wriggles: a sine wave across the straight line from head to tail, gentler near both ends
  const dr = b.r - a.r, dc = b.c - a.c, len = Math.hypot(dr, dc) || 1, nr = -dc / len, nc = dr / len;
  const waves = Math.max(1, Math.round(len / 2.2)), amp = Math.min(0.75, 0.25 + len * 0.06);
  const w = Math.sin(u * Math.PI * 2 * waves) * amp * Math.sin(u * Math.PI);
  return { r: a.r + dr * u + nr * w, c: a.c + dc * u + nc * w };
}
/** The snakes' skins, each a body colour and its spots. */
const SKINS = [['#7cc95a', '#4f9a35'], ['#ff8a5c', '#d9542b'], ['#b58cf0', '#7a4fc9'], ['#5aa2ec', '#2b6cd6'], ['#ffc93c', '#c98f0a'], ['#ff7fae', '#d94f86']];

// ---- The board, drawn once into its own canvas ---------------------------------------------------
let boardCache: HTMLCanvasElement | null = null, cacheKey = '';
const ROWS = ['#ffe9c7', '#fbe0ea', '#dff2d6', '#dcecfb', '#f1e2fb'];
function drawBoardInto(c: CanvasRenderingContext2D, s: number): void {
  const cs = s / 10, P = (r: number, col: number) => ({ x: col * cs, y: r * cs });
  c.fillStyle = '#8fcf68'; rrect(c, -cs * 0.25, -cs * 0.25, s + cs * 0.5, s + cs * 0.5, cs * 0.6); c.fill();
  for (let n = 1; n <= LAST; n++) { // the cells: a pastel band every two rows, light and dark by turns
    const g = gridOf(n), o = P(g.r, g.c), band = ROWS[Math.floor((n - 1) / 20) % ROWS.length];
    c.fillStyle = (g.r + g.c) % 2 ? band : '#fff8ea'; rrect(c, o.x + cs * 0.04, o.y + cs * 0.04, cs * 0.92, cs * 0.92, cs * 0.16); c.fill();
    c.fillStyle = '#b08a64'; c.font = `bold ${Math.round(cs * 0.26)}px ${FONT}`; c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText(String(n), o.x + cs * 0.12, o.y + cs * 0.1);
  }
  { // the start and the finish
    const a = P(gridOf(1).r, gridOf(1).c); c.fillStyle = 'rgba(124,201,90,0.55)'; rrect(c, a.x + cs * 0.04, a.y + cs * 0.04, cs * 0.92, cs * 0.92, cs * 0.16); c.fill();
    c.fillStyle = '#2f7a2a'; c.font = `bold ${Math.round(cs * 0.2)}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('XUẤT PHÁT', a.x + cs / 2, a.y + cs * 0.82);
    const z = P(gridOf(LAST).r, gridOf(LAST).c); c.fillStyle = '#ffd84a'; rrect(c, z.x + cs * 0.04, z.y + cs * 0.04, cs * 0.92, cs * 0.92, cs * 0.16); c.fill();
    c.strokeStyle = '#d9a12b'; c.lineWidth = cs * 0.05; c.stroke();
    c.fillStyle = '#b0501f'; c.font = `bold ${Math.round(cs * 0.26)}px ${FONT}`; c.fillText('100', z.x + cs / 2, z.y + cs * 0.25);
    c.fillStyle = '#d9442b'; c.beginPath(); c.moveTo(z.x + cs * 0.42, z.y + cs * 0.4); c.lineTo(z.x + cs * 0.75, z.y + cs * 0.52); c.lineTo(z.x + cs * 0.42, z.y + cs * 0.64); c.fill(); // a little flag
    c.strokeStyle = '#7a4a2a'; c.lineWidth = cs * 0.05; c.beginPath(); c.moveTo(z.x + cs * 0.42, z.y + cs * 0.38); c.lineTo(z.x + cs * 0.42, z.y + cs * 0.88); c.stroke();
  }
  const G2 = (p: { r: number; c: number }) => P(p.r, p.c);
  for (const l of LINKS.filter(x => x.kind === 'ladder')) { // bamboo ladders
    const a = G2(centre(l.from)), b = G2(centre(l.to)), len = Math.hypot(b.x - a.x, b.y - a.y), nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len, half = cs * 0.2;
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(60,40,20,0.22)'; c.lineWidth = cs * 0.13;
    for (const k of [-1, 1]) { c.beginPath(); c.moveTo(a.x + nx * half * k + 3, a.y + ny * half * k + 5); c.lineTo(b.x + nx * half * k + 3, b.y + ny * half * k + 5); c.stroke(); }
    const rungs = Math.max(2, Math.round(len / (cs * 0.42)));
    c.strokeStyle = '#c98f3a'; c.lineWidth = cs * 0.08;
    for (let k = 1; k < rungs; k++) { const u = k / rungs, x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u; c.beginPath(); c.moveTo(x - nx * half, y - ny * half); c.lineTo(x + nx * half, y + ny * half); c.stroke(); }
    for (const k of [-1, 1]) {
      c.strokeStyle = '#9a6a26'; c.lineWidth = cs * 0.12; c.beginPath(); c.moveTo(a.x + nx * half * k, a.y + ny * half * k); c.lineTo(b.x + nx * half * k, b.y + ny * half * k); c.stroke();
      c.strokeStyle = '#e8c070'; c.lineWidth = cs * 0.06; c.beginPath(); c.moveTo(a.x + nx * half * k, a.y + ny * half * k); c.lineTo(b.x + nx * half * k, b.y + ny * half * k); c.stroke();
      for (let j = 1; j < 4; j++) { const u = j / 4, x = a.x + (b.x - a.x) * u + nx * half * k, y = a.y + (b.y - a.y) * u + ny * half * k; c.fillStyle = '#9a6a26'; c.beginPath(); c.arc(x, y, cs * 0.07, 0, 7); c.fill(); } // the bamboo's knots
    }
  }
  LINKS.filter(x => x.kind === 'snake').forEach((l, k) => { // chibi snakes: a fat wriggling body, spots, a round smiling head
    const [skin, spot] = SKINS[k % SKINS.length], N = 48;
    const pts = Array.from({ length: N + 1 }, (_, j) => G2(linkPoint(l, j / N)));
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const [col, extra, dy] of [['rgba(40,60,30,0.22)', 0, 5], [spot, cs * 0.05, 0], [skin, 0, 0]] as [string, number, number][]) {
      for (let j = 0; j < N; j++) {
        const u = j / N, wdt = cs * (0.3 - 0.22 * u) + extra; // fat at the head, thin to the tail
        c.strokeStyle = col; c.lineWidth = wdt; c.beginPath(); c.moveTo(pts[j].x, pts[j].y + dy); c.lineTo(pts[j + 1].x, pts[j + 1].y + dy); c.stroke();
      }
    }
    for (let j = 6; j < N - 4; j += 5) { c.fillStyle = spot; c.beginPath(); c.arc(pts[j].x, pts[j].y, cs * (0.07 - 0.04 * j / N), 0, 7); c.fill(); }
    const h = pts[0], nx = pts[2].x - h.x, ny = pts[2].y - h.y, ang = Math.atan2(ny, nx) + Math.PI; // the head faces away from the body
    c.save(); c.translate(h.x, h.y); c.rotate(ang);
    c.strokeStyle = '#d9442b'; c.lineWidth = cs * 0.035; c.beginPath(); c.moveTo(cs * 0.2, 0); c.lineTo(cs * 0.34, 0); c.lineTo(cs * 0.4, -cs * 0.05); c.moveTo(cs * 0.34, 0); c.lineTo(cs * 0.4, cs * 0.05); c.stroke();
    c.fillStyle = spot; c.beginPath(); c.ellipse(0, 0, cs * 0.25, cs * 0.21, 0, 0, 7); c.fill();
    c.fillStyle = skin; c.beginPath(); c.ellipse(0, -cs * 0.01, cs * 0.23, cs * 0.19, 0, 0, 7); c.fill();
    for (const s2 of [-1, 1]) {
      c.fillStyle = '#fff'; c.beginPath(); c.arc(cs * 0.05, s2 * cs * 0.09, cs * 0.065, 0, 7); c.fill();
      c.fillStyle = '#3a2618'; c.beginPath(); c.arc(cs * 0.07, s2 * cs * 0.09, cs * 0.035, 0, 7); c.fill();
      c.fillStyle = 'rgba(255,140,170,0.6)'; c.beginPath(); c.arc(-cs * 0.06, s2 * cs * 0.14, cs * 0.04, 0, 7); c.fill(); // blush
    }
    c.restore();
  });
}
/** Copies the board, drawn once at the screen's pixel size. */
function drawBoard(): void {
  const b = boardRect(), px = Math.min(2048, Math.round(b.s * screenScale * (B.live ? 2 : 1))), key = `${px}`;
  if (!boardCache || key !== cacheKey) {
    const pad = Math.round(px * PAD);
    boardCache = document.createElement('canvas'); boardCache.width = boardCache.height = px + pad * 2;
    const c = boardCache.getContext('2d')!; c.translate(pad, pad); c.scale(px / b.s, px / b.s);
    drawBoardInto(c, b.s); cacheKey = key;
  }
  B.drawBoard(ctx, boardCache); // the flat board with its margin, as the face of the 3D board
}

// ---- Pieces ------------------------------------------------------------------------------------
/** One piece: a round base in the seat's colour, the player's animal on it. */
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
/** A piece standing on the board: its shadow and (whose turn) a glowing ring drawn on the board now, Cờ Tỷ
 * Phú's 3D figure of the player's animal queued (B.flush draws the figures over the board's marks). */
function drawBoardPiece(at: BoardSpot, size: number, seat: number, animal: number, lift: number, glow: number, mood?: 'happy' | 'sad'): void {
  const x = at.x, y = at.y;
  ctx.save();
  ctx.fillStyle = 'rgba(40,60,30,0.3)'; ctx.beginPath(); ctx.ellipse(x, y, size * 0.4 * (1 - Math.min(0.5, lift / size)), size * 0.17, 0, 0, 7); ctx.fill();
  if (glow) { ctx.strokeStyle = `rgba(255,236,120,${0.5 + 0.5 * glow})`; ctx.lineWidth = size * 0.1; ctx.beginPath(); ctx.ellipse(x, y, size * 0.52, size * 0.24, 0, 0, 7); ctx.stroke(); }
  ctx.restore();
  B.piece(at, size, lift, SEATS[seat].color, SEATS[seat].dark, animal, mood); // as big on its cell as Cờ Tỷ Phú's pieces on their tiles
}
/** Where a player's piece is drawn now (grid fractions and lift): hopping, on a ladder or snake, or standing. */
function piecePos(pi: number): { r: number; c: number; lift: number } {
  const p = G.players[pi], cs = 1;
  if (G.hop && G.hop.pi === pi && G.hop.path.length) {
    const a = standSpot(pi, p.pos), b = centre(G.hop.path[0]), u = Math.min(1, G.hop.t / tune.snake_hop_time);
    return { r: a.r + (b.r - a.r) * u, c: a.c + (b.c - a.c) * u, lift: Math.sin(u * Math.PI) * 0.5 * cs };
  }
  if (G.slide && G.slide.pi === pi) {
    const u = Math.min(1, G.slide.t / tune.snake_slide_time), e = G.slide.link.kind === 'ladder' ? u * u * (3 - 2 * u) : u; // a climb eases in and out
    const q = linkPoint(G.slide.link, e);
    return { ...q, lift: G.slide.link.kind === 'ladder' ? 0.12 : 0.05 };
  }
  return { ...standSpot(pi, p.pos), lift: 0 };
}
/** Where a standing piece sits on its cell: in the middle alone, side by side when it shares it;
 * a piece still beside the board waits in a corner of the start cell. */
function standSpot(pi: number, pos: number): { r: number; c: number } {
  const g = centre(pos), p = G.players[pi];
  if (pos === 0) return { r: g.r - 0.24 + (p.seat >> 1) * 0.3, c: g.c - 0.2 + (p.seat & 1) * 0.4 };
  const here = G.players.filter(q => q.pos === pos && !(G.hop?.pi === q.id) && !(G.slide?.pi === q.id));
  if (here.length < 2) return g;
  const k = here.findIndex(q => q.id === pi), off = [[-0.2, -0.2], [0.2, 0.2], [0.2, -0.2], [-0.2, 0.2]][Math.max(0, k)];
  return { r: g.r + off[0], c: g.c + off[1] };
}
function drawPieces(): void {
  const cs = cellSize();
  const list = G.players.map((p, pi) => { const q = piecePos(pi), s = at(q.r, q.c); return { p, pi, s, x: s.x, y: s.y, k: s.k, lift: q.lift * cs * s.k }; });
  list.sort((a, b) => (a.pi === G.cur ? 1 : 0) - (b.pi === G.cur ? 1 : 0) || a.y - b.y); // whose turn on top
  for (const it of list) {
    const cur = it.pi === G.cur && G.phase !== 'over', crowd = G.players.filter(q => q.pos === it.p.pos).length > 1 && !(G.hop?.pi === it.pi) || it.p.pos === 0;
    const ck = cs * it.k; // a cell's size where the piece stands: the far side smaller
    const bob = cur && prefs.effects && (G.phase === 'roll' || G.phase === 'shake') ? Math.abs(Math.sin(G.t * 5)) * ck * 0.12 : 0;
    const sad = G.slide?.pi === it.pi && G.slide.link.kind === 'snake';
    drawBoardPiece(it.s, ck * (crowd ? 0.56 : 0.8), it.p.seat, it.p.animal, it.lift + bob, cur ? 0.5 + 0.5 * Math.sin(G.t * 6) : 0, sad ? 'sad' : G.slide?.pi === it.pi ? 'happy' : undefined);
  }
  B.flush(ctx); // the figures, over the board's marks; the words float above them
  for (const f of G.floaters) {
    const u = f.t / 1.4, b = boardRect();
    let x: number, y: number;
    if (f.pi >= 0) { const q = piecePos(f.pi), s = at(q.r, q.c); x = s.x; y = s.y - cs * 0.8 - u * cs * 0.8; }
    else { const m = at(5, 5); x = m.x; y = m.y - u * cs; } // about the throw: the middle of the board, clear of the panel
    if (f.pi >= 0) x = Math.max(b.x + cs * 1.4, Math.min(b.x + b.s - cs * 1.4, x)), y = Math.max(B.topY() + cs * 0.4, y);
    ctx.save(); ctx.globalAlpha = 1 - Math.max(0, u - 0.6) / 0.4;
    ctx.font = `bold ${Math.round(Math.max(18, cs * 0.42))}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 6; ctx.strokeStyle = '#fff6e2'; ctx.strokeText(f.text, x, y);
    ctx.fillStyle = f.color; ctx.fillText(f.text, x, y); ctx.restore();
  }
}

// ---- The die: wood-cream, its pips little paw prints, beside the shake button -------------------
const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};
function paw(x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.25, r * 0.55, r * 0.45, 0, 0, 7); ctx.fill();
  for (const [dx, dy] of [[-0.55, -0.45], [0, -0.72], [0.55, -0.45]]) { ctx.beginPath(); ctx.arc(x + dx * r, y + dy * r, r * 0.22, 0, 7); ctx.fill(); }
}
function drawDieFace(x: number, y: number, s: number, n: number, rot: number): void {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = 'rgba(40,60,30,0.25)'; rrect(ctx, -s / 2 + 4, -s / 2 + 8, s, s, s * 0.22); ctx.fill();
  ctx.fillStyle = '#e8c9a0'; rrect(ctx, -s / 2, -s / 2 + s * 0.06, s, s, s * 0.22); ctx.fill();
  const g = ctx.createLinearGradient(0, -s / 2, 0, s / 2); g.addColorStop(0, '#fffaf0'); g.addColorStop(1, '#fbe6c4');
  ctx.fillStyle = g; rrect(ctx, -s / 2, -s / 2, s, s, s * 0.22); ctx.fill();
  ctx.strokeStyle = '#d9a86a'; ctx.lineWidth = Math.max(1.5, s * 0.03); ctx.stroke();
  const pipColor = n === 1 || n === 6 ? '#d9442b' : '#5a3a26';
  for (const [dx, dy] of PIPS[n] || []) paw(dx * s * 0.27, dy * s * 0.27, s * (n === 1 ? 0.17 : 0.1), pipColor);
  ctx.restore();
}
/** The bottom area: the shake button's row, the die at its right end. */
function controls(): { bx: number; by: number; bw: number } {
  return phone() ? { bx: 16, by: H - 176, bw: W - 32 } : { bx: PX + 34, by: 420, bw: PWD - 68 };
}
function dieSpot(): { x: number; y: number; s: number } {
  const c = controls(), n = rulesNow().dice;
  return { x: c.bx + c.bw - (n > 1 ? 62 : 40), y: c.by + 31, s: n > 1 ? 52 : 64 };
}
function drawDie(): void {
  const D = dieSpot(), n = rulesNow().dice, last = G.dice.length === n ? G.dice : Array(n).fill(6);
  for (let k = 0; k < n; k++) {
    const ox = n > 1 ? (k ? 1 : -1) * D.s * 0.58 : 0, ph = k * 1.7;
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
    drawDieFace(D.x + ox + dx, D.y + dy, D.s, face, rot);
  }
  if (G.show && G.show.t < 1.4 && G.phase !== 'dice') { // the number, big, as the die stops
    const d = G.show.dice, label = d.length === 2 ? (d[0] === d[1] ? `Đôi ${d[0]}!` : `${d[0] + d[1]}`) : String(d[0]);
    const t = G.show.t, pop = t < 0.15 ? 0.5 + t / 0.15 * 0.7 : 1.2 - Math.min(0.2, (t - 0.15) * 0.8), alpha = t > 1 ? 1 - (t - 1) / 0.4 : 1;
    ctx.save(); ctx.globalAlpha = Math.max(0, alpha); ctx.translate(D.x, D.y - D.s * 0.1); ctx.scale(pop, pop); // over the dice: the turn line runs above them
    ctx.font = `bold 40px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 8; ctx.strokeStyle = '#fff6e2'; ctx.strokeText(label, 0, 0);
    ctx.fillStyle = d.includes(6) ? '#d9442b' : '#4a3020'; ctx.fillText(label, 0, 0); ctx.restore();
  }
}

// ---- Words -------------------------------------------------------------------------------------
/** True when this screen throws for the current player. */
function myTurn(): boolean {
  if (!G || G.phase === 'over') return false;
  const p = curP();
  if (on.isGuest()) return p.seat === on.mySeat && p.kind === 'remote';
  return p.kind === 'human';
}
function turnLine(): string {
  if (!G || !G.players.length) return '';
  const p = curP(), me = myTurn(), who = me ? 'Bạn' : p.name, d = diceText(G.dice);
  if (G.order) { // everyone throws once for the order of play, as in Cờ Tỷ Phú
    if (G.phase === 'roll') return me ? 'Tung chọn lượt: giữ nút để lắc, cao nhất đi trước' : `${who} chuẩn bị tung chọn lượt...`;
    if (G.phase === 'nomove') return `${who} tung được ${G.dice.reduce((a, b) => a + b, 0)}`;
  }
  switch (G.phase) {
    case 'roll': return me ? (G.players.filter(q => q.kind === 'human').length > 1 && !on.isGuest() ? `${p.name}: giữ nút để lắc, thả ra để thảy` : 'Giữ nút để lắc xúc xắc, thả ra để thảy') : `${who} chuẩn bị thảy...`;
    case 'shake': return me ? 'Thả ra khi vạch màu nằm trong vùng vàng' : `${who} đang lắc...`;
    case 'dice': return 'Xúc xắc đang lăn...';
    case 'move': return `${who} đổ ${d}, đi ${G.dice.reduce((a, b) => a + b, 0)} ô`;
    case 'slide': return G.slide?.link.kind === 'ladder' ? `${who} leo thang lên ô ${G.slide.link.to}!` : `${who} bị rắn đớp, tuột xuống ô ${G.slide?.link.to}`;
    case 'nomove': return `${who} đổ ${d}: cần đổ ${enterFace()} mới vào bàn`;
    default: return '';
  }
}
const finishName = (): string => (tune.snake_exact_finish >= 1 ? 'Đúng ô 100' : 'Vượt cũng được');
/** What brings a piece on under the six-to-start rule: a six with one die, a double with two. */
const enterFace = (): string => (rulesNow().dice > 1 ? 'đôi' : '6');
const diceName = (): string => (tune.snake_dice >= 2 ? '2 viên' : '1 viên');
const startName = (): string => (tune.snake_six_to_start >= 1 ? `Phải đổ ${enterFace()}` : 'Thảy là vào');
function kindName(s: SnakeSeat, i: number): string {
  if (s.kind === 'human' && i === 0 && (on.isHost() || on.isGuest())) return `Chủ phòng · ${on.isHost() ? on.myName : on.lobby?.hostName || ''}`;
  if (s.kind === 'human') return 'Người chơi';
  if (s.kind === 'ai') return 'Máy';
  if (s.kind === 'remote') return s.peer === undefined && !s.name ? 'Chờ bạn online...' : `Online · ${s.name || 'Bạn'}`;
  return 'Không chơi';
}

// ---- Buttons and taps --------------------------------------------------------------------------
function press(b: Loose): void {
  sfx.click();
  if (on.isGuest() && b.act) { on.sendAct(b.act); return; }
  b.fn();
}
function handleTaps(): void {
  for (const c of clicks) {
    const b = F.ui.find(x => c.x >= x.x && c.x <= x.x + x.w && c.y >= x.y && c.y <= x.y + x.h);
    if (b && b.enabled) press(b);
  }
  clicks.length = 0;
  if (F.picker && (pressed('Escape') || pressed('Enter'))) { F.picker = null; return; }
  if (pressed('Space') || pressed('Enter')) { const b = F.ui.find(x => x.role === 'primary' && x.enabled); if (b) press(b); }
  if (pressed('Escape') || pressed('KeyN')) { const b = F.ui.find(x => (x.role === 'secondary' || x.role === 'menuSecondary') && x.enabled); if (b) press(b); } // N / Esc: "bỏ qua", as in Cờ Tỷ Phú (and "Ở lại" under the leave menu)
}
/** The power gauge in the middle of the board, over everything: shown as soon as it is this screen's throw
 * (the sweet zone to see before holding), and while it shakes (src/ui/gameChrome.ts drawGauge). */
function drawPowerGauge(): void {
  const mine = (myTurn() || (!on.isGuest() && curP().kind === 'human')), v = viewRect(), gx = v.x + v.w / 2, gy = v.y + v.h / 2 + GAUGE_R * 0.35; // the board area's middle, fixed: turned, zoomed or moved, the board leaves the gauge where it is
  if (G.phase === 'shake' && G.shake && !G.shake.ai && mine) {
    const own = on.isGuest() && on.guestShaking, t = own ? on.guestShakeT() : G.shake.t; // a friend: its own clock, no lag
    drawGauge(gx, gy, own ? on.guestPower() : shakePower(), G.shake.zone, false, tune.shake_max_time - t);
  } else if (G.phase === 'roll' && G.zone && mine) drawGauge(gx, gy, 0, G.zone, true, 0);
}
/** The shake button's words while shaking: "let go now" over the sweet zone, else the seconds left. */
function shakeLabel(): string {
  const own = on.isGuest() && on.guestShaking, pos = own ? on.guestPower() : shakePower();
  if (inZone(pos, G.shake?.zone)) return 'Thả ngay: vùng đẹp!';
  return 'Thả ra để thảy!'; // the seconds left are on the gauge (two counts drifted a second apart)
}
/** The person shaking still holds the die (a finger, the mouse, Space or Enter). */
export const holding = (): boolean => pointerHeld || down.has('Space') || down.has('Enter');

/** The rules page of Rắn và Thang, numbers from data/config.json and data/snake-board.json. */
function showSnakeRules(): void {
  const R = rulesNow(), lad = LINKS.filter(l => l.kind === 'ladder'), sn = LINKS.filter(l => l.kind === 'snake');
  openPage('Luật Rắn và Thang', `
    <h3>Mục tiêu</h3><ul><li>Bàn <b>100 ô</b>, đi từ ô 1 ở góc dưới, ngoằn ngoèo lên tới <b>ô 100</b> ở góc trên. Ai tới ô 100 trước thì <b>thắng</b>.</li></ul>
    <h3>Thảy xúc xắc</h3><ul><li><b>Giữ nút</b> để lắc, <b>thả ra</b> để thảy: khi giữ, <b>thanh lực chạy lên xuống</b>; thả lúc thanh cao thì dễ ra số lớn, thấp thì dễ ra số nhỏ (mặt nào cũng vẫn có thể ra). Thả trúng <b>vùng vàng</b> trên thanh thì <b>may hơn một chút</b>. Có ${Math.round(tune.shake_max_time)} giây để canh. ${R.dice > 1 ? 'Hai viên, đi <b>tổng</b> hai viên.' : 'Một viên, ra mấy đi mấy ô.'}</li>
    <li>${R.sixToStart ? `Phải đổ <b>${enterFace()}</b> mới được vào bàn${R.dice > 1 ? ' (một viên 6 không tính)' : ''}.` : 'Thảy được bao nhiêu thì vào bàn bấy nhiêu ô.'}</li>
    ${R.bonusSix ? `<li>Đổ <b>${R.dice > 1 ? 'đôi' : '6'}</b> được <b>thảy thêm</b> một lần.</li>` : ''}</ul>
    <h3>Thang và rắn</h3><ul><li>Dừng đúng <b>chân thang</b> thì leo lên đầu thang (${lad.length} cây: ${lad.map(l => `${l.from}→${l.to}`).join(', ')}).</li>
    <li>Dừng đúng <b>đầu rắn</b> thì bị đớp, tuột xuống đuôi rắn (${sn.length} con: ${sn.map(l => `${l.from}→${l.to}`).join(', ')}).</li>
    <li>Nhiều quân đứng chung một ô được, không ai đá ai.</li></ul>
    <h3>Về đích</h3><ul><li>${R.exactFinish ? 'Phải tới <b>đúng ô 100</b>: dư bao nhiêu thì <b>lùi lại</b> bấy nhiêu ô (lùi trúng đầu rắn vẫn bị đớp!).' : 'Đổ dư cũng về đích.'}</li></ul>
    <h3>Phím</h3><ul><li>Space / Enter: giữ để lắc, thả ra để thảy · M: tắt tiếng</li></ul>`);
}

// ---- The setup screen --------------------------------------------------------------------------
function setupSpots() {
  return phone()
    ? { cx: 240, y0: 196, step: 62, rowH: 50, pieceX: 44, kindX: 200, kindW: 264, ruleY: [446, 500, 554], ruleH: 46, start: [16, 614, 448, 56], online: [16, 678, 448, 52], resume: [16, 740, 448, 48], rejoin: [16, 796, 448, 48], back: [12, 8, 92, 32], rules: [W - 104, 8, 92, 32], settings: [W - 202, 8, 92, 32], code: 768 }
    : { cx: 640, y0: 196, step: 58, rowH: 48, pieceX: 380, kindX: 650, kindW: 300, ruleY: [430, 482, 534], ruleH: 46, start: [370, 596, 260, 54], online: [650, 596, 260, 54], resume: [370, 656, 260, 40], rejoin: [650, 656, 260, 40], back: [326, 56, 100, 32], rules: [854, 56, 100, 32], settings: [746, 56, 100, 32], code: 674 };
}
function seatsShown(): SnakeSeat[] { return on.isGuest() ? (on.lobby?.seats ?? []) : snakeSetup.seats; }
function buildSetup(): void {
  F.ui = [];
  const T = setupSpots();
  const b4 = (r: number[], label: string, fn: () => void, role: string, color: string) => btn(r[0], r[1], r[2], r[3], label, fn, role, true, color);
  b4(T.back, '‹ Sảnh', () => { if (on.isHost() || on.isGuest()) on.leaveRoom(); setScene('hub'); }, 'room', '');
  b4(T.rules, 'Luật', showSnakeRules, 'room', '');
  b4(T.settings, 'Cài đặt', openSettings, 'room', ''); // the sound and the effects, as on Cờ Tỷ Phú's setup screen
  seatsShown().forEach((s, i) => { // a tap on the piece changes its animal (your own seat, online)
    const y = T.y0 + i * T.step, mine = on.isGuest() ? i === on.mySeat : !(s.kind === 'remote' && on.peerOnline(s.peer));
    if (s.kind !== 'off' && mine) btn(T.pieceX - 26, y - 2, 160, T.rowH + 4, '', () => { if (on.isGuest()) on.sendAct('animal'); else { nextAnimal(i); on.sendLobby(); } }, 'hidden');
  });
  if (on.isGuest()) { b4(T.online, 'Rời phòng', on.leaveRoom, 'secondary', '#6a4a2a'); return; }
  snakeSetup.seats.forEach((s, i) => {
    const locked = on.isHost() && (i === 0 || (s.kind === 'remote' && on.peerOnline(s.peer)));
    const r = { x: T.kindX, y: T.y0 + i * T.step, w: T.kindW, h: T.rowH };
    btn(r.x, r.y, r.w, r.h, kindName(s, i) + (locked ? '' : ' ▾'), () => {
      const items: { label: string; value: string }[] = [{ label: 'Người chơi', value: 'human' }];
      if (on.isHost()) items.push({ label: 'Chờ bạn online', value: 'remote' });
      items.push({ label: 'Máy', value: 'ai' });
      if (i > 0) items.push({ label: 'Không chơi', value: 'off' });
      openPicker(r, items, s.kind, v => {
        snakeSetup.seats[i] = { kind: String(v) as SnakeSeat['kind'], animal: s.animal };
        if (v !== 'off') { const used = snakeSetup.seats.some((q, k) => k !== i && q.kind !== 'off' && q.animal === s.animal); if (used) nextAnimal(i); }
        on.setNote(''); on.sendLobby();
      });
    }, 'seat', !locked);
  });
  const rule = (k: number, label: string, items: { label: string; value: number }[], key: string) => {
    const r = { x: T.kindX, y: T.ruleY[k], w: T.kindW, h: T.ruleH };
    const base = key === 'snake_dice' ? 1 : 0; // the dice count is 1 or 2, the other switches 0 or 1
    btn(r.x, r.y, r.w, r.h, `${label} ▾`, () => openPicker(r, items, tune[key] - base >= 1 ? 1 : 0, v => { CONFIG[key].value = Number(v) + base; on.sendLobby(); }), 'seat');
  };
  rule(0, diceName(), [{ label: '1 viên', value: 0 }, { label: '2 viên', value: 1 }], 'snake_dice');
  rule(1, startName(), [{ label: 'Thảy là vào', value: 0 }, { label: `Phải đổ ${enterFace()}`, value: 1 }], 'snake_six_to_start');
  rule(2, finishName(), [{ label: 'Đúng ô 100', value: 1 }, { label: 'Vượt cũng được', value: 0 }], 'snake_exact_finish');
  b4(T.start, phone() ? 'Bắt đầu' : 'Bắt đầu (Enter)', startSnake, 'primary', '#c8201f');
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
  snakeSetup.seats = k.seats.map(x => ({ ...x }));
  restoreKept(k.g, k.rng, k.history); setScene('snake');
}
function startSnake(): void {
  F.picker = null;
  const n = snakeSetup.seats.filter(s => s.kind !== 'off').length;
  if (n < 2) { on.setNote('Cần ít nhất 2 người chơi để bắt đầu.'); return; }
  if (snakeSetup.seats.some(s => s.kind === 'remote' && s.peer === undefined)) { on.setNote('Còn chỗ "Chờ bạn online" chưa có ai: đổi chỗ đó hoặc chờ bạn vào.'); return; }
  on.setNote('');
  if (on.isHost()) on.hostNewGame(); else newGame(checkSeed(), [], animalName);
  setScene('snake');
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
  const cardX = phone() ? 8 : 310, cardW = phone() ? W - 16 : 660, cardY = phone() ? 48 : 40, cardH = phone() ? (extra ? 808 : on.roomCode ? 744 : 690) : 660; // a room's code sits under the online button
  ctx.save(); ctx.fillStyle = 'rgba(255,249,234,0.97)'; rrect(ctx, cardX, cardY, cardW, cardH, 22); ctx.fill(); ctx.strokeStyle = '#e8a86a'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
  text('RẮN VÀ THANG', T.cx, cardY + (phone() ? 50 : 62), phone() ? 34 : 44, '#d9622b', 'center', 'bold');
  text(`Leo thang, né rắn, về ô 100 · 2 đến 4 người · ${rulesNow().dice > 1 ? 'hai viên' : 'một viên'} xúc xắc`, T.cx, cardY + (phone() ? 90 : 108), phone() ? 14 : 18, '#6a4a32');
  const hint = on.isGuest() ? (on.lobby ? `Phòng ${on.roomCode} · chờ ${on.lobby.hostName || 'chủ phòng'} bắt đầu ván · bấm con vật của bạn để đổi` : `Đang vào phòng ${on.roomCode}...`)
    : on.isHost() ? (on.roomCode ? `Gửi mã ${on.roomCode} cho bạn bè: họ vào bằng Rắn và Thang › Chơi online` : 'Đang mở phòng, chờ chút nhé...') : 'Bấm con vật để đổi quân, bấm chỗ ngồi để chọn người hoặc máy';
  ctx.font = `15px ${FONT}`;
  wrapLines(ctx, hint, cardW - 40).slice(0, 2).forEach((l, j) => text(l, T.cx, cardY + (phone() ? 118 : 140) + j * 20, phone() ? 14 : 16, on.isGuest() || on.isHost() ? '#d9622b' : '#8a6a4a'));
  seatsShown().forEach((s, i) => {
    const y = T.y0 + i * T.step + T.rowH / 2, off = s.kind === 'off';
    ctx.save(); ctx.globalAlpha = off ? 0.45 : 1;
    drawPiece(T.pieceX, y + 4, 46, i, s.animal, prefs.effects && !off ? Math.abs(Math.sin(performance.now() / 400 + i)) * 4 : 0);
    text(animalName(s.animal), T.pieceX + 34, y - 6, phone() ? 18 : 20, '#4a3020', 'left', 'bold');
    if (!off) text('bấm để đổi', T.pieceX + 34, y + 15, 12, '#a08060', 'left');
    ctx.restore();
    if (on.isGuest()) {
      const me = i === on.mySeat;
      ctx.save(); ctx.fillStyle = me ? '#ffd99a' : '#fff6e2'; rrect(ctx, T.kindX, y - T.rowH / 2, T.kindW, T.rowH, 12); ctx.fill(); ctx.strokeStyle = me ? '#d9622b' : '#e8c9a0'; ctx.lineWidth = me ? 3 : 1.5; ctx.stroke(); ctx.restore();
      text(kindName(s, i) + (me ? ' (bạn)' : ''), T.kindX + T.kindW / 2, y, 17, '#4a3020', 'center', 'bold');
    }
  });
  [['Xúc xắc', tune.snake_dice >= 2 ? 'đi tổng hai viên' : 'ra mấy đi mấy', diceName()], ['Vào bàn', tune.snake_six_to_start >= 1 ? `chờ được ${enterFace() === '6' ? 'số 6' : 'đôi'}` : 'ván nhanh hơn', startName()], ['Về đích', tune.snake_exact_finish >= 1 ? 'dư thì lùi lại' : 'ván ngắn hơn', finishName()]].forEach(([a, b, v], k) => {
    const y = T.ruleY[k] + T.ruleH / 2;
    text(a, T.pieceX - 22, y - 6, phone() ? 18 : 20, '#4a3020', 'left', 'bold');
    text(b, T.pieceX - 22, y + 15, 13, '#8a6a4a', 'left');
    if (on.isGuest()) text(v, T.kindX + T.kindW / 2, y, 17, '#4a3020', 'center', 'bold');
  });
  if (on.roomCode) text(`MÃ PHÒNG  ${on.roomCode}`, T.cx, T.code, phone() ? 30 : 34, '#d9622b', 'center', 'bold');
  F.ui.forEach(drawButton);
  if (on.note) messageBox([on.note], T.cx, phone() ? H - 110 : 690, 600);
  else drawLink(T.cx);
  drawPicker();
}
function drawLink(cx: number): void {
  if ((on.isHost() || on.isGuest()) && !on.linkUp) messageBox(['Đang mở phòng, máy chủ đang thức dậy... (tới 30 giây)'], cx, phone() ? H - 110 : 690, 600);
  else if (on.isGuest() && !on.hostOnline) messageBox(['Chủ phòng mất kết nối, đang chờ quay lại...'], cx, phone() ? H - 110 : 690, 600);
}

// ---- The game ----------------------------------------------------------------------------------
// The room's dialogs (src/net/roomExtras.ts) build their buttons with this screen's btn, centred on the board.
Object.assign(on.roomUi, { btn, cx: (): number => (phone() ? W / 2 : PX / 2), phone });
/** Where a player's card is (its top middle), for the bubbles over it. */
function cardSpot(i: number): { x: number; y: number } {
  if (!phone()) return { x: PX + PWD / 2, y: 76 + i * 70 };
  const cw = (W - 24) / 2;
  return { x: 8 + (i % 2) * (cw + 8) + cw / 2, y: 540 + Math.floor(i / 2) * 64 };
}
function buildPlay(): void {
  F.ui = [];
  const ph = phone(), inRoom = on.isHost() || on.isGuest();
  btn(ph ? 8 : PX + 14, ph ? 8 : 14, ph ? 82 : 92, 32, '‹ Sảnh', () => { F.roomMenu = true; }, 'room', true, '');
  btn(ph ? 96 : PX + 114, ph ? 8 : 14, ph ? 62 : 64, 32, 'Luật', showSnakeRules, 'room', true, '');
  btn(W - 52, ph ? 6 : 12, 40, 34, '', openSettings, 'mute');
  const speedOn = !on.isGuest() && G.players.some(p => p.kind !== 'human');
  if (ph) { // the row at the foot, as Cờ Tỷ Phú's: the history left, the speed right
    const r = phoneRow();
    btn(r.left, r.y, r.w, r.h, 'Lịch sử', on.openHistory, '', true, '#6a4a2a');
    if (speedOn) btn(r.right, r.y, r.w, r.h, `Tốc độ ×${speedNow()}`, cycleSpeed, '', true, '#6a4a2a');
  } else {
    if (speedOn) { const r = wideSpeedSpot(); btn(r.x, r.y, r.w, r.h, `×${speedNow()}`, cycleSpeed, 'room', true, ''); }
    btn(W - 118, LOG_Y - 14, 88, 28, 'Lịch sử', on.openHistory, 'room', true, '');
  }
  if (inRoom) { // quick emotes and chat, as in Cờ Tỷ Phú's room
    if (ph) { const r = phoneRow(); btn(W / 2 - 52, r.y, 104, r.h, 'Biểu cảm', on.extras.toggleEmotes, '', true, '#8a5a2a'); }
    else btn(W - 214, LOG_Y - 14, 88, 28, 'Biểu cảm', on.extras.toggleEmotes, 'room', true, '');
  }
  if (B.live) { // the view: zoom, turn, back (a phone pinches to zoom: turn and back sit in its row's gaps)
    const r = phoneRow();
    buildViewButtons(btn, B.orbit, ph ? [null, null, { x: 124, y: r.y, w: 56, h: r.h }, { x: 300, y: r.y, w: 56, h: r.h }] : viewRow(14, 676), ph ? '' : 'room', ph ? '#6a4a2a' : '');
  }
  if (G.vote) { on.extras.buildOverlay(); return; } // the vote for a new game, over everything
  if (F.roomMenu) {
    const y = ph ? H / 2 : 400;
    const go = on.isHost() ? 'Giải tán & về sảnh' : on.isGuest() ? 'Rời phòng' : 'Về sảnh';
    btn(W / 2 - 210, y, 200, 54, go, () => { F.roomMenu = false; if (on.isHost() || on.isGuest()) on.leaveRoom(); setScene('hub'); }, 'menu', true, '#c8201f');
    btn(W / 2 + 10, y, 200, 54, 'Ở lại', () => { F.roomMenu = false; }, 'menuSecondary', true, '#6a4a2a');
    if (inRoom) btn(W / 2 - 210, y + 66, 420, 50, 'Bỏ phiếu chơi lại ván mới', on.extras.startVote, 'menu', true, '#2b6cd6'); // as Cờ Tỷ Phú's room menu
    return;
  }
  if (on.extras.buildOverlay()) return; // the emote menu
  const mine = G.players[G.cur];
  if (G.phase !== 'over') tips.build(myTurn() && G.phase === 'roll' ? (rulesNow().sixToStart && mine && !mine.pos ? 'enter' : 'roll') : null, ph, PX, btn);
  if (G.phase === 'over') {
    const box = resultsBox(G.players.length, ph, PX / 2), cy = box.by, mid = box.cx;
    if (on.isGuest()) { // a friend asks for another game, as in Cờ Tỷ Phú: the host and the others vote
      btn(mid - 230, cy, 220, 54, 'Chơi lại', on.extras.startVote, 'primary', true, '#c8201f');
      btn(mid + 10, cy, 220, 54, 'Rời phòng', () => { on.leaveRoom(); setScene('hub'); }, 'secondary', true, '#6a4a2a');
    } else {
      btn(mid - 230, cy, 220, 54, 'Chơi lại (Enter)', () => { if (on.isHost()) on.extras.startVote(); else newGame(checkSeed(), [], animalName); }, 'primary', true, '#c8201f');
      btn(mid + 10, cy, 220, 54, CHANGE_PLAYERS, () => { setScene('snakeSetup'); on.sendLobby(); }, 'secondary', true, '#6a4a2a');
    }
    return;
  }
  const c = controls(), dieW = rulesNow().dice > 1 ? 136 : 92;
  if (myTurn() && (G.phase === 'roll' || G.phase === 'shake')) {
    btn(c.bx, c.by, c.bw - dieW, 62, G.phase === 'shake' ? shakeLabel() : G.order ? 'Giữ để lắc chọn lượt' : 'Giữ để lắc xúc xắc', () => startShake(), 'primary', true, '#c8201f', 'shake'); // full colour while held, as Cờ Tỷ Phú's (startShake does nothing mid-shake)
  }
}
const ready = (): boolean => !!G && !!G.players && G.players.length > 0;
function drawPlay(): void {
  clear('#bfe6f5');
  drawWater();
  drawBoard();
  drawPieces();
  if (phone()) drawPhonePanel(); else drawWidePanel();
  drawPowerGauge();
  if (G.phase !== 'over') drawDie(); // a game over: the panel shows "Tổng kết ván" where the die sat
  else drawResults();
  F.ui.forEach(b => { if (b.role !== 'menu' && b.role !== 'menuSecondary') drawButton(b); });
  tips.draw(phone(), PX, F.ui);
  on.extras.drawBubbles(i => (G.players[i] ? cardSpot(i) : null), i => SEATS[G.players[i]?.seat ?? 0].dark);
  on.extras.drawOverlay(F.ui); // the vote or the emote menu
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
  text(p.name + (me ? ' (bạn)' : '') + (off ? ' (máy thay)' : ''), x + h + 2, y + h * 0.32, Math.min(18, h * 0.32), '#4a3020', 'left', 'bold');
  text(p.pos ? `Ô ${p.pos}` : 'Chưa vào bàn', x + h + 2, y + h * 0.7, phone() ? 13 : 15, '#6a4a32', 'left', 'bold');
  if (G.order) drawOrderMark(G.order, i, i === G.cur, x, y, w, h); // the throws for the order of play
  else if (!phone()) text(`thang ${p.ladders} · rắn ${p.bites}`, x + w - 14, y + h * 0.7, 14, '#8a6a4a', 'right');
}
/** The wide panel's "Diễn biến" line, its history button beside it. */
const LOG_Y = 524;
/** "Tổng kết ván": who climbed most, who was bitten most, who threw the most sixes (or doubles). */
function summaryLines(): string[] {
  const l = mostOf(G.players, p => p.ladders), b = mostOf(G.players, p => p.bites), sx = mostOf(G.players, p => p.sixes);
  const six = rulesNow().dice > 1 ? 'đôi' : 'số 6';
  return [l ? `Leo thang nhiều nhất: ${l.p.name} (${l.n} lần)` : '', b ? `Bị rắn đớp nhiều nhất: ${b.p.name} (${b.n} lần)` : 'Không ai bị rắn đớp.', sx ? `Đổ ${six} nhiều nhất: ${sx.p.name} (${sx.n} lần)` : ''].filter(Boolean);
}
function drawWidePanel(): void {
  lacquer(PX, 0, PWD, H);
  text('RẮN VÀ THANG', PX + PWD / 2 + 70, 31, 24, '#d9622b', 'center', 'bold');
  if (on.roomCode) text(`Phòng ${on.roomCode}`, W - 70, 62, 16, '#d9622b', 'right', 'bold');
  G.players.forEach((_, i) => playerCard(i, PX + 24, 76 + i * 70, PWD - 48, 60));
  const line = turnLine();
  if (G.phase === 'over') drawSummary(PX + 24, 366, PWD - 48, summaryLines()); // as Cờ Tỷ Phú's after a game
  else if (line) { ctx.font = `bold 20px ${FONT}`; wrapLines(ctx, line, PWD - 60).slice(0, 2).forEach((l, j) => text(l, PX + PWD / 2, 372 + j * 24, 20, '#4a3020', 'center', 'bold')); }
  text('Diễn biến', PX + 30, LOG_Y, 17, '#b0501f', 'left', 'bold');
  G.log.slice(0, 6).forEach((l, j) => { ctx.font = `15px ${FONT}`; text(wrapLines(ctx, l, PWD - 60)[0], PX + 30, 552 + j * 25, 15, j ? '#8a6a4a' : '#4a3020', 'left'); });
}
function drawPhonePanel(): void {
  lacquer(0, 0, W, 46); // the header and the strip under the board: one sign each, as Cờ Tỷ Phú's
  text('RẮN VÀ THANG', W / 2 + 40, 24, 20, '#d9622b', 'center', 'bold');
  if (on.roomCode) text(on.roomCode, W - 62, 24, 15, '#d9622b', 'right', 'bold');
  const y0 = 540, cw = (W - 24) / 2;
  lacquer(0, y0 - 12, W, H - y0 + 12);
  G.players.forEach((_, i) => playerCard(i, 8 + (i % 2) * (cw + 8), y0 + Math.floor(i / 2) * 64, cw, 56));
  const line = turnLine(), ly = H - 214;
  if (line) { ctx.font = `bold 18px ${FONT}`; wrapLines(ctx, line, W - 30).slice(0, 2).forEach((l, j) => text(l, W / 2, ly + j * 24 - 10, 18, '#4a3020', 'center', 'bold')); }
  const logY = 680;
  G.log.slice(0, Math.max(1, Math.floor((ly - 30 - logY) / 22))).forEach((l, j) => { ctx.font = `14px ${FONT}`; text(wrapLines(ctx, l, W - 30)[0], 16, logY + j * 22, 14, j ? '#8a6a4a' : '#4a3020', 'left'); });
}
function drawResults(): void {
  const ph = phone(), order = rank(G.players, G.winner), win = order[0], { x, y, w, h, cx } = resultsBox(order.length, ph, PX / 2);
  ctx.save(); ctx.fillStyle = 'rgba(70,110,130,0.3)'; ctx.fillRect(0, 0, ph ? W : PX, H); // the board dims, the panel's summary stays clear
  ctx.fillStyle = 'rgba(255,249,234,0.97)'; rrect(ctx, x, y, w, h, 22); ctx.fill(); ctx.strokeStyle = '#e8a86a'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
  if (prefs.effects) {
    ctx.save(); rrect(ctx, x, y, w, h, 22); ctx.clip();
    for (let k = 0; k < 36; k++) {
      const fx = x + ((k * 97) % w), fy = y + ((k * 53 + G.timer * (40 + (k % 5) * 12)) % h);
      ctx.fillStyle = ['#ff9ec4', '#ffd84a', '#8fd16a', '#8cc4f5', '#ffb59a'][k % 5];
      ctx.beginPath(); ctx.ellipse(fx, fy, 5, 3, G.timer * 2 + k, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
  text(`Về tới ô ${LAST} trước!`, cx, y + 26, 15, '#8a6a4a', 'center'); // why it ended, as Cờ Tỷ Phú's
  order.slice(1, 3).forEach((p, j) => drawPiece(cx + (j ? 120 : -120), y + 96, 44, p.seat, p.animal)); // the podium: second left, third right
  drawPiece(cx, y + 86, 72, win.seat, win.animal, prefs.effects ? Math.abs(Math.sin(G.timer * 5)) * 14 : 0, 1);
  text(`${win.name} thắng!`, cx, y + 160, ph ? 28 : 32, '#d9622b', 'center', 'bold');
  order.forEach((p, j) => {
    const ry = y + 206 + j * 52;
    ctx.save(); ctx.fillStyle = j === 0 ? '#ffd99a' : '#fff6e2'; rrect(ctx, x + 20, ry - 22, w - 40, 44, 10); ctx.fill(); ctx.restore();
    text(`${j + 1}.`, x + 42, ry, 19, '#d9622b', 'center', 'bold');
    drawPiece(x + 76, ry + 2, 32, p.seat, p.animal);
    text(p.name, x + 100, ry, ph ? 16 : 18, '#4a3020', 'left', 'bold');
    text(`Ô ${p.pos} · thang ${p.ladders} · rắn ${p.bites} · ${rulesNow().dice > 1 ? 'đôi' : 'số 6'}: ${p.sixes}`, x + w - 34, ry, ph ? 13 : 15, '#6a4a32', 'right');
  });
}

// ---- Fast forward: the computer's turns at ×2 or ×4 (src/core/speed.ts, shared with the other games) ----
/** How much faster this step runs: the computer's turns at the chosen speed, a person's at ×1. */
function turnSpeed(): number {
  if (!G?.players || G.phase === 'over') return 1;
  return autoPlays(curP(), on.peerOnline) ? speedNow() : 1;
}

/** The two screens of Rắn và Thang, for main.ts's scene table. */
export const snakeScenes: Record<string, { update(dt: number): void; draw(): void }> = {
  snakeSetup: {
    update() { syncView(); buildSetup(); handleTaps(); },
    draw() { syncView(); drawSetup(); },
  },
  snake: {
    update(dt: number) {
      if (!ready()) { if (on.isGuest()) return; setScene('snakeSetup'); return; }
      syncView(); B.orbit.step(dt);
      buildPlay(); handleTaps();
      if (scene !== 'snake') return;
      if (B.live && !F.roomMenu && !G.vote && !F.emoteMenu && !F.picker) { useView({ orbit: B.orbit, cam: () => B.cam, rect: viewRect() }); viewKeys(B.orbit, pressed); } // the player turns and zooms their own view
      on.extras.step(dt); // the bubbles age; the host runs the vote's clock
      if (on.isGuest()) { G.t += dt; if (G.hop) G.hop.t = Math.min(G.hop.t + dt, tune.snake_hop_time); if (G.slide) G.slide.t = Math.min(G.slide.t + dt, tune.snake_slide_time); if (G.throwAt) G.throwAt.t += dt; if (G.shake) G.shake.t += dt; if (G.show) G.show.t += dt; for (const f of G.floaters) f.t += dt; return; }
      gameStep(dt * turnSpeed(), holding(), on.peerOnline); // the computer's turns at the chosen speed
    },
    draw() {
      if (!ready()) { clear('#bfe6f5'); text('Đang tải ván...', W / 2, H / 2, 22, '#4a3020', 'center', 'bold'); return; }
      syncView(); drawPlay();
    },
  },
};
/** Runs the Rắn và Thang room's messages each step (main.ts calls it after the scene). */
export function snakeNet(): void { on.snakeNetStep(holding()); }
/** For checks: where each piece stands and whose turn it is, read-only. */
export function snakeView(): Loose {
  return G ? { phase: G.phase, cur: G.cur, dice: G.dice, pos: G.players.map(p => p.pos), winner: G.winner, auto: G.players.map(p => autoPlays(p, on.peerOnline)), names: G.players.map(p => p.name), ordering: !!G.order, bubbles: (G.emotes || []).map(e => e.text ?? e.i), vote: G.vote ? G.vote.list.map(e => e.ans) : null, tip: tips.now } : null;
}
