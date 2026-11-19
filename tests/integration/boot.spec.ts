// Playwright: the single-file build opened from disk, driven through the
// game-state hook (src/hook.ts). npm run smoke runs only the @boot test.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CARDS } from '../../src/game/data';

const config = JSON.parse(readFileSync('data/config.json', 'utf8'));
const build = (query: string): string => `${pathToFileURL(resolve('dist-single/index.html')).href}?game=typhu&${query}`;

/** Taps a point of the wide 1280x720 layout. */
async function tapAt(page: Page, x: number, y: number) {
  const b = (await page.locator('#game').boundingBox())!;
  await page.mouse.click(b.x + x * b.width / 1280, b.y + y * b.height / 720);
  await page.evaluate(() => window.game!.step(2));
}
/** Opens the dropdown at (x, y) and picks the item with this label (window.game.view.picker). */
async function pick(page: Page, x: number, y: number, label: string) {
  await tapAt(page, x, y);
  const items = await page.evaluate(() => (window.game!.view as { picker: { label: string; x: number; y: number; w: number; h: number }[] | null }).picker);
  const it = items?.find(i => i.label === label);
  if (!it) throw new Error(`no "${label}" in the list: ${JSON.stringify(items?.map(i => i.label))}`);
  await tapAt(page, it.x + it.w / 2, it.y + it.h / 2);
}
const SEAT_X = 580, seatY = (i: number): number => 250 + i * 62 + 25;   // a seat's kind, wide title
const KIND_Y = 250 + 4 * 62 + 10 + 25, SINGLE_X = 503, LENGTH_X = 657; // single/team and the length
const TEAM_X = 373;                                                      // a seat's team

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
  // the phone layout is 480 wide and as tall as the phone (here 812/375), so no empty bands above and below
  expect(box && box.height / box.width).toBeCloseTo(812 / 375, 1);
  expect(box && box.height).toBeCloseTo(812, -1);
  const scene = await page.evaluate(() => {
    const g = window.game!;
    g.press('Enter'); g.step();
    g.press('Space'); g.step(); g.step(240);
    return g.scene;
  });
  expect(scene).toBe('play');
  expect(errors).toEqual([]);
});

/** Each player's throws for the order, in turn order now, read back from the game's history ("X tung được N"):
 * a tie is settled by throwing again, so the order follows these lists compared throw by throw. */
function orderThrows(st: { players: { name: string }[]; history?: string[] }): number[][] {
  return st.players.map(p => (st.history || []).flatMap(l => { const m = /^V\d+: (.+) tung được (\d+)\.$/.exec(l); return m && m[1] === p.name ? [Number(m[2])] : []; }));
}
/** True when each list is above the next, throw by throw (the first that differs decides). */
const inOrder = (keys: number[][]): boolean => keys.every((k, i) => i === 0 || (() => { const a = keys[i - 1]; for (let j = 0; j < Math.max(a.length, k.length); j++) if ((a[j] ?? -1) !== (k[j] ?? -1)) return (a[j] ?? -1) > (k[j] ?? -1); return false; })());

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
  const keys = orderThrows(first.state as { players: { name: string }[]; history?: string[] });
  expect(keys.every(k => k.length >= 1)).toBe(true);
  expect(inOrder(keys)).toBe(true); // highest first, lowest last; ties thrown again and settled among themselves
  expect(first.cash.every(c => c === config.start_cash.value)).toBe(true); // nobody moved yet
  expect(await run()).toEqual(first);
});

