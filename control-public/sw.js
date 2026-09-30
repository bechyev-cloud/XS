// XCAR CONTROL service worker: офлайн-оболочка (app shell). API всегда идёт в сеть.
const CACHE = 'xcar-control-v8';
const SHELL = ['./', './index.html', './manifest.json', './styles/app.css', './js/app.bundle.js', './assets/icon-192.png', './assets/icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.includes('/api/')) return; // данные — только из сети
  if (url.origin !== location.origin) {
    if (url.hostname.includes('fonts.g')) e.respondWith(caches.open(CACHE).then(async (c) => { const hit = await c.match(e.request); if (hit) return hit; try { const r = await fetch(e.request); c.put(e.request, r.clone()); return r; } catch (x) { return hit || Response.error(); } }));
    return;
  }
  // сеть в приоритете (свежие обновления), кэш — при отсутствии сети
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request).then((hit) => hit || (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
