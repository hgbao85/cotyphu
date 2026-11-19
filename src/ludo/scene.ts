// Cá Ngựa's screens: the setup screen (who plays) and the game (the board seen from above, the die in
// the middle, the players' panel), with the end of the game drawn over it. A 2D chibi board: grass
// island, cream track tiles, a pastel yard in each corner and a lotus in the centre.
// The turns are in ./game.ts, online play in ./online.ts, the rules in ./rules.ts.

import { tune, CONFIG } from '../config';
import { CHECKED } from '../core/env';
import { sfx } from '../audio';
import { W, H, FONT, ctx, text, rrect, clear, screenScale, wrapLines } from '../screen';
import { setScene, scene } from '../core/store';
import { F } from '../core/flags';
import { prefs } from '../core/prefs';
import type { Loose } from '../game/types';
import { btn, clicks, pointer, pressed, down, pointerHeld, L } from '../main';
import { drawButton, drawTokenIcon, lacquer, messageBox } from '../ui/draw';
import { openPicker, buildPicker, drawPicker } from '../ui/setupScreen';
import { openPage } from '../ui/pages';
import { openSettings } from '../ui/settings';
import { showOnlinePanel } from '../net/room';
import { G, setG, diceText, SIDES, LV_NAMES, ludoSetup, newGame, startShake, pickHorse, curP, step as gameStep, shakePower, ranking, rulesNow, autoPlays } from './game';
import { cellOf, moveValue, GATE, STEPS, TRACK, startOf, stepCell, exitRolls, type LudoSeat } from './rules';
import * as on from './online';
import { localGame, lastRoom, restoreRules, type KeptGame } from './keep';

/** The horse's face on every piece: Ngựa, the seventh of the twelve animals. */
const HORSE = 6;

// ---- Layout ------------------------------------------------------------------------------------
const phone = (): boolean => L.phone;
/** The board's square on the screen. */
function boardRect(): { x: number; y: number; s: number } {
  return phone() ? { x: 4, y: 52, s: 472 } : { x: 30, y: 20, s: 680 };
}
/** The wide layout's panel. */
const PX = 740, PWD = 1280 - 740;
/** A point of the grid (rows and columns, as fractions) on the screen. */
function at(r: number, c: number): { x: number; y: number } {
  const b = boardRect(), cs = b.s / 15;
  return { x: b.x + c * cs, y: b.y + r * cs };
}
const cellSize = (): number => boardRect().s / 15;
/** The corner yard of each side: its top-left cell. */
const YARD: [number, number][] = [[0, 0], [0, 9], [9, 9], [9, 0]];
/** Where horse h of a side waits in its yard, as grid fractions. */
function nest(side: number, h: number): { r: number; c: number } {
  const [r0, c0] = YARD[side];
  return { r: r0 + 1.9 + (h >> 1) * 2.2, c: c0 + 1.9 + (h & 1) * 2.2 };
}
/** Where a horse at progress p stands, as grid fractions (its cell's centre, or its nest). */
function spot(side: number, h: number, p: number): { r: number; c: number } {
  const c = cellOf(side, p);
  return c ? { r: c[0] + 0.5, c: c[1] + 0.5 } : nest(side, h);
}

// ---- The board, drawn once into its own canvas ---------------------------------------------------
let boardCache: HTMLCanvasElement | null = null, cacheKey = '';
function lighten(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const m = (v: number) => Math.round(v + (255 - v) * k);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}
function drawBoardInto(c: CanvasRenderingContext2D, s: number): void {
  const cs = s / 15, P = (r: number, col: number) => ({ x: col * cs, y: r * cs });
  const rr = (x: number, y: number, w: number, h: number, r: number) => rrect(c, x, y, w, h, r);
  // the grass island
  c.fillStyle = '#8fcf68'; rr(0, 0, s, s, cs * 0.9); c.fill();
  c.fillStyle = '#a8dc7a'; rr(cs * 0.12, cs * 0.12, s - cs * 0.24, s - cs * 0.24, cs * 0.8); c.fill();
  // the yards
  YARD.forEach(([r0, c0], side) => {
    const o = P(r0, c0), col = SIDES[side].color;
    c.fillStyle = lighten(col, 0.25); rr(o.x + cs * 0.3, o.y + cs * 0.3, cs * 5.4, cs * 5.4, cs * 0.8); c.fill();
    c.strokeStyle = SIDES[side].dark; c.lineWidth = cs * 0.08; c.stroke();
    c.fillStyle = '#fff6e2'; rr(o.x + cs * 0.9, o.y + cs * 0.9, cs * 4.2, cs * 4.2, cs * 0.7); c.fill();
    for (let h = 0; h < 4; h++) {
      const n = nest(side, h), q = P(n.r, n.c);
      c.fillStyle = lighten(col, 0.55); c.beginPath(); c.arc(q.x, q.y, cs * 0.78, 0, 7); c.fill();
      c.strokeStyle = lighten(SIDES[side].dark, 0.2); c.lineWidth = cs * 0.06; c.stroke();
    }
  });
  // the track
  const tile = (r: number, col: number, fill: string, edge: string) => {
    const o = P(r, col); c.fillStyle = fill; rr(o.x + cs * 0.06, o.y + cs * 0.06, cs * 0.88, cs * 0.88, cs * 0.22); c.fill();
    c.strokeStyle = edge; c.lineWidth = cs * 0.05; c.stroke();
  };
  TRACK.forEach(([r, col]) => tile(r, col, '#fff6e2', '#e8c9a0'));
  for (let side = 0; side < 4; side++) {
    const [r, col] = TRACK[startOf(side)];
    tile(r, col, SIDES[side].color, SIDES[side].dark); // the start: the side's colour, with a little star
    const o = P(r + 0.5, col + 0.5); c.fillStyle = '#fff6e2'; c.beginPath();
    for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, d = (k % 2 ? 0.14 : 0.3) * cs; c.lineTo(o.x + Math.cos(a) * d, o.y + Math.sin(a) * d); }
    c.fill();
    for (let k = 1; k <= STEPS; k++) { // the stable's steps, numbered
      const [sr, sc] = stepCell(side, k);
      tile(sr, sc, lighten(SIDES[side].color, 0.35 - k * 0.04), SIDES[side].dark);
      const m = P(sr + 0.5, sc + 0.53);
      c.fillStyle = SIDES[side].dark; c.font = `bold ${Math.round(cs * 0.5)}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(k), m.x, m.y);
    }
  }
  // the centre: four petals in the sides' colours around a lotus
  const m = P(7.5, 7.5);
  const corner = [[6, 6], [6, 9], [9, 9], [9, 6]].map(([r, col]) => P(r, col));
  const toward = [[0, 3], [0, 1], [1, 2], [2, 3]]; // each side's two corners: left, top, right, bottom
  toward.forEach(([a, b2], side) => {
    c.fillStyle = lighten(SIDES[side].color, 0.15); c.beginPath(); c.moveTo(corner[a].x, corner[a].y); c.lineTo(corner[b2].x, corner[b2].y); c.lineTo(m.x, m.y); c.closePath(); c.fill();
    c.strokeStyle = '#fff6e2'; c.lineWidth = cs * 0.06; c.stroke();
  });
  for (let k = 0; k < 8; k++) { // the lotus
    const a = k * Math.PI / 4; c.fillStyle = k % 2 ? '#ffc2d6' : '#ff9ec4';
    c.beginPath(); c.ellipse(m.x + Math.cos(a) * cs * 0.42, m.y + Math.sin(a) * cs * 0.42, cs * 0.42, cs * 0.2, a, 0, 7); c.fill();
  }
  c.fillStyle = '#ffd84a'; c.beginPath(); c.arc(m.x, m.y, cs * 0.26, 0, 7); c.fill();
  for (let side = 0; side < 4; side++) { // the top step lies on the side's petal
    const [sr, sc] = stepCell(side, STEPS), q = P(sr + 0.5, sc + 0.53);
    c.fillStyle = SIDES[side].dark; c.font = `bold ${Math.round(cs * 0.5)}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(STEPS), q.x, q.y);
  }
  // little grass tufts and flowers between the yards and the track
  const tufts: [number, number][] = [[6.3, 6.3], [0.4, 6.0], [14.5, 8.9], [6.0, 14.5], [8.9, 0.4]];
  for (const [r, col] of tufts) { const o = P(r, col); c.fillStyle = '#6fb84e'; for (const dx of [-0.12, 0, 0.12]) { c.beginPath(); c.ellipse(o.x + dx * cs, o.y, cs * 0.04, cs * 0.12, dx * 3, 0, 7); c.fill(); } }
}
/** Copies the board, drawn once at the screen's pixel size. */
function drawBoard(): void {
  const b = boardRect(), px = Math.round(b.s * screenScale), key = `${px}`;
  if (!boardCache || key !== cacheKey) {
    boardCache = document.createElement('canvas'); boardCache.width = boardCache.height = px;
    const c = boardCache.getContext('2d')!; c.scale(px / b.s, px / b.s);
    drawBoardInto(c, b.s); cacheKey = key;
  }
  ctx.save(); ctx.fillStyle = 'rgba(40,90,110,0.18)'; rrect(ctx, b.x + 6, b.y + 10, b.s, b.s, b.s / 15 * 0.9); ctx.fill(); ctx.restore();
  ctx.drawImage(boardCache, b.x, b.y, b.s, b.s);
}

