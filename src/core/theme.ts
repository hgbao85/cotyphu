// The look of the game. "chibi" (the default) is the little-village look: a grass island on the water,
// rounded tiles, a lotus pond, pastel panels with dark brown words. "lacquer" is the earlier red-black
// sơn mài with gold, still there with ?theme=lacquer. A leaf file: it imports nothing
// from the game, so any file may read it while the modules load (docs/architecture/source-map.md).
import { params } from '../hook';

/** True when the little-village look is on. */
export const CHIBI = params.get('theme') !== 'lacquer';
if (CHIBI) document.documentElement.classList.add('chibi'); // the page's own panels (index.html: online, chat, rules)
else document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#1d120c'); // the phone's status bar

/** The 2D screens' colours in the chibi look: every dark lacquer fill becomes a light pastel and
 * every light word a dark brown, so the screens keep their layout and only their colours turn. */
const CHIBI_2D: Record<string, string> = {
  // panels, cards, the page behind them
  '#5a2a1c': '#ffd99a', '#2c140f': '#fff6e2', '#34180f': '#fbeccc', '#1d120c': '#bfe6f5', '#2a1a10': '#bfe6f5',
  'rgba(20,10,6,0.82)': 'rgba(255,249,234,0.96)', 'rgba(20,10,6,0.85)': 'rgba(255,249,234,0.96)', 'rgba(20,10,6,0.86)': 'rgba(255,249,234,0.96)',
  'rgba(20,10,6,0.8)': 'rgba(255,249,234,0.94)', 'rgba(20,10,6,0.7)': 'rgba(120,180,210,0.55)', 'rgba(20,10,6,0.72)': 'rgba(255,249,234,0.92)',
  'rgba(30,12,8,0.94)': 'rgba(255,249,234,0.97)', 'rgba(30,12,8,0.96)': 'rgba(255,249,234,0.97)', 'rgba(30,12,8,0.9)': 'rgba(255,249,234,0.95)', 'rgba(30,12,8,0.88)': 'rgba(255,249,234,0.95)',
  'rgba(40,16,10,0.85)': 'rgba(255,249,234,0.95)', 'rgba(40,14,8,0.9)': 'rgba(255,249,234,0.95)', 'rgba(10,5,3,0.35)': 'rgba(255,249,234,0.6)',
  'rgba(10,5,3,0.6)': 'rgba(70,110,130,0.35)', 'rgba(10,5,3,0.55)': 'rgba(70,110,130,0.32)', 'rgba(10,5,3,0.45)': 'rgba(70,110,130,0.28)', 'rgba(20,10,6,0.55)': 'rgba(70,110,130,0.3)',
  // words
  '#fff8e6': '#4a3020', '#e8d9b5': '#6a4a32', '#d9c8a6': '#8a6a4a', '#cbb994': '#8a6a4a', '#f2c44a': '#d9622b', '#ffe9a8': '#b0501f',
  '#ff8a7a': '#d9442b', '#ff9a8a': '#d9442b', '#7ee08a': '#2f8a3a', '#9a8a7a': '#9a8a7a',
  // buttons: pastel with dark words
  '#c8201f': '#ff9a76', '#2f8a3a': '#8fd16a', '#2b6cd6': '#8cc4f5', '#6a4a2a': '#ffe2b0', '#8a5a2a': '#ffd59a', '#6a6a6a': '#d8d0c8',
  // trims
  '#c9a24a': '#e8a86a', 'rgba(122,20,18,0.95)': 'rgba(255,170,120,0.95)', 'rgba(122,20,18,0.88)': 'rgba(255,170,120,0.92)',
};

/** Turns the 2D canvas's colours into the theme's: on the chibi look every fill and stroke set on ctx
 * goes through CHIBI_2D; gradients and colours it does not list pass as they are. */
export function themeCanvas(ctx: CanvasRenderingContext2D): void {
  if (!CHIBI) return;
  const proto = Object.getPrototypeOf(ctx);
  for (const key of ['fillStyle', 'strokeStyle'] as const) {
    const d = Object.getOwnPropertyDescriptor(proto, key)!;
    Object.defineProperty(ctx, key, {
      get() { return d.get!.call(this); },
      set(v: unknown) { d.set!.call(this, typeof v === 'string' ? (CHIBI_2D[v] ?? v) : v); },
    });
  }
}
