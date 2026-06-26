// Oriente Fraterno 148 — Service Worker v24.0
// CORRECCIÓN v24 (app cerrada en Android/iOS):
//   1. Un solo handler push que NUNCA descarta mensajes FCM.
//   2. Sin depender del SDK Firebase en el SW (importScripts fallaba en móvil).
//   3. FCM con notification payload: el browser lo muestra; el SW solo marca fired.
//   4. Web Push nativo (iOS PWA / Firefox): parseo JSON + texto plano.

const SW_VERSION    = 'of-sw-v24.0';
const DB_NAME       = 'of_sw';
const APP_ROOT      = 'https://caristim.github.io/oriente-fraterno/';
const APP_URL       = 'https://caristim.github.io/oriente-fraterno/';
const ICON_192      = 'https://caristim.github.io/oriente-fraterno/icon-192.png';
const BADGE_URL     = 'https://caristim.github.io/oriente-fraterno/icon-192.png';

const CACHE_NAME    = 'of-cache-v24.0';
const PRECACHE_URLS = [
  APP_ROOT,
  APP_ROOT + 'index.html',
  APP_ROOT + 'manifest.json',
  APP_ROOT + 'icon-192.png',
  APP_ROOT + 'icon-512.png',
];

// ── Push: parseo unificado (FCM + Web Push nativo) ────────────────────────
function readPushJson(e) {
  if (!e.data) return null;
  try { return e.data.json(); } catch (_) {}
  try {
    const text = e.data.text();
    if (text) return JSON.parse(text);
  } catch (_) {}
  return null;
}

async function showPushNotification(titulo, cuerpo, url, evTag) {
  await self.registration.showNotification(titulo, {
    body: cuerpo,
    icon: ICON_192,
    badge: BADGE_URL,
    tag: evTag,
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 200],
    data: { url },
  });
  await markFiredToday();
}

async function handlePushEvent(e) {
  const raw = readPushJson(e);

  if (!raw) {
    const text = e.data ? (() => { try { return e.data.text(); } catch (_) { return ''; } })() : '';
    await showPushNotification(
      'Oriente Fraterno 148',
      text || 'Tenés un evento hoy ✦',
      APP_URL,
      'of-' + Date.now()
    );
    return;
  }

  const isFCM = !!(raw.from || raw.fcmMessageId);

  // Android/Chrome: FCM con notification payload lo muestra el browser automáticamente
  if (isFCM && raw.notification && (raw.notification.title || raw.notification.body)) {
    console.log('[SW-Push] FCM notification payload — auto-display del browser');
    await markFiredToday();
    return;
  }

  let titulo = 'Oriente Fraterno 148';
  let cuerpo = 'Tenés un evento hoy ✦';
  let url    = APP_URL;
  let evTag  = 'of-' + Date.now();

  if (isFCM && raw.data && typeof raw.data === 'object') {
    const d = raw.data;
    titulo = d.title || titulo;
    cuerpo = d.body  || cuerpo;
    url    = d.url   || url;
    evTag  = d.tag   || evTag;
  } else {
    titulo = raw.title || titulo;
    cuerpo = raw.body  || cuerpo;
    url    = raw.url   || url;
    evTag  = raw.tag   || evTag;
  }

  console.log('[SW-Push] Mostrando notificación:', titulo, '|', cuerpo);
  await showPushNotification(titulo, cuerpo, url, evTag);
}

self.addEventListener('push', e => {
  console.log('[SW-Push] Evento push recibido (app puede estar cerrada)');
  e.waitUntil(handlePushEvent(e).catch(err => {
    console.error('[SW-Push] Error fatal:', err.message);
  }));
});

