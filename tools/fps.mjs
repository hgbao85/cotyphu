// Frames per second of the real loop on a phone-sized page, the CPU slowed down like a cheap phone.
// Each case: a game of computers running at ×1 for some seconds, the gaps between frames measured.
import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)('@playwright/test');
import { pathToFileURL } from 'node:url'; import { resolve } from 'node:path';
const [, , slow = '6', secs = '8', extra = ''] = process.argv;
const b = await chromium.launch({ executablePath: process.env.SHOT_BROWSER, args: process.env.SOFTGL ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const run = async (label, vw, vh, dpr, q) => {
  const ctx = await b.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr, isMobile: vw < 600, hasTouch: vw < 600 });
  const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(slow) });
  await p.addInitScript(() => { localStorage.setItem('tpdv-local-game', ''); });
  await p.goto(pathToFileURL(resolve('dist-single/index.html')).href + '?seed=7' + q);
  await p.waitForFunction(() => typeof window.game?.step === 'function', null, { timeout: 60000 });
  await p.evaluate(() => { window.game.configure({ seats: [{ kind: 'ai', lv: 1 }, { kind: 'ai', lv: 1 }, { kind: 'ai', lv: 2 }, { kind: 'ai', lv: 0 }] }); window.game.press('Enter'); });
  await p.waitForTimeout(3000);
  const r = await p.evaluate(async secs => {
    const gaps = []; let last = performance.now(); const end = last + secs * 1000;
    await new Promise(done => { const f = t => { gaps.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else done(); }; requestAnimationFrame(f); });
    gaps.sort((a, b) => a - b);
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length, p95 = gaps[Math.floor(gaps.length * 0.95)];
    return { fps: +(1000 / avg).toFixed(1), p95ms: +p95.toFixed(0), frames: gaps.length, render: window.game.render, scene: window.game.scene };
  }, Number(secs));
  console.log(label.padEnd(26), JSON.stringify(r));
  await ctx.close();
};
await run('phone 390x844 dpr2', 390, 844, 2, extra);
await run('phone 360x640 dpr2', 360, 640, 2, extra);
await run('wide 1280x720 dpr1', 1280, 720, 1, extra);
await b.close();