test('the second seat can be set to not playing, and a game will not start with fewer than two players', async ({ page }) => {
  // Regression: seats 1 and 2 never offered "Không chơi", so a host online could not leave seat 2 empty.
  const errors = await open(page, 'manual=1&seed=7');
  const seatKind = (i: number) => page.evaluate(k => (window.game!.online as { seats: { kind: string }[] }).seats[k].kind, i);
  /** Picks a seat's kind from its list on the wide title screen. */
  async function setSeat(i: number, kind: string) {
    await pick(page, SEAT_X, seatY(i), kind === 'off' ? 'Không chơi' : 'Máy · Vừa');
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

test('the kind of game is picked from two lists, single or teams and how long, and a 50-round game ends after round 50', async ({ page }) => {
  // Asked for: dropdowns on the setup screen, Đơn/Đội and 30 vòng/50 vòng/tới khi phá sản.
  const errors = await open(page, 'manual=1&seed=7');
  const kind = () => page.evaluate(() => { const o = window.game!.online as { mode: string; rounds: number; teams: boolean }; return (o.teams ? 'teams ' : '') + (o.mode === 'rounds' ? `${o.rounds}` : o.mode); });
  expect(await kind()).toBe('bankrupt');
  await pick(page, LENGTH_X, KIND_Y, '30 vòng');
  expect(await kind()).toBe('30');
  await pick(page, SINGLE_X, KIND_Y, 'Đội (2 đấu 2)');
  expect(await kind()).toBe('teams 30');
  await pick(page, SINGLE_X, KIND_Y, 'Đơn');
  await pick(page, LENGTH_X, KIND_Y, '50 vòng');
  expect(await kind()).toBe('50');
  await tapAt(page, LENGTH_X, KIND_Y);                         // a tap outside an open list closes it, changing nothing
  await tapAt(page, 100, 100);
  expect(await page.evaluate(() => (window.game!.view as { picker: unknown }).picker)).toBe(null);
  expect(await kind()).toBe('50');
  await page.evaluate(() => { window.game!.press('Enter'); window.game!.step(5); });
  expect(await page.evaluate(() => (window.game!.state as { maxRounds?: number }).maxRounds)).toBe(50);
  expect(errors).toEqual([]);
});

test("the host picks who plays with whom, and uneven teams do not start", async ({ page }) => {
  // Asked for: choose the teams; a full colour group counts the whole team.
  const errors = await open(page, 'manual=1&seed=7');
  await page.evaluate(() => window.game!.configure!({ seats: [{ kind: 'human' }, { kind: 'ai', lv: 1 }, { kind: 'ai', lv: 1 }, { kind: 'ai', lv: 1 }] }));
  await page.evaluate(() => window.game!.step(2));
  await pick(page, SINGLE_X, KIND_Y, 'Đội (2 đấu 2)');
  await pick(page, TEAM_X, seatY(1), 'Đội 1');                 // seats 1, 2 and 3 in team 1: uneven
  await page.evaluate(() => { window.game!.press('Enter'); window.game!.step(2); });
  expect(await page.evaluate(() => window.game!.scene)).toBe('title');
  await pick(page, TEAM_X, seatY(2), 'Đội 2');                 // seats 1+2 against 3+4
  await page.evaluate(() => { window.game!.press('Enter'); window.game!.step(3); });
  expect(await page.evaluate(() => window.game!.scene)).toBe('play');
  const teams = await page.evaluate(() => (window.game!.state as { players: { id: number; team?: number }[] }).players.map(p => [p.id, p.team]));
  expect(Object.fromEntries(teams)).toEqual({ 0: 0, 1: 0, 2: 1, 3: 1 });
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
  // what was kept: the game goes on a little after the last keep, and the reload brings back the kept one
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('tpdv-local-game') || 'null').state as S);
  expect(before.round).toBeGreaterThanOrEqual(7); // kept after the round was set (the 120 steps may end that round: how far depends on the shake's pace)
  await page.reload();
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  expect(await page.evaluate(() => window.game!.scene)).toBe('title');
  const box = (await page.locator('#game').boundingBox())!;
  await page.mouse.click(box.x + 1090 * box.width / 1280, box.y + 638 * box.height / 720); // "Chơi tiếp ván trước"
  await page.evaluate(() => window.game!.step(2));
  expect(await page.evaluate(() => window.game!.scene)).toBe('play');
  const after = await page.evaluate(() => window.game!.state as S);
  expect(after.round).toBe(before.round);
  expect(after.players.map(p => [p.name, p.cash])).toEqual(before.players.map(p => [p.name, p.cash]));
  // a piece kept mid-move goes on hopping once the game is back: at most one tile further
  after.players.forEach((p, k) => expect([before.players[k].pos, (before.players[k].pos + 1) % 40]).toContain(p.pos));
  expect(errors).toEqual([]);
});

test('a new game deals every card of both decks, the rare kept cards too', async ({ page }) => {
  // Regression: the decks were dealt as 16 cards, so a 17th card (Thẻ Đổ Lại, Thẻ Miễn Thuê) never came up.
  const errors = await open(page, 'manual=1&seed=7');
  const decks = await page.evaluate(() => { const g = window.game!; g.press('Enter'); g.step(2); return (g.state as { decks: { co: number[]; kv: number[] } }).decks; });
  const sizes = { co: CARDS.co.length, kv: CARDS.kv.length };
  expect([...decks.co].sort((a, b) => a - b)).toEqual([...Array(sizes.co).keys()]);
  expect([...decks.kv].sort((a, b) => a - b)).toEqual([...Array(sizes.kv).keys()]);
  expect(errors).toEqual([]);
});

test('the computers draw and use Thẻ Miễn Thuê and Thẻ Đổ Lại in long games', async ({ page }) => {
  // The rare kept cards end up used: rent skipped once, a throw taken back. Self-play, no drawing.
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(build('manual=1&render=cheap'));
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  const lines = await page.evaluate(() => {
    const g = window.game!, out: string[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      g.configure({ seats: [{ kind: 'ai', lv: 1 }, { kind: 'ai', lv: 1 }, { kind: 'ai', lv: 1 }, { kind: 'ai', lv: 1 }], mode: 'rounds', rounds: 50, seed });
      g.press('Enter'); g.step(1, false);
      for (let n = 0; g.scene === 'play' && n < 600000; n += 600) g.step(600, false);
      out.push(...((g.state as { history?: string[] }).history || []));
    }
    return out;
  });
  expect(lines.some(l => l.includes('rút thẻ Khí Vận: Thẻ Miễn Thuê'))).toBe(true);
  expect(lines.some(l => l.includes('rút thẻ Cơ Hội: Thẻ Đổ Lại'))).toBe(true);
  expect(lines.some(l => l.includes('dùng Thẻ Miễn Thuê'))).toBe(true);
  expect(lines.some(l => l.includes('dùng Thẻ Đổ Lại'))).toBe(true);
  expect(errors).toEqual([]);
});

test('two teams: teammates pay each other no rent, the game ends when one team is left, and it needs four players', async ({ page }) => {
  // Asked for: 2 against 2. Seats 1 and 3 are one team, seats 2 and 4 the other.
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(build('manual=1&render=cheap'));
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  const ai = { kind: 'ai', lv: 1 };
  const r = await page.evaluate(seats => {
    const g = window.game!;
    type P = { id: number; team?: number; bankrupt: boolean };
    type S = { players: P[]; history?: string[]; ranking: { i: number }[]; teams?: boolean };
    // three seats: a team game does not start
    g.configure({ seats: [seats[0], seats[0], seats[0], { kind: 'off' }], mode: 'bankrupt', teams: true, seed: 3 });
    g.press('Enter'); g.step(2, false);
    const threeStarts = g.scene !== 'title';
    const games: { teams: (number | undefined)[]; left: number[]; winnerTeam?: number; rentBetween: number; teammateLines: number }[] = [];
    for (let seed = 1; seed <= 4; seed++) {
      g.configure({ seats, mode: 'bankrupt', teams: true, seed });
      g.press('Enter'); g.step(1, false);
      const events: { type: string; from?: number; to?: number }[] = [];
      for (let n = 0; g.scene === 'play' && n < 2000000; n += 600) { g.step(600, false); events.push(...(g.events as typeof events)); (g.events as unknown[]).length = 0; }
      const s = g.state as S;
      const teamOf = (k: number) => s.players[k].team;
      games.push({
        teams: s.players.map(p => p.team), left: s.players.filter(p => !p.bankrupt).map(p => p.team!),
        winnerTeam: g.scene === 'results' ? s.players[s.ranking[0].i].team : undefined,
        rentBetween: events.filter(e => e.type === 'rent' && teamOf(e.from!) === teamOf(e.to!)).length,
        teammateLines: (s.history || []).filter(l => l.includes('đất đồng đội')).length,
      });
    }
    return { threeStarts, games };
  }, [ai, ai, ai, ai]);
  expect(r.threeStarts).toBe(false);
  for (const gm of r.games) {
    expect([...gm.teams].sort()).toEqual([0, 0, 1, 1]);
    expect(gm.rentBetween).toBe(0);
    if (gm.winnerTeam !== undefined) expect(new Set(gm.left)).toEqual(new Set([gm.winnerTeam]));
  }
  expect(r.games.some(gm => gm.winnerTeam !== undefined)).toBe(true);
  expect(r.games.some(gm => gm.teammateLines > 0)).toBe(true);
  expect(errors).toEqual([]);
});

test('the end-of-game summary adds up the rent that was paid, tile by tile and player by player', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(build('manual=1&render=cheap'));
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  const r = await page.evaluate(() => {
    const g = window.game!;
    g.configure({ seats: [{ kind: 'ai', lv: 1 }, { kind: 'ai', lv: 1 }, { kind: 'ai', lv: 1 }, { kind: 'off' }], mode: 'rounds', rounds: 30, seed: 5 });
    g.press('Enter'); g.step(1, false);
    let rent = 0;
    for (let n = 0; g.scene === 'play' && n < 1000000; n += 600) { g.step(600, false); for (const e of g.events as { type: string; amt?: number }[]) if (e.type === 'rent') rent += e.amt!; (g.events as unknown[]).length = 0; }
    const st = (g.state as { stats?: { paid: number[]; got: number[]; tile: Record<string, number> } }).stats!;
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    return { scene: g.scene, rent, paid: sum(st.paid), got: sum(st.got), tile: sum(Object.values(st.tile)) };
  });
  expect(r.scene).toBe('results');
  expect(r.rent).toBeGreaterThan(0);
  expect([r.paid, r.got, r.tile]).toEqual([r.rent, r.rent, r.rent]);
  expect(errors).toEqual([]);
});

