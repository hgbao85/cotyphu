// Draws the app icons and the link preview into public/ from tools/icons/icon.html, on the Vite dev
// server (the page imports the game's own animal drawing). Run: node tools/icons/render.mjs
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const PORT = 5182;
const OUT = [ // [file, query]
  ['public/icons/icon-512.png', 'kind=icon&size=512'],
  ['public/icons/icon-192.png', 'kind=icon&size=192'],
  ['public/icons/icon-maskable-512.png', 'kind=maskable&size=512'],
  ['public/icons/apple-touch-icon.png', 'kind=maskable&size=180'], // iOS rounds the corners itself: full bleed
  ['public/og.png', 'kind=og'],
];
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
try {
  for (let k = 0; ; k++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* not up yet */ } if (k > 60) throw new Error('vite did not start'); await new Promise(r => setTimeout(r, 500)); }
  const browser = await chromium.launch({ executablePath: process.env.SHOT_BROWSER || undefined });
  const page = await browser.newPage();
  for (const [file, query] of OUT) {
    await page.goto(`http://localhost:${PORT}/tools/icons/icon.html?${query}`);
    await page.waitForFunction(() => document.title === 'ready', null, { timeout: 30000 });
    await page.locator('#c').screenshot({ path: file, omitBackground: true });
    console.log('wrote', file);
  }
  await browser.close();
} finally { vite.kill(); }
