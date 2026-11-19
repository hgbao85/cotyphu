// Playwright: turning and zooming the board, in all four games (src/ui/viewGestures.ts, src/ui/viewButtons.ts,
// src/three/orbitView.ts, src/three/board3d.ts). The single-file build is opened from disk and stepped by
// hand (?manual=1); the mouse drags and wheels on the canvas as a player's would.
import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const build = (query: string): string => `${pathToFileURL(resolve('dist-single/index.html')).href}?${query}`;
type BoardView = { yaw: number; pitch: number; zoom: number; home: boolean; rect: { x: number; y: number; w: number; h: number } } | null;
type G = {
  configure(o: unknown): void; configureCaro(o: unknown): void; configureSnake(o: unknown): void; configureLudo(o: unknown): void;
  press(c: string): void; step(n?: number, d?: boolean): void; scene: string; boardView: BoardView; setBoardView(o: unknown): void;
  caro: { cur: number; size: number; board: number[]; moves: number; phase: string }; caroSpot(cell: number): { x: number; y: number };
  view: { buttons: { label: string; x: number; y: number; w: number; h: number }[]; inspect: number };
};
const game = (page: Page) => ({ eval: <T>(f: (g: G) => T) => page.evaluate(`(${f.toString()})(window.game)`) as Promise<T> });

async function open(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(build(query));
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  return errors;
}
/** A point of the layout on the page (1280 across wide, 480 on a phone). */
async function onPage(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const b = (await page.locator('#game').boundingBox())!, w = b.width > b.height ? 1280 : 480, k = b.width / w;
  return { x: b.x + x * k, y: b.y + y * k };
}
async function drag(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const a = await onPage(page, x0, y0), b = await onPage(page, x1, y1);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8);
  await page.mouse.up();
}
async function tapLabel(page: Page, label: string): Promise<void> {
  const b = await game(page).eval(g => g.view.buttons);
  const it = b.find(x => x.label === label);
  expect(it, `button ${label}`).toBeTruthy();
  const p = await onPage(page, it!.x + it!.w / 2, it!.y + it!.h / 2);
  await page.mouse.click(p.x, p.y);
}
const view = (page: Page): Promise<BoardView> => game(page).eval(g => g.boardView);
const steps = (page: Page, n: number): Promise<void> => page.evaluate(k => window.game!.step(k), n);

/** Each game, started with computers and nobody throwing for the order. */
const STARTS: Record<string, string> = {
  caro: "g.configure({ tune: { order_roll: 0 } }); g.configureCaro({ seats: [{ kind: 'ai', lv: 1, animal: 4 }, { kind: 'ai', lv: 1, animal: 9 }] }); g.step(1); g.press('Enter'); g.step(1); g.step(200);",
  snake: "g.configure({ tune: { order_roll: 0 } }); g.configureSnake({ seats: [{ kind: 'ai', animal: 2 }, { kind: 'ai', animal: 8 }, { kind: 'off', animal: 3 }, { kind: 'off', animal: 11 }] }); g.step(1); g.press('Enter'); g.step(1); g.step(200);",
  ludo: "g.configure({ tune: { order_roll: 0 } }); g.configureLudo({ seats: [{ kind: 'ai', lv: 1, animal: 0 }, { kind: 'ai', lv: 1, animal: 4 }, { kind: 'off' }, { kind: 'off' }] }); g.step(1); g.press('Enter'); g.step(1); g.step(200);",
  play: "g.configure({ seats: [{ kind: 'ai', lv: 1 }, { kind: 'ai', lv: 1 }, { kind: 'off' }, { kind: 'off' }], seed: 3 }); g.step(1); g.press('Enter'); g.step(1); g.step(200);",
};