test('a first-game tip shows at the first throw, goes for good with Đã hiểu, and stays gone after a reload', async ({ page }) => {
  // Checks run without tips; ?tutorial=1 asks for them.
  const errors = await open(page, 'manual=1&seed=7&tutorial=1');
  const tip = () => page.evaluate(() => (window.game!.view as { tip: string | null }).tip);
  const start = () => page.evaluate(() => {
    const g = window.game!;
    g.configure!({ seats: [{ kind: 'human' }, { kind: 'ai', lv: 1 }, { kind: 'off' }, { kind: 'off' }], tune: { order_roll: 0 } });
    g.press('Enter'); g.step(3);
  });
  await start();
  expect(await tip()).toBe('roll');
  await tapAt(page, 731, 164);                                  // "Đã hiểu"
  expect(await tip()).toBe(null);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tpdv-tips') || '[]'))).toContain('roll');
  await page.reload();
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  await start();
  expect(await tip()).toBe(null);
  expect(errors).toEqual([]);
});

/** Two computers play until a turn is about to be thrown, then the player to move becomes a
 * person, so a check can put that person in a spot (in debt, in jail) and press the keys. */
async function personToMove(page: Page) {
  await page.evaluate(() => {
    const g = window.game!;
    g.configure({ seats: [{ kind: 'ai', lv: 1 }, { kind: 'ai', lv: 1 }, { kind: 'off' }, { kind: 'off' }] });
    g.press('Enter'); g.step(1, false);
    type S = { phase: string; ordering?: boolean; cur: number; players: { kind: string }[] };
    const s = (): S => g.state as S;
    for (let n = 0; n < 20000 && !(s().phase === 'roll' && !s().ordering); n++) g.step(1, false);
    s().players[s().cur].kind = 'human';
  });
}