// ---- Horses ------------------------------------------------------------------------------------
/** One horse: a round coloured base, the horse's face on it. */
function drawHorse(x: number, y: number, size: number, side: number, lift = 0, glow = 0): void {
  const col = SIDES[side].color;
  ctx.save();
  ctx.fillStyle = 'rgba(40,60,30,0.28)'; ctx.beginPath(); ctx.ellipse(x, y + size * 0.42, size * 0.42 * (1 - lift * 0.01), size * 0.14, 0, 0, 7); ctx.fill();
  if (glow) { ctx.strokeStyle = `rgba(255,236,120,${0.5 + 0.5 * glow})`; ctx.lineWidth = size * 0.12; ctx.beginPath(); ctx.arc(x, y - lift, size * 0.58, 0, 7); ctx.stroke(); }
  ctx.fillStyle = SIDES[side].dark; ctx.beginPath(); ctx.arc(x, y - lift + size * 0.06, size * 0.46, 0, 7); ctx.fill();
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y - lift, size * 0.46, 0, 7); ctx.fill();
  ctx.strokeStyle = '#fff6e2'; ctx.lineWidth = size * 0.06; ctx.stroke();
  ctx.restore();
  drawTokenIcon(HORSE, x, y - lift - size * 0.02, size * 0.86, col, glow ? 'happy' : undefined);
}
/** Where a horse is drawn now: hopping, flying home after a kick, or standing. */
function horsePos(pi: number, h: number): { x: number; y: number; lift: number } {
  const p = G.players[pi], cs = cellSize();
  const hp = G.hop;
  if (hp && hp.pi === pi && hp.h === h && hp.path.length) {
    const a = spot(p.side, h, p.horses[h]), b = spot(p.side, h, hp.path[0]);
    const u = Math.min(1, hp.t / tune.ludo_hop_time), q = at(a.r + (b.r - a.r) * u, a.c + (b.c - a.c) * u);
    return { x: q.x, y: q.y, lift: Math.sin(u * Math.PI) * cs * 0.55 };
  }
  const k = G.kicked.find(x => x.pi === pi && x.h === h);
  if (k) {
    const a = spot(p.side, h, k.from), b = nest(p.side, h), u = Math.min(1, k.t / 0.6), q = at(a.r + (b.r - a.r) * u, a.c + (b.c - a.c) * u);
    return { x: q.x, y: q.y, lift: Math.sin(u * Math.PI) * cs * 2 };
  }
  const s = spot(p.side, h, p.horses[h]), q = at(s.r, s.c);
  return { x: q.x, y: q.y, lift: 0 };
}
/** True when this screen chooses the current player's horse. */
function myTurn(): boolean {
  if (!G || G.phase === 'over') return false;
  const p = curP();
  if (on.isGuest()) return p.side === on.mySeat && p.kind === 'remote';
  return p.kind === 'human';
}
/** The horse this screen tapped that can go two ways (two different dice): the buttons ask how far. -1: none. */
let pickedHorse = -1;
/** How far horse h can go now (each die's face, and both dice's total), farthest first. */
function horseDice(h: number): number[] { return [...new Set(G.moves.filter(m => m.h === h).map(moveValue))].sort((a, b) => b - a); }
/** The horses this screen may tap now: every horse with a move. */
function movable(): number[] { if (G.phase !== 'choose' || !myTurn()) return []; return [...new Set(G.moves.map(m => m.h))]; }
/** The tapped horse, while it can still go two ways. */
function picked(): number { return movable().includes(pickedHorse) && horseDice(pickedHorse).length > 1 ? pickedHorse : -1; }
/** Which dice of the throw are spent (a die value no longer in G.use). */
function spentDice(): boolean[] {
  const left = [...(G.use || [])];
  return G.dice.map(d => { const k = left.indexOf(d); if (k >= 0) { left.splice(k, 1); return false; } return true; });
}
/** The colours of the two "how far" buttons, and of the band each paints to its cell. */
const HINT = ['#ff8a5c', '#5aa2ec', '#7cc95a'];
/** The tapped horse's ways to go: a band of its colour over the cells it passes, its end cell ringed and numbered. */
function drawHints(): void {
  const h = picked(); if (h < 0) return;
  const p = curP(), cs = cellSize(), pulse = 0.75 + 0.25 * Math.sin(G.t * 5);
  horseDice(h).forEach((d, k) => {
    const ms = G.moves.filter(m => m.h === h && moveValue(m) === d); if (!ms.length) return;
    const m = ms.reduce((a, b) => (b.to > a.to ? b : a));
    const path: number[] = m.from === GATE && m.to > GATE && rulesNow().homeStrict ? [m.to] : Array.from({ length: m.to - m.from }, (_, j) => m.from + 1 + j);
    ctx.save();
    path.forEach((q, j) => {
      const c = cellOf(p.side, q)!, o = at(c[0], c[1]), last = j === path.length - 1;
      ctx.globalAlpha = last ? 0.55 * pulse : 0.32;
      ctx.fillStyle = HINT[k]; rrect(ctx, o.x + cs * 0.08, o.y + cs * 0.08, cs * 0.84, cs * 0.84, cs * 0.22); ctx.fill();
      if (last) {
        ctx.globalAlpha = 1; ctx.strokeStyle = HINT[k]; ctx.lineWidth = Math.max(3, cs * 0.12);
        rrect(ctx, o.x + cs * 0.02, o.y + cs * 0.02, cs * 0.96, cs * 0.96, cs * 0.26); ctx.stroke();
        text(String(d), o.x + cs * 0.82, o.y + cs * 0.14, Math.round(cs * 0.42), HINT[k], 'center', 'bold');
      }
    });
    ctx.restore();
  });
}
function drawHorses(): void {
  drawHints();
  const cs = cellSize(), mv = movable();
  const list: { pi: number; h: number; x: number; y: number; lift: number }[] = [];
  G.players.forEach((p, pi) => p.horses.forEach((_, h) => list.push({ pi, h, ...horsePos(pi, h) })));
  list.sort((a, b) => a.y - b.y); // the lower ones in front
  for (const it of list) {
    const p = G.players[it.pi], mine = it.pi === G.cur && mv.includes(it.h);
    const bob = mine && prefs.effects ? Math.abs(Math.sin(G.t * 5 + it.h)) * cs * 0.18 : 0;
    const breathe = prefs.effects && it.pi === G.cur && !mine ? Math.sin(G.t * 3 + it.h) * cs * 0.03 : 0;
    const chosen = mine && it.h === picked(); // the tapped horse, waiting for how far
    drawHorse(it.x, it.y, cs * (chosen ? 1.12 : 0.95), p.side, it.lift + bob + breathe + (chosen ? cs * 0.2 : 0), mine ? (chosen ? 1 : 0.5 + 0.5 * Math.sin(G.t * 6)) : 0);
    if (mine && mv.length > 1) text(String(it.h + 1), it.x + cs * 0.38, it.y - it.lift - bob - cs * 0.4, Math.round(cs * 0.36), '#4a3020', 'center', 'bold');
  }
  for (const f of G.floaters) {
    const u = f.t / 1.4;
    const q = f.pi >= 0 ? horsePos(f.pi, f.h) : { ...at(7.5, 7.5), lift: cs * 1.4 };
    ctx.save(); ctx.globalAlpha = 1 - Math.max(0, u - 0.6) / 0.4;
    ctx.font = `bold ${Math.round(cs * 0.55)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const y = q.y - q.lift - cs * 0.9 - u * cs, b = boardRect(), x = Math.max(b.x + cs * 1.6, Math.min(b.x + b.s - cs * 1.6, q.x)); // kept on the board
    ctx.lineWidth = 6; ctx.strokeStyle = '#fff6e2'; ctx.strokeText(f.text, x, y);
    ctx.fillStyle = f.color; ctx.fillText(f.text, x, y); ctx.restore();
  }
}

// ---- The die: wood-cream, its pips little paw prints --------------------------------------------
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
function drawDie(): void {
  const cs = cellSize(), c = at(7.5, 7.5), n = rulesNow().dice, s = n > 1 ? cs * 1.22 : cs * 1.75;
  const last = G.dice.length === n ? G.dice : Array(n).fill(6);
  for (let k = 0; k < n; k++) { // two dice side by side in the centre, each tumbling its own way
    const ox = n > 1 ? (k ? 1 : -1) * s * 0.62 : 0, ph = k * 1.7;
    let face = last[k], rot = 0, dy = 0, dx = 0;
    if (G.phase === 'shake' && G.shake) {
      const t = G.shake.t; face = 1 + (Math.floor(t * 14 + k * 3) % 6);
      dx = Math.sin(t * 47 + ph) * cs * 0.12; dy = Math.cos(t * 39 + ph) * cs * 0.1; rot = Math.sin(t * 31 + ph) * 0.25;
    } else if (G.phase === 'dice' && G.throwAt) {
      const th = G.throwAt, u = Math.min(1, th.t / th.dur);
      face = u > 0.85 ? last[k] : th.faces[Math.min(th.faces.length - 1, Math.floor(u * th.faces.length))][k] ?? last[k];
      dy = -Math.abs(Math.sin(u * Math.PI * (3 + k * 0.5) + ph * 0.3)) * (1 - u) * cs * (1.2 + th.power * 1.2);
      rot = th.spin * (k ? -1 : 1) * (1 - u) * (1 - u) * 3;
    } else if (prefs.effects) dy = -Math.abs(Math.sin(G.t * 2 + ph)) * cs * 0.06;
    const busy = G.phase === 'choose' || G.phase === 'move', spent = busy && spentDice()[k]; // a die already moved with fades
    ctx.save(); if (spent) ctx.globalAlpha = 0.35;
    drawDieFace(c.x + ox + dx, c.y + dy, s, face, rot + (n > 1 && G.phase !== 'dice' && G.phase !== 'shake' ? (k ? 0.12 : -0.1) : 0));
    ctx.restore();
  }
}
/** Over the horses: the numbers as the dice stop, and the power bar while shaking. */
function drawDiceTop(): void {
  const cs = cellSize(), c = at(7.5, 7.5);
  if (G.show && G.show.t < 1.4 && G.phase !== 'dice') { // the numbers, big, as the dice stop
    const d = G.show.dice, dbl = d.length === 2 && d[0] === d[1];
    const label = d.length === 2 ? (dbl ? `Đôi ${d[0]}!` : `${d[0]} + ${d[1]} = ${d[0] + d[1]}`) : String(d[0]);
    const t = G.show.t, pop = t < 0.15 ? 0.5 + t / 0.15 * 0.7 : 1.2 - Math.min(0.2, (t - 0.15) * 0.8), alpha = t > 1 ? 1 - (t - 1) / 0.4 : 1;
    ctx.save(); ctx.globalAlpha = Math.max(0, alpha); ctx.translate(c.x, c.y - cs * 1.75); ctx.scale(pop, pop);
    ctx.font = `bold ${Math.round(cs * (d.length === 2 && !dbl ? 0.85 : 1.15))}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 8; ctx.strokeStyle = '#fff6e2'; ctx.strokeText(label, 0, 0);
    ctx.fillStyle = dbl || (d.length === 1 && d[0] === 6) ? '#d9442b' : '#4a3020'; ctx.fillText(label, 0, 0); ctx.restore();
  }
  if (G.phase === 'shake' && G.shake && !G.shake.ai && (myTurn() || (!on.isGuest() && curP().kind === 'human'))) { // the power bar
    const w = cs * 4.2, x = c.x - w / 2, y = c.y + cs * 1.4, h = cs * 0.32, pw = shakePower();
    ctx.save(); ctx.fillStyle = 'rgba(255,249,234,0.95)'; rrect(ctx, x - 4, y - 4, w + 8, h + 8, 8); ctx.fill();
    const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, '#8fd16a'); g.addColorStop(0.6, '#ffd84a'); g.addColorStop(1, '#ff7b6b');
    ctx.fillStyle = g; rrect(ctx, x, y, Math.max(8, w * pw), h, 6); ctx.fill(); ctx.restore();
  }
}

