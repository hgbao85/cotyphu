// Playwright: Cờ Caro. On one screen the single-file build is opened from disk and stepped by hand
// (?manual=1) through the game-state hook (src/hook.ts: configureCaro, caro, caroSpot); online, the room
// server (server/server.mjs) serves the folder build (dist/) to a host and a friend, each in a browser
// context of their own, as two phones would be.
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';

/** The browser contexts this file opened, closed after each test (Bug: left open, they slowed the files after it). */
const opened: BrowserContext[] = [];
test.afterEach(async () => { await Promise.all(opened.splice(0).map(c => c.close())); });

const build = (query: string): string => `${pathToFileURL(resolve('dist-single/index.html')).href}?${query}`;
type View = { phase: string; cur: number; size: number; board: number[]; last: number; moves: number; winner: number; draw: boolean; line: number[] | null; round: number; wins: number[]; names: string[]; bubbles: unknown[]; results: boolean; online: { role: string; code: string; mySeat: number; lobby: { kind: string; name?: string }[] | null } };
type Game = { configure(o: unknown): void; configureCaro(o: unknown): void; press(c: string): void; step(n?: number, d?: boolean): void; scene: string; caro: View; caroSpot(cell: number): { x: number; y: number } };
const HUMAN = { kind: 'human' };
/** Where the setup screen's "Chơi online" is, wide (src/caro/scene.ts setupSpots: online). */
const ONLINE = [780, 457];
/** The hub's fourth card, wide (src/ui/hub.ts cardRect(3)). */
const CARD4 = [1069, 420];

/** The logical size of the canvas's layout: 1280x720 wide, 480 across on a phone. */
async function logical(page: Page): Promise<{ w: number; h: number; box: { x: number; y: number; width: number; height: number } }> {
  const box = (await page.locator('#game').boundingBox())!;
  const w = box.width > box.height ? 1280 : 480;
  return { w, h: Math.round(box.height * w / box.width), box };
}
/** Taps a point of the layout. */
async function tap(page: Page, x: number, y: number): Promise<void> {
  const { w, box } = await logical(page), k = box.width / w;
  await page.mouse.click(box.x + x * k, box.y + y * k);
}
/** Taps a cell of the board, and (on a stepped page) lets the piece land. */
async function tapCell(page: Page, r: number, c: number, stepped = true): Promise<void> {
  const p = await page.evaluate(([r, c]) => { const g = window.game as unknown as Game; return g.caroSpot(r * g.caro.size + c); }, [r, c]);
  await tap(page, p.x, p.y);
  if (stepped) await page.evaluate(() => (window.game as unknown as Game).step(30));
}
/** Taps the button with this label, as the screen built it this step (window.game.view.buttons). */
async function tapLabel(page: Page, label: string): Promise<void> {
  let b: { x: number; y: number; w: number; h: number } | undefined;
  await expect.poll(async () => {
    b = await page.evaluate(l => (window.game as unknown as { view: { buttons: { label: string; x: number; y: number; w: number; h: number }[] } }).view.buttons.find(x => x.label === l), label);
    return !!b;
  }, { timeout: 5000 }).toBe(true);
  await tap(page, b!.x + b!.w / 2, b!.y + b!.h / 2);
}
const view = (page: Page): Promise<View> => page.evaluate(() => (window.game as unknown as Game).caro);
async function open(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(build(query));
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  return errors;
}
/** Starts a game for two people on this screen, without the throws for who goes first (order_roll 0: the
 * first seat starts) unless the tune turns them on. */
async function startTwoPeople(page: Page, tune: Record<string, number> = {}): Promise<View> {
  await page.evaluate(t => {
    const g = window.game as unknown as Game;
    g.configure({ tune: { order_roll: 0, ...t } }); g.configureCaro({ seats: [{ kind: 'human', animal: 4 }, { kind: 'human', animal: 9 }] });
    g.step(1); g.press('Enter'); g.step(1); g.step(140);
  }, tune);
  const v = await view(page);
  expect(v.phase).toBe('turn');
  return v;
}
/** Plays moves for the first and the second player by turns: [r, c] each. */
async function playMoves(page: Page, first: number[][], second: number[][]): Promise<void> {
  for (let k = 0; k < first.length; k++) {
    await tapCell(page, first[k][0], first[k][1]);
    if (second[k]) await tapCell(page, second[k][0], second[k][1]);
  }
}

