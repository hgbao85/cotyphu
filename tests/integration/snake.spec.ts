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
