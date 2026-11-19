// Playwright: the browser's side of online play (src/net/net.ts, the games' online.ts), against a room
// server the test plays itself (page.routeWebSocket), so it can stay silent or send exactly what a
// host would. The page comes from server/server.mjs serving the folder build (dist/), as on Render.
import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';

const PORT = 8792;
const BASE = `http://localhost:${PORT}/`;
const CODE = 'AB12';
/** The build served: dist/, or another build (NET_SPEC_DIST) to watch a test fail on older code. */
const DIST = process.env.NET_SPEC_DIST || 'dist';

let server: ChildProcess;
test.beforeAll(async () => {
  test.setTimeout(40000);
  if (!existsSync(`${DIST}/index.html`)) throw new Error(`${DIST}/ is missing: npm run build first (npm run test:e2e does)`);
  server = spawn(process.execPath, ['server/server.mjs'], { env: { ...process.env, PORT: String(PORT), STATIC_DIR: DIST }, stdio: 'ignore' });
  await expect.poll(async () => { try { return (await fetch(`${BASE}health`)).ok; } catch { return false; } }, { timeout: 25000 }).toBe(true);
});
test.afterAll(() => { server?.kill(); });

/** Taps the canvas at a point of the wide 1280x720 layout, then runs two steps (the pages here are ?manual=1). */
async function tap(page: Page, x: number, y: number) {
  const b = (await page.locator('#game').boundingBox())!;
  await page.mouse.click(b.x + x * b.width / 1280, b.y + y * b.height / 720);
  await page.evaluate(() => window.game!.step(2));
}
/** The room server, played by the test: every socket the page opens, and what it sent. */
async function fakeServer(page: Page, onMessage: (ws: WebSocketRoute, m: Record<string, unknown>) => void) {
  const sockets: WebSocketRoute[] = [], sent: Record<string, unknown>[] = [];
  await page.routeWebSocket(/\/ws$/, ws => {
    sockets.push(ws);
    ws.onMessage(raw => { const m = JSON.parse(String(raw)); sent.push(m); onMessage(ws, m); });
  });
  return { sockets, sent };
}

test('a link that hears nothing from the server for 50 s is let go and opened again, and gets the room back', async ({ page }) => {
  // A phone that changes network keeps a dead socket "open" for minutes. The server beats every 20 s;
  // the page counts silence and reconnects, asking for its room back, not a new one.
  await page.clock.install();
  const srv = await fakeServer(page, (ws, m) => { if (m.t === 'create') ws.send(JSON.stringify({ t: 'created', code: CODE, id: 0, ...(m.fresh ? {} : { back: true }) })); });
  await page.goto(`${BASE}?game=typhu&render=cheap&manual=1`);
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  await tap(page, 600, 630);                                   // "Chơi online" (src/main.ts titleSpots)
  await page.fill('#op-name', 'Chu');
  await page.click('#op-create');
  await expect.poll(() => srv.sockets.length).toBe(1);
  const creates = () => srv.sent.filter(m => m.t === 'create');
  expect(creates()[0]).toMatchObject({ fresh: true });         // "Tạo phòng mới" asks for a new room
  await expect.poll(() => page.evaluate(() => (window.game!.online as { code: string }).code)).toBe(CODE);

  await page.clock.runFor(30000);                              // quiet, but not long enough to give up
  expect(srv.sockets.length).toBe(1);
  await page.clock.runFor(30000);                              // 60 s of silence: a dead link
  await expect.poll(() => srv.sockets.length).toBe(2);
  await expect.poll(() => creates().length).toBe(2);
  expect(creates()[1].fresh).toBeUndefined();                  // the reconnect gets the same room back
});

test('a friend in a Rắn và Thang room reads the host\'s rules, "Phải đổ 6" and "Vượt cũng được" included', async ({ page }) => {
  // Regression (full review): the room told friends the finish rule but not the start rule.
  const srv = await fakeServer(page, (ws, m) => {
    if (m.t !== 'join') return;
    ws.send(JSON.stringify({ t: 'joined', code: CODE, id: 1, hostOnline: true }));
    ws.send(JSON.stringify({ t: 'fromHost', data: {
      k: 'snakeLobby', code: CODE, hostName: 'Chu', playing: false,
      seats: [{ kind: 'human', name: 'Chu' }, { kind: 'remote', peer: 1, name: 'Ban' }, { kind: 'off' }, { kind: 'off' }],
      rules: { snake_dice: 1, snake_six_to_start: 1, snake_exact_finish: 0 },
      exact: 0, // how a host before 4efa39e sent the finish rule: with it, only the start rule is missing there
    } }));
  });
  await page.goto(`${BASE}?render=cheap&manual=1`);
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  await page.evaluate(() => (window.game as unknown as { configureSnake(o: unknown): void }).configureSnake({}));
  await tap(page, 780, 610);                                   // "Chơi online" (src/snake/scene.ts setupSpots: online; inside it before and after 4efa39e)
  await page.fill('#op-name', 'Ban');
  await page.fill('#op-code', CODE);
  await page.click('#op-join');
  await expect.poll(() => srv.sent.some(m => m.t === 'join')).toBe(true);
  await page.evaluate(() => window.game!.step(5));
  await tap(page, 904, 72);                                    // "Luật": the rules page reads the rules in play
  const rules = await page.locator('body').innerText();
  expect(rules).toContain('mới được vào bàn');                  // "Phải đổ 6 mới được vào bàn"
  expect(rules).toContain('Đổ dư cũng về đích');
});

