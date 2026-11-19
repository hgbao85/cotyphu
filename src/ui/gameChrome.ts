// The frame Cá Ngựa and Rắn và Thang draw around their boards, laid out as Cờ Tỷ Phú's: the speed
// button under the speaker, the history beside "Diễn biến", the phone's strip under the board with
// its row of buttons, and the results card sized to the players with its "Tổng kết ván".
import { W, H, ctx, text, rrect, FONT, wrapLines } from '../screen';
import { icon } from '../draw/icons';
import type { OrderState } from '../game/orderRoll';

/** The wide screen's speed button: under the speaker, where Cờ Tỷ Phú's is. */
export const wideSpeedSpot = (): { x: number; y: number; w: number; h: number } => ({ x: W - 60, y: 48, w: 48, h: 26 });
/** The phone's row of buttons at the foot of the screen: the history left, the speed right (as Cờ Tỷ Phú's). */
export const phoneRow = (): { y: number; h: number; left: number; right: number; w: number } => ({ y: H - 100, h: 44, left: 12, right: W - 116, w: 104 });

/** The results card for n players: tall enough for its rows and buttons, no more; over the board (cx:
 * its centre), so the panel's "Tổng kết ván" shows beside it as in Cờ Tỷ Phú. by: its buttons' top. */
export function resultsBox(n: number, phone: boolean, cx: number): { x: number; y: number; w: number; h: number; by: number; cx: number } {
  const w = phone ? W - 24 : Math.min(640, cx * 2 - 40), h = 300 + n * 52, x = (phone ? W / 2 : cx) - w / 2;
  const y = phone ? Math.max(60, H / 2 - h / 2 - 40) : Math.max(40, 340 - h / 2);
  return { x, y, w, h, by: y + h - 74, cx: x + w / 2 };
}

/** The player with the most of something, and how many, or null when nobody has any. */
export function mostOf<T>(list: T[], count: (p: T) => number): { p: T; n: number } | null {
  let best: { p: T; n: number } | null = null;
  for (const p of list) { const n = count(p); if (n > 0 && (!best || n > best.n)) best = { p, n }; }
  return best;
}

/** "Tổng kết ván" in the side panel, as Cờ Tỷ Phú's after a game: a title and a few lines. */
export function drawSummary(x: number, y: number, w: number, lines: string[]): void {
  ctx.save(); ctx.fillStyle = 'rgba(255,246,226,0.9)'; rrect(ctx, x, y, w, 40 + lines.length * 26, 12); ctx.fill();
  ctx.strokeStyle = '#e8c9a0'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
  text('Tổng kết ván', x + w / 2, y + 20, 18, '#d9622b', 'center', 'bold');
  ctx.save(); ctx.font = `15px ${FONT}`;
  lines.forEach((l, j) => text(wrapLines(ctx, l, w - 24)[0], x + w / 2, y + 48 + j * 26, 15, '#4a3020', 'center'));
  ctx.restore();
}

/** On a player's card while everyone throws for the order (as Cờ Tỷ Phú's order table): its throw on a
 * little die at the card's right, "..." while it throws, "chờ" before; a crown on the highest so far. */
export function drawOrderMark(o: OrderState, i: number, cur: boolean, x: number, y: number, w: number, h: number): void {
  const v = o.throws[i], thrown = o.throws.filter((t): t is number => t !== null), best = thrown.length ? Math.max(...thrown) : -1;
  const s = Math.min(36, h * 0.6), cx = x + w - s / 2 - 12, cy = y + h / 2;
  if (v === null) { text(cur ? '...' : 'chờ', cx, cy, 14, '#9a7a5a', 'center', 'bold'); return; }
  ctx.save(); ctx.fillStyle = '#ffffff'; rrect(ctx, cx - s / 2, cy - s / 2, s, s, 8); ctx.fill(); ctx.strokeStyle = '#d2a878'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
  text(String(v), cx, cy + 1, Math.round(s * 0.55), '#d9622b', 'center', 'bold');
  if (v === best) icon.crown(ctx, cx, cy - s / 2 - 4, 16);
}

/** The power gauge's radius in every game, so aiming is as hard in each (a bigger gauge is a wider sweet zone). */
export const GAUGE_R = 110;
/**
 * The power gauge, in the middle of the board while this screen's player throws (all four games): a half
 * circle from the left (no power) over the top to the right (full power), the sweet zone a gold stretch on it,
 * the power a coloured stretch from the left up to where it stands (no needle: asked 19/11/2026). It shows as soon as it is the player's throw (idle: the needle at the
 * start, "Giữ nút để lắc"), so the zone can be seen before the button is held; held, the colour runs up
 * and down and the words say "Thả ngay!" over the zone, else the seconds left.
 */
export function drawGauge(cx: number, cy: number, pos: number, zone: { a: number; b: number } | null | undefined, idle: boolean, left: number): void {
  const r = GAUGE_R, lw = r * 0.2, ang = (p: number) => Math.PI + Math.max(0, Math.min(1, p)) * Math.PI;
  ctx.save();
  ctx.fillStyle = 'rgba(255,249,234,0.88)'; // a soft half disc behind it, so it reads on any board
  ctx.beginPath(); ctx.arc(cx, cy, r + lw * 0.9, Math.PI, 2 * Math.PI); ctx.lineTo(cx + r + lw * 0.9, cy + 26); ctx.lineTo(cx - r - lw * 0.9, cy + 26); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#e8c9a0'; ctx.lineWidth = 2; ctx.stroke();
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#efe2c8'; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI); ctx.stroke(); // the track
  if (zone) { // the sweet zone: gold, outlined
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#c98f0a'; ctx.lineWidth = lw + 8; ctx.beginPath(); ctx.arc(cx, cy, r, ang(zone.a), ang(zone.b)); ctx.stroke();
    ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = lw + 2; ctx.beginPath(); ctx.arc(cx, cy, r, ang(zone.a), ang(zone.b)); ctx.stroke();
    ctx.lineCap = 'round';
  }
  if (!idle && pos > 0.005) { // how far the power has come: green to red, over the track and the zone, its tip marked
    const g = ctx.createLinearGradient(cx - r, 0, cx + r, 0); g.addColorStop(0, '#8fd16a'); g.addColorStop(0.6, '#ffd84a'); g.addColorStop(1, '#ff7b6b');
    ctx.strokeStyle = g; ctx.lineWidth = lw * 0.7; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, ang(pos)); ctx.stroke();
    const a = ang(pos);
    ctx.fillStyle = '#fff8e6'; ctx.strokeStyle = '#4a3020'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, lw * 0.42, 0, 7); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
  const hit = !idle && zone && pos >= zone.a && pos <= zone.b;
  text(idle ? 'Giữ nút để lắc' : hit ? 'Thả ngay!' : `còn ${Math.max(0, Math.ceil(left))} giây`, cx, cy - r * 0.3, idle ? 17 : 20, hit ? '#c98f0a' : '#4a3020', 'center', 'bold');
  if (idle && zone) text('thả trúng vùng vàng: may hơn', cx, cy - r * 0.3 + 22, 13, '#8a6a4a', 'center');
}
