// The results screen's party: confetti falling over the card, and every player's animal hopping for
// joy around the winner's. The chibi look throws pastel hearts, stars and dots; the sơn mài look keeps
// its strips in the players' colours.
import { ctx } from '../screen';
import { state } from '../core/store';
import { PLAYER_COLORS } from '../game/data';
import { CHIBI } from '../core/theme';
import { prefs } from '../core/prefs';
import { drawTokenIcon } from './draw';

const PASTELS = ['#ff9ec4', '#ffd84a', '#8fd16a', '#8cc4f5', '#ffb59a', '#c9a8f5'];

/** A heart centred on (0, 0), about 2r across. */
function heart(r: number) {
  ctx.beginPath(); ctx.moveTo(0, r * 0.9);
  ctx.bezierCurveTo(-r * 1.4, -r * 0.1, -r * 0.6, -r * 1.2, 0, -r * 0.35);
  ctx.bezierCurveTo(r * 0.6, -r * 1.2, r * 1.4, -r * 0.1, 0, r * 0.9); ctx.fill();
}
/** A five-pointed star centred on (0, 0). */
function star(r: number) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, d = k % 2 ? r * 0.45 : r; ctx.lineTo(Math.cos(a) * d, Math.sin(a) * d); }
  ctx.closePath(); ctx.fill();
}
/**
 * Confetti falling inside a box: n pieces, each looping from the top to the bottom.
 * @example confetti(BW / 2 - 300, 80, 600, 560, 40)
 */
export function confetti(x: number, y: number, w: number, h: number, n: number) {
  if (!prefs.effects) return;
  for (let k = 0; k < n; k++) {
    const px = x + ((k * 137) % w), py = y + ((k * 53 + state.t * 90 * (1 + (k % 3))) % h);
    ctx.save(); ctx.translate(px + Math.sin(state.t * 2 + k) * 6, py); ctx.rotate(k + state.t * 3);
    if (!CHIBI) { ctx.fillStyle = PLAYER_COLORS[k % 4]; ctx.fillRect(-5, -2, 10, 4); ctx.restore(); continue; }
    ctx.fillStyle = PASTELS[k % PASTELS.length];
    const shape = k % 3, r = 5 + (k % 4);
    if (shape === 0) heart(r); else if (shape === 1) star(r); else { ctx.beginPath(); ctx.arc(0, 0, r * 0.7, 0, 7); ctx.fill(); }
    ctx.restore();
  }
}
/**
 * The winner's animal in the middle, hopping, with the other players' animals hopping round it,
 * every face smiling.
 * @param cx the winner's centre; cy where the animals stand; spread how far apart they stand.
 */
export function partyAnimals(cx: number, cy: number, spread: number) {
  const win = state.players[state.ranking![0].i];
  const others = state.ranking!.slice(1).map(r => state.players[r.i]);
  const hop = (k: number) => (prefs.effects ? -Math.abs(Math.sin(state.t * 5 + k * 1.3)) * 14 : 0); // a bouncy hop, each to its own beat
  others.forEach((p, j) => { // to the left and right in turn, the nearest first
    const side = j % 2 ? 1 : -1, ring = Math.floor(j / 2) + 1, x = cx + side * spread * ring, y = cy + 14 + hop(j + 1);
    ctx.save(); ctx.fillStyle = '#f4ead2'; ctx.globalAlpha = 0.95; ctx.beginPath(); ctx.arc(x, y, 26, 0, 7); ctx.fill(); ctx.restore();
    drawTokenIcon(p.token, x, y + 2, 44, p.color, 'happy');
  });
  const y = cy + hop(0) * 0.7;
  ctx.fillStyle = '#f4ead2'; ctx.beginPath(); ctx.arc(cx, y, 44, 0, 7); ctx.fill();
  drawTokenIcon(win.token, cx, y + 3, 72, win.color, 'happy');
}
