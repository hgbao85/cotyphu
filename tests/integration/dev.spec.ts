// Playwright: the game served by the Vite dev server, file by file as a browser loads ES modules. The
// checks elsewhere open one bundled file, where the bundler orders the code itself; here a file that reads
// another's value while the modules are still loading (a cycle through main.ts) fails as it would for a
// developer running `npm run dev`.
import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';

const PORT = 5179;
let vite: ChildProcess;
test.beforeAll(async () => {
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  await expect.poll(async () => { try { return (await fetch(`http://localhost:${PORT}/`)).ok; } catch { return false; } }, { timeout: 30000 }).toBe(true);
});
test.afterAll(() => { vite?.kill(); });

test("the dev server's page loads every module and starts a game with no errors", async ({ page }) => {
  // Regression: tips.ts read CHEAP from main.ts while the modules were loading: a blank page under `npm run dev`.
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/?game=typhu&manual=1&seed=7`);
  await expect.poll(() => page.evaluate(() => typeof window.game?.step), { timeout: 20000 }).toBe('function');
  await page.evaluate(() => { window.game!.press('Enter'); window.game!.step(5); });
  expect(await page.evaluate(() => window.game!.scene)).toBe('play');
  expect(errors).toEqual([]);
});
