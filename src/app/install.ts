// Installing as an app (manifest, service worker) and keeping the screen on during a game.

import { W } from '../screen';

import { scene } from '../core/store';

import type { Loose } from '../game/types';

import { L, PX, PW } from '../main';

// ---- Installing as an app, and keeping the screen on -------------------------------------------
// Served over http(s), the page offers its manifest and service worker, so a phone can add it to the
// home screen and open it full screen. Opened from a file (the checks), none of this is asked for.
if (location.protocol.startsWith('http') && !import.meta.env.DEV) {
  const add = (rel: string, href: string) => { const l = document.createElement('link'); l.rel = rel; l.href = href; document.head.appendChild(l); };
  add('manifest', './manifest.webmanifest');
  add('apple-touch-icon', './icons/apple-touch-icon.png');
  add('icon', './icons/icon-192.png'); // the tab's icon
  for (const [name, content] of [['apple-mobile-web-app-capable', 'yes'], ['mobile-web-app-capable', 'yes'], ['apple-mobile-web-app-title', 'Sự Thảy'], ['apple-mobile-web-app-status-bar-style', 'black-translucent']]) {
    const m = document.createElement('meta'); m.name = name; m.content = content; document.head.appendChild(m);
  }
  if ('serviceWorker' in navigator) {
    const register = () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* no app install: the game still plays */ }); };
    if (document.readyState === 'complete') register(); else addEventListener('load', register); // the game may start after the page's load event
  }
}
let wakeLock: { release(): Promise<void> } | null = null;
/** Keeps a phone's screen on while a game is being played, and lets it sleep otherwise. */
async function keepAwake() {
  const want = (scene === 'play' || scene === 'ludo') && document.visibilityState === 'visible';
  const nav = navigator as Loose;
  if (want && !wakeLock && nav.wakeLock) {
    try { wakeLock = await nav.wakeLock.request('screen'); (wakeLock as Loose).addEventListener?.('release', () => { wakeLock = null; }); } catch { wakeLock = null; }
  } else if (!want && wakeLock) {
    const w = wakeLock; wakeLock = null; w.release().catch(() => { /* already released */ });
  }
}
setInterval(keepAwake, 2000);
document.addEventListener('visibilitychange', () => { keepAwake(); });

/** Where the title screen's settings button sits: the phone's top-left corner, or the panel's top left. */
export function settingsSpot(): { x: number; y: number; w: number; h: number } {
  return L.phone ? { x: 12, y: 6, w: 84, h: 30 } : { x: PX + 16, y: 28, w: 84, h: 32 };
}
/** Where the rules button sits: the title's corner, the panel's top, or the phone's header. */
export function rulesSpot(): { x: number; y: number; w: number; h: number } {
  if (scene === 'title') return L.phone ? { x: W - 92, y: 6, w: 80, h: 30 } : { x: PX + PW - 104, y: 28, w: 84, h: 32 };
  return L.phone ? { x: 186, y: 9, w: 56, h: 32 } : { x: PX + 14, y: 14, w: 64, h: 30 };
}