test('a friend whose ask for a new game was turned down cannot reopen the vote at once', async ({ page }) => {
  // Bug: a friend could send voteStart again and again after a "no", and the vote kept opening.
  const srv = await fakeServer(page, (ws, m) => {
    if (m.t !== 'create') return;
    ws.send(JSON.stringify({ t: 'created', code: CODE, id: 0 }));
    ws.send(JSON.stringify({ t: 'peer', id: 1, name: 'Ban', online: true })); // a friend comes in
  });
  const friend = (act: string) => srv.sockets[0].send(JSON.stringify({ t: 'fromPeer', from: 1, data: { k: 'act', act } }));
  await page.goto(`${BASE}?game=typhu&render=cheap&manual=1`);
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  await tap(page, 600, 630);                                   // "Chơi online"
  await page.fill('#op-name', 'Chu');
  await page.click('#op-create');
  await expect.poll(() => page.evaluate(() => (window.game!.online as { seats: { kind: string }[] }).seats.some(s => s.kind === 'remote'))).toBe(true);
  await page.evaluate(() => { window.game!.press('Enter'); window.game!.step(3); }); // the host starts the game
  expect(await page.evaluate(() => window.game!.scene)).toBe('play');
  const vote = () => page.evaluate(() => { window.game!.step(1); return !!(window.game!.state as { vote?: unknown }).vote; });

  friend('voteStart'); await expect.poll(vote).toBe(true);    // the friend asks
  await page.evaluate(() => { window.game!.press('KeyN'); window.game!.step(2); }); // the host says no
  expect(await vote()).toBe(false);
  friend('voteStart');                                         // and asks again at once
  await page.waitForTimeout(300);
  expect(await vote()).toBe(false);
});

/** A friend joins a room of this game, the host's lobby brings the host's rules, then the host closes
 * the room: the labels of the friend's own rule buttons afterwards. */
async function rulesAfterLeaving(page: Page, game: 'ludo' | 'snake', lobby: Record<string, unknown>, onlineAt: [number, number]): Promise<string[]> {
  const srv = await fakeServer(page, (ws, m) => {
    if (m.t !== 'join') return;
    ws.send(JSON.stringify({ t: 'joined', code: CODE, id: 1, hostOnline: true }));
    ws.send(JSON.stringify({ t: 'fromHost', data: { code: CODE, hostName: 'Chu', playing: false, seats: [{ kind: 'human', name: 'Chu' }, { kind: 'remote', peer: 1, name: 'Ban' }, { kind: 'off' }, { kind: 'off' }], ...lobby } }));
  });
  await page.goto(`${BASE}?render=cheap&manual=1`);
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  await page.evaluate(g => (window.game as unknown as Record<string, (o: unknown) => void>)[g === 'ludo' ? 'configureLudo' : 'configureSnake']({}), game);
  await tap(page, onlineAt[0], onlineAt[1]);
  await page.fill('#op-name', 'Ban');
  await page.fill('#op-code', CODE);
  await page.click('#op-join');
  await expect.poll(() => srv.sent.some(m => m.t === 'join')).toBe(true);
  await page.evaluate(() => window.game!.step(5));
  srv.sockets[0].send(JSON.stringify({ t: 'closed' }));       // the host closes the room
  await expect.poll(() => page.evaluate(() => (window.game!.online as { role: string }).role)).toBe('off');
  return page.evaluate(() => { window.game!.step(2); return (window.game!.view as { buttons: { label: string }[] }).buttons.map(b => b.label); });
}

test('a friend who leaves a room plays by their own rules again, not the host\'s (Cá Ngựa, Rắn và Thang)', async ({ browser }) => {
  // Bug: the host's rules were copied into the friend's settings and stayed after the room was gone.
  const ludo = await browser.newPage();
  const l = await rulesAfterLeaving(ludo, 'ludo', { k: 'ludoLobby', strict: 0 }, [780, 592]); // the host plays "Nhanh"
  expect(l.some(x => x.startsWith('Truyền thống'))).toBe(true);    // the friend's own: data/config.json's
  const snake = await browser.newPage();
  const s = await rulesAfterLeaving(snake, 'snake', { k: 'snakeLobby', rules: { snake_dice: 2, snake_six_to_start: 1, snake_exact_finish: 0 } }, [780, 610]);
  expect(s.some(x => x.startsWith('1 viên'))).toBe(true);
  expect(s.some(x => x.startsWith('Thảy là vào'))).toBe(true);
  expect(s.some(x => x.startsWith('Đúng ô 100'))).toBe(true);
});