test('a game kept while a person is in debt comes back after a reload, and paying the debt goes on with the turn', async ({ page }) => {
  // Bug: the debt kept a function for "what comes after paying"; a kept game (JSON) lost it, and
  // after a reload "Trả nợ" threw and froze the game for good.
  const errors = await open(page, 'manual=1&seed=7');
  await personToMove(page);
  await page.evaluate(() => {
    const g = window.game!;
    const s = g.state as { phase: string; timer: number; debt: unknown; cur: number; players: { cash: number }[] };
    s.players[s.cur].cash = 500;
    s.debt = { payments: [{ to: -1, amt: 100 }], total: 100, why: '', next: 'rent' }; s.phase = 'debt'; s.timer = 0;
    g.step(120, false);                                       // long enough for the game to be kept
  });
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('tpdv-local-game') || 'null').state.phase);
  expect(kept).toBe('debt');
  await page.reload();
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  await tapAt(page, 1090, 638);                               // "Chơi tiếp ván trước"
  expect(await page.evaluate(() => window.game!.scene)).toBe('play');
  const after = await page.evaluate(() => {
    const g = window.game!;
    g.press('Space'); g.step(2);                              // "Trả nợ"
    const s = g.state as { phase: string; debt: unknown; cur: number; players: { cash: number }[] };
    return { phase: s.phase, debt: s.debt, cash: s.players[s.cur].cash };
  });
  expect(after).toEqual({ phase: 'rentShow', debt: null, cash: 400 });
  expect(errors).toEqual([]);
});