// ---- Words: whose turn, what to do --------------------------------------------------------------
/** The last throw in words. */
const dt = (): string => diceText(G.dice);
function turnLine(): string {
  if (!G || !G.players.length) return '';
  const p = curP(), me = myTurn();
  const who = me ? 'Bạn' : p.name;
  switch (G.phase) {
    case 'roll': return me ? (G.players.filter(q => q.kind === 'human').length > 1 && !on.isGuest() ? `${p.name}: giữ nút để lắc, thả ra để thảy` : 'Giữ nút để lắc xúc xắc, thả ra để thảy') : `${who} chuẩn bị thảy...`;
    case 'shake': return me ? 'Thả ra để thảy!' : `${who} đang lắc...`;
    case 'dice': return 'Xúc xắc đang lăn...';
    case 'choose': {
      const left = G.use.length < G.dice.length ? `Còn viên ${G.use.join(', ')}` : `Đổ ${dt()}`;
      if (!me) return `${who} ${left.toLowerCase()}, đang chọn ngựa...`;
      return picked() >= 0 ? `${left}: ngựa số ${picked() + 1} đi mấy?` : `${left}: bấm ngựa đang sáng`;
    }
    case 'move': return `${who} đổ ${dt()}`;
    case 'nomove': return `${who} đổ ${dt()}: không đi được`;
    default: return '';
  }
}
/** A player's horses in a few words: in the yard, on the way, in the stable. */
function horseSummary(i: number): string {
  const p = G.players[i];
  const yard = p.horses.filter(x => x < 0).length, home = p.horses.filter(x => x > GATE).length, way = p.horses.length - yard - home;
  return phone() ? `Chuồng ${yard} · Đi ${way} · Lên ${home}` : `Chuồng ${yard} · Đường ${way} · Lên ${home}`;
}
/** The stable rule's name on the setup screen. */
const homeName = (): string => (tune.ludo_home_strict >= 1 ? 'Truyền thống' : 'Nhanh');
function kindName(s: LudoSeat, i: number): string {
  if (s.kind === 'human' && i === 0 && (on.isHost() || on.isGuest())) return `Chủ phòng · ${on.isHost() ? on.myName : on.lobby?.hostName || ''}`;
  if (s.kind === 'human') return 'Người chơi';
  if (s.kind === 'ai') return `Máy · ${LV_NAMES[s.lv ?? 1]}`;
  if (s.kind === 'remote') return s.peer === undefined && !s.name ? 'Chờ bạn online...' : `Online · ${s.name || 'Bạn'}`;
  return 'Không chơi';
}

