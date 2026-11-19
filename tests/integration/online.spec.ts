// Playwright: a whole online game between two screens. The room server (server/server.mjs) runs on its
// own port and serves the folder build (dist/), as on Render; a host and a friend each get their own
// browser context, so their storage is apart, like two phones. The game runs on its own loop and the
// test waits for what each screen shows through window.game (src/hook.ts), tapping the canvas where
// the buttons are in the wide 1280x720 layout.
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';

/** The browser contexts this file opened, closed after each test (Bug: left open, they slowed the files after it). */
const opened: BrowserContext[] = [];
test.afterEach(async () => { await Promise.all(opened.splice(0).map(c => c.close())); });

const PORT = 8790;
const BASE = `http://localhost:${PORT}/`;
// Where the buttons are, in the wide layout's own coordinates (src/main.ts: titleSpots, buildToolbar,
// buildEmoteMenu, animalSpot).
const AT = {
  online: [600, 630], start: [300, 630], rejoin: [1090, 638],
  friendAnimal: [190, 337],                 // seat 2's animal on the title screen
  history: [54, 693], emotes: [152, 693],   // the toolbar under the board
  emotePayUp: [355, 294],                   // "Trả tiền đi!", the second emote
  chat: [360, 415],                         // "Nhắn tin…", beside Đóng under the emotes
};
const EMOTE_PAY_UP = 1;
const FRIEND_SEAT = 1; // a friend takes the first seat after the host's, here a computer's (regression: they used to skip to the free fourth seat)

type Online = { role: string; code: string; mySeat: number; seats: { kind: string; name?: string }[] | null; animals: number[] | null };
type P = { id: number; kind: string; name: string; token: number; orderRoll?: number; offline?: boolean };
type S = { ordering?: boolean; phase: string; cur: number; players: P[]; emotes?: { seat: number; i: number; text?: string }[] };

let server: ChildProcess;
test.beforeAll(async () => {
  if (!existsSync('dist/index.html')) throw new Error('dist/ is missing: npm run build first (npm run test:e2e does)');
  server = spawn(process.execPath, ['server/server.mjs'], { env: { ...process.env, PORT: String(PORT), STATIC_DIR: 'dist' }, stdio: 'ignore' });
  await expect.poll(async () => { try { return (await fetch(`${BASE}health`)).ok; } catch { return false; } }, { timeout: 25000 }).toBe(true); // a busy machine starts node slowly
});
test.afterAll(() => { server?.kill(); });