test('N and Esc never declare bankruptcy in debt, nor spend the Thẻ Ra Tù in jail', async ({ page }) => {
  // Bug: N / Esc ("bỏ qua") pressed the first secondary button: "Phá sản" in debt, the jail card in jail.
  const errors = await open(page, 'manual=1&seed=7');
  await personToMove(page);
  const seen = await page.evaluate(() => {
    const g = window.game!;
    type P = { cash: number; bankrupt: boolean; inJail: boolean; freeCards: string[] };
    const s = g.state as { phase: string; timer: number; debt: unknown; cur: number; players: P[] };
    const p = s.players[s.cur];
    p.inJail = true; p.freeCards = ['co']; s.phase = 'jail'; s.timer = 0; // jail first: a bankruptcy would end the game
    g.step(1, false); g.press('KeyN'); g.step(1, false); g.press('Escape'); g.step(1, false);
    const jail = { phase: s.phase, inJail: p.inJail, cards: p.freeCards.length };
    p.inJail = false; p.freeCards = [];
    p.cash = 50; s.debt = { payments: [{ to: -1, amt: 100 }], total: 100, why: '', next: 'after' }; s.phase = 'debt'; s.timer = 0;
    g.step(1, false); g.press('KeyN'); g.step(1, false); g.press('Escape'); g.step(1, false);
    return { debt: { phase: s.phase, bankrupt: p.bankrupt }, jail };
  });
  expect(seen).toEqual({ debt: { phase: 'debt', bankrupt: false }, jail: { phase: 'jail', inJail: true, cards: 1 } });
  expect(errors).toEqual([]);
});