// ---- Buttons and taps --------------------------------------------------------------------------
/** A button pressed: a friend online sends its act; everyone else runs it. */
function press(b: Loose): void {
  sfx.click();
  if (on.isGuest() && b.act) { on.sendAct(b.act); return; }
  b.fn();
}
function handleTaps(): void {
  let pressedOne = false; // one button per step: a second press would act on buttons built for the state before the first
  for (const c of clicks) {
    const b = F.ui.find(x => c.x >= x.x && c.x <= x.x + x.w && c.y >= x.y && c.y <= x.y + x.h);
    if (b) { if (b.enabled && !pressedOne) { press(b); pressedOne = true; } continue; }
    if (pressedOne) continue;
    if (scene === 'ludo' && G && !F.roomMenu && movable().length) { // a tap on a glowing horse moves it (not under the leave menu)
      const cs = cellSize();
      let best = -1, bd = cs * 0.75;
      for (const h of movable()) { const q = horsePos(G.cur, h), d = Math.hypot(c.x - q.x, c.y - q.y); if (d < bd) { bd = d; best = h; } }
      if (best >= 0) choose(best);
    }
  }
  clicks.length = 0;
  if (F.picker && (pressed('Escape') || pressed('Enter'))) { F.picker = null; return; }
  if (pressedOne) return;
  if (scene === 'ludo' && !F.roomMenu && movable().length) { // the leave menu open: only its buttons answer
    for (let k = 0; k < 4; k++) if (pressed('Digit' + (k + 1)) && movable().includes(k)) { choose(k); return; }
    if ((pressed('Space') || pressed('Enter')) && picked() < 0) { choose(movable()[0]); return; }
  }
  if (pressed('Space') || pressed('Enter')) { const b = F.ui.find(x => x.role === 'primary' && x.enabled); if (b) press(b); }
  if (pressed('Escape')) { const b = F.ui.find(x => x.role === 'secondary' && x.enabled); if (b) press(b); }
}
/** A horse tapped: it goes at once when it has one way to go; with two (two different dice) the buttons ask how far. */
function choose(h: number): void {
  sfx.click();
  const ds = horseDice(h);
  if (ds.length > 1) { pickedHorse = h; return; }
  go(h, ds[0]);
}
/** Moves horse h with die d (a friend online sends it to the host). */
function go(h: number, d: number): void {
  pickedHorse = -1;
  if (on.isGuest()) on.sendAct('pick', h, d); else pickHorse(h, d);
}
/** The person shaking still holds the die (a finger, the mouse, Space or Enter). */
export const holding = (): boolean => pointerHeld || down.has('Space') || down.has('Enter');

