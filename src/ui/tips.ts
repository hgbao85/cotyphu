// First-game tips: one small box the first time each moment comes on this screen.

import { params } from '../hook';

import { W, BW, FONT, ctx, text, rrect, wrapLines } from '../screen';

import { state, scene } from '../core/store';

import { owned, curP } from '../game/turn';

import { F } from '../core/flags';
import { humanTurn, L, btn } from '../main';
import { drawButton } from './draw';
import { CHECKED } from '../core/env';

// ---- First-game tips -----------------------------------------------------------------------------------
// A small box with one tip, the first time each moment comes on this screen (the first throw, the first
// land to buy...). "Đã hiểu" puts it away for good, "Tắt hướng dẫn" puts them all away. Checks run without
// them (so a same-seed replay draws the same), unless the address asks with ?tutorial=1.
const TIPS: Record<string, string> = {
  roll: 'Giữ nút đỏ để lắc xúc xắc, thả ra để ném. Giữ càng lâu, xúc xắc lăn càng mạnh.',
  buy: 'Mua đất để thu tiền thuê khi người khác dẫm vào. Gom đủ cả nhóm màu thì tiền thuê nhân đôi.',
  inspect: 'Bấm vào một ô bất kỳ trên bàn cờ để xem giá, tiền thuê, đặc sản và chủ của ô.',
  build: 'Dẫm lại đất của mình thì được xây thêm 1 cấp: nhà, khách sạn, rồi Landmark.',
  debt: 'Thiếu tiền: bán bớt nhà hoặc cầm cố đất ở danh sách tài sản, rồi bấm Trả nợ.',
  jail: 'Ở tù: đổ được đôi thì ra ngay. Ở đủ 3 lượt thì lượt sau được ra.',
};
const tipsOn = !CHECKED || params.get('tutorial') === '1';
const tipsSeen = new Set<string>((() => { try { return JSON.parse(localStorage.getItem('tpdv-tips') || '[]'); } catch { return []; } })());
export let tipNow: string | null = null;
function keepTipsSeen() { try { localStorage.setItem('tpdv-tips', JSON.stringify([...tipsSeen])); } catch { /* not kept: fine */ } }
/** The tip this moment calls for, if this screen has not seen it. */
function tipFor(): string | null {
  if (!tipsOn || scene !== 'play' || !state.players || state.ordering || !humanTurn()) return null;
  const p = curP(), pi = state.cur;
  const want = state.phase === 'roll' && !state.shaking ? (tipsSeen.has('roll') && owned(pi).length ? 'inspect' : 'roll')
    : state.phase === 'buy' ? 'buy' : state.phase === 'build' ? 'build' : state.phase === 'debt' ? 'debt' : state.phase === 'jail' && p.inJail ? 'jail' : null;
  return want && !tipsSeen.has(want) ? want : null;
}
/** Where the tip box sits: the board's top right on a wide screen, under the toolbar on a phone. */
function tipBox(): { x: number; y: number; w: number; h: number } {
  return L.phone ? { x: 12, y: L.by + 44, w: W - 24, h: 104 } : { x: BW - 360, y: 64, w: 350, h: 124 };
}
export function buildTip() {
  tipNow = tipFor();
  if (!tipNow) return;
  const b = tipBox(), key = tipNow;
  btn(b.x + b.w - 214, b.y + b.h - 40, 110, 32, 'Đã hiểu', () => { tipsSeen.add(key); keepTipsSeen(); }, 'room');
  btn(b.x + b.w - 98, b.y + b.h - 40, 88, 32, 'Tắt', () => { for (const k of Object.keys(TIPS)) tipsSeen.add(k); keepTipsSeen(); }, 'room');
}
export function drawTip() {
  if (!tipNow) return;
  const b = tipBox();
  ctx.save(); ctx.fillStyle = 'rgba(255,248,230,0.97)'; rrect(ctx, b.x, b.y, b.w, b.h, 12); ctx.fill(); ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
  text('Mẹo', b.x + 14, b.y + 16, 15, '#8a3a24', 'left', 'bold');
  ctx.font = `15px ${FONT}`;
  wrapLines(ctx, TIPS[tipNow], b.w - 28).slice(0, 3).forEach((l, j) => text(l, b.x + 14, b.y + 38 + j * 19, 15, '#2b1d12', 'left'));
  F.ui.forEach(x => { if (x.label === 'Đã hiểu' || (x.label === 'Tắt' && x.role === 'room')) drawButton(x); });
}

