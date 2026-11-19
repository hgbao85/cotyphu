// Playwright: Cá Ngựa in the single-file build opened from disk, driven through the game-state hook
// (src/hook.ts: configureLudo, ludo). Taps use the wide 1280x720 layout.
import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/** The single-file build: dist-single/, or another (SPEC_SINGLE) to watch a test fail on older code. */
const build = (query: string): string => `${pathToFileURL(resolve(process.env.SPEC_SINGLE || 'dist-single', 'index.html')).href}?${query}`;
const BACK = [800, 30]; // "‹ Sảnh" on the side panel (src/ludo/scene.ts: PX + 14, 14, 92 x 32)
type View = { phase: string; cur: number; moves: number[]; horses: number[][]; auto: boolean[] } | null;

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
      const me = v ? v.auto.indexOf(false) : -1; // the person's place: after the throws for the order, not always first
      if (v && v.cur === me && v.phase === 'choose' && v.moves.length) return true;
      if (v && v.cur === me && v.phase === 'roll') { g.press('Space'); g.hold('Space', true); g.step(20, false); g.hold('Space', false); }
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

test('the fast-forward speeds come from data/config.json (fast_speed_1, fast_speed_2)', async ({ page }) => {
  await page.goto(build('manual=1&seed=3&game=typhu'));
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  type G = { configure(o: unknown): void; press(c: string): void; step(n?: number, d?: boolean): void; view: { buttons: { label: string; x: number; y: number; w: number; h: number }[] } };
  const speedButton = () => page.evaluate(() => (window.game as unknown as G).view.buttons.find(b => /^×\d+$/.test(b.label))!);
  await page.evaluate(() => {
    const g = window.game as unknown as G;
    g.configure({ tune: { fast_speed_1: 3, fast_speed_2: 6 }, seats: [{ kind: 'ai', lv: 1 }, { kind: 'ai', lv: 1 }, { kind: 'off' }, { kind: 'off' }] });
    g.press('Enter'); g.step(3);
  });
  const seen: string[] = [];
  for (let k = 0; k < 3; k++) {
    const b = await speedButton();
    await tapAt(page, b.x + b.w / 2, b.y + b.h / 2);
    seen.push((await speedButton()).label);
  }
  expect(seen).toEqual(['×3', '×6', '×1']);
});

// ---- Laid out as Cờ Tỷ Phú (the review of 19/11/2026: the two new games, in line with the first) ----
type Hook = { configure(o: unknown): void; configureLudo(o: unknown): void; configureSnake(o: unknown): void; press(c: string): void; step(n?: number, d?: boolean): void; scene: string;
  view: { buttons: { label: string; x: number; y: number; w: number; h: number }[] }; ludo: { names: string[]; phase: string } | null; snake: { names: string[]; phase: string } | null };
const gameOf = (page: Page) => ({
  run: <T>(fn: (g: Hook) => T) => page.evaluate(fn as unknown as () => T),
  labels: () => page.evaluate(() => { const g = window.game as unknown as Hook; g.step(1); return g.view.buttons.map(b => b.label); }),
  tap: async (label: string) => {
    const b = (await page.evaluate(() => (window.game as unknown as Hook).view.buttons))!.find(x => x.label === label);
    if (!b) throw new Error(`no "${label}" button`);
    await tapAt(page, b.x + b.w / 2, b.y + b.h / 2);
  },
});