/** The rules page of Cá Ngựa, numbers from data/config.json. */
function showLudoRules(): void {
  const R = rulesNow(), ex = exitRolls(R).join(' hoặc '), two = R.dice > 1;
  openPage('Luật Cá Ngựa', `
    <h3>Mục tiêu</h3><ul><li>Mỗi người <b>${R.horses} chú ngựa</b> trong chuồng ở góc bàn. Ai đưa đủ ngựa lên <b>bậc thang chuồng</b> (6 ô màu ở giữa cánh của mình) trước thì <b>thắng</b>.</li></ul>
    <h3>Thảy xúc xắc</h3><ul><li><b>Giữ nút</b> để lắc (giữ càng lâu thảy càng mạnh), <b>thả ra</b> để thảy. ${two ? '<b>Hai viên</b> xúc xắc, <b>mỗi viên đi riêng</b>: bấm ngựa đang sáng; ngựa đi được cả hai số thì chọn <b>đi số nào</b>, xong rồi chọn ngựa cho số còn lại. Một ngựa đi cả hai số (đi <b>tổng</b> một mạch, hoặc từng số một), hay hai ngựa mỗi con một số, tùy bạn. Đi tổng thì không dừng ở ô giữa.' : 'Một viên xúc xắc.'}</li>
    <li>${two ? `Một viên <b>${ex}</b> ra được <b>một ngựa</b>; viên còn lại đi tiếp (ô ngôi sao đã có ngựa vừa ra, nên đôi ${exitRolls(R).join(', đôi ')} cũng chỉ ra một ngựa, trừ khi viên kia đưa ngựa ấy đi chỗ khác trước). ${R.exitDouble ? '<b>Đôi 2, 3, 4, 5</b>: dùng cả hai viên để ra một ngựa, hoặc đi như thường.' : 'Đôi 2, 3, 4, 5 <b>không</b> ra quân được (vẫn đi và vẫn được thảy thêm).'}` : `Đổ <b>${ex}</b> thì được ra quân.`} Ngựa ra ô có ngôi sao ở góc ngoài cánh của mình.</li>
    ${R.bonusSix ? `<li>${two ? '<b>Đổ đôi</b>' : 'Đổ <b>6</b>'} được <b>thảy thêm</b> một lần.</li>` : ''}
    <li>Không có ngựa nào đi được thì mất lượt.</li></ul>
    <h3>Đi ngựa</h3><ul><li>Ngựa chạy theo chiều kim đồng hồ quanh bàn, đúng số đã đổ. Có nhiều ngựa đi được thì bấm chọn con đang sáng.</li>
    ${R.noJump ? '<li><b>Không được nhảy qua đầu</b> ngựa khác (của ai cũng vậy).</li>' : ''}
    <li>Dừng đúng ô có ngựa người khác: <b>đá</b> ngựa đó về chuồng${R.bonusKick ? ' và được thảy thêm' : ''}. Không được dừng lên ngựa của mình.</li></ul>
    <h3>Lên chuồng</h3><ul>${R.homeStrict
      ? `<li>Ngựa phải dừng <b>đúng ô cửa chuồng</b> (ô giữa ở cuối cánh của mình, ngay trước ô ra quân) mới được lên. Đứng ở cửa, ${two ? 'có một viên' : 'đổ'} <b>k</b> thì lên thẳng <b>bậc k</b>.</li><li>Đang ở bậc <b>s</b>, phải ${two ? 'có một viên' : 'đổ'} đúng <b>s + 1</b> mới lên thêm một bậc.</li>`
      : '<li>Đi qua ô cửa chuồng thì vào các bậc theo số đổ, không được đi lố bậc 6.</li>'}</ul>
    <h3>Phím</h3><ul><li>Space / Enter: giữ để lắc, chọn ngựa đầu tiên · 1–4: chọn ngựa số đó · M: tắt tiếng</li></ul>`);
}

// ---- The setup screen --------------------------------------------------------------------------
function setupSpots() {
  return phone()
    ? { cx: 240, y0: 200, step: 64, rowH: 52, kindX: 200, kindW: 264, homeY: 462, start: [16, 528, 448, 60], online: [16, 598, 448, 54], resume: [16, 664, 448, 50], rejoin: [16, 722, 448, 50], back: [12, 8, 92, 32], rules: [W - 104, 8, 92, 32] }
    : { cx: 640, y0: 222, step: 64, rowH: 50, kindX: 650, kindW: 300, homeY: 482, start: [370, 562, 260, 60], online: [650, 562, 260, 60], resume: [370, 636, 260, 50], rejoin: [650, 636, 260, 50], back: [326, 56, 100, 32], rules: [854, 56, 100, 32] };
}
function seatsShown(): LudoSeat[] { return on.isGuest() ? (on.lobby?.seats ?? []) : ludoSetup.seats; }
function buildSetup(): void {
  F.ui = [];
  const T = setupSpots();
  const b4 = (r: number[], label: string, fn: () => void, role: string, color: string) => btn(r[0], r[1], r[2], r[3], label, fn, role, true, color);
  b4(T.back, '‹ Sảnh', () => { if (on.isHost() || on.isGuest()) on.leaveRoom(); setScene('hub'); }, 'room', '');
  b4(T.rules, 'Luật', showLudoRules, 'room', '');
  if (on.isGuest()) { b4(T.online, 'Rời phòng', on.leaveRoom, 'secondary', '#6a4a2a'); return; }
  ludoSetup.seats.forEach((s, i) => {
    const locked = on.isHost() && (i === 0 || (s.kind === 'remote' && on.peerOnline(s.peer)));
    const r = { x: T.kindX, y: T.y0 + i * T.step, w: T.kindW, h: T.rowH };
    btn(r.x, r.y, r.w, r.h, kindName(s, i) + (locked ? '' : ' ▾'), () => {
      const items: { label: string; value: string }[] = [{ label: 'Người chơi', value: 'human' }];
      if (on.isHost()) items.push({ label: 'Chờ bạn online', value: 'remote' });
      LV_NAMES.forEach((n, lv) => items.push({ label: `Máy · ${n}`, value: 'ai' + lv }));
      if (i > 0) items.push({ label: 'Không chơi', value: 'off' });
      openPicker(r, items, s.kind === 'ai' ? 'ai' + s.lv : s.kind, v => {
        const k = String(v); ludoSetup.seats[i] = k.startsWith('ai') ? { kind: 'ai', lv: Number(k[2]) } : { kind: k as LudoSeat['kind'] };
        on.setNote(''); on.sendLobby();
      });
    }, 'seat', !locked);
  });
  { // how a horse climbs its stable: the traditional exact rolls, or straight in (a shorter game)
    const r = { x: T.kindX, y: T.homeY, w: T.kindW, h: T.rowH };
    btn(r.x, r.y, r.w, r.h, `${homeName()} ▾`, () => openPicker(r, [{ label: 'Truyền thống', value: 1 }, { label: 'Nhanh', value: 0 }], tune.ludo_home_strict >= 1 ? 1 : 0, v => { CONFIG.ludo_home_strict.value = Number(v); on.sendLobby(); }), 'seat');
  }
  b4(T.start, phone() ? 'Bắt đầu' : 'Bắt đầu (Enter)', startLudo, 'primary', '#c8201f');
  if (on.isHost()) b4(T.online, `Giải tán phòng ${on.roomCode}`, on.leaveRoom, '', '#6a4a2a');
  else b4(T.online, 'Chơi online', () => showOnlinePanel(true, { create: on.createRoom, join: on.joinRoom }), '', '#2b6cd6');
  if (!on.isHost()) { // after a reload: the game left on this screen, the room left
    const kept = localGame(), room = lastRoom();
    if (kept) b4(T.resume, phone() ? 'Chơi tiếp ván trước' : 'Chơi tiếp ván trước', () => resumeLocal(kept), '', '#2f8a3a');
    if (room) b4(kept ? T.rejoin : T.resume, `Vào lại phòng ${room.code}`, on.rejoinRoom, '', '#2f8a3a');
  }
  buildPicker();
}
/** Puts the game left on this screen back, where it was. */
function resumeLocal(k: KeptGame): void {
  F.picker = null; on.setNote('');
  ludoSetup.seats = k.seats.map(x => ({ ...x }));
  restoreRules(k.rules); // the rules it was played with, not the ones on the setup screen now
  setG(k.g); setScene('ludo');
}
function startLudo(): void {
  F.picker = null;
  const n = ludoSetup.seats.filter(s => s.kind !== 'off').length;
  if (n < 2) { on.setNote('Cần ít nhất 2 người chơi để bắt đầu.'); return; }
  if (ludoSetup.seats.some(s => s.kind === 'remote' && s.peer === undefined)) { on.setNote('Còn chỗ "Chờ bạn online" chưa có ai: đổi chỗ đó hoặc chờ bạn vào.'); return; }
  on.setNote('');
  if (on.isHost()) on.hostNewGame(); else newGame(checkSeed());
  setScene('ludo');
}
/** A seed a check set (?seed=), so a check replays the same game. */
function checkSeed(): number | undefined { const s = new URLSearchParams(location.search).get('seed'); return s ? Number(s) : undefined; }