test('two taps on "Kết thúc lượt" in the same step end the turn once, not skipping the next player', async ({ page }) => {
  // Bug: every tap queued in one step pressed against the same buttons, so the turn ended twice.
  const errors = await open(page, 'manual=1&seed=7');
  await personToMove(page);
  const before = await page.evaluate(() => {
    const g = window.game!;
    const s = g.state as { phase: string; timer: number; cur: number };
    s.phase = 'end'; s.timer = 0; g.step(1);
    return s.cur;
  });
  type B = { label: string; x: number; y: number; w: number; h: number };
  const end = (await page.evaluate(() => (window.game!.view as { buttons: B[] }).buttons)).find(b => b.label === 'Kết thúc lượt')!;
  expect(end).toBeTruthy();
  const box = (await page.locator('#game').boundingBox())!;
  const at = { x: box.x + (end.x + end.w / 2) * box.width / 1280, y: box.y + (end.y + end.h / 2) * box.height / 720 };
  await page.mouse.click(at.x, at.y); await page.mouse.click(at.x, at.y); // both before the next step
  const after = await page.evaluate(() => { window.game!.step(1, false); return (window.game!.state as { cur: number }).cur; });
  expect(after).toBe((before + 1) % 2);
  expect(errors).toEqual([]);
});

test('in a team game, "each player" cards skip the teammate: the birthday card and the hotpot card', async ({ page }) => {
  // Decided: a teammate neither pays nor is paid by a card, as with rent (it used to charge them too).
  const errors = await open(page, 'manual=1&seed=5&render=cheap');
  const collect = CARDS.kv.findIndex(c => c.act === 'collect'), payeach = CARDS.co.findIndex(c => c.act === 'payeach');
  const cards = { collect: { deck: 'kv', ci: collect, card: CARDS.kv[collect] }, payeach: { deck: 'co', ci: payeach, card: CARDS.co[payeach] } };
  const r = await page.evaluate(cards => {
    const g = window.game!, ai = { kind: 'ai', lv: 1 };
    type P = { cash: number; team?: number; bankrupt: boolean };
    type S = { phase: string; ordering?: boolean; timer: number; cur: number; popup: unknown; players: P[] };
    g.configure({ seats: [ai, ai, ai, ai], mode: 'bankrupt', teams: true });
    g.press('Enter'); g.step(1, false);
    const s = () => g.state as S;
    const play = (c: { deck: string; ci: number; card: unknown }) => {
      for (let n = 0; n < 20000 && !(s().phase === 'roll' && !s().ordering); n++) g.step(1, false);
      s().players.forEach(p => { p.cash = 5000; });
      const cur = s().cur;
      s().popup = { kind: 'card', ...c }; s().phase = 'card'; s().timer = 0;
      for (let n = 0; n < 2000 && s().phase === 'card'; n++) g.step(1, false); // the computer takes the card
      const team = s().players[cur].team;
      return s().players.map((p, j) => ({ who: j === cur ? 'me' : p.team === team ? 'mate' : 'other', change: p.cash - 5000 }));
    };
    return { collect: play(cards.collect), payeach: play(cards.payeach) };
  }, cards);
  const v = CARDS.kv[collect].v as number; // both cards move the same amount (src/game/data.ts)
  const sum = (rows: { who: string; change: number }[], who: string) => rows.filter(x => x.who === who).map(x => x.change);
  expect(sum(r.collect, 'mate')).toEqual([0]);
  expect(sum(r.collect, 'other')).toEqual([-v, -v]);
  expect(sum(r.collect, 'me')).toEqual([2 * v]);
  expect(sum(r.payeach, 'mate')).toEqual([0]);
  expect(sum(r.payeach, 'other')).toEqual([v, v]);
  expect(sum(r.payeach, 'me')).toEqual([-2 * v]);
  expect(errors).toEqual([]);
});

