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
  server = spawn(process.execPath, ['server/server.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
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

test('a host opening the room again from another tab closes the old tab, which can no longer send', async () => {
  // Bug: the old socket stayed open and kept sending, so guests saw two diverging games.
  const a = await client();
  a.send({ t: 'create', name: 'A', key: 'same-key-1' }); await wait(100);
  const code = a.got.find(m => m.t === 'created')!.code as string;
  const guest = await client();
  guest.send({ t: 'join', code, name: 'G', key: 'guest-1' }); await wait(100);
  const b = await client();
  b.send({ t: 'create', name: 'A', key: 'same-key-1' }); await wait(200);
  expect(b.got.find(m => m.t === 'created')).toMatchObject({ code, back: true });
  expect(a.got.some(m => m.t === 'error')).toBe(true);
  expect(a.closed()).toBe(true);
  b.send({ t: 'toAll', data: { from: 'b' } }); await wait(100);
  expect(guest.got.filter(m => m.t === 'fromHost').map(m => m.data)).toEqual([{ from: 'b' }]);
  for (const c of [a, b, guest]) c.ws.close();
});

test('a full room gives the seat of a guest who closed their tab to a newcomer', async () => {
  // Bug: a guest was only removed by "leave", so closed tabs kept the room full for good.
  const host = await client();
  host.send({ t: 'create', name: 'H', key: 'host-full' }); await wait(100);
  const code = host.got.find(m => m.t === 'created')!.code as string;
  const guests = [];
  for (let i = 0; i < 3; i++) { const g = await client(); g.send({ t: 'join', code, name: `G${i}`, key: `full-${i}` }); guests.push(g); }
  await wait(150);
  guests[0].ws.close(); await wait(150);                     // the first guest closes the tab, no "leave"
  const late = await client();
  late.send({ t: 'join', code, name: 'Late', key: 'full-late' }); await wait(150);
  expect(late.got.find(m => m.t === 'joined')).toMatchObject({ code });
  expect(host.got.some(m => m.t === 'peer' && m.left === true && m.name === 'G0')).toBe(true);
  // with every guest online, the room is still full
  const extra = await client();
  extra.send({ t: 'join', code, name: 'Extra', key: 'full-extra' }); await wait(150);
  expect(extra.got.find(m => m.t === 'error')).toMatchObject({ msg: 'Phòng đã đủ người.' });
  for (const c of [host, ...guests, late, extra]) c.ws.close();
});
