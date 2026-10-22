const CACHE_NAME = 'xcar-v308';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './default-cars.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for navigation/app shell so updates land quickly; cache-first fallback offline.
// WhatsApp (Green API) calls go straight to the network and are never cached.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // let API calls pass through untouched

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
  );
});

// Push-уведомления (владельцу/оператору) — приходят от сервера, даже когда
// приложение закрыто, и показываются в системном центре уведомлений
// (Android — сразу; iPhone — только если приложение добавлено на экран
// «Домой», iOS 16.4+). Сервер шлёт JSON {title, body, tag}, см.
// server/lib/push.js.
self.addEventListener('push', (event) => {
  let data = { title: 'XCAR', body: 'Новое уведомление' };
  try { if (event.data) data = Object.assign(data, event.data.json()); } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag || undefined,
      icon: './icon-192.png',
      badge: './icon-192.png',
    })
  );
});

// Клик по уведомлению — фокусируем уже открытую вкладку приложения, если
// такая есть, иначе открываем новую.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});
