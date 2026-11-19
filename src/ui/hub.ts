// The hub: the first screen after the splash. Sự Thảy is a table of dice games; each has a big card,
// and a tap opens that game's own setup screen. A game still to come shows as a faded card.
// ?game=typhu or ?game=cangua in the address skips the hub (main.ts), for a shared link or a check.

import { W, H, FONT, ctx, text, rrect, clear } from '../screen';
import { setScene } from '../core/store';
import { F } from '../core/flags';
import { prefs } from '../core/prefs';
import { sfx } from '../audio';
import { btn, clicks, pointer, pressed, L } from '../main';
import { drawButton, drawTokenIcon } from './draw';
import { openSettings } from './settings';
import { SIDES } from '../ludo/game';

/** The games on the table: their scene, name, a line about them, and whether they are ready. */
const GAMES = [
  { scene: 'title', name: 'Cờ Tỷ Phú', line: 'Mua đất 22 tỉnh thành, xây nhà tới Landmark, thu tiền thuê', who: '2–4 người · online', ready: true },
  { scene: 'ludoSetup', name: 'Cá Ngựa', line: 'Đua 4 chú ngựa về chuồng, đá ngựa đối thủ, lên bậc thang', who: '2–4 người · online', ready: true },
  { scene: '', name: 'Sắp có thêm', line: 'Bầu Cua, Rắn và Thang, Xì Xúc Xắc...', who: 'đang làm', ready: false },
];
let t = 0;

/** Where each game's card sits. */
function cardRect(k: number): { x: number; y: number; w: number; h: number } {
  if (L.phone) { const h = Math.min(220, (H - 250) / 3 - 14); return { x: 16, y: 200 + k * (h + 14), w: W - 32, h }; }
  return { x: 100 + k * 370, y: 230, w: 340, h: 380 };
}
function open(k: number): void {
  const g = GAMES[k];
  if (!g.ready) return;
  sfx.click(); F.picker = null; F.netError = '';
  setScene(g.scene);
}
function build(): void {
  F.ui = [];
  GAMES.forEach((g, k) => { const r = cardRect(k); btn(r.x, r.y, r.w, r.h, '', () => open(k), 'hidden', g.ready); });
  btn(L.phone ? 12 : 24, L.phone ? 8 : 20, 92, 32, 'Cài đặt', openSettings, 'room', true, '');
}
function input(): void {
  for (const c of clicks) { const b = F.ui.find(x => c.x >= x.x && c.x <= x.x + x.w && c.y >= x.y && c.y <= x.y + x.h); if (b && b.enabled) b.fn(); }
  clicks.length = 0;
  if (pressed('Digit1') || pressed('Enter')) open(0);
  if (pressed('Digit2')) open(1);
}

