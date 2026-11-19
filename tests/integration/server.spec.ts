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
  server = spawn(process.execPath, ['server/server.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  server.on('exit', code => { exited = code ?? -1; });
  await expect.poll(health, { timeout: 10000 }).toBe(true);
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