test('Cá Ngựa and Rắn và Thang: a person is "Người …", the history, the speed, the settings and the results read as in Cờ Tỷ Phú', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(build('manual=1&seed=3'));
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  const g = gameOf(page);
  for (const game of ['ludo', 'snake'] as const) {
    await g.run(() => {});
    await page.evaluate(gm => { const v = window.game as unknown as Hook; (gm === 'ludo' ? v.configureLudo : v.configureSnake)({ seats: [{ kind: 'human', animal: 2 }, { kind: 'ai', lv: 1, animal: 3 }, { kind: 'off' }, { kind: 'off' }] }); v.step(1); }, game);
    expect(await g.labels()).toContain('Cài đặt');                          // the setup screen, as Cờ Tỷ Phú's
    await page.evaluate(() => { const v = window.game as unknown as Hook; v.press('Enter'); v.step(2); });
    const names = await page.evaluate(gm => (window.game as unknown as Hook)[gm]!.names, game);
    expect(names[0]).toMatch(/^Người /);                                       // Người / Máy + the side or animal
    expect(names[1]).toMatch(/^Máy /);
    const play = await g.labels();
    expect(play).toEqual(expect.arrayContaining(['‹ Sảnh', 'Luật', 'Lịch sử', '×1'])); // Rắn và Thang has the speed too now
    await g.tap('Lịch sử');
    await expect(page.locator('text=Lịch sử ván')).toBeVisible();
    await page.locator('.ru-close').click();
    // the computer plays to the end: the results' second button is "Đổi người chơi (N)", and N presses it
    await page.evaluate(gm => {
      const v = window.game as unknown as Hook;
      (gm === 'ludo' ? v.configureLudo : v.configureSnake)({ seats: [{ kind: 'ai', lv: 1, animal: 0 }, { kind: 'ai', lv: 1, animal: 1 }, { kind: 'off' }, { kind: 'off' }] });
      v.press('Enter'); v.step(1, false);
      for (let n = 0; n < 4000 && v[gm]!.phase !== 'over'; n++) v.step(300, false);
      v.step(2);
    }, game);
    expect(await g.labels()).toEqual(expect.arrayContaining(['Chơi lại (Enter)', 'Đổi người chơi (N)']));
    await page.evaluate(() => { const v = window.game as unknown as Hook; v.press('KeyN'); v.step(2); });
    expect(await page.evaluate(() => (window.game as unknown as Hook).scene)).toBe(game === 'ludo' ? 'ludoSetup' : 'snakeSetup');
  }
  expect(errors).toEqual([]);
});

test('Cờ Tỷ Phú on one screen has "‹ Sảnh" in the game: asked once, back to the hub, and the game is kept', async ({ page }) => {
  // Before, a game on one screen had no way back to the hub but a reload.
  await page.goto(build('manual=1&seed=3&game=typhu'));
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  const g = gameOf(page);
  await page.evaluate(() => {
    const v = window.game as unknown as Hook;
    v.configure({ seats: [{ kind: 'ai', lv: 1 }, { kind: 'ai', lv: 1 }, { kind: 'off' }, { kind: 'off' }] });
    v.press('Enter'); v.step(1, false); v.step(200, false);                // played a while, and kept
  });
  await g.tap('‹ Sảnh');
  expect(await g.labels()).toEqual(expect.arrayContaining(['Về sảnh', 'Ở lại']));
  await g.tap('Về sảnh');
  expect(await page.evaluate(() => (window.game as unknown as Hook).scene)).toBe('hub');
  expect(await page.evaluate(() => !!localStorage.getItem('tpdv-local-game'))).toBe(true); // "Chơi tiếp ván trước" brings it back
});

test('Cá Ngựa\'s sides play as zodiac animals, as Cờ Tỷ Phú: a tap on the piece picks the next free one, and the names follow', async ({ page }) => {
  // Asked for (19/11/2026): Cá Ngựa's horses wear the twelve animals, each side in its own colour.
  await page.goto(build('manual=1&seed=3'));
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  // seat 1 Trâu, seat 2 Hổ, seat 3 Khỉ, seat 4 not playing with Mèo
  await page.evaluate(() => (window.game as unknown as Hook).configureLudo({ seats: [{ kind: 'human', animal: 1 }, { kind: 'ai', lv: 1, animal: 2 }, { kind: 'ai', lv: 1, animal: 8 }, { kind: 'off', animal: 3 }] }));
  await tapAt(page, 400, 245);                                 // seat 1's piece (src/ludo/scene.ts: setupSpots y0, the tap beside the piece)
  const names = await page.evaluate(() => { const v = window.game as unknown as Hook; v.press('Enter'); v.step(2); return v.ludo!.names; });
  // Hổ is seat 2's, so the next free one is Mèo: a seat not playing does not hold its animal
  expect(names).toEqual(['Người Mèo', 'Máy Hổ', 'Máy Khỉ']);
});

