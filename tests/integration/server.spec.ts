// Playwright (no browser): the room server (server/server.mjs) on its own port, sent bad frames.
// A bad frame must close that one socket, never the server and every room on it.
import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';

const PORT = 8791;
const MAX_MESSAGE = 256 * 1024; // server.mjs MAX_MESSAGE

let server: ChildProcess;
let exited: number | null = null;
test.beforeAll(async () => {
  test.setTimeout(40000);
  // BEAT_MS: short for the beat test, not so short that a busy machine misses a ping and is cut off
  server = spawn(process.execPath, ['server/server.mjs'], { env: { ...process.env, PORT: String(PORT), STATIC_DIR: 'dist', BEAT_MS: '1500' }, stdio: 'ignore' });
  server.on('exit', code => { exited = code ?? -1; });
  await expect.poll(health, { timeout: 25000 }).toBe(true); // a busy machine (the whole suite, two browsers) starts node slowly
});
test.afterAll(() => { server?.kill(); });

async function health(): Promise<boolean> {
  try { return (await fetch(`http://localhost:${PORT}/health`)).ok; } catch { return false; }
}
/** Opens a socket, sends one frame and waits until the server closes it (or a second goes by). */
function sendAndWait(frame: string): Promise<void> {
  return new Promise(done => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    ws.on('open', () => ws.send(frame));
    ws.on('error', () => {});
    ws.on('close', () => done());
    setTimeout(() => { ws.terminate(); done(); }, 1000);
  });
}

test('a frame over the size limit closes that socket and the server keeps running', async () => {
  // Bug: no 'error' listener on the socket, so "Max payload size exceeded" ended the whole process.
  await sendAndWait('x'.repeat(MAX_MESSAGE + 1024));
  await new Promise(r => setTimeout(r, 300));
  expect(exited).toBeNull();
  expect(await health()).toBe(true);
});

/** A test client: a socket and every message it got. */
async function client(): Promise<{ ws: WebSocket; got: Record<string, unknown>[]; send(m: unknown): void; closed: () => boolean }> {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`), got: Record<string, unknown>[] = [];
  let isClosed = false;
  ws.on('message', d => got.push(JSON.parse(String(d))));
  ws.on('close', () => { isClosed = true; });
  ws.on('error', () => {});
  await new Promise(r => ws.on('open', r));
  return { ws, got, send: m => ws.send(JSON.stringify(m)), closed: () => isClosed };
}
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Waits until a client got a message that passes the test (a busy machine relays slowly). */
const until = (c: { got: Record<string, unknown>[] }, ok: (m: Record<string, unknown>) => boolean) =>
  expect.poll(() => c.got.find(ok) ?? null, { timeout: 20000 }).not.toBeNull(); // a whole-suite run (3D pages, two browsers) slows the relay a lot

test('a host opening the room again from another tab closes the old tab, which can no longer send', async () => {
  // Bug: the old socket stayed open and kept sending, so guests saw two diverging games.
  const a = await client();
  a.send({ t: 'create', name: 'A', key: 'same-key-1' }); await until(a, m => m.t === 'created');
  const code = a.got.find(m => m.t === 'created')!.code as string;
  const guest = await client();
  guest.send({ t: 'join', code, name: 'G', key: 'guest-1' }); await until(guest, m => m.t === 'joined');
  const b = await client();
  b.send({ t: 'create', name: 'A', key: 'same-key-1' }); await until(b, m => m.t === 'created');
  expect(b.got.find(m => m.t === 'created')).toMatchObject({ code, back: true });
  await until(a, m => m.t === 'error');
  await expect.poll(() => a.closed(), { timeout: 10000 }).toBe(true);
  b.send({ t: 'toAll', data: { from: 'b' } }); await until(guest, m => m.t === 'fromHost');
  expect(guest.got.filter(m => m.t === 'fromHost').map(m => m.data)).toEqual([{ from: 'b' }]);
  for (const c of [a, b, guest]) c.ws.close();
});

test('a full room gives the seat of a guest who closed their tab to a newcomer', async () => {
  // Bug: a guest was only removed by "leave", so closed tabs kept the room full for good.
  const host = await client();
  host.send({ t: 'create', name: 'H', key: 'host-full' }); await until(host, m => m.t === 'created');
  const code = host.got.find(m => m.t === 'created')!.code as string;
  const guests = [];
  for (let i = 0; i < 3; i++) { const g = await client(); g.send({ t: 'join', code, name: `G${i}`, key: `full-${i}` }); await until(g, m => m.t === 'joined'); guests.push(g); }
  guests[0].ws.close();                                      // the first guest closes the tab, no "leave"
  await until(host, m => m.t === 'peer' && m.name === 'G0' && m.online === false);
  const late = await client();
  late.send({ t: 'join', code, name: 'Late', key: 'full-late' });
  await until(late, m => m.t === 'joined' || m.t === 'error');
  expect(late.got.find(m => m.t === 'joined')).toMatchObject({ code });
  await until(host, m => m.t === 'peer' && m.left === true && m.name === 'G0');
  // with every guest online, the room is still full
  const extra = await client();
  extra.send({ t: 'join', code, name: 'Extra', key: 'full-extra' }); await until(extra, m => m.t === 'error' || m.t === 'joined');
  expect(extra.got.find(m => m.t === 'error')).toMatchObject({ msg: 'Phòng đã đủ người.' });
  for (const c of [host, ...guests, late, extra]) c.ws.close();
});

test('a request cannot reach a folder beside dist/ whose name starts the same (dist-single/)', async () => {
  // Bug: the check was startsWith('…/dist'), which '…/dist-single/index.html' passes.
  const res = await fetch(`http://localhost:${PORT}/..%2fdist-single/index.html`);
  expect(res.status).toBe(403);
});

test('every socket hears a beat, so a page can tell a dead link from a quiet one', async () => {
  const c = await client();
  await expect.poll(() => c.got.filter(m => m.t === 'beat').length, { timeout: 10000 }).toBeGreaterThanOrEqual(2); // BEAT_MS is 1500 here
  c.ws.close();
});

test('"Tạo phòng mới" makes a new room: the old one with that key is closed for its guests', async () => {
  // Bug: create with the same key always handed back the old room, its code and its guests.
  const host = await client();
  host.send({ t: 'create', name: 'H', key: 'fresh-key' }); await until(host, m => m.t === 'created');
  const oldCode = host.got.find(m => m.t === 'created')!.code as string;
  const guest = await client();
  guest.send({ t: 'join', code: oldCode, name: 'G', key: 'fresh-guest' }); await until(guest, m => m.t === 'joined');
  const again = await client();                                // the host presses "Tạo phòng mới"
  again.send({ t: 'create', name: 'H', key: 'fresh-key', fresh: true }); await until(again, m => m.t === 'created');
  const made = again.got.find(m => m.t === 'created')!;
  expect(made.code).not.toBe(oldCode);
  expect(made.back).toBeUndefined();
  await until(guest, m => m.t === 'closed');
  // and without fresh (going back into the last room) the room comes back as before
  const back = await client();
  back.send({ t: 'create', name: 'H', key: 'fresh-key' }); await until(back, m => m.t === 'created');
  expect(back.got.find(m => m.t === 'created')).toMatchObject({ code: made.code, back: true });
  for (const c of [host, guest, again, back]) c.ws.close();
});
