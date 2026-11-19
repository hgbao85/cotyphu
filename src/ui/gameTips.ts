// First-game tips for Cá Ngựa and Rắn và Thang, as Cờ Tỷ Phú's (src/ui/tips.ts): one small box the
// first time each moment comes on this screen. "Đã hiểu" puts that tip away for good, "Tắt" all of this
// game's. They are kept with Cờ Tỷ Phú's in the browser (tpdv-tips), each game's under its own prefix.
// Checks run without them (a same-seed replay draws the same), unless the address asks with ?tutorial=1.
import { params } from '../hook';
import { CHECKED } from '../core/env';
import { W, FONT, ctx, text, rrect, wrapLines } from '../screen';
import { drawButton } from './draw';
import type { Loose } from '../game/types';

const on = !CHECKED || params.get('tutorial') === '1';
const KEY = 'tpdv-tips';
const seen = new Set<string>((() => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } })());
const keep = (): void => { try { localStorage.setItem(KEY, JSON.stringify([...seen])); } catch { /* not kept: fine */ } };

/** A game's tips: prefix keeps its keys apart from the other games'. */
export function makeTips(prefix: string, tips: Record<string, string>) {
  let now: string | null = null;
  const box = (phone: boolean, boardRight: number): { x: number; y: number; w: number; h: number } =>
    (phone ? { x: 12, y: 54, w: W - 24, h: 104 } : { x: boardRight - 370, y: 16, w: 350, h: 124 });
  return {
    /** The tip shown now (for checks), or null. */
    get now(): string | null { return now; },
    /** True when a point is on the tip box shown now (a game whose board takes taps ignores them there). */
    covers(x: number, y: number, phone: boolean, boardRight: number): boolean {
      if (!now) return false;
      const b = box(phone, boardRight);
      return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
    },
    /** Builds the box's two buttons when the moment (want: a key of tips, or null) has a tip not yet seen. */
    build(want: string | null, phone: boolean, boardRight: number, btn: (x: number, y: number, w: number, h: number, label: string, fn: () => void, role: string, enabled?: boolean, color?: string) => void): void {
      now = on && want && tips[want] && !seen.has(prefix + want) ? want : null;
      if (!now) return;
      const b = box(phone, boardRight), key = prefix + now;
      btn(b.x + b.w - 214, b.y + b.h - 40, 110, 32, 'Đã hiểu', () => { seen.add(key); keep(); }, 'room', true, '');
      btn(b.x + b.w - 98, b.y + b.h - 40, 88, 32, 'Tắt', () => { for (const k of Object.keys(tips)) seen.add(prefix + k); keep(); }, 'room', true, '');
    },
    /** Draws the box over the board, with its buttons. */
    draw(phone: boolean, boardRight: number, ui: Loose[]): void {
      if (!now) return;
      const b = box(phone, boardRight);
      ctx.save(); ctx.fillStyle = 'rgba(255,248,230,0.97)'; rrect(ctx, b.x, b.y, b.w, b.h, 12); ctx.fill(); ctx.strokeStyle = '#e8a86a'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
      text('Mẹo', b.x + 14, b.y + 16, 15, '#d9622b', 'left', 'bold');
      ctx.font = `15px ${FONT}`;
      wrapLines(ctx, tips[now], b.w - 28).slice(0, 3).forEach((l, j) => text(l, b.x + 14, b.y + 38 + j * 19, 15, '#2b1d12', 'left'));
      ui.forEach(x => { if (x.label === 'Đã hiểu' || x.label === 'Tắt') drawButton(x); });
    },
  };
}
