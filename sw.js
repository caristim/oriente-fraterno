// Oriente Fraterno 148 — Service Worker v19.0

importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

const SW_VERSION = 'of-sw-v19.0';
const DB_NAME    = 'of_sw';
const APP_ROOT   = 'https://caristim.github.io/oriente-fraterno/';
const APP_URL    = 'https://caristim.github.io/oriente-fraterno/';
const ICON_192   = 'https://caristim.github.io/oriente-fraterno/icon-192.png';
const BADGE_URL  = 'https://caristim.github.io/oriente-fraterno/icon-192.png';

const CACHE_NAME    = 'of-cache-v19.0';
const PRECACHE_URLS = [
  APP_ROOT,
  APP_ROOT + 'index.html',
  APP_ROOT + 'manifest.json',
  APP_ROOT + 'icon-192.png',
  APP_ROOT + 'icon-512.png',
];

let fcmMessaging   = null;
let fcmInitialized = false;

function tryInitFirebase() {
  if (fcmInitialized) return;
  fcmInitialized = true;
  try {
    const existingApps = firebase.apps || [];
    if (existingApps.length === 0) {
      firebase.initializeApp({
        apiKey:            'AIzaSyD9gQW61AvKHhNai6gljNFE7q9rS7KKuN8',
        authDomain:        'orientefraterno148-2a0c1.firebaseapp.com',
        projectId:         'orientefraterno148-2a0c1',
        storageBucket:     'orientefraterno148-2a0c1.firebasestorage.app',
        messagingSenderId: '101867774014',
        appId:             '1:101867774014:web:0b4bb797293910c419716f',
      });
    }
    fcmMessaging = firebase.messaging();
    console.log('[SW] Firebase + FCM inicializados correctamente.');
  } catch (err) {
    console.warn('[SW] Firebase no disponible (normal en Firefox/Safari):', err.message);
    fcmMessaging = null;
  }
}

tryInitFirebase();

// ── HANDLER FCM BACKGROUND ────────────────────────────────────────────────────
if (fcmMessaging) {
  fcmMessaging.onBackgroundMessage(async payload => {
    console.log('[SW-FCM] onBackgroundMessage:', JSON.stringify(payload));

    const data   = payload.data || {};
    const titulo = data.title || 'Oriente Fraterno 148';
    const cuerpo = data.body  || 'Tenés un evento hoy ✦';
    const url    = data.url   || APP_URL;
    const evTag  = data.tag   || ('of-fcm-' + Date.now());

    await dbSet('last_fcm_tag', evTag);

    await self.registration.showNotification(titulo, {
      body:               cuerpo,
      icon:               ICON_192,
      badge:              BADGE_URL,
      tag:                evTag,
      requireInteraction: true,
      vibrate:            [200, 100, 200, 100, 200],
      data:               { url },
    });

    await markFiredToday();
  });
}

// ── HANDLER WEB PUSH NATIVO ───────────────────────────────────────────────────
self.addEventListener('push', e => {
  console.log('[SW-Push] Evento push nativo recibido');

  let titulo = 'Oriente Fraterno 148';
  let cuerpo = 'Tenés un evento hoy ✦';
  let url    = APP_URL;
  let evTag  = 'of-wp-' + Date.now();

  if (e.data) {
    try {
      const data = e.data.json();
      titulo = data.title || titulo;
      cuerpo = data.body  || cuerpo;
      url    = data.url   || url;
      evTag  = data.tag   || evTag;
    } catch (_) {
      const texto = e.data.text();
      if (texto) cuerpo = texto;
    }
  }

  e.waitUntil(
    (async () => {
      const lastFcmTag = await dbGet('last_fcm_tag');
      if (lastFcmTag && lastFcmTag === evTag) {
        console.log('[SW-Push] Notificación ya procesada por FCM, ignorando duplicado.');
        return;
      }

      await self.registration.showNotification(titulo, {
        body:               cuerpo,
        icon:               ICON_192,
        badge:              BADGE_URL,
        tag:                evTag,
        requireInteraction: true,
        vibrate:            [200, 100, 200, 100, 200],
        data:               { url },
      });
      await markFiredToday();
    })()
  );
});

// ── VERIFICACIÓN LOCAL ────────────────────────────────────────────────────────
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
      if (parts.length === 2)      { [month, day] = parts.map(Number); }
      else if (parts.length === 3) { [, month, day] = parts.map(Number); }
      else continue;

      if (!month || !day) continue;

      const evDay   = new Date(now.getFullYear(), month - 1, day);
      const isToday = evDay.getTime() === today.getTime();
      if (!isToday) continue;

      const evId    = ev.docId || ev.id || `${ev.nombre}-${ev.fecha}`;
      const fireKey = `${evId}-${now.getFullYear()}`;
      if (fired[fireKey]) continue;

      try {
        await self.registration.showNotification('Oriente Fraterno 148', {
          body:               `Hoy: ${ev.tipo} de ${ev.nombre}`,
          icon:               ICON_192,
          badge:              BADGE_URL,
          tag:                `of-local-${evId}`,
          requireInteraction: true,
          vibrate:            [200, 100, 200, 100, 200],
          data:               { url: APP_URL },
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
      if (parts.length === 2)      { [month, day] = parts.map(Number); }
      else if (parts.length === 3) { [, month, day] = parts.map(Number); }
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

// ── Helpers de IndexedDB ──────────────────────────────────────────────────────
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
      .then(cache => cache.addAll(PRECACHE_URLS).catch(err => console.warn('[SW] Pre-cache parcial:', err)))
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
  if (e.data.type === 'CHECK_NOW') {
    await checkAndNotify();
  }
  if (e.data.type === 'PING') {
    if (e.source) e.source.postMessage({ type: 'PONG', version: SW_VERSION });
  }
  if (e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, response.clone()));
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
      caches.match(e.request).then(cached =>
        cached || new Response('Sin conexión', { status: 503 })
      )
    )
  );
});

// ── Notificaciones Clic / Cierre ──────────────────────────────────────────────
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
  console.log('[SW] Notificación cerrada por el usuario:', e.notification.tag);
});
