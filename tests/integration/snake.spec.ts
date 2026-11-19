// Playwright: Rắn và Thang in the single-file build opened from disk, driven through the game-state
// hook (src/hook.ts: configureSnake, configure for the rules' switches, view for the buttons).
import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const build = (query: string): string => `${pathToFileURL(resolve('dist-single/index.html')).href}?${query}`;
const RESUME = [500, 676]; // "Chơi tiếp ván trước", wide setup screen (src/snake/scene.ts setupSpots: resume)
type G = { configure(o: unknown): void; configureSnake(o: unknown): void; press(c: string): void; step(n?: number, d?: boolean): void; scene: string; view: { buttons: { label: string }[] } };

async function tapAt(page: Page, x: number, y: number) {
  const b = (await page.locator('#game').boundingBox())!;
  await page.mouse.click(b.x + x * b.width / 1280, b.y + y * b.height / 720);
  await page.evaluate(() => window.game!.step(2));
}

test('a game kept with "Phải đổ 6" and "Vượt cũng được" goes on with them after a reload, not the defaults', async ({ page }) => {
  // Regression (full review): the picked rules lived only in the page's settings, and a resumed game played by data/config.json's.
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(build('manual=1&seed=3'));
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  await page.evaluate(() => {
    const g = window.game as unknown as G;
    g.configure({ tune: { snake_six_to_start: 1, snake_exact_finish: 0 } }); // as picked on the setup screen
    g.configureSnake({ seats: [{ kind: 'ai', lv: 1 }, { kind: 'ai', lv: 1 }, { kind: 'off' }, { kind: 'off' }] });
    g.press('Enter'); g.step(1, false); g.step(200, false);          // played a while, and kept
  });
  expect(await page.evaluate(() => !!localStorage.getItem('tpdv-snake-local'))).toBe(true);
  await page.reload();                                                 // the page's rules are back to data/config.json's
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  const labels = () => page.evaluate(() => { const g = window.game as unknown as G; g.step(1); return g.view.buttons.map(b => b.label); });
  await page.evaluate(() => (window.game as unknown as G).configureSnake({}));
  expect((await labels()).some(l => l.startsWith('Thảy là vào'))).toBe(true); // the defaults, before resuming
  await tapAt(page, RESUME[0], RESUME[1]);
  expect(await page.evaluate(() => (window.game as unknown as G).scene)).toBe('snake');
  await page.evaluate(() => (window.game as unknown as G).configureSnake({})); // back to the setup screen: its rule buttons read the rules in play
  const now = await labels();
  expect(now.some(l => l.startsWith('Phải đổ'))).toBe(true);
  expect(now.some(l => l.startsWith('Vượt cũng được'))).toBe(true);
  expect(errors).toEqual([]);
});

test('Rắn và Thang: a game kept while a person held the shake comes back waiting for the throw, not thrown by itself', async ({ page }) => {
  // Regression (full review 19/11/2026): the kept shake came back as it was, and with nobody holding, the first step threw it.
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${pathToFileURL(resolve(process.env.SPEC_SINGLE || 'dist-single', 'index.html')).href}?manual=1&seed=4`);
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  type V = { phase: string; cur: number; auto: boolean[] } | null;
  const held = await page.evaluate(() => {
    const g = window.game as unknown as { configureSnake(o: unknown): void; press(c: string): void; hold(c: string, on: boolean): void; step(n?: number, d?: boolean): void; snake: V };
    g.configureSnake({ seats: [{ kind: 'human', name: 'Người' }, { kind: 'ai', lv: 1 }, { kind: 'off' }, { kind: 'off' }] });
    g.press('Enter'); g.step(1, false);
    for (let k = 0; k < 4000; k++) { const v = g.snake!; if (v.phase === 'roll' && !v.auto[v.cur]) break; g.step(1, false); } // to this person's throw
    g.press('Space'); g.hold('Space', true); g.step(90, false);                   // held a second and a half: kept mid-shake
    return JSON.parse(localStorage.getItem('tpdv-snake-local') || 'null')?.g?.phase;
  });
  expect(held).toBe('shake');
  await page.reload();
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  await page.evaluate(() => (window.game as unknown as { configureSnake(o: unknown): void }).configureSnake({}));
  const b = (await page.locator('#game').boundingBox())!;
  await page.mouse.click(b.x + [500, 676][0] * b.width / 1280, b.y + [500, 676][1] * b.height / 720); // "Chơi tiếp ván trước"
  const after = await page.evaluate(() => { const g = window.game as unknown as { step(n?: number): void; scene: string; snake: V }; g.step(3); return { scene: g.scene, phase: g.snake?.phase }; });
  expect(after).toEqual({ scene: 'snake', phase: 'roll' });
  expect(errors).toEqual([]);
});