test('the hub\'s fourth card opens Cờ Caro; five in a row wins and the loser goes first in the next game', async ({ page }) => {
  const errors = await open(page, 'manual=1&seed=5');
  await page.evaluate(() => (window.game as unknown as Game).step(2));
  await tap(page, CARD4[0], CARD4[1]);
  await page.evaluate(() => (window.game as unknown as Game).step(2));
  expect(await page.evaluate(() => (window.game as unknown as Game).scene)).toBe('caroSetup');

  const v0 = await startTwoPeople(page);
  const first = v0.cur;
  await playMoves(page, [[7, 3], [7, 4], [7, 5], [7, 6], [7, 7]], [[8, 3], [8, 4], [8, 5], [8, 6]]);
  const v = await view(page);
  expect(v.phase).toBe('over');
  expect(v.winner).toBe(first);
  expect(v.line?.length).toBe(5);
  expect(v.moves).toBe(9);
  expect(v.results).toBe(false);                                   // the row glows on the board a moment first
  await page.evaluate(() => (window.game as unknown as Game).step(120));
  expect((await view(page)).results).toBe(true);
  await page.evaluate(() => { const g = window.game as unknown as Game; g.press('Enter'); g.step(2); }); // "Chơi lại"
  const next = await view(page);
  expect(next).toMatchObject({ phase: 'turn', round: 2, cur: 1 - first, moves: 0 });
  expect(next.wins[first]).toBe(1);
  expect(errors).toEqual([]);
});

test('five shut at both ends does not win under the Vietnamese rule, and wins with the rule off', async ({ page }) => {
  const errors = await open(page, 'manual=1&seed=7');
  // the first player fills row 7 from column 3 to 7; the second has already shut columns 2 and 8
  const firstMoves = [[7, 3], [7, 4], [7, 5], [7, 6], [7, 7]], secondMoves = [[7, 2], [7, 8], [0, 0], [0, 2]];
  const a = await startTwoPeople(page, { caro_block_two: 1 });
  await playMoves(page, firstMoves, secondMoves);
  const blocked = await view(page);
  expect(blocked.phase).toBe('turn');
  expect(blocked.winner).toBe(-1);
  expect(blocked.cur).toBe(1 - a.cur);                             // the game goes on: the other player's turn
  const b = await startTwoPeople(page, { caro_block_two: 0 });
  await playMoves(page, firstMoves, secondMoves);
  const won = await view(page);
  expect(won.phase).toBe('over');
  expect(won.winner).toBe(b.cur);
  expect(errors).toEqual([]);
});

test('a tap on a taken cell does nothing, and the computer answers a move', async ({ page }) => {
  const errors = await open(page, 'manual=1&seed=11');
  await page.evaluate(() => {
    const g = window.game as unknown as Game;
    g.configure({ tune: { order_roll: 0 } }); // the person, in the first seat, starts
    g.configureCaro({ seats: [{ kind: 'human', animal: 0 }, { kind: 'ai', lv: 2, animal: 6 }] });
    g.step(1); g.press('Enter'); g.step(1); g.step(140);
  });
  if ((await view(page)).cur === 1) await page.evaluate(() => (window.game as unknown as Game).step(120)); // the computer went first
  const before = await view(page);
  expect(before.cur).toBe(0);
  const taken = before.board.findIndex(x => x !== -1);
  if (taken >= 0) { await tapCell(page, Math.floor(taken / before.size), taken % before.size); expect((await view(page)).moves).toBe(before.moves); }
  await tapCell(page, 3, 3);
  expect((await view(page)).moves).toBe(before.moves + 1);
  await page.evaluate(() => (window.game as unknown as Game).step(120));
  const after = await view(page);
  expect(after.moves).toBe(before.moves + 2);                      // the computer placed its piece
  expect(after.cur).toBe(0);
  expect(errors).toEqual([]);
});