function drawSetup(): void {
  clear('#bfe6f5');
  const T = setupSpots();
  // the board behind, faded
  drawBoard(); ctx.fillStyle = 'rgba(191,230,245,0.72)'; ctx.fillRect(0, 0, W, H);
  const cardX = phone() ? 8 : 310, cardW = phone() ? W - 16 : 660, cardY = phone() ? 48 : 40, cardH = phone() ? (!on.isHost() && !on.isGuest() && (localGame() || lastRoom()) ? 736 : on.roomCode ? 712 : 620) : 660; // a room's code sits under the online button
  ctx.save(); ctx.fillStyle = 'rgba(255,249,234,0.97)'; rrect(ctx, cardX, cardY, cardW, cardH, 22); ctx.fill(); ctx.strokeStyle = '#e8a86a'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
  text('CÁ NGỰA', T.cx, cardY + (phone() ? 50 : 62), phone() ? 36 : 46, '#d9622b', 'center', 'bold');
  text(`Đua ngựa về chuồng · 2 đến 4 người · ${rulesNow().dice > 1 ? 'hai viên' : 'một viên'} xúc xắc`, T.cx, cardY + (phone() ? 92 : 112), phone() ? 15 : 18, '#6a4a32');
  const hint = on.isGuest() ? (on.lobby ? `Phòng ${on.roomCode} · chờ ${on.lobby.hostName || 'chủ phòng'} bắt đầu ván` : `Đang vào phòng ${on.roomCode}...`)
    : on.isHost() ? (on.roomCode ? `Gửi mã ${on.roomCode} cho bạn bè: họ vào bằng Cá Ngựa › Chơi online` : 'Đang mở phòng, chờ chút nhé...') : 'Bấm vào từng chỗ ngồi để chọn người hoặc máy';
  ctx.font = `15px ${FONT}`;
  wrapLines(ctx, hint, cardW - 40).slice(0, 2).forEach((l, j) => text(l, T.cx, cardY + (phone() ? 122 : 150) + j * 20, phone() ? 15 : 16, on.isGuest() || on.isHost() ? '#d9622b' : '#8a6a4a'));
  seatsShown().forEach((s, i) => {
    const y = T.y0 + i * T.step + T.rowH / 2, off = s.kind === 'off';
    ctx.save(); ctx.globalAlpha = off ? 0.45 : 1;
    const hx = phone() ? 44 : 380;
    drawHorse(hx, y + 4, 46, i, prefs.effects && !off ? Math.abs(Math.sin(performance.now() / 400 + i)) * 4 : 0);
    text(`Ngựa ${SIDES[i].name}`, hx + 34, y, phone() ? 18 : 20, '#4a3020', 'left', 'bold');
    ctx.restore();
    if (on.isGuest()) {
      const me = i === on.mySeat;
      ctx.save(); ctx.fillStyle = me ? '#ffd99a' : '#fff6e2'; rrect(ctx, T.kindX, y - T.rowH / 2, T.kindW, T.rowH, 12); ctx.fill(); ctx.strokeStyle = me ? '#d9622b' : '#e8c9a0'; ctx.lineWidth = me ? 3 : 1.5; ctx.stroke(); ctx.restore();
      text(kindName(s, i) + (me ? ' (bạn)' : ''), T.kindX + T.kindW / 2, y, 17, '#4a3020', 'center', 'bold');
    }
  });
  { // the stable rule's row
    const y = T.homeY + T.rowH / 2;
    text('Lên chuồng', phone() ? 44 : 380, y, phone() ? 18 : 20, '#4a3020', 'left', 'bold');
    text(tune.ludo_home_strict >= 1 ? 'đổ đúng từng bậc' : 'ván ngắn hơn', phone() ? 44 : 380, y + 20, 13, '#8a6a4a', 'left');
    if (on.isGuest()) text(homeName(), T.kindX + T.kindW / 2, y, 17, '#4a3020', 'center', 'bold');
  }
  if (on.roomCode) {
    const y = phone() ? 660 : 632;
    text(`MÃ PHÒNG  ${on.roomCode}`, T.cx, y + (phone() ? 30 : 30), phone() ? 30 : 34, '#d9622b', 'center', 'bold');
  }
  F.ui.forEach(drawButton);
  if (on.note) messageBox([on.note], T.cx, phone() ? H - 120 : 690, 600);
  else drawLink(T.cx);
  drawPicker();
}
/** The line about the room server, while it connects. */
function drawLink(cx: number): void {
  if ((on.isHost() || on.isGuest()) && !on.linkUp) messageBox(['Đang mở phòng, máy chủ đang thức dậy... (tới 30 giây)'], cx, phone() ? H - 120 : 690, 600);
  else if (on.isGuest() && !on.hostOnline) messageBox(['Chủ phòng mất kết nối, đang chờ quay lại...'], cx, phone() ? H - 120 : 690, 600);
}