/** A little house, roof and door, for Cờ Tỷ Phú's card. */
function house(x: number, y: number, s: number, wall: string, roof: string): void {
  ctx.fillStyle = wall; rrect(ctx, x - s * 0.4, y - s * 0.35, s * 0.8, s * 0.7, s * 0.08); ctx.fill();
  ctx.fillStyle = roof; ctx.beginPath(); ctx.moveTo(x - s * 0.55, y - s * 0.3); ctx.lineTo(x, y - s * 0.78); ctx.lineTo(x + s * 0.55, y - s * 0.3); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#8b5a2b'; rrect(ctx, x - s * 0.1, y, s * 0.2, s * 0.35, s * 0.05); ctx.fill();
}
function coin(x: number, y: number, r: number): void {
  ctx.fillStyle = '#e8a82a'; ctx.beginPath(); ctx.ellipse(x, y + r * 0.15, r, r * 0.95, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#ffd84a'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  ctx.fillStyle = '#e8a82a'; ctx.font = `bold ${Math.round(r)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('đ', x, y + 1);
}
/** A cream die with paw-print pips. */
function die(x: number, y: number, s: number, n: number, rot: number): void {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = 'rgba(40,60,30,0.2)'; rrect(ctx, -s / 2 + 3, -s / 2 + 6, s, s, s * 0.22); ctx.fill();
  ctx.fillStyle = '#fffaf0'; rrect(ctx, -s / 2, -s / 2, s, s, s * 0.22); ctx.fill(); ctx.strokeStyle = '#d9a86a'; ctx.lineWidth = 2; ctx.stroke();
  const P: Record<number, number[][]> = { 3: [[-1, -1], [0, 0], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
  ctx.fillStyle = n === 6 ? '#d9442b' : '#5a3a26';
  for (const [dx, dy] of P[n] || [[0, 0]]) { const px = dx * s * 0.27, py = dy * s * 0.27, r = s * 0.1; ctx.beginPath(); ctx.ellipse(px, py + r * 0.25, r * 0.55, r * 0.45, 0, 0, 7); ctx.fill(); for (const [a, b] of [[-0.55, -0.45], [0, -0.72], [0.55, -0.45]]) { ctx.beginPath(); ctx.arc(px + a * r, py + b * r, r * 0.22, 0, 7); ctx.fill(); } }
  ctx.restore();
}
function drawCard(k: number): void {
  const g = GAMES[k], r = cardRect(k), hover = g.ready && pointer.x >= r.x && pointer.x <= r.x + r.w && pointer.y >= r.y && pointer.y <= r.y + r.h;
  const lift = hover ? 6 : 0, bob = prefs.effects ? Math.sin(t * 2 + k) * 3 : 0;
  ctx.save(); ctx.globalAlpha = g.ready ? 1 : 0.55;
  ctx.fillStyle = 'rgba(40,90,110,0.18)'; rrect(ctx, r.x + 5, r.y + 9, r.w, r.h, 22); ctx.fill();
  const y = r.y - lift;
  const grd = ctx.createLinearGradient(0, y, 0, y + r.h); grd.addColorStop(0, '#fffaf0'); grd.addColorStop(1, g.ready ? '#fbe6c4' : '#eee6da');
  ctx.fillStyle = grd; rrect(ctx, r.x, y, r.w, r.h, 22); ctx.fill();
  ctx.strokeStyle = hover ? '#d9622b' : '#e8a86a'; ctx.lineWidth = hover ? 4 : 3; ctx.stroke();
  // the picture
  const phone = L.phone, px = phone ? r.x + r.h * 0.5 : r.x + r.w / 2, py = phone ? y + r.h / 2 : y + 120, s = phone ? r.h * 0.55 : 110;
  ctx.fillStyle = g.ready ? '#c8ecd0' : '#e6e0d6'; ctx.beginPath(); ctx.ellipse(px, py + s * 0.35, s * 0.85, s * 0.28, 0, 0, 7); ctx.fill();
  if (k === 0) {
    house(px - s * 0.35, py + bob * 0.3, s * 0.6, '#ffb59a', '#d9442b'); house(px + s * 0.3, py - s * 0.05, s * 0.75, '#8cc4f5', '#2b6cd6');
    coin(px - s * 0.6, py + s * 0.3 + bob, s * 0.13); coin(px + s * 0.66, py + s * 0.24 - bob, s * 0.13);
  } else if (k === 1) {
    for (let h = 0; h < 4; h++) {
      const hx = px + (h - 1.5) * s * 0.42, hy = py + s * 0.1 - (prefs.effects ? Math.abs(Math.sin(t * 4 + h * 0.9)) * s * 0.18 : 0);
      ctx.fillStyle = SIDES[h].dark; ctx.beginPath(); ctx.arc(hx, hy + s * 0.04, s * 0.2, 0, 7); ctx.fill();
      ctx.fillStyle = SIDES[h].color; ctx.beginPath(); ctx.arc(hx, hy, s * 0.2, 0, 7); ctx.fill();
      drawTokenIcon(6, hx, hy, s * 0.36, SIDES[h].color, 'happy');
    }
  } else {
    die(px - s * 0.3, py, s * 0.42, 5, -0.3 + bob * 0.02); die(px + s * 0.3, py - s * 0.06, s * 0.42, 3, 0.25 - bob * 0.02);
  }
  if (k < 2) die(phone ? px + s * 0.62 : px + s * 0.85, (phone ? py - s * 0.32 : py - s * 0.55) + bob, phone ? s * 0.34 : s * 0.36, k === 0 ? 6 : 5, 0.3 + (prefs.effects ? Math.sin(t * 1.5 + k) * 0.15 : 0));
  // the words
  const tx = phone ? r.x + r.h + 10 : r.x + r.w / 2, al: CanvasTextAlign = phone ? 'left' : 'center';
  text(g.name, tx, phone ? y + r.h * 0.26 : y + 215, phone ? 26 : 32, g.ready ? '#d9622b' : '#8a6a4a', al, 'bold');
  ctx.font = `${phone ? 15 : 17}px ${FONT}`;
  const words = g.line.split(' '), lines: string[] = []; let cur = '';
  const maxW = phone ? r.w - r.h - 20 : r.w - 40;
  for (const wd of words) { const tt = cur ? cur + ' ' + wd : wd; if (ctx.measureText(tt).width > maxW && cur) { lines.push(cur); cur = wd; } else cur = tt; }
  lines.push(cur);
  lines.slice(0, phone ? 3 : 2).forEach((l, j) => text(l, tx, (phone ? y + r.h * 0.5 : y + 252) + j * (phone ? 20 : 23), phone ? 15 : 17, '#6a4a32', al));
  if (g.ready) {
    const bw = phone ? 0 : 200;
    if (!phone) { ctx.fillStyle = hover ? '#ff8a66' : '#ff9a76'; rrect(ctx, r.x + r.w / 2 - bw / 2, y + r.h - 64, bw, 46, 14); ctx.fill(); text('Chơi', r.x + r.w / 2, y + r.h - 40, 21, '#4a3020', 'center', 'bold'); }
    text(g.who, tx, phone ? y + r.h * 0.84 : y + 302, phone ? 14 : 15, '#8a6a4a', al, 'bold');
  } else text(g.who, tx, phone ? y + r.h * 0.84 : y + r.h - 50, 16, '#8a6a4a', al, 'bold');
  ctx.restore();
}

/** The hub's scene, for main.ts's table. */
export const hubScene = {
  update(dt: number) { t += dt; build(); input(); },
  draw() {
    clear('#bfe6f5');
    if (prefs.effects) { // ripples on the water
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
      for (let k = 0; k < 9; k++) { const x = (k * 167 + t * 14) % W, y = 40 + ((k * 113) % (H - 80)); ctx.beginPath(); ctx.arc(x, y, 10 + (k % 3) * 5, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
      ctx.restore();
    }
    // the grass island the cards sit on
    ctx.fillStyle = '#8fcf68'; rrect(ctx, L.phone ? 6 : 50, L.phone ? 60 : 50, L.phone ? W - 12 : W - 100, L.phone ? H - 80 : H - 90, 60); ctx.fill();
    ctx.fillStyle = '#a8dc7a'; rrect(ctx, L.phone ? 14 : 60, L.phone ? 68 : 60, L.phone ? W - 28 : W - 120, L.phone ? H - 96 : H - 110, 54); ctx.fill();
    const ty = L.phone ? 110 : 120;
    text('SỰ THẢY', W / 2, ty, L.phone ? 46 : 64, '#d9622b', 'center', 'bold');
    die(W / 2 + (L.phone ? 128 : 178), ty - 10 + (prefs.effects ? Math.sin(t * 3) * 4 : 0), L.phone ? 34 : 46, 6, prefs.effects ? Math.sin(t * 1.7) * 0.3 : 0.2);
    text('Góc board game của cả nhà · mọi ván đều bắt đầu bằng cú thảy xúc xắc', W / 2, ty + (L.phone ? 44 : 56), L.phone ? 14 : 19, '#4a3020');
    GAMES.forEach((_, k) => drawCard(k));
    F.ui.forEach(b => { if (b.role !== 'hidden') drawButton(b); });
  },
};