test('a player who goes bankrupt gives their kept cards back to the decks, so no card leaves the game', async ({ page }) => {
  // Bug: a bankrupt player's Thẻ Ra Tù, Miễn Thuê and Đổ Lại were dropped, and the decks shrank for good.
  const errors = await open(page, 'manual=1&seed=7');
  await personToMove(page);
  const keepOf = (act: string) => (['co', 'kv'] as const).flatMap(d => CARDS[d].some(c => c.act === act) ? [{ act, deck: d }] : []);
  const kept = [...keepOf('norent'), ...keepOf('reroll')];
  const out = [{ deck: 'co', i: CARDS.co.findIndex(c => c.act === 'free') }, ...kept.map(k => ({ deck: k.deck, i: CARDS[k.deck].findIndex(c => c.act === k.act) }))];
  type B = { label: string; x: number; y: number; w: number; h: number };
  await page.evaluate(([kept, out]) => {
    const g = window.game!;
    type P = { cash: number; freeCards: string[]; keep?: unknown[] };
    const s = g.state as { phase: string; timer: number; debt: unknown; cur: number; players: P[]; decks: Record<string, number[]> };
    const p = s.players[s.cur];
    // the cards they hold come out of the decks, as a draw takes them
    p.freeCards = ['co']; p.keep = kept;
    const st = s as unknown as { used: Record<string, number[]> };
    for (const o of out) { s.decks[o.deck] = s.decks[o.deck].filter(i => i !== o.i); st.used[o.deck] = st.used[o.deck].filter(i => i !== o.i); }
    p.cash = 0; s.debt = { payments: [{ to: -1, amt: 100 }], total: 100, why: '', next: 'after' }; s.phase = 'debt'; s.timer = 0;
    g.step(1);
  }, [kept, out] as const);
  const bankrupt = (await page.evaluate(() => (window.game!.view as { buttons: B[] }).buttons)).find(b => b.label === 'Phá sản')!;
  await tapAt(page, bankrupt.x + bankrupt.w / 2, bankrupt.y + bankrupt.h / 2);
  const s = await page.evaluate(() => window.game!.state as { decks: Record<string, number[]>; used: Record<string, number[]>; players: { bankrupt: boolean; freeCards: string[]; keep?: { deck: string }[] }[] });
  expect(s.players.some(p => p.bankrupt)).toBe(true);
  for (const d of ['co', 'kv'] as const) {
    const held = s.players.filter(p => !p.bankrupt).flatMap(p => [...p.freeCards.filter(x => x === d), ...(p.keep || []).filter(k => k.deck === d)]).length;
    const inPlay = new Set([...s.decks[d], ...s.used[d]]);
    expect(inPlay.size + held).toBe(CARDS[d].length);
  }
  expect(errors).toEqual([]);
});

test('the summary counts rent that was paid: in full after a debt, only the part paid at a bankruptcy', async ({ page }) => {
  // Bug: rent was counted when it was owed, so a payer who went bankrupt left money in the summary that never moved.
  const errors = await open(page, 'manual=1&seed=7');
  await personToMove(page);
  type B = { label: string; x: number; y: number; w: number; h: number };
  type St = { paid: number[]; got: number[]; tile: Record<string, number> } | undefined;
  const HA_NOI = 14;
  const owe = (cash: number, amt: number) => page.evaluate(([cash, amt, tile]) => {
    const g = window.game!;
    const s = g.state as { phase: string; timer: number; debt: unknown; cur: number; players: { cash: number }[]; stats?: unknown };
    const other = (s.cur + 1) % 2;
    s.stats = undefined; s.players[s.cur].cash = cash;
    s.debt = { payments: [{ to: other, amt, rentTile: tile }], total: amt, why: '', next: 'after' }; s.phase = 'debt'; s.timer = 0;
    g.step(1);
  }, [cash, amt, HA_NOI] as const);
  const tap = async (label: string) => {
    const b = (await page.evaluate(() => (window.game!.view as { buttons: B[] }).buttons)).find(x => x.label === label)!;
    await tapAt(page, b.x + b.w / 2, b.y + b.h / 2);
  };
  const stats = () => page.evaluate(() => (window.game!.state as { stats?: unknown }).stats as St);
  const total = (st: St) => st ? [st.paid.reduce((a, b) => a + b, 0), st.got.reduce((a, b) => a + b, 0), st.tile[HA_NOI]] : null;

  await owe(500, 400); await tap('Trả nợ');
  expect(total(await stats())).toEqual([400, 400, 400]);
  await owe(300, 1000); await tap('Phá sản');
  expect(total(await stats())).toEqual([300, 300, 300]);
  expect(errors).toEqual([]);
});

