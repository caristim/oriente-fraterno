// Oriente Fraterno 148 — Service Worker v23.0
// CORRECCIÓN DEFINITIVA:
//   1. Firebase se reinicializa en cada evento push/mensaje si falló al inicio.
//   2. onBackgroundMessage se registra dentro de initFirebase (reintento seguro).
//   3. El payload de iOS se maneja como texto plano (requisito de Safari).
//   4. Se usa badge para forzar el despertado en segundo plano en iOS.

const SW_VERSION    = 'of-sw-v23.0';
const DB_NAME       = 'of_sw';
const APP_ROOT      = 'https://caristim.github.io/oriente-fraterno/';
const APP_URL       = 'https://caristim.github.io/oriente-fraterno/';
const ICON_192      = 'https://caristim.github.io/oriente-fraterno/icon-192.png';
const BADGE_URL     = 'https://caristim.github.io/oriente-fraterno/icon-192.png';
const FCM_SENDER_ID = '101867774014';

const CACHE_NAME    = 'of-cache-v23.0';
const PRECACHE_URLS = [
  APP_ROOT,
  APP_ROOT + 'index.html',
  APP_ROOT + 'manifest.json',
  APP_ROOT + 'icon-192.png',
  APP_ROOT + 'icon-512.png',
];

// ── Inicialización Firebase (con reintento) ─────────────────────────────
let fcmMessaging         = null;
let fcmInitialized       = false;
let fcmHandlerRegistered = false;

function registerFcmBackgroundHandler() {
  if (fcmHandlerRegistered || !fcmMessaging) return;
  fcmHandlerRegistered = true;
  fcmMessaging.onBackgroundMessage(async payload => {
    console.log('[SW-FCM] onBackgroundMessage:', JSON.stringify(payload));
    const data   = payload.data || {};
    const titulo = data.title || 'Oriente Fraterno 148';
    const cuerpo = data.body  || 'Tenés un evento hoy ✦';
    const url    = data.url   || APP_URL;
    const evTag  = data.tag   || ('of-fcm-' + Date.now());

    await self.registration.showNotification(titulo, {
      body: cuerpo, icon: ICON_192, badge: BADGE_URL,
      tag: evTag, requireInteraction: true,
      vibrate: [200, 100, 200, 100, 200],
      data: { url },
    });
    await markFiredToday();
  });
}

function initFirebase() {
  if (fcmInitialized && fcmMessaging) return;
  try {
    if (typeof firebase === 'undefined') {
      try {
        importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
        importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');
      } catch (e) {
        console.warn('[SW] importScripts falló:', e.message);
        return;
      }
    }
    fcmInitialized = true;

    const existingApps = firebase.apps || [];
    if (existingApps.length === 0) {
      firebase.initializeApp({
        apiKey:            'AIzaSyD9gQW61AvKHhNai6gljNFE7q9rS7KKuN8',
        authDomain:        'orientefraterno148-2a0c1.firebaseapp.com',
        projectId:         'orientefraterno148-2a0c1',
        storageBucket:     'orientefraterno148-2a0c1.firebasestorage.app',
        messagingSenderId: FCM_SENDER_ID,
        appId:             '1:101867774014:web:0b4bb797293910c419716f',
      });
    }
    fcmMessaging = firebase.messaging();
    registerFcmBackgroundHandler();
    console.log('[SW] Firebase + FCM inicializado.');
  } catch (err) {
    console.warn('[SW] Firebase no disponible (normal en Firefox/Safari):', err.message);
    fcmMessaging = null;
  }
}

initFirebase();

self.addEventListener('push', () => { if (!fcmMessaging) initFirebase(); });
self.addEventListener('message', () => { if (!fcmMessaging) initFirebase(); });

// ── CANAL 2: WEB PUSH NATIVO (iOS Safari PWA, Firefox) ────────────────────
self.addEventListener('push', e => {
  console.log('[SW-Push] Evento push nativo recibido');

  // En iOS/Firefox no hay FCM; en Android/Chrome los mensajes FCM los maneja el SDK.
  if (e.data) {
    try {
      const data = e.data.json();
      if (data.from || data.fcmMessageId || (fcmMessaging && data.data)) {
        console.log('[SW-Push] Mensaje FCM detectado, ignorando (manejado por SDK).');
        return;
      }
    } catch (_) {}
  }

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
      // Si no es JSON, usar el texto plano como cuerpo (necesario para iOS)
      const texto = e.data.text();
      if (texto) cuerpo = texto;
    }
  }

  e.waitUntil(
    (async () => {
      try {
        // ⚠️ iOS necesita badge o sound para "despertar" en segundo plano.
        await self.registration.showNotification(titulo, {
          body: cuerpo,
          icon: ICON_192,
          badge: BADGE_URL,  // <-- CRÍTICO para iOS 16.4+
          tag: evTag,
          requireInteraction: true,
          vibrate: [200, 100, 200, 100, 200],
          data: { url },
        });
        await markFiredToday();
      } catch (err) {
        console.error('[SW-Push] Error mostrando notificación:', err.message);
      }
    })()
  );
});

// ── CANAL 3: VERIFICACIÓN LOCAL (respaldo con app abierta) ────────────────
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