// ---- The game ----------------------------------------------------------------------------------
function buildPlay(): void {
  F.ui = [];
  const ph = phone();
  btn(ph ? 8 : PX + 14, ph ? 8 : 14, ph ? 82 : 92, 32, '‹ Sảnh', () => { F.roomMenu = true; }, 'room', true, '');
  btn(ph ? 96 : PX + 114, ph ? 8 : 14, ph ? 62 : 64, 32, 'Luật', showLudoRules, 'room', true, '');
  btn(W - 52, ph ? 6 : 12, 40, 34, '', openSettings, 'mute');
  if (!on.isGuest() && G.players.some(p => p.kind !== 'human')) btn(ph ? 164 : PX + 186, ph ? 8 : 14, ph ? 52 : 56, 32, `×${speed}`, cycleSpeed, 'room', true, '');
  if (F.roomMenu) { // leaving the game: asked once
    const y = ph ? H / 2 : 400;
    const go = on.isHost() ? 'Giải tán & về sảnh' : on.isGuest() ? 'Rời phòng' : 'Về sảnh';
    btn(W / 2 - 210, y, 200, 54, go, () => { F.roomMenu = false; if (on.isHost() || on.isGuest()) on.leaveRoom(); setScene('hub'); }, 'menu', true, '#c8201f');
    btn(W / 2 + 10, y, 200, 54, 'Ở lại', () => { F.roomMenu = false; }, 'menuSecondary', true, '#6a4a2a');
    return;
  }
  const bx = ph ? 16 : PX + 40, bw = ph ? W - 32 : PWD - 80, by = ph ? H - 176 : 404;
  if (G.phase === 'over') {
    const cy = ph ? H / 2 + 150 : 520;
    if (on.isGuest()) btn(W / 2 - 110, cy, 220, 54, 'Rời phòng', () => { on.leaveRoom(); setScene('hub'); }, 'secondary', true, '#6a4a2a');
    else {
      btn(W / 2 - 230, cy, 220, 54, 'Chơi lại (Enter)', () => { if (on.isHost()) on.hostNewGame(); else newGame(checkSeed()); }, 'primary', true, '#c8201f');
      btn(W / 2 + 10, cy, 220, 54, 'Đổi người chơi', () => { setScene('ludoSetup'); on.sendLobby(); }, 'secondary', true, '#6a4a2a');
    }
    return;
  }
  if (picked() >= 0) { // the tapped horse can go two ways: how far
    const h = picked(), u = horseDice(h), gap = 12, w = (bw - gap) / u.length;
    const both = (d: number) => G.moves.some(m => m.h === h && m.dice.length > 1 && m.from >= 0 && moveValue(m) === d);
    u.forEach((d, k) => btn(bx + k * (w + gap), by, w, 56, both(d) ? `Đi ${d} (cả 2)` : u.length > 2 ? `Đi ${d}` : `Ngựa ${h + 1} đi ${d}`, () => go(h, d), k ? '' : 'primary', true, HINT[k])); // the same colours as the bands on the board
  }
  if (myTurn() && (G.phase === 'roll' || G.phase === 'shake')) {
    btn(bx, by, bw, 62, G.phase === 'shake' ? 'Thả ra để thảy!' : 'Giữ để lắc xúc xắc', () => startShake(), 'primary', G.phase === 'roll', '#c8201f', 'shake');
  }
}
/** A friend's screen, or a check's: G arrives or is made before the first draw. */
const ready = (): boolean => !!G && !!G.players && G.players.length > 0;
function drawPlay(): void {
  clear('#bfe6f5');
  drawWater();
  drawBoard();
  drawDie();     // the dice under the horses: a horse on its sixth step stands on the centre's petal
  drawHorses();
  drawDiceTop();
  if (phone()) drawPhonePanel(); else drawWidePanel();
  if (G.phase === 'over') drawResults(); // the card first, its buttons over it
  F.ui.forEach(b => { if (b.role !== 'menu' && b.role !== 'menuSecondary') drawButton(b); });
  if (F.roomMenu) {
    ctx.save(); ctx.fillStyle = 'rgba(70,110,130,0.35)'; ctx.fillRect(0, 0, W, H); ctx.restore();
    messageBox([on.isHost() ? 'Giải tán phòng? Mọi người sẽ ra khỏi ván.' : on.isGuest() ? 'Rời phòng? Máy sẽ chơi thay bạn.' : 'Về sảnh? Ván này sẽ bỏ dở.'], W / 2, (phone() ? H / 2 : 400) - 60, 460);
    F.drawingMenu = true; F.ui.forEach(b => { if (b.role === 'menu' || b.role === 'menuSecondary') drawButton(b); }); F.drawingMenu = false;
  }
  drawLink(phone() ? W / 2 : PX + PWD / 2);
}
/** Gentle ripples on the water around the island. */
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
  const p = G.players[i], cur = i === G.cur && G.phase !== 'over';
  const me = on.isGuest() && p.side === on.mySeat;
  ctx.save();
  ctx.fillStyle = cur ? lighten(SIDES[p.side].color, 0.55) : '#fff6e2'; rrect(ctx, x, y, w, h, 12); ctx.fill();
  ctx.strokeStyle = cur ? SIDES[p.side].dark : '#e8c9a0'; ctx.lineWidth = cur ? 3 : 1.5; ctx.stroke(); ctx.restore();
  drawHorse(x + h / 2, y + h / 2 + 2, h * 0.7, p.side, cur && prefs.effects ? Math.abs(Math.sin(G.t * 4)) * 3 : 0);
  const off = p.kind === 'remote' && on.isHost() && !on.peerOnline(p.peer);
  text(p.name + (me ? ' (bạn)' : '') + (off ? ' (máy chơi thay)' : ''), x + h + 2, y + h * 0.32, Math.min(18, h * 0.32), '#4a3020', 'left', 'bold');
  text(horseSummary(i), x + h + 2, y + h * 0.7, phone() ? 13 : 15, '#6a4a32', 'left');
}
function drawWidePanel(): void {
  lacquer(PX, 0, PWD, H);
  text('CÁ NGỰA', PX + PWD / 2 + 70, 31, 26, '#d9622b', 'center', 'bold');
  if (on.roomCode) text(`Phòng ${on.roomCode}`, W - 70, 62, 16, '#d9622b', 'right', 'bold');
  G.players.forEach((_, i) => playerCard(i, PX + 24, 76 + i * 72, PWD - 48, 62));
  const line = turnLine();
  if (line) { ctx.font = `bold 20px ${FONT}`; wrapLines(ctx, line, PWD - 60).slice(0, 2).forEach((l, j) => text(l, PX + PWD / 2, 366 + j * 24, 20, '#4a3020', 'center', 'bold')); }
  text('Diễn biến', PX + 30, 500, 17, '#b0501f', 'left', 'bold');
  G.log.slice(0, 7).forEach((l, j) => { ctx.font = `15px ${FONT}`; text(wrapLines(ctx, l, PWD - 60)[0], PX + 30, 528 + j * 25, 15, j ? '#8a6a4a' : '#4a3020', 'left'); });
}
function drawPhonePanel(): void {
  ctx.save(); ctx.fillStyle = 'rgba(255,249,234,0.92)'; ctx.fillRect(0, 0, W, 48); ctx.restore();
  text('CÁ NGỰA', W / 2 + 40, 25, 22, '#d9622b', 'center', 'bold');
  if (on.roomCode) text(on.roomCode, W - 62, 25, 15, '#d9622b', 'right', 'bold');
  const y0 = 532, cw = (W - 24) / 2;
  G.players.forEach((_, i) => playerCard(i, 8 + (i % 2) * (cw + 8), y0 + Math.floor(i / 2) * 64, cw, 56));
  const line = turnLine(), ly = H - 214;
  if (line) { ctx.font = `bold 18px ${FONT}`; wrapLines(ctx, line, W - 30).slice(0, 2).forEach((l, j) => text(l, W / 2, ly + j * 24 - 10, 18, '#4a3020', 'center', 'bold')); }
  const logY = 672;
  G.log.slice(0, Math.max(1, Math.floor((ly - 30 - logY) / 22))).forEach((l, j) => { ctx.font = `14px ${FONT}`; text(wrapLines(ctx, l, W - 30)[0], 16, logY + j * 22, 14, j ? '#8a6a4a' : '#4a3020', 'left'); });
}
function drawResults(): void {
  const ph = phone(), w = ph ? W - 24 : 640, h = ph ? 470 : 480, x = W / 2 - w / 2, y = ph ? H / 2 - 260 : 90;
  ctx.save(); ctx.fillStyle = 'rgba(70,110,130,0.3)'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,249,234,0.97)'; rrect(ctx, x, y, w, h, 22); ctx.fill(); ctx.strokeStyle = '#e8a86a'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
  if (prefs.effects) { // confetti: pastel dots and petals falling inside the card
    ctx.save(); rrect(ctx, x, y, w, h, 22); ctx.clip();
    for (let k = 0; k < 36; k++) {
      const fx = x + ((k * 97) % w), fy = y + ((k * 53 + G.timer * (40 + (k % 5) * 12)) % h);
      ctx.fillStyle = ['#ff9ec4', '#ffd84a', '#8fd16a', '#8cc4f5', '#ffb59a'][k % 5];
      ctx.beginPath(); ctx.ellipse(fx, fy, 5, 3, G.timer * 2 + k, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
  const rank = ranking(), win = rank[0];
  drawHorse(W / 2, y + 74, 72, win.side, prefs.effects ? Math.abs(Math.sin(G.timer * 5)) * 14 : 0, 1);
  text(`${win.name} thắng!`, W / 2, y + 150, ph ? 28 : 32, '#d9622b', 'center', 'bold');
  rank.forEach((p, j) => {
    const ry = y + 196 + j * 52;
    ctx.save(); ctx.fillStyle = j === 0 ? '#ffd99a' : '#fff6e2'; rrect(ctx, x + 20, ry - 22, w - 40, 44, 10); ctx.fill(); ctx.restore();
    text(`${j + 1}.`, x + 42, ry, 19, '#d9622b', 'center', 'bold');
    drawHorse(x + 76, ry + 2, 32, p.side);
    text(p.name, x + 100, ry, ph ? 16 : 18, '#4a3020', 'left', 'bold');
    text(`Lên ${p.horses.filter(v => v > GATE).length} · đá ${p.kicks} · bị đá ${p.kicked} · ${rulesNow().dice > 1 ? 'đôi' : 'số 6'}: ${p.sixes}`, x + w - 34, ry, ph ? 13 : 15, '#6a4a32', 'right');
  });
}

// ---- Fast forward ----------------------------------------------------------------------------
// The computer's turns (and a friend's who dropped, the computer playing for them) run at ×2 or ×4:
// its shake, its throw, its hops, its thinking. A person's turn always runs at its own pace. Online,
// the host's button sets it for everyone. The choice is shared with Cờ Tỷ Phú's button.
const SPEEDS = [1, 2, 4];
let speed = 1;
try { const k = Number(localStorage.getItem('tpdv-speed')); speed = !CHECKED && SPEEDS.includes(k) ? k : 1; } catch { speed = 1; } // a check always runs at ×1
function cycleSpeed(): void {
  speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
  try { localStorage.setItem('tpdv-speed', String(speed)); } catch { /* not kept: fine */ }
}
/** How much faster this step runs: the computer's turns at the chosen speed, a person's at ×1. */
function turnSpeed(): number {
  if (!G?.players || G.phase === 'over') return 1;
  return autoPlays(curP(), on.peerOnline) ? speed : 1;
}

/** The two screens of Cá Ngựa, for main.ts's scene table. */
export const ludoScenes: Record<string, { update(dt: number): void; draw(): void }> = {
  ludoSetup: {
    update() { buildSetup(); handleTaps(); },
    draw() { drawSetup(); },
  },
  ludo: {
    update(dt: number) {
      if (!ready()) { if (on.isGuest()) return; setScene('ludoSetup'); return; }
      buildPlay(); handleTaps();
      if (scene !== 'ludo') return;
      if (on.isGuest()) { G.t += dt; if (G.hop) G.hop.t = Math.min(G.hop.t + dt, tune.ludo_hop_time); if (G.throwAt) G.throwAt.t += dt; if (G.shake) G.shake.t += dt; if (G.show) G.show.t += dt; for (const f of G.floaters) f.t += dt; return; }
      gameStep(dt * turnSpeed(), holding(), on.peerOnline); // the computer's turns at the chosen speed
    },
    draw() {
      if (!ready()) { clear('#bfe6f5'); text('Đang tải ván...', W / 2, H / 2, 22, '#4a3020', 'center', 'bold'); return; }
      drawPlay();
    },
  },
};
/** Runs the Cá Ngựa room's messages each step (main.ts calls it after the scene). */
export function ludoNet(): void { on.ludoNetStep(holding()); }
/** For checks: who plays which side and what they can do, read-only. */
export function ludoView(): Loose {
  return G ? { phase: G.phase, cur: G.cur, dice: G.dice, use: G.use, moves: G.moves.map(m => m.h), horses: G.players.map(p => [...p.horses]), winner: G.winner, auto: G.players.map(p => autoPlays(p, on.peerOnline)) } : null;
}
