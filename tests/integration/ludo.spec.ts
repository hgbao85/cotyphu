// Playwright: Cá Ngựa in the single-file build opened from disk, driven through the game-state hook
// (src/hook.ts: configureLudo, ludo). Taps use the wide 1280x720 layout.
import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const build = (query: string): string => `${pathToFileURL(resolve('dist-single/index.html')).href}?${query}`;
const BACK = [800, 30]; // "‹ Sảnh" on the side panel (src/ludo/scene.ts: PX + 14, 14, 92 x 32)
type View = { phase: string; cur: number; moves: number[]; horses: number[][] } | null;

async function tapAt(page: Page, x: number, y: number) {
  const b = (await page.locator('#game').boundingBox())!;
  await page.mouse.click(b.x + x * b.width / 1280, b.y + y * b.height / 720);
  await page.evaluate(() => window.game!.step(2));
}

test('under the "Về sảnh?" menu, Space and the number keys do not move a horse', async ({ page }) => {
  // Bug: the menu built only its own buttons, but the horse keys and taps still answered underneath.
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(build('manual=1&seed=3'));
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  const ready = await page.evaluate(() => {
    const g = window.game as unknown as { configureLudo(o: unknown): void; ludo: View; press(c: string): void; hold(c: string, on: boolean): void; step(n?: number, d?: boolean): void };
    g.configureLudo({ seats: [{ kind: 'human' }, { kind: 'ai', lv: 1 }, { kind: 'off' }, { kind: 'off' }] });
    g.press('Enter'); g.step(1, false);
    for (let n = 0; n < 3000; n++) {
      const v = g.ludo;
      if (v && v.cur === 0 && v.phase === 'choose' && v.moves.length) return true;
      if (v && v.cur === 0 && v.phase === 'roll') { g.press('Space'); g.hold('Space', true); g.step(20, false); g.hold('Space', false); }
      g.step(10, false);
    }
    return false;
  });
  expect(ready).toBe(true);
  const before = await page.evaluate(() => (window.game as unknown as { ludo: View }).ludo);
  await tapAt(page, BACK[0], BACK[1]);
  const after = await page.evaluate(() => {
    const g = window.game as unknown as { ludo: View; press(c: string): void; step(n?: number, d?: boolean): void };
    g.press('Space'); g.step(2, false); g.press('Digit1'); g.step(2, false); g.press('Digit2'); g.step(2, false);
    return g.ludo;
  });
  expect(after!.horses).toEqual(before!.horses);
  expect(after!.phase).toBe('choose');
  expect(errors).toEqual([]);
});

test('a game kept with "Lên chuồng: Nhanh" goes on with Nhanh after a reload, not the default rule', async ({ page }) => {
  // Bug: the picked rule lived only in the page's settings, so "Chơi tiếp ván trước" went on with the default.
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  type G = { configure(o: unknown): void; configureLudo(o: unknown): void; press(c: string): void; step(n?: number, d?: boolean): void; scene: string };
  await page.goto(build('manual=1&seed=3'));
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  await page.evaluate(() => {
    const g = window.game as unknown as G;
    g.configure({ tune: { ludo_home_strict: 0 } });          // "Nhanh", as picked on the setup screen
    g.configureLudo({ seats: [{ kind: 'ai', lv: 1 }, { kind: 'ai', lv: 1 }, { kind: 'off' }, { kind: 'off' }] });
    g.press('Enter'); g.step(1, false); g.step(200, false); // played a while, and kept
  });
  const keptRules = () => page.evaluate(() => JSON.parse(localStorage.getItem('tpdv-ludo-local') || 'null')?.rules);
  expect(await keptRules()).toEqual({ ludo_home_strict: 0 });
  await page.reload();                                        // the page's rule is back to data/config.json's
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  await page.evaluate(() => (window.game as unknown as G).configureLudo({}));
  await tapAt(page, 500, 661);                                // "Chơi tiếp ván trước"
  expect(await page.evaluate(() => (window.game as unknown as G).scene)).toBe('ludo');
  await page.evaluate(() => { localStorage.removeItem('tpdv-ludo-local'); (window.game as unknown as G).step(200, false); }); // kept again, with the rule in play now
  expect(await keptRules()).toEqual({ ludo_home_strict: 0 });
  expect(errors).toEqual([]);
});

test('the fast-forward speed picked in Cờ Tỷ Phú is the speed in Cá Ngựa at once, with no reload', async ({ page }) => {
  // Bug: each game read the kept speed once when the page opened and then kept its own copy.
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(build('manual=1&seed=3&game=typhu'));
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  type G = { configure(o: unknown): void; configureLudo(o: unknown): void; press(c: string): void; step(n?: number, d?: boolean): void; view: { buttons: { label: string; x: number; y: number; w: number; h: number }[] } };
  const speedButton = () => page.evaluate(() => (window.game as unknown as G).view.buttons.find(b => /^×\d$/.test(b.label)) ?? null);
  await page.evaluate(() => {
    const g = window.game as unknown as G;
    g.configure({ seats: [{ kind: 'ai', lv: 1 }, { kind: 'ai', lv: 1 }, { kind: 'off' }, { kind: 'off' }] });
    g.press('Enter'); g.step(3);
  });
  const fast = (await speedButton())!;
  expect(fast.label).toBe('×1');
  await tapAt(page, fast.x + fast.w / 2, fast.y + fast.h / 2);
  await tapAt(page, fast.x + fast.w / 2, fast.y + fast.h / 2);  // ×1 → ×2 → ×4
  expect((await speedButton())!.label).toBe('×4');
  await page.evaluate(() => {
    const g = window.game as unknown as G;
    g.configureLudo({ seats: [{ kind: 'ai', lv: 1 }, { kind: 'ai', lv: 1 }, { kind: 'off' }, { kind: 'off' }] });
    g.press('Enter'); g.step(3);
  });
  expect((await speedButton())!.label).toBe('×4');
  expect(errors).toEqual([]);
});
