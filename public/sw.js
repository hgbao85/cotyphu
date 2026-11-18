// Sự Thảy service worker: lets the game install as an app and open without a network for a
// game on one screen. Pages and files are fetched fresh when online and kept as a fallback; online
// rooms (/ws) and the health check are never touched.
const CACHE = 'tpdv-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/ws') || url.pathname === '/health') return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    } catch {
      const cached = await caches.match(req) || (req.mode === 'navigate' ? await caches.match('./') : undefined);
      return cached || Response.error();
    }
  })());
});
