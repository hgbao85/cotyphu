// The end-of-game summary: who collected most rent, the tile that hurt most, the unluckiest.

import { ctx, text, rrect } from '../screen';

import { TILES } from '../game/data';

import { state } from '../core/store';

import { money } from '../game/rules';

import { fitText } from './setupScreen';

// ---- The end-of-game summary --------------------------------------------------------------------------
/** A few lines about the game just played: who collected most rent, the tile that hurt most, the unluckiest. */
function summaryLines(): string[] {
  const st = state.stats;
  if (!st) return [];
  const name = (seat: number) => state.players.find(p => p.id === seat)?.name ?? '';
  const best = (a: number[]) => a.reduce((b, v, k) => (v > a[b] ? k : b), 0);
  const out: string[] = [];
  const g = best(st.got), pd = best(st.paid);
  if (st.got[g] > 0) out.push(`Thu tiền thuê nhiều nhất: ${name(g)} (${money(st.got[g])})`);
  const tiles = Object.entries(st.tile).sort((a, b) => b[1] - a[1]);
  if (tiles.length) out.push(`Ô đáng sợ nhất: ${TILES[Number(tiles[0][0])].n} (thu ${money(tiles[0][1])})`);
  if (st.paid[pd] > 0) out.push(`Xui nhất: ${name(pd)} (trả ${money(st.paid[pd])} tiền thuê)`);
  return out;
}
export function drawSummary(x: number, y: number, w: number, minH = 0) {
  const lines = summaryLines();
  if (!lines.length) return;
  const h = Math.max(minH, 48 + lines.length * 30);
  ctx.save(); ctx.fillStyle = '#2c140f'; rrect(ctx, x, y, w, h, 12); ctx.fill(); ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
  text('Tổng kết ván', x + w / 2, y + 22, 18, '#f2c44a', 'center', 'bold');
  lines.forEach((l, j) => fitText(l, x + w / 2, y + 52 + j * 30, w - 20, 16, '#fff8e6', ''));
}