test('on a phone the board takes taps too, and a game left there comes back after a reload', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = await open(page, 'manual=1&seed=13');
  expect((await logical(page)).w).toBe(480);
  const v0 = await startTwoPeople(page);
  await tapCell(page, 0, 0);                                        // a far corner: the tilt's smallest cell
  await tapCell(page, 14, 14);                                      // a near corner
  const v = await view(page);
  expect(v.board[0]).toBe(v0.cur);
  expect(v.board[14 * 15 + 14]).toBe(1 - v0.cur);
  await page.evaluate(() => (window.game as unknown as Game).step(70)); // kept about once a second
  expect(await page.evaluate(() => !!localStorage.getItem('tpdv-caro-local'))).toBe(true);
  await page.reload();
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  await page.evaluate(() => { const g = window.game as unknown as Game; g.configureCaro({}); g.step(1); });
  await tap(page, 240, 580);                                        // "Chơi tiếp ván trước" (setupSpots phone: resume)
  await page.evaluate(() => (window.game as unknown as Game).step(2));
  expect(await page.evaluate(() => (window.game as unknown as Game).scene)).toBe('caro');
  expect((await view(page)).moves).toBe(2);
  expect(errors).toEqual([]);
  await ctx.close();
});

type Ordering = View & { ordering: boolean; dice: number[] };
const ordering = (page: Page): Promise<Ordering> => page.evaluate(() => (window.game as unknown as { caro: Ordering }).caro);
const labels = (page: Page): Promise<string[]> => page.evaluate(() => (window.game as unknown as { view: { buttons: { label: string }[] } }).view.buttons.map(b => b.label));

test('the first game waits for each person to hold and let go of the dice; the higher throw goes first', async ({ page }) => {
  // As the other three games (order_roll): nobody throws for a person; ties throw again.
  const errors = await open(page, 'manual=1&seed=5');
  await page.evaluate(() => {
    const g = window.game as unknown as Game;
    g.configure({ tune: { order_roll: 1 } }); g.configureCaro({ seats: [{ kind: 'human', animal: 4 }, { kind: 'human', animal: 9 }] });
    g.step(1); g.press('Enter'); g.step(1); g.step(600);           // ten seconds, and nobody touches the dice
  });
  const waiting = await ordering(page);
  expect(waiting).toMatchObject({ ordering: true, phase: 'roll', cur: 0 });
  expect(await labels(page)).toContain('Giữ để lắc chọn lượt');
  const names = waiting.names;
  const throws: number[] = [];
  for (let k = 0; k < 12 && (await ordering(page)).ordering; k++) { // each throw: hold Space a moment, let go, watch the dice land
    await page.evaluate(() => { const g = window.game as unknown as Game & { hold(c: string, on: boolean): void }; g.press('Space'); g.hold('Space', true); g.step(1); g.step(20); g.hold('Space', false); g.step(1); });
    expect((await ordering(page)).phase).toBe('dice');                 // let go: the dice tumble
    const landed = await page.evaluate(() => { const g = window.game as unknown as { caro: Ordering; step(n: number): void }; for (let i = 0; i < 60 && g.caro.phase === 'dice'; i++) g.step(5); return g.caro; });
    expect(landed.phase).toBe('shown');                                // the total shows on the card
    throws.push(landed.dice.reduce((a, b) => a + b, 0));
    await page.evaluate(() => { const g = window.game as unknown as { caro: Ordering; step(n: number): void }; for (let i = 0; i < 60 && g.caro.phase === 'shown'; i++) g.step(5); });
  }
  const v = await ordering(page);
  expect(v).toMatchObject({ ordering: false, phase: 'turn', cur: 0, moves: 0 });
  expect(throws.length).toBeGreaterThanOrEqual(2);
  expect(throws.every(t => t >= 2 && t <= 12)).toBe(true);           // two dice each (caro_order_dice)
  expect([...v.names].sort()).toEqual([...names].sort());
  expect(errors).toEqual([]);
});