test('a rounds game that ends with the richest players level says it is a tie, not a winner by seat order', async ({ page }) => {
  // Bug: two players worth the same: the one first in turn order was "là tỷ phú, thắng ván!".
  const errors = await open(page, 'manual=1&seed=7&render=cheap');
  const r = await page.evaluate(() => {
    const g = window.game!;
    type S = { phase: string; ordering?: boolean; timer: number; cur: number; round: number; maxRounds: number; owner: number[]; level: number[]; players: { cash: number }[]; gained: string };
    g.configure({ seats: [{ kind: 'ai', lv: 1 }, { kind: 'ai', lv: 1 }, { kind: 'off' }, { kind: 'off' }], mode: 'rounds', rounds: 30 });
    g.press('Enter'); g.step(1, false);
    const s = () => g.state as S;
    for (let n = 0; n < 50000 && !(s().phase === 'roll' && !s().ordering && s().cur === 1); n++) g.step(1, false);
    // the last player's turn of the last round, everyone level: no land, the same cash
    s().round = s().maxRounds; s().owner.fill(-1); s().level.fill(0); s().players.forEach(p => { p.cash = 3000; });
    s().phase = 'end'; s().timer = 0;
    for (let n = 0; n < 2000 && g.scene === 'play'; n++) g.step(1, false);
    return { scene: g.scene, gained: s().gained };
  });
  expect(r.scene).toBe('results');
  expect(r.gained).toContain('Hòa!');
  expect(r.gained).not.toContain('thắng ván');
  expect(errors).toEqual([]);
});

test('a game resumed after a reload throws the same dice it would have thrown had it gone on', async ({ page }) => {
  // Regression (full review 19/11/2026): the random numbers were not kept with the game, so a resumed game drew from the
  // page's own start, the same dice for every resumed game, whatever was left.
  const errors = await open(page, 'manual=1&seed=7');
  const DICE = /đổ (\d+)\s*[-+]\s*(\d+)/;
  const live = await page.evaluate((src) => {
    const g = window.game!, re = new RegExp(src);
    g.configure({ seats: [{ kind: 'ai', lv: 1 }, { kind: 'ai', lv: 1 }, { kind: 'off' }, { kind: 'off' }] });
    g.press('Enter'); g.step(1); g.step(600, false);                      // the computers play a while
    const at = () => JSON.parse(localStorage.getItem('tpdv-local-game') || 'null');
    let kept = at(), last = kept?.at;
    for (let k = 0; k < 2000; k++) {                                      // to a keep made between two shakes
      g.step(1, false); const now = at();
      if (now && now.at !== last) { last = now.at; if (!now.state.shaking) { kept = now; break; } }
    }
    const from = kept.state.history.length;
    g.step(4500, false);                                                  // the game goes on, never reloaded
    const s = g.state as { history: string[] };
    return { kept: JSON.stringify(kept), dice: s.history.slice(from).filter(l => re.test(l)).slice(0, 8).map(l => l.match(re)!.slice(1).join('-')) };
  }, DICE.source);
  expect(live.dice.length).toBe(8);
  await page.evaluate(k => localStorage.setItem('tpdv-local-game', k), live.kept);
  await page.reload();
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  const box = (await page.locator('#game').boundingBox())!;
  await page.mouse.click(box.x + 1090 * box.width / 1280, box.y + 638 * box.height / 720); // "Chơi tiếp ván trước"
  const resumed = await page.evaluate(({ src, from }) => {
    const g = window.game!, re = new RegExp(src);
    g.step(4500, false);
    const s = g.state as { history: string[] };
    return s.history.slice(from).filter(l => re.test(l)).slice(0, 8).map(l => l.match(re)!.slice(1).join('-'));
  }, { src: DICE.source, from: JSON.parse(live.kept).state.history.length });
  expect(resumed).toEqual(live.dice);
  expect(errors).toEqual([]);
});
