// Flat drawn icons for tiles, cards and the HUD (lantern, envelope, ship, train...), on any 2D canvas.
import { rrect } from '../screen';

export const icon = {
  lantern(c: CanvasRenderingContext2D, x: number, y: number, s: number) { // đèn lồng đỏ: Cơ Hội
    c.save(); c.translate(x, y);
    c.fillStyle = '#5a3a1a'; c.fillRect(-s * 0.04, -s * 0.62, s * 0.08, s * 0.16);
    c.fillStyle = '#e8b33a'; rrect(c, -s * 0.24, -s * 0.48, s * 0.48, s * 0.1, s * 0.03); c.fill();
    rrect(c, -s * 0.24, s * 0.38, s * 0.48, s * 0.1, s * 0.03); c.fill();
    c.fillStyle = '#d42a24'; c.beginPath(); c.ellipse(0, -s * 0.0, s * 0.4, s * 0.4, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#f2c44a'; c.lineWidth = s * 0.04;
    for (const k of [-0.22, 0, 0.22]) { c.beginPath(); c.ellipse(0, 0, Math.abs(k) * s * 1.3 + s * 0.02, s * 0.4, 0, 0, Math.PI * 2); c.stroke(); }
    c.strokeStyle = '#e8b33a'; c.lineWidth = s * 0.03;
    for (let k = -2; k <= 2; k++) { c.beginPath(); c.moveTo(k * s * 0.05, s * 0.48); c.lineTo(k * s * 0.07, s * 0.72); c.stroke(); }
    c.restore();
  },
  envelope(c: CanvasRenderingContext2D, x: number, y: number, s: number) { // bao lì xì: Khí Vận
    c.save(); c.translate(x, y);
    c.fillStyle = '#c8201f'; rrect(c, -s * 0.32, -s * 0.48, s * 0.64, s * 0.96, s * 0.06); c.fill();
    c.fillStyle = '#a3171a'; c.beginPath(); c.moveTo(-s * 0.32, -s * 0.44); c.lineTo(0, -s * 0.12); c.lineTo(s * 0.32, -s * 0.44); c.closePath(); c.fill();
    c.strokeStyle = '#f2c44a'; c.lineWidth = s * 0.035; rrect(c, -s * 0.26, -s * 0.42, s * 0.52, s * 0.84, s * 0.04); c.stroke();
    c.fillStyle = '#f2c44a'; c.beginPath(); c.arc(0, s * 0.12, s * 0.14, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#c8201f'; c.fillRect(-s * 0.06, s * 0.06, s * 0.12, s * 0.12);
    c.restore();
  },
  coins(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
    c.save(); c.translate(x, y);
    for (let k = 0; k < 4; k++) {
      const yy = s * 0.3 - k * s * 0.15;
      c.fillStyle = '#b98a1c'; c.beginPath(); c.ellipse(0, yy + s * 0.04, s * 0.32, s * 0.11, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#f2c44a'; c.beginPath(); c.ellipse(0, yy, s * 0.32, s * 0.11, 0, 0, Math.PI * 2); c.fill();
    }
    c.strokeStyle = '#8a6410'; c.lineWidth = s * 0.03; c.strokeRect(-s * 0.08, -s * 0.2, s * 0.16, s * 0.08);
    c.restore();
  },
  ship(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
    c.save(); c.translate(x, y);
    c.fillStyle = '#2d4f7c'; c.beginPath(); c.moveTo(-s * 0.48, 0); c.lineTo(s * 0.48, 0); c.lineTo(s * 0.34, s * 0.24); c.lineTo(-s * 0.4, s * 0.24); c.closePath(); c.fill();
    c.fillStyle = '#f4ead2'; c.fillRect(-s * 0.26, -s * 0.2, s * 0.44, s * 0.2);
    c.fillStyle = '#d8403a'; c.fillRect(-s * 0.06, -s * 0.38, s * 0.12, s * 0.18);
    c.strokeStyle = '#3d86c6'; c.lineWidth = s * 0.04;
    c.beginPath(); for (let k = -0.5; k <= 0.5; k += 0.25) c.arc(k * s, s * 0.34, s * 0.12, Math.PI, 0); c.stroke();
    c.restore();
  },
  train(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
    c.save(); c.translate(x, y);
    c.fillStyle = '#2d6a4f'; rrect(c, -s * 0.42, -s * 0.28, s * 0.6, s * 0.44, s * 0.06); c.fill();
    c.fillStyle = '#d8403a'; c.fillRect(s * 0.18, -s * 0.1, s * 0.26, s * 0.26);
    c.fillStyle = '#333'; c.fillRect(-s * 0.3, -s * 0.44, s * 0.1, s * 0.16);
    c.fillStyle = '#cfe8f7'; c.fillRect(-s * 0.32, -s * 0.18, s * 0.16, s * 0.14); c.fillRect(-s * 0.08, -s * 0.18, s * 0.16, s * 0.14);
    c.fillStyle = '#222'; for (const k of [-0.3, 0, 0.3]) { c.beginPath(); c.arc(k * s, s * 0.22, s * 0.09, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = '#8a8a8a'; c.fillRect(-s * 0.5, s * 0.31, s, s * 0.04);
    c.restore();
  },
  plane(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
    c.save(); c.translate(x, y); c.rotate(-0.4);
    c.fillStyle = '#3a6ea5';
    c.beginPath(); c.ellipse(0, 0, s * 0.46, s * 0.08, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(-s * 0.05, 0); c.lineTo(-s * 0.2, -s * 0.4); c.lineTo(s * 0.05, -s * 0.4); c.lineTo(s * 0.15, 0); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(-s * 0.05, 0); c.lineTo(-s * 0.2, s * 0.4); c.lineTo(s * 0.05, s * 0.4); c.lineTo(s * 0.15, 0); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(-s * 0.38, 0); c.lineTo(-s * 0.5, -s * 0.18); c.lineTo(-s * 0.42, -s * 0.18); c.lineTo(-s * 0.3, 0); c.closePath(); c.fill();
    c.fillStyle = '#d8403a'; c.beginPath(); c.ellipse(s * 0.38, 0, s * 0.08, s * 0.05, 0, 0, Math.PI * 2); c.fill();
    c.restore();
  },
  bulb(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
    c.save(); c.translate(x, y);
    c.fillStyle = '#fff1a8'; c.beginPath(); c.arc(0, -s * 0.12, s * 0.3, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#c99a10'; c.lineWidth = s * 0.04; c.stroke();
    c.fillStyle = '#9a9a9a'; c.fillRect(-s * 0.13, s * 0.16, s * 0.26, s * 0.2);
    c.strokeStyle = '#666'; c.lineWidth = s * 0.03; for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(-s * 0.13, s * (0.2 + k * 0.06)); c.lineTo(s * 0.13, s * (0.22 + k * 0.06)); c.stroke(); }
    c.strokeStyle = '#e09a10'; c.lineWidth = s * 0.03; c.beginPath(); c.moveTo(-s * 0.08, s * 0.1); c.lineTo(-s * 0.04, -s * 0.12); c.lineTo(s * 0.04, -s * 0.04); c.lineTo(s * 0.08, -s * 0.2); c.stroke();
    c.restore();
  },
  drop(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
    c.save(); c.translate(x, y);
    c.fillStyle = '#3a9bdc'; c.beginPath(); c.moveTo(0, -s * 0.46);
    c.bezierCurveTo(s * 0.36, -s * 0.05, s * 0.34, s * 0.4, 0, s * 0.4); c.bezierCurveTo(-s * 0.34, s * 0.4, -s * 0.36, -s * 0.05, 0, -s * 0.46); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.6)'; c.beginPath(); c.ellipse(-s * 0.1, s * 0.08, s * 0.05, s * 0.12, 0.3, 0, Math.PI * 2); c.fill();
    c.restore();
  },
  arrow(c: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number) {
    c.save(); c.translate(x, y); c.rotate(rot);
    c.fillStyle = '#d8403a'; c.beginPath();
    c.moveTo(-s * 0.5, -s * 0.12); c.lineTo(s * 0.15, -s * 0.12); c.lineTo(s * 0.15, -s * 0.3); c.lineTo(s * 0.5, 0);
    c.lineTo(s * 0.15, s * 0.3); c.lineTo(s * 0.15, s * 0.12); c.lineTo(-s * 0.5, s * 0.12); c.closePath(); c.fill();
    c.restore();
  },
  bars(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
    c.save(); c.translate(x, y);
    c.fillStyle = '#e8d9b5'; c.fillRect(-s * 0.4, -s * 0.4, s * 0.8, s * 0.8);
    c.strokeStyle = '#3a3a3a'; c.lineWidth = s * 0.06;
    for (let k = -0.3; k <= 0.31; k += 0.15) { c.beginPath(); c.moveTo(k * s, -s * 0.4); c.lineTo(k * s, s * 0.4); c.stroke(); }
    c.lineWidth = s * 0.08; c.strokeRect(-s * 0.4, -s * 0.4, s * 0.8, s * 0.8);
    c.restore();
  },
  palm(c: CanvasRenderingContext2D, x: number, y: number, s: number) { // Bến Đỗ Tự Do: a coconut palm and a hammock
    c.save(); c.translate(x, y);
    c.strokeStyle = '#8a5a2a'; c.lineWidth = s * 0.08;
    c.beginPath(); c.moveTo(-s * 0.3, s * 0.45); c.quadraticCurveTo(-s * 0.35, 0, -s * 0.15, -s * 0.3); c.stroke();
    c.beginPath(); c.moveTo(s * 0.35, s * 0.45); c.quadraticCurveTo(s * 0.38, 0, s * 0.25, -s * 0.2); c.stroke();
    c.fillStyle = '#2f8a3a';
    for (const [px, py] of [[-0.15, -0.3], [0.25, -0.2]]) for (let a = 0; a < 5; a++) {
      c.save(); c.translate(px * s, py * s); c.rotate(-2.6 + a * 0.9);
      c.beginPath(); c.ellipse(s * 0.18, 0, s * 0.2, s * 0.05, 0, 0, Math.PI * 2); c.fill(); c.restore();
    }
    c.strokeStyle = '#d8403a'; c.lineWidth = s * 0.05; c.beginPath(); c.moveTo(-s * 0.28, s * 0.05); c.quadraticCurveTo(0, s * 0.35, s * 0.33, s * 0.08); c.stroke();
    c.restore();
  },
  cap(c: CanvasRenderingContext2D, x: number, y: number, s: number) { // Đi Tù: a khaki officer's cap with a red band
    c.save(); c.translate(x, y);
    c.fillStyle = '#5d6b2e'; c.beginPath(); c.ellipse(0, -s * 0.08, s * 0.44, s * 0.24, 0, Math.PI, 0); c.fill();
    c.fillStyle = '#c8201f'; c.fillRect(-s * 0.36, -s * 0.1, s * 0.72, s * 0.12);
    c.fillStyle = '#2a2a1a'; c.beginPath(); c.ellipse(0, s * 0.04, s * 0.42, s * 0.1, 0, 0, Math.PI); c.fill();
    c.fillStyle = '#f2c44a'; star(c, 0, -s * 0.22, s * 0.1);
    c.restore();
  },
};
export function star(c: CanvasRenderingContext2D, x: number, y: number, r: number) {
  c.beginPath();
  for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.42 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  c.closePath(); c.fill();
}
export const TILE_ICON: Record<string, string> = { ship: 'ship', train: 'train', plane: 'plane', bulb: 'bulb', drop: 'drop' };