test('a computer throws for the order on its own, and the person still throws their own', async ({ page }) => {
  const errors = await open(page, 'manual=1&seed=9');
  await page.evaluate(() => {
    const g = window.game as unknown as Game;
    g.configure({ tune: { order_roll: 1 } }); g.configureCaro({ seats: [{ kind: 'ai', lv: 1, animal: 2 }, { kind: 'human', animal: 7 }] });
    g.step(1); g.press('Enter'); g.step(1); g.step(400);           // the computer (first seat) throws; then it waits for the person
  });
  const v = await ordering(page);
  expect(v).toMatchObject({ ordering: true, phase: 'roll', cur: 1 });
  expect(errors).toEqual([]);
});

test('a tap on the tip box, off its buttons, places no piece under it', async ({ page }) => {
  // Regression (review 19/11/2026): the board under the first-game tip took the tap.
  const errors = await open(page, 'manual=1&seed=5&tutorial=1');
  await startTwoPeople(page);
  await page.evaluate(() => (window.game as unknown as Game).step(90));
  expect(await page.evaluate(() => (window.game as unknown as { caro: { tip: string | null } }).caro.tip)).toBe('turn');
  // a cell whose centre is inside the tip box (src/ui/gameTips.ts box, wide: x 370..720, y 16..140), left of "Đã hiểu" (x from 506)
  const cell = await page.evaluate(() => {
    const g = window.game as unknown as Game;
    for (let c = 0; c < g.caro.size * g.caro.size; c++) { const s = g.caroSpot(c); if (s.x > 380 && s.x < 495 && s.y > 100 && s.y < 138) return c; }
    return -1;
  });
  expect(cell).toBeGreaterThanOrEqual(0);
  const s = await page.evaluate(c => (window.game as unknown as Game).caroSpot(c), cell);
  await tap(page, s.x, s.y);
  await page.evaluate(() => (window.game as unknown as Game).step(30));
  expect((await view(page)).moves).toBe(0);
  expect(errors).toEqual([]);
});