// ── CANAL LOCAL: respaldo con app abierta ─────────────────────────────────
async function checkAndNotify() {
  try {
    const events = await dbGet('events');
    if (!Array.isArray(events) || events.length === 0) return;
    const now   = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const fired = (await dbGet('fired')) || {};
    let changed = false;

    for (const ev of events) {
      if (!ev.fecha || !ev.nombre || !ev.tipo) continue;
      const parts = String(ev.fecha).split('-');
      let month, day;
      if (parts.length === 2)      [month, day] = parts.map(Number);
      else if (parts.length === 3) [, month, day] = parts.map(Number);
      else continue;
      if (!month || !day) continue;

      const evDay = new Date(now.getFullYear(), month - 1, day);
      if (evDay.getTime() !== today.getTime()) continue;

      const evId    = ev.docId || ev.id || `${ev.nombre}-${ev.fecha}`;
      const fireKey = `${evId}-${now.getFullYear()}`;
      if (fired[fireKey]) continue;

      try {
        await self.registration.showNotification('Oriente Fraterno 148', {
          body: `Hoy: ${ev.tipo} de ${ev.nombre}`,
          icon: ICON_192, badge: BADGE_URL,
          tag: `of-local-${evId}`, requireInteraction: true,
          vibrate: [200, 100, 200, 100, 200],
          data: { url: APP_URL },
        });
        fired[fireKey] = true;
        changed = true;
      } catch (notifErr) {
        console.warn('[SW] showNotification falló:', notifErr.message);
      }
    }
    if (changed) await dbSet('fired', fired);
  } catch (err) {
    console.warn('[SW] checkAndNotify error:', err);
  }
}

async function markFiredToday() {
  try {
    const events = await dbGet('events');
    if (!Array.isArray(events) || events.length === 0) return;
    const now   = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const fired = (await dbGet('fired')) || {};
    let changed = false;

    for (const ev of events) {
      if (!ev.fecha || !ev.nombre) continue;
      const parts = String(ev.fecha).split('-');
      let month, day;
      if (parts.length === 2)      [month, day] = parts.map(Number);
      else if (parts.length === 3) [, month, day] = parts.map(Number);
      else continue;
      if (!month || !day) continue;

      const evDay = new Date(now.getFullYear(), month - 1, day);
      if (evDay.getTime() !== today.getTime()) continue;

      const evId    = ev.docId || ev.id || `${ev.nombre}-${ev.fecha}`;
      const fireKey = `${evId}-${now.getFullYear()}`;
      if (!fired[fireKey]) { fired[fireKey] = true; changed = true; }
    }
    if (changed) await dbSet('fired', fired);
  } catch (err) {
    console.warn('[SW] markFiredToday error:', err);
  }
}

// ── IndexedDB helpers ─────────────────────────────────────────────────────────
function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}
async function dbGet(key) {
  try {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readonly');
      const r  = tx.objectStore('kv').get(key);
      r.onsuccess = () => res(r.result ?? null);
      r.onerror   = () => rej(r.error);
    });
  } catch (_) { return null; }
}
async function dbSet(key, value) {
  try {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = res;
      tx.onerror    = () => rej(tx.error);
    });
  } catch (_) {}
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  console.log('[SW] Instalando versión:', SW_VERSION);
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS)
        .catch(err => console.warn('[SW] Pre-cache parcial:', err.message)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  console.log('[SW] Activando versión:', SW_VERSION);
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Eliminando caché antiguo:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())
  );
});

// ── Mensajes desde la app ─────────────────────────────────────────────────────
self.addEventListener('message', async e => {
  if (!e.data) return;
  if (e.data.type === 'SCHEDULE_EVENTS') {
    await dbSet('events', e.data.events || []);
    await checkAndNotify();
  }
  if (e.data.type === 'CHECK_NOW') await checkAndNotify();
  if (e.data.type === 'PING') {
    if (e.source) e.source.postMessage({ type: 'PONG', version: SW_VERSION });
  }
  if (e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  if (url.startsWith(APP_ROOT)) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(response => {
          if (response && response.status === 200) {
            caches.open(CACHE_NAME).then(c => c.put(e.request, response.clone()));
          }
          return response;
        }).catch(() =>
          caches.match(APP_ROOT + 'index.html')
            .then(fb => fb || new Response('Sin conexión', { status: 503 }))
        );
      })
    );
    return;
  }
  e.respondWith(
    fetch(e.request).catch(() =>
      caches.match(e.request)
        .then(c => c || new Response('Sin conexión', { status: 503 }))
    )
  );
});

// ── Notificationclick ─────────────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const targetUrl = (e.notification.data && e.notification.data.url) || APP_URL;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const appClient = clients.find(c => c.url.startsWith(APP_ROOT));
      if (appClient) return appClient.focus();
      return self.clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener('notificationclose', e => {
  console.log('[SW] Notificación cerrada:', e.notification.tag);
});
