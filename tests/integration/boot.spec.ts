// Playwright: the single-file build opened from disk, driven through the
// game-state hook (src/hook.ts). npm run smoke runs only the @boot test.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const config = JSON.parse(readFileSync('data/config.json', 'utf8'));
const build = (query: string): string => `${pathToFileURL(resolve('dist-single/index.html')).href}?${query}`;

/** Opens the build and collects every page error and console error. */
async function open(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(build(query));
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  return errors;
}

test('boots to the title screen with no errors @boot', async ({ page }) => {
  const errors = await open(page, 'manual=1');
  expect(await page.evaluate(() => window.game!.scene)).toBe('title');
  const size = await page.locator('#game').boundingBox();
  expect(size && size.width > 0 && size.height > 0).toBe(true);
  expect(errors).toEqual([]);
});

test('runs on its own when opened without manual stepping @boot', async ({ page }) => {
  // Regression: the grow once dropped the line that starts the loop; every manual=1 check still passed.
  const errors = await open(page, 'seed=7');
  await expect.poll(() => page.evaluate(() => (window.game!.state as { t: number }).t), { timeout: 5000 }).toBeGreaterThan(0.2);
  expect(errors).toEqual([]);
});

test('a scripted turn shakes, throws and moves the token, and the same seed repeats it exactly', async ({ page }) => {
  // ?manual=1 stops the loop, so only step() moves the game: the same keys the reference replay
  // opened with (Enter to start, Space held to shake and let go to throw).
  async function run(): Promise<{ scene: string; dice: number[]; pos: number; cash: number; state: unknown }> {
    await open(page, 'manual=1&seed=7');
    return page.evaluate(() => {
      const g = window.game!;
      g.press('Enter'); g.step();
      g.press('Space'); g.hold('Space', true); g.step(30); g.hold('Space', false);
      g.step(240, false);
      const s = g.state as { dice: number[]; players: { pos: number; cash: number }[] };
      return { scene: g.scene, dice: s.dice, pos: s.players[0].pos, cash: s.players[0].cash, state: g.state };
    });
  }
  const first = await run();
  expect(first.scene).toBe('play');
  expect(first.pos).toBe((first.dice[0] + first.dice[1]) % 40);
  expect(first.cash).toBe(config.start_cash.value);
  expect(await run()).toEqual(first);
});