for (const [scene, start] of Object.entries(STARTS)) {
  test(`${scene}: a drag turns the board, the wheel zooms, ↻ turns a quarter and "Gốc" brings it back`, async ({ page }) => {
    const errors = await open(page, 'manual=1&seed=5');
    await page.evaluate(`(g => { ${start} })(window.game)`);
    expect(await game(page).eval(g => g.scene)).toBe(scene);
    const v0 = (await view(page))!;
    expect(v0).toMatchObject({ yaw: 0, zoom: 1, home: true });
    const cx = v0.rect.x + v0.rect.w / 2, cy = v0.rect.y + v0.rect.h / 2;
    await drag(page, cx, cy, cx + 120, cy + 40);                     // turned and tilted
    await steps(page, 2);
    const v1 = (await view(page))!;
    expect(v1.yaw).toBeLessThan(-0.3);
    expect(v1.home).toBe(false);
    const p = await onPage(page, cx, cy);
    await page.mouse.move(p.x, p.y); await page.mouse.wheel(0, -100); // zoomed in about the pointer (the wheel event arrives on its own time)
    await expect.poll(async () => { await steps(page, 1); return (await view(page))!.zoom; }, { timeout: 5000 }).toBeGreaterThan(1.05);
    await tapLabel(page, 'Gốc'); await steps(page, 120);             // back, eased
    expect((await view(page))!.home).toBe(true);
    await tapLabel(page, '↻'); await steps(page, 120);
    expect(Math.sin((await view(page))!.yaw)).toBeCloseTo(1, 3);      // a quarter turn
    expect(errors).toEqual([]);
  });
}

test('Cờ Caro: a drag across the board on your turn places nothing; after turning and zooming, a tap still lands on the cell under it', async ({ page }) => {
  const errors = await open(page, 'manual=1&seed=5');
  await page.evaluate(() => {
    const g = window.game as unknown as G;
    g.configure({ tune: { order_roll: 0 } }); g.configureCaro({ seats: [{ kind: 'human', animal: 4 }, { kind: 'human', animal: 9 }] });
    g.step(1); g.press('Enter'); g.step(1); g.step(30);
  });
  const v0 = (await view(page))!;
  await drag(page, v0.rect.w / 2, v0.rect.h / 2, v0.rect.w / 2 + 150, v0.rect.h / 2);
  await steps(page, 30);
  expect((await game(page).eval(g => g.caro)).moves).toBe(0);        // a drag is no move
  await game(page).eval(g => { g.setBoardView({ yaw: 2.2, zoom: 2.5, pitch: -0.2 }); g.step(2); });
  const target = 6 * 15 + 9;
  const s = await game(page).eval(g => g.caroSpot(6 * 15 + 9));
  const at = await onPage(page, s.x, s.y);
  await page.mouse.click(at.x, at.y); await steps(page, 30);
  const c = await game(page).eval(g => g.caro);
  expect(c.moves).toBe(1);
  expect(c.board[target]).toBe(0);
  expect(errors).toEqual([]);
});

test('Cờ Tỷ Phú: a drag on the table opens no tile card; the view is the player\'s own, kept through the turns', async ({ page }) => {
  const errors = await open(page, 'manual=1&seed=5');
  await page.evaluate(`(g => { ${STARTS.play} })(window.game)`);
  const v0 = (await view(page))!;
  await drag(page, v0.rect.x + 200, v0.rect.y + 300, v0.rect.x + 420, v0.rect.y + 260);
  await steps(page, 2);
  expect(await game(page).eval(g => g.view.inspect)).toBe(-1);
  const turned = (await view(page))!.yaw;
  await steps(page, 300);                                            // the computers play on
  expect((await view(page))!.yaw).toBeCloseTo(turned, 5);
  expect(errors).toEqual([]);
});

test('on a phone the boards show ↻ and "Gốc" once turned, and the board is drawn in 3D', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = await open(page, 'manual=1&seed=5');
  for (const start of [STARTS.caro, STARTS.snake, STARTS.ludo, STARTS.play]) {
    await page.evaluate(`(g => { ${start} })(window.game)`);
    const labels = () => game(page).eval(g => g.view.buttons.map(b => b.label));
    expect(await labels()).toContain('↻');
    expect(await labels()).not.toContain('Gốc');
    await game(page).eval(g => { g.setBoardView({ yaw: 0.5 }); g.step(2); });
    expect(await labels()).toContain('Gốc');
  }
  expect(errors).toEqual([]);
  await ctx.close();
});
