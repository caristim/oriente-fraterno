// Oriente Fraterno 148 — Service Worker v18.1
// CORRECCIONES v18.1:
//  1. URLs normalizadas para evitar redirecciones de GitHub Pages.
//  2. APP_BASE apunta a index.html para asegurar el clic en la notificación.

importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

const SW_VERSION = 'of-sw-v18.1';
const DB_NAME    = 'of_sw';
const APP_URL    = 'https://caristim.github.io/oriente-fraterno/index.html';
const APP_ROOT   = 'https://caristim.github.io/oriente-fraterno/';
const ICON_192   = 'https://caristim.github.io/oriente-fraterno/icon-192.png';
const BADGE_URL  = 'https://caristim.github.io/oriente-fraterno/icon-192.png';

const CACHE_NAME   = 'of-cache-v18.1';
const PRECACHE_URLS = [
  APP_ROOT,
  APP_URL,
  APP_ROOT + 'manifest.json',
  APP_ROOT + 'icon-192.png',
  APP_ROOT + 'icon-512.png',
];

// ── Inicialización Firebase ───────────────────────────────────────────────────
let fcmMessaging = null;
try {
  firebase.initializeApp({
    apiKey:            'AIzaSyD9gQW61AvKHhNai6gljNFE7q9rS7KKuN8',
    authDomain:        'orientefraterno148-2a0c1.firebaseapp.com',
    projectId:         'orientefraterno148-2a0c1',
    storageBucket:     'orientefraterno148-2a0c1.firebasestorage.app',
    messagingSenderId: '101867774014',
    appId:             '1:101867774014:web:0b4bb797293910c419716f',
  });
  fcmMessaging = firebase.messaging();
} catch (err) {
  console.warn('[SW] Firebase no disponible en este entorno:', err.message);
}

// ── HANDLER FCM BACKGROUND (Android / Chrome con app CERRADA) ────────────────
if (fcmMessaging) {
  fcmMessaging.onBackgroundMessage(async payload => {
    console.log('[SW-FCM] onBackgroundMessage recibido:', JSON.stringify(payload));

    const data   = payload.data || {};
    const titulo = data.title || 'Oriente Fraterno 148';
    const cuerpo = data.body  || 'Tenés un evento hoy ✦';
    const url    = data.url   || APP_URL;
    const evTag  = data.tag   || ('of-fcm-' + Date.now());

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

// ── HANDLER WEB PUSH NATIVO (iOS Safari / Firefox / Edge) ────────────────────
self.addEventListener('push', e => {
  console.log('[SW-Push] Evento push nativo recibido (iOS/Web Push)');

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
    Promise.all([
      self.registration.showNotification(titulo, {
        body:               cuerpo,
        icon:               ICON_192,
        badge:              BADGE_URL,
        tag:                evTag,
        requireInteraction: true,
        vibrate:            [200, 100, 200, 100, 200],
        data:               { url },
      }),
      markFiredToday()
    ])
  );
});

// ── TERCER NIVEL DE SEGURIDAD: verificación local ────────────────────────────
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

      const evDay   = new Date(now.getFullYear(), month - 1, day);
      const isToday = evDay.getTime() === today.getTime();
      if (!isToday) continue;

      const evId    = ev.docId || ev.id || `${ev.nombre}-${ev.fecha}`;
      const fireKey = `${evId}-${now.getFullYear()}`;
      if (fired[fireKey]) continue;

      if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') continue;

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
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS).catch(err => console.warn('[SW] Pre-cache parcial:', err)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

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
    e.source && e.source.postMessage({ type: 'PONG', version: SW_VERSION });
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
          caches.match(APP_URL)
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

// ── Clic en notificación ──────────────────────────────────────────────────────
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
