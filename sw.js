// ==========================================
// SERVICE WORKER - ORIENTE FRATERO 148
// Versión simplificada - Solo Web Push
// ==========================================

const CACHE_NAME = 'oriente-fraterno-cache-v3';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// ── Instalación ───────────────────────────────────────────────────────────────
self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(urlsToCache);
    })
  );
});

// ── Activación ────────────────────────────────────────────────────────────────
self.addEventListener('activate', function(event) {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(function(cacheNames) {
        return Promise.all(
          cacheNames.map(function(cacheName) {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          })
        );
      })
    ])
  );
});

// ── Cache: Network First para HTML ────────────────────────────────────────────
self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  if (url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request).catch(function() {
        return caches.match(event.request);
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function(response) {
      return response || fetch(event.request);
    })
  );
});

// ── Push desde el servidor/GitHub Actions ─────────────────────────────────────
self.addEventListener('push', function(event) {
  let data = { 
    title: 'Oriente Fraterno · 148', 
    body: 'Tienes un evento hoy.',
    url: '/',
    tag: 'push-notif'
  };

  if (event.data) {
    try { 
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    } catch(e) {
      data.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [200, 100, 200],
      data: { url: data.url || '/' },
      tag: data.tag || 'push-notif',
      requireInteraction: true,
      renotify: false
    })
  );
});

// ── Clic en notificación ──────────────────────────────────────────────────────
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