test('on the tilted board, a tap on a glowing horse moves that horse', async ({ page }) => {
  // The board is seen tilted, as Cờ Tỷ Phú's (src/ui/tilt.ts): a horse is tapped where it is drawn.
  await page.goto(build('manual=1&seed=3'));
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  type T = { phase: string; cur: number; horses: number[][]; auto: boolean[]; tapAt: { h: number; x: number; y: number }[] };
  const ready = await page.evaluate(() => {
    const g = window.game as unknown as Hook & { ludo: T | null; hold(c: string, on: boolean): void };
    g.configureLudo({ seats: [{ kind: 'human' }, { kind: 'ai', lv: 1 }, { kind: 'off' }, { kind: 'off' }] });
    g.press('Enter'); g.step(1, false);
    for (let n = 0; n < 3000; n++) {
      const v = g.ludo!;
      const me = v.auto.indexOf(false); // the person's place: after the throws for the order, not always first
      if (v.cur === me && v.phase === 'choose' && v.tapAt.length) return true;
      if (v.cur === me && v.phase === 'roll') { g.press('Space'); g.hold('Space', true); g.step(20, false); g.hold('Space', false); }
      g.step(10, false);
    }
    return false;
  });
  expect(ready).toBe(true);
  const before = await page.evaluate(() => (window.game as unknown as { ludo: T }).ludo);
  const target = before.tapAt[before.tapAt.length - 1];
  await tapAt(page, target.x, target.y);
  const after = await page.evaluate(() => { const g = window.game as unknown as Hook & { ludo: T }; g.step(200, false); return g.ludo; });
  const me = before.auto.indexOf(false);
  expect(after.horses[me][target.h]).not.toBe(before.horses[me][target.h]); // the tapped horse moved
});

test('a game of two Cá Ngựa players seats them across the board, and the setup screen shows it', async ({ page }) => {
  // Bug (19/11/2026): two players sat in corners side by side, and the one behind won 59% of self-play games.
  await page.goto(build('manual=1&seed=3'));
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  const sides = await page.evaluate(() => {
    const g = window.game as unknown as Hook & { ludo: { sides: number[] } };
    g.configureLudo({ seats: [{ kind: 'human' }, { kind: 'ai', lv: 1 }, { kind: 'off' }, { kind: 'off' }] });
    g.press('Enter'); g.step(2);
    return g.ludo.sides;
  });
  expect(sides).toEqual([0, 2]);
});

test('Cá Ngựa and Rắn và Thang open with everyone throwing for the order, highest first, as Cờ Tỷ Phú', async ({ page }) => {
  // Asked for (19/11/2026): the two games picked who goes first at random, with no throw.
  await page.goto(build('manual=1&seed=3'));
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  for (const game of ['ludo', 'snake'] as const) {
    const r = await page.evaluate(gm => {
      type V = { ordering: boolean; phase: string };
      const g = window.game as unknown as Hook & Record<string, V | null>;
      (gm === 'ludo' ? g.configureLudo : g.configureSnake)({ seats: [{ kind: 'ai', lv: 1, animal: 0 }, { kind: 'ai', lv: 1, animal: 1 }, { kind: 'ai', lv: 1, animal: 2 }, { kind: 'off' }] });
      g.press('Enter'); g.step(1, false);
      const opened = g[gm]!.ordering;
      let n = 0;
      while (g[gm]!.ordering && n < 20000) { g.step(5, false); n += 5; }
      return { opened, ordered: !g[gm]!.ordering, firstTurn: g[gm]!.phase };
    }, game);
    expect(r.opened).toBe(true);
    expect(r.ordered).toBe(true);                    // everyone threw, ties again, and the order is set
  }
});
