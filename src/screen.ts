// The 2D canvas: a 1280x720 logical screen that fills the window, and the drawing helpers the
// HUD, popups and buttons use. The 3D board is drawn into it each frame by main.ts.

/** The logical size: 1280x720 on a wide screen, 480x960 on a phone held upright (setLogical). */
export let W = 1280, H = 720;
/** The board view's width on a wide screen; the HUD panel fills the rest. */
export const BW = 900;

/** Changes the logical size; fit() applies it. */
export function setLogical(w: number, h: number): void {
  W = w; H = h;
}
const PIXEL = false;
export const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

export const canvas = document.getElementById('game') as HTMLCanvasElement;
export const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

/** Device pixels per logical pixel, after the last fit(). */
export let screenScale = 1;

const onFit: Array<() => void> = [];
/** Runs f after every resize (the 3D renderer resizes with the canvas). */
export function afterFit(f: () => void): void {
  onFit.push(f);
}

const beforeFitFns: Array<() => void> = [];
/** Runs f at the start of every fit(), before the size is read (the layout picks W and H). */
export function beforeFit(f: () => void): void {
  beforeFitFns.push(f);
}

/** Fills the window at any size and pixel ratio. */
export function fit(): void {
  beforeFitFns.forEach(f => f());
  const k = Math.min(innerWidth / W, innerHeight / H);
  const s = PIXEL ? Math.max(1, Math.floor(k)) : k;
  const r = PIXEL ? 1 : s * (devicePixelRatio || 1);
  canvas.width = Math.round(W * r); canvas.height = Math.round(H * r);
  canvas.style.width = Math.round(W * s) + 'px'; canvas.style.height = Math.round(H * s) + 'px';
  canvas.style.marginTop = Math.max(0, Math.floor((innerHeight - H * s) / 2)) + 'px';
  canvas.style.imageRendering = PIXEL ? 'pixelated' : 'auto';
  ctx.setTransform(r, 0, 0, r, 0, 0); ctx.imageSmoothingEnabled = !PIXEL;
  screenScale = r;
  onFit.forEach(f => f());
}
addEventListener('resize', fit);

/** Fills the whole screen with colour c. */
export function clear(c: string): void {
  ctx.fillStyle = c; ctx.fillRect(0, 0, W, H);
}

/** One line of text, middle-aligned on y. */
export function text(s: string, x: number, y: number, size: number, c: string, align: CanvasTextAlign = 'center', weight = ''): void {
  ctx.fillStyle = c; ctx.font = `${weight} ${size}px ${FONT}`; ctx.textAlign = align;
  ctx.textBaseline = 'middle'; ctx.fillText(s, x, y);
}

/** A rounded-rectangle path on c (fill or stroke it after). */
export function rrect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

/** Splits s into lines that fit maxW in c's current font. */
export function wrapLines(c: CanvasRenderingContext2D, s: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of String(s).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const t = line ? line + ' ' + word : word;
      if (c.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}