// ---- Online ----------------------------------------------------------------------------------
const PORT = 8793;
const BASE = `http://localhost:${PORT}/`;
let server: ChildProcess | undefined;
test.describe('online', () => {
  test.beforeAll(async () => {
    if (!existsSync('dist/index.html')) throw new Error('dist/ is missing: npm run build first (npm run test:e2e does)');
    server = spawn(process.execPath, ['server/server.mjs'], { env: { ...process.env, PORT: String(PORT), STATIC_DIR: 'dist' }, stdio: 'ignore' });
    await expect.poll(async () => { try { return (await fetch(`${BASE}health`)).ok; } catch { return false; } }, { timeout: 25000 }).toBe(true); // a busy machine starts node slowly
  });
  test.afterAll(() => { server?.kill(); });

  async function screen(browser: Browser): Promise<{ page: Page; errors: string[] }> {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    opened.push(ctx); // closed after the test: left open, its 3D pages kept drawing through later files and starved them
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${BASE}?game=caro&render=cheap`);
    await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
    return { page, errors };
  }

  test('a friend joins a Cờ Caro room, both screens play the same board, an emote shows, and five in a row ends it for both', async ({ browser }) => {
    test.setTimeout(120000);
    const host = await screen(browser);
    await tap(host.page, ONLINE[0], ONLINE[1]);
    await host.page.fill('#op-name', 'Chu');
    await host.page.click('#op-create');
    await expect.poll(async () => (await view(host.page)).online.code, { timeout: 15000 }).toMatch(/^[A-Z0-9]{4}$/);
    const code = (await view(host.page)).online.code;

    const friend = await screen(browser);
    await tap(friend.page, ONLINE[0], ONLINE[1]);
    await friend.page.fill('#op-name', 'Ban');
    await friend.page.fill('#op-code', code);
    await friend.page.click('#op-join');
    await expect.poll(async () => (await view(friend.page)).online.mySeat, { timeout: 15000 }).toBe(1);
    await expect.poll(async () => (await view(friend.page)).online.lobby?.[1]).toMatchObject({ kind: 'remote', name: 'Ban' });

    await host.page.evaluate(() => (window.game as unknown as Game).press('Enter'));
    await expect.poll(() => friend.page.evaluate(() => (window.game as unknown as Game).scene), { timeout: 10000 }).toBe('caro');
    // each throws for the order on their own screen: hold Space, let go (the friend's screen asks the host)
    const byName = async (who: number): Promise<Page> => ((await view(host.page)).names[who] === 'Chu' ? host.page : friend.page);
    for (let k = 0; k < 12; k++) {
      const v = await host.page.evaluate(() => (window.game as unknown as { caro: Ordering }).caro);
      if (!v.ordering) break;
      await expect.poll(async () => (await view(host.page)).phase, { timeout: 10000 }).toBe('roll');
      const who = await byName((await view(host.page)).cur);
      await expect.poll(async () => (await labels(who)).includes('Giữ để lắc chọn lượt'), { timeout: 10000 }).toBe(true);
      await who.evaluate(() => { const g = window.game as unknown as Game & { hold(c: string, on: boolean): void }; g.press('Space'); g.hold('Space', true); });
      await who.waitForTimeout(300);
      await who.evaluate(() => (window.game as unknown as Game & { hold(c: string, on: boolean): void }).hold('Space', false));
      await expect.poll(async () => ['dice', 'shown'].includes((await view(host.page)).phase), { timeout: 10000 }).toBe(true);
      await expect.poll(async () => ['roll', 'turn'].includes((await view(host.page)).phase), { timeout: 10000 }).toBe(true);
    }
    await expect.poll(async () => (await view(host.page)).phase, { timeout: 10000 }).toBe('turn');
    const first = (await view(host.page)).cur;
    const names = (await view(host.page)).names;
    const pageOf = (who: number): Page => (names[who] === 'Chu' ? host.page : friend.page);
    const firstMoves = [[6, 2], [6, 3], [6, 4], [6, 5], [6, 6]], secondMoves = [[9, 9], [9, 10], [10, 3], [12, 12]];
    for (let k = 0; k < firstMoves.length; k++) {
      for (const [who, mv] of [[first, firstMoves[k]], [1 - first, secondMoves[k]]] as [number, number[] | undefined][]) {
        if (!mv) continue;
        const n = (await view(host.page)).moves;
        await expect.poll(async () => { const v = await view(host.page); return v.phase === 'turn' && v.cur === who; }, { timeout: 10000 }).toBe(true);
        await expect.poll(async () => (await view(pageOf(who))).moves, { timeout: 10000 }).toBe(n); // that screen has the latest board
        await tapCell(pageOf(who), mv[0], mv[1], false);
        await expect.poll(async () => (await view(host.page)).moves, { timeout: 10000 }).toBe(n + 1);
      }
      if (k === 1) { // the friend sends "Trả tiền đi!" (the second emote): the host's game carries it
        await tapLabel(friend.page, 'Biểu cảm');
        await tapLabel(friend.page, 'Trả tiền đi!');
        await expect.poll(async () => (await view(host.page)).bubbles, { timeout: 5000 }).toContain(1);
      }
    }
    await expect.poll(async () => (await view(friend.page)).phase, { timeout: 10000 }).toBe('over');
    const h = await view(host.page), f = await view(friend.page);
    expect(f.winner).toBe(first);
    expect(f.board).toEqual(h.board);
    expect([...h.names].sort()).toEqual(['Ban', 'Chu']);           // in the order the throws put them
    expect(host.errors).toEqual([]);
    expect(friend.errors).toEqual([]);
  });
});
