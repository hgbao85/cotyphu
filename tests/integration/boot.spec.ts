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

test('the second seat can be set to not playing, and a game will not start with fewer than two players', async ({ page }) => {
  // Regression: seats 1 and 2 never offered "Không chơi", so a host online could not leave seat 2 empty.
  const errors = await open(page, 'manual=1&seed=7');
  const seatKind = (i: number) => page.evaluate(k => (window.game!.online as { seats: { kind: string }[] }).seats[k].kind, i);
  /** Taps a seat's button on the wide title screen until it shows the kind wanted. */
  async function setSeat(i: number, kind: string) {
    const box = (await page.locator('#game').boundingBox())!;
    for (let k = 0; k < 8 && (await seatKind(i)) !== kind; k++) {
      await page.mouse.click(box.x + 580 * box.width / 1280, box.y + (250 + i * 62 + 25) * box.height / 720);
      await page.evaluate(() => window.game!.step(2));
    }
    return seatKind(i);
  }
  expect(await setSeat(1, 'off')).toBe('off');
  expect(await setSeat(2, 'off')).toBe('off');   // seat 4 starts empty: one player is left
  await page.evaluate(() => { window.game!.press('Enter'); window.game!.step(2); });
  expect(await page.evaluate(() => window.game!.scene)).toBe('title');
  expect(await setSeat(2, 'ai')).toBe('ai');
  await page.evaluate(() => { window.game!.press('Enter'); window.game!.step(2); });
  expect(await page.evaluate(() => window.game!.scene)).toBe('play');
  expect(errors).toEqual([]);
});

test('a tap anywhere closes an open tile card, and never opens another tile', async ({ page }) => {
  // Regression: with Hà Nội's card open, a tap on another tile switched the card to that tile. Asked for
  // after: a tap anywhere, not only on Đóng, closes the card.
  const errors = await open(page, 'manual=1&seed=7');
  const box = (await page.locator('#game').boundingBox())!;
  const tap = (x: number, y: number) => page.mouse.click(box.x + x * box.width / 1280, box.y + y * box.height / 720);
  const inspect = () => page.evaluate(() => (window.game!.view as { inspect: number }).inspect);
  await page.evaluate(() => { window.game!.press('Enter'); window.game!.step(5); });
  await tap(135, 360);                                       // Hà Nội, on the left edge of the board
  await page.evaluate(() => window.game!.step(2));
  const first = await inspect();
  expect(first).toBeGreaterThanOrEqual(0);
  await tap(385, 600);                                       // Hạ Long, on the bottom edge, outside the card
  await page.evaluate(() => window.game!.step(2));
  expect(await inspect()).toBe(-1);                          // closed, and Hạ Long not opened
  await tap(135, 360);                                       // open Hà Nội again, then tap on the card itself
  await page.evaluate(() => window.game!.step(2));
  expect(await inspect()).toBe(first);
  await tap(450, 300);
  await page.evaluate(() => window.game!.step(2));
  expect(await inspect()).toBe(-1);
  expect(errors).toEqual([]);
});

test('the kind of game cycles through 30 rounds, 50 rounds and until bankrupt, and a 50-round game ends after round 50', async ({ page }) => {
  // Asked for: a longer limited game, 50 rounds, beside 30 rounds and until bankrupt.
  const errors = await open(page, 'manual=1&seed=7');
  const box = (await page.locator('#game').boundingBox())!;
  const kind = () => page.evaluate(() => { const o = window.game!.online as { mode: string; rounds: number }; return o.mode === 'rounds' ? `${o.rounds}` : o.mode; });
  const tapMode = async () => {
    await page.mouse.click(box.x + 580 * box.width / 1280, box.y + (250 + 4 * 62 + 10 + 25) * box.height / 720);
    await page.evaluate(() => window.game!.step(2));
  };
  const seen = [await kind()];
  for (let k = 0; k < 3; k++) { await tapMode(); seen.push(await kind()); }
  expect(seen).toEqual(['bankrupt', '30', '50', 'bankrupt']);
  await tapMode(); await tapMode();                           // 50 rounds
  await page.evaluate(() => { window.game!.press('Enter'); window.game!.step(5); });
  expect(await page.evaluate(() => (window.game!.state as { maxRounds?: number }).maxRounds)).toBe(50);
  expect(errors).toEqual([]);
});

test('a game on one screen comes back after a reload, where it was left', async ({ page }) => {
  // Asked for: a reload or a closed tab used to lose the whole game (a game at round 50, for one).
  const errors = await open(page, 'manual=1&seed=7');
  type S = { round: number; cur: number; players: { name: string; cash: number; pos: number }[] };
  await page.evaluate(() => {
    const g = window.game!;
    g.configure({ seats: [{ kind: 'ai', lv: 1 }, { kind: 'ai', lv: 1 }, { kind: 'off' }, { kind: 'off' }] });
    g.press('Enter'); g.step(1);
    g.step(3000, false);                                      // the computers play a while
    (g.state as { round: number }).round = 7;                 // a round to read back on the button
    g.step(120, false);                                       // long enough for the game to be kept
  });
  const before = await page.evaluate(() => JSON.parse(JSON.stringify(window.game!.state)) as S);
  await page.reload();
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  expect(await page.evaluate(() => window.game!.scene)).toBe('title');
  const box = (await page.locator('#game').boundingBox())!;
  await page.mouse.click(box.x + 1090 * box.width / 1280, box.y + 638 * box.height / 720); // "Chơi tiếp ván trước"
  await page.evaluate(() => window.game!.step(2));
  expect(await page.evaluate(() => window.game!.scene)).toBe('play');
  const after = await page.evaluate(() => window.game!.state as S);
  expect(after.round).toBe(before.round);
  expect(after.players.map(p => [p.name, p.cash, p.pos])).toEqual(before.players.map(p => [p.name, p.cash, p.pos]));
  expect(errors).toEqual([]);
});