/** A screen of its own: a fresh browser context with the game open, and its page errors collected. */
async function screen(browser: Browser): Promise<{ page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  opened.push(ctx); // closed after the test: left open, its 3D pages kept drawing through later files and starved them
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}?game=typhu&render=cheap`); // light 3D: two screens draw in software at once
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  return { page, errors };
}
/** Taps the canvas at a point of the 1280x720 layout. */
async function tap(page: Page, [x, y]: number[]) {
  const b = (await page.locator('#game').boundingBox())!;
  await page.mouse.click(b.x + x * b.width / 1280, b.y + y * b.height / 720);
}
const online = (page: Page) => page.evaluate(() => window.game!.online as Online);
const state = (page: Page) => page.evaluate(() => window.game!.state as S);
const sceneOf = (page: Page) => page.evaluate(() => window.game!.scene);
/** Holds the throw (Space) for a moment and lets go, as a player does. */
async function throwDice(page: Page) {
  await page.evaluate(() => { window.game!.press('Space'); window.game!.hold('Space', true); });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.game!.hold('Space', false));
}

/** Each player's throws for the order, in turn order now, read back from the game's history ("X tung được N"):
 * a tie is settled by throwing again, so the order follows these lists compared throw by throw. */
function orderThrows(st: { players: { name: string }[]; history?: string[] }): number[][] {
  return st.players.map(p => (st.history || []).flatMap(l => { const m = /^V\d+: (.+) tung được (\d+)\.$/.exec(l); return m && m[1] === p.name ? [Number(m[2])] : []; }));
}
/** True when each list is above the next, throw by throw (the first that differs decides). */
const inOrder = (keys: number[][]): boolean => keys.every((k, i) => i === 0 || (() => { const a = keys[i - 1]; for (let j = 0; j < Math.max(a.length, k.length); j++) if ((a[j] ?? -1) !== (k[j] ?? -1)) return (a[j] ?? -1) > (k[j] ?? -1); return false; })());

test('a friend joins a room, picks an animal, throws for the order, sends an emote, reads the history and comes back after leaving', async ({ browser }) => {
  test.setTimeout(240000);
  // The host makes a room. Its chat gap is long for the check below: with the game's 3 s, a busy machine
  // took longer than that between a friend's two lines and let the second through.
  const host = await screen(browser);
  await host.page.evaluate(() => (window.game as unknown as { configure(o: unknown): void }).configure({ tune: { chat_gap: 30 } }));
  await tap(host.page, AT.online);
  await host.page.fill('#op-name', 'Chu');
  await host.page.click('#op-create');
  await expect.poll(async () => (await online(host.page)).code, { timeout: 10000 }).toMatch(/^[A-Z0-9]{4}$/);
  const code = (await online(host.page)).code;

  // A friend joins with the code and gets the free seat.
  const friend = await screen(browser);
  await tap(friend.page, AT.online);
  await friend.page.fill('#op-name', 'Ban');
  await friend.page.fill('#op-code', code);
  await friend.page.click('#op-join');
  await expect.poll(async () => (await online(friend.page)).mySeat, { timeout: 10000 }).toBe(FRIEND_SEAT);
  await expect.poll(async () => (await online(host.page)).seats?.[FRIEND_SEAT]).toMatchObject({ kind: 'remote', name: 'Ban' });

  // The friend taps their own animal: the host's setup changes, and nobody shares an animal.
  const before = (await online(host.page)).animals![FRIEND_SEAT];
  await tap(friend.page, AT.friendAnimal);                    // the list of animals opens; take the first free one
  const items = await friend.page.evaluate(() => (window.game!.view as { picker: { label: string; enabled: boolean; x: number; y: number; w: number; h: number }[] | null }).picker);
  const free = items!.find(it => it.enabled && it.label !== ['Chuột', 'Trâu', 'Hổ', 'Mèo', 'Rồng', 'Rắn', 'Ngựa', 'Dê', 'Khỉ', 'Gà', 'Chó', 'Heo'][before])!;
  await tap(friend.page, [free.x + free.w / 2, free.y + free.h / 2]);
  await expect.poll(async () => (await online(host.page)).animals![FRIEND_SEAT]).not.toBe(before);
  const animals = (await online(host.page)).animals!;
  expect(new Set(animals).size).toBe(animals.length);
  await expect.poll(async () => (await online(friend.page)).animals?.[FRIEND_SEAT]).toBe(animals[FRIEND_SEAT]);

  // The host starts; both screens play, and the friend's piece is the animal they picked.
  await tap(host.page, AT.start);
  await expect.poll(() => sceneOf(friend.page), { timeout: 10000 }).toBe('play');
  const mine = (await state(friend.page)).players.find(p => p.id === FRIEND_SEAT)!;
  expect(mine).toMatchObject({ kind: 'remote', name: 'Ban', token: animals[FRIEND_SEAT] });

  // Everyone throws for the order: the host and the friend throw by hand, the computer on its own.
  for (let k = 0; k < 120; k++) {
    const s = await state(host.page);
    if (!s.ordering) break;
    const who = s.players[s.cur];
    if (s.phase === 'order' && who.kind === 'human') await throwDice(host.page);
    if (s.phase === 'order' && who.kind === 'remote') await throwDice(friend.page);
    await host.page.waitForTimeout(400);
  }
  await expect.poll(async () => !!(await state(friend.page)).ordering, { timeout: 20000 }).toBe(false);
  const hostState = await host.page.evaluate(() => window.game!.state as { players: { name: string }[]; history?: string[] });
  expect(inOrder(orderThrows(hostState))).toBe(true); // highest first, lowest last (ties settled among themselves)
  expect((await state(friend.page)).players.map(p => p.name)).toEqual(hostState.players.map(p => p.name)); // the same order on the friend's screen

  // The friend sends an emote: the host's state carries it, over the friend's piece.
  await tap(friend.page, AT.emotes);
  await tap(friend.page, AT.emotePayUp);
  await expect.poll(async () => (await state(host.page)).emotes?.some(e => e.seat === FRIEND_SEAT && e.i === EMOTE_PAY_UP), { timeout: 5000 }).toBe(true);

  // The friend types a line: the host shows it over the friend's piece and writes it in the log; a second
  // line straight after is too soon (chat_gap, 30 s here) and is dropped.
  const line = 'Ai mua Hà Nội thì nhớ xây nhà nha, đừng để trống mãi như vậy chứ các bạn ơi';
  await tap(friend.page, AT.emotes);
  await tap(friend.page, AT.chat);
  await expect(friend.page.locator('#ch-text')).toBeVisible();
  await friend.page.fill('#ch-text', line);
  await friend.page.click('#ch-send');
  await expect.poll(async () => (await state(host.page)).emotes?.some(e => e.seat === FRIEND_SEAT && e.text === line), { timeout: 5000 }).toBe(true);
  await tap(friend.page, AT.emotes);
  await tap(friend.page, AT.chat);
  await friend.page.fill('#ch-text', 'tin thứ hai gửi quá nhanh');
  await friend.page.click('#ch-send');
  await host.page.waitForTimeout(800);
  expect((await state(host.page)).emotes?.some(e => e.text === 'tin thứ hai gửi quá nhanh')).toBe(false);

  // The friend opens the history: the host sends it, and it tells of the throws.
  await tap(friend.page, AT.history);
  await expect(friend.page.locator('#rules')).toBeVisible();
  await expect(friend.page.locator('#rules h2')).toHaveText('Lịch sử ván');
  await expect(friend.page.locator('#rules .ru-body')).toContainText('tung được');
  await expect(friend.page.locator('#rules .ru-body')).toContainText(`Ban: ${line}`);
  await friend.page.click('#rules .ru-close');

  // The friend's page reloads (a dropped phone): the host marks them away; "Vào lại phòng" brings them
  // back to the same seat and the same animal.
  await friend.page.reload();
  await expect.poll(async () => (await state(host.page)).players.find(p => p.id === FRIEND_SEAT)!.offline, { timeout: 10000 }).toBe(true);
  await expect.poll(() => friend.page.evaluate(() => typeof window.game?.step)).toBe('function');
  await tap(friend.page, AT.rejoin);
  await expect.poll(() => sceneOf(friend.page), { timeout: 10000 }).toBe('play');
  expect((await online(friend.page)).mySeat).toBe(FRIEND_SEAT);
  await expect.poll(async () => (await state(host.page)).players.find(p => p.id === FRIEND_SEAT), { timeout: 10000 })
    .toMatchObject({ kind: 'remote', offline: false, token: animals[FRIEND_SEAT] });

  expect(host.errors).toEqual([]);
  expect(friend.errors).toEqual([]);
});

test("a friend back mid-way through the computer's shake on their seat cannot take it over", async ({ browser }) => {
  // Regression (full review 19/11/2026): while a friend was away the computer shook for their seat; their "shake" act on
  // coming back marked that shake as theirs, and their "throw" then set its power.
  test.setTimeout(120000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } }); opened.push(ctx);
  const page = await ctx.newPage();
  // the host's socket, kept where the test can hand it a message as the server would
  await page.addInitScript(() => {
    const Real = window.WebSocket;
    (window as unknown as { sockets: WebSocket[] }).sockets = [];
    window.WebSocket = class extends Real { constructor(u: string | URL, p?: string | string[]) { super(u, p); (window as unknown as { sockets: WebSocket[] }).sockets.push(this); } } as typeof WebSocket;
  });
  await page.goto(`${BASE}?game=typhu&render=cheap`);
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  const host = { page, errors: [] as string[] };
  page.on('pageerror', e => host.errors.push(e.message));
  await tap(page, AT.online);
  await page.fill('#op-name', 'Chu');
  await page.click('#op-create');
  await expect.poll(async () => (await online(page)).code, { timeout: 10000 }).toMatch(/^[A-Z0-9]{4}$/);
  const friend = await screen(browser);
  await tap(friend.page, AT.online);
  await friend.page.fill('#op-name', 'Ban');
  await friend.page.fill('#op-code', (await online(page)).code);
  await friend.page.click('#op-join');
  await expect.poll(async () => (await online(friend.page)).mySeat, { timeout: 10000 }).toBe(FRIEND_SEAT);
  await tap(page, AT.start);
  await expect.poll(() => sceneOf(page), { timeout: 10000 }).toBe('play');

  const seen = await page.evaluate((seat) => {
    type Sh = { t: number; ai: boolean; holdFor: number; rattle: number; zone: { a: number; b: number }; remote?: boolean; power?: number };
    const s = window.game!.state as { ordering?: boolean; phase: string; cur: number; zone?: unknown; shaking?: Sh | null; players: { id: number; peer?: number }[] };
    const fi = s.players.findIndex(p => p.id === seat), peer = s.players[fi].peer!;
    // the friend's turn, the computer shaking for them (as while they were away), long enough for the test
    s.ordering = false; s.cur = fi; s.phase = 'roll'; s.zone = undefined;
    s.shaking = { t: 0, ai: true, holdFor: 8, rattle: 0, zone: { a: 0.4, b: 0.5 } };
    const sock = (window as unknown as { sockets: WebSocket[] }).sockets.find(w => w.readyState === 1)!;
    const fromFriend = (data: unknown) => sock.onmessage!(new MessageEvent('message', { data: JSON.stringify({ t: 'fromPeer', from: peer, data }) }));
    fromFriend({ k: 'act', act: 'shake' });                    // back, and pressing shake at once
    fromFriend({ k: 'act', act: 'throw', i: 0.45 });           // and letting go
    return { ai: s.shaking?.ai, remote: !!s.shaking?.remote, power: s.shaking?.power ?? null };
  }, FRIEND_SEAT);
  expect(seen).toEqual({ ai: true, remote: false, power: null }); // still the computer's shake, its let-go its own
  expect(host.errors).toEqual([]);
  expect(friend.errors).toEqual([]);
});
