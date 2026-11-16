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

test('lays out for a phone held upright and plays a turn there @boot', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const errors = await open(page, 'manual=1&seed=7');
  const box = await page.locator('#game').boundingBox();
  expect(box && box.height / box.width).toBeCloseTo(2, 1); // the phone layout is 480x960
  const scene = await page.evaluate(() => {
    const g = window.game!;
    g.press('Enter'); g.step();
    g.press('Space'); g.step(); g.step(240);
    return g.scene;
  });
  expect(scene).toBe('play');
  expect(errors).toEqual([]);
});

test('throws for the order of play, puts the highest first and the lowest last, and the same seed repeats it exactly', async ({ page }) => {
  // ?manual=1 stops the loop, so only step() moves the game. Enter starts; the person throws with
  // Space (held, then let go) whenever it is their throw; the computer throws on its own.
  async function run(): Promise<{ scene: string; rolls: number[]; ordering: boolean; cash: number[]; state: unknown }> {
    await open(page, 'manual=1&seed=7');
    return page.evaluate(() => {
      const g = window.game!;
      type S = { ordering?: boolean; phase: string; cur: number; players: { kind: string; orderRoll?: number; cash: number; pos: number }[] };
      g.press('Enter'); g.step();
      for (let k = 0; k < 60 && (g.state as S).ordering; k++) {
        const s = g.state as S;
        if (s.phase === 'order' && s.players[s.cur].kind === 'human') {
          g.press('Space'); g.hold('Space', true); g.step(20); g.hold('Space', false);
        }
        g.step(90, false);
      }
      const s = g.state as S;
      return { scene: g.scene, rolls: s.players.map(p => p.orderRoll ?? -1), ordering: !!s.ordering, cash: s.players.map(p => p.cash), state: g.state };
    });
  }
  const first = await run();
  expect(first.scene).toBe('play');
  expect(first.ordering).toBe(false);
  expect(first.rolls.every(r => r >= 2 && r <= 12)).toBe(true);
  expect([...first.rolls].sort((a, b) => b - a)).toEqual(first.rolls); // highest first, lowest last
  expect(new Set(first.rolls).size).toBe(first.rolls.length);          // ties were thrown again
  expect(first.cash.every(c => c === config.start_cash.value)).toBe(true); // nobody moved yet
  expect(await run()).toEqual(first);
});
