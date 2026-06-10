// Oriente Fraterno 148 - Service Worker v14
// Maneja notificaciones FCM en background y lógica local de respaldo

importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

const SW_VERSION  = 'of-sw-v14';
const DB_NAME     = 'of_sw';
const DB_VERSION  = 1;
const APP_ORIGIN  = 'https://caristim.github.io';
const APP_BASE    = 'https://caristim.github.io/oriente-fraterno/';
const ICON_192    = 'https://caristim.github.io/oriente-fraterno/icon-192.png';
const BADGE_URL   = 'https://caristim.github.io/oriente-fraterno/icon-192.png';

// ── Recursos a pre-cachear para funcionar offline ─────────────────────────────
const CACHE_NAME = 'of-cache-v14';
const PRECACHE_URLS = [
  'https://caristim.github.io/oriente-fraterno/',
  'https://caristim.github.io/oriente-fraterno/index.html',
  'https://caristim.github.io/oriente-fraterno/manifest.json',
  'https://caristim.github.io/oriente-fraterno/icon-192.png',
  'https://caristim.github.io/oriente-fraterno/icon-512.png',
];

firebase.initializeApp({
  apiKey:            'AIzaSyD9gQW61AvKHhNai6gljNFE7q9rS7KKuN8',
  authDomain:        'orientefraterno148-2a0c1.firebaseapp.com',
  projectId:         'orientefraterno148-2a0c1',
  storageBucket:     'orientefraterno148-2a0c1.firebasestorage.app',
  messagingSenderId: '101867774014',
  appId:             '1:101867774014:web:0b4bb797293910c419716f',
});

const messaging = firebase.messaging();

// ── Handler de notificaciones en background ───────────────────────────────────
//
// El workflow envía webpush.notification en el payload (además de data).
// Esto garantiza:
//   - iOS PWA (16.4+): FCM/WebKit muestra la notificación AUTOMÁTICAMENTE sin
//     pasar por este handler, ya que WebKit procesa webpush.notification directo.
//   - Android/Chrome: FCM muestra la notif automáticamente desde webpush.notification
//     Y llama a onBackgroundMessage.
//
// Por eso este handler NO llama a showNotification() — ya fue mostrada por FCM.
// Solo ejecuta markFcmFiredToday() para que checkAndNotify() no duplique
// la notificación si el usuario abre la app más tarde ese mismo día.
//
messaging.onBackgroundMessage(payload => {
  const titulo = (payload.data && payload.data.title)
              || (payload.notification && payload.notification.title)
              || 'Oriente Fraterno 148';
  const cuerpo  = (payload.data && payload.data.body)
              || (payload.notification && payload.notification.body)
              || 'Hoy hay un evento';

  console.log('[SW-FCM] Mensaje background recibido:', titulo, cuerpo);

  // La notificación ya fue mostrada automáticamente por FCM (webpush.notification).
  // Solo marcar en fired[] para evitar duplicado desde checkAndNotify().
  return markFcmFiredToday();
});

// ── Marca en fired[] los eventos de hoy notificados por FCM ──────────────────
async function markFcmFiredToday() {
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
      if (!fired[fireKey]) { fired[fireKey] = true; changed = true; }
    }
    if (changed) await dbSet('fired', fired);
  } catch (err) { console.warn('[SW] markFcmFiredToday error:', err); }
}

// ── IndexedDB helpers ─────────────────────────────────────────────────────────
function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}
async function dbGet(key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readonly');
    const r  = tx.objectStore('kv').get(key);
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
}
async function dbSet(key, value) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = res;
    tx.onerror    = () => rej(tx.error);
  });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  console.log('[SW]', SW_VERSION);
  // Pre-cachear recursos de la app para funcionamiento offline
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_URLS).catch(err => {
        // No bloquear instalación si falla algún recurso (ej: sin red)
        console.warn('[SW] Pre-cache parcial:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  // Limpiar cachés antiguas al activar nueva versión del SW
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Eliminando caché antigua:', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

// ── Mensajes desde la app ─────────────────────────────────────────────────────
self.addEventListener('message', async e => {
  if (!e.data) return;
  if (e.data.type === 'SCHEDULE_EVENTS') {
    await dbSet('events', e.data.events || []);
    await checkAndNotify();
  }
  if (e.data.type === 'PING')         e.source && e.source.postMessage({ type: 'PONG', version: SW_VERSION });
  if (e.data.type === 'CHECK_NOW')    await checkAndNotify();
  if (e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// ── Background Periodic Sync ──────────────────────────────────────────────────
self.addEventListener('periodicsync', e => {
  if (e.tag === 'of-daily-check') {
    console.log('[SW] Periodic sync disparado');
    e.waitUntil(checkAndNotify());
  }
});

// ── Background Sync estándar (reconexión de red) ──────────────────────────────
self.addEventListener('sync', e => {
  if (e.tag === 'of-check') {
    console.log('[SW] Background sync disparado');
    e.waitUntil(checkAndNotify());
  }
});

// ── Fetch: estrategia Cache-First para recursos propios, Network-First para el resto ──
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Solo interceptar GETs
  if (e.request.method !== 'GET') return;

  // Recursos propios de la app (mismo origen GitHub Pages): Cache-First
  if (url.startsWith(APP_BASE)) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(response => {
          // Cachear respuestas válidas
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          }
          return response;
        }).catch(() => {
          // Sin red y sin caché: devolver página principal si existe
          return caches.match('https://caristim.github.io/oriente-fraterno/index.html')
            || new Response('Sin conexión', { status: 503 });
        });
      })
    );
    return;
  }

  // Recursos externos (Firebase, CDNs): Network-First con fallback a caché
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
  const targetUrl = (e.notification.data && e.notification.data.url) || APP_BASE;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const appClient = clients.find(c => c.url.includes('oriente-fraterno'));
      if (appClient) return appClient.focus();
      return self.clients.openWindow(targetUrl);
    })
  );
});

// ── Notificación local de respaldo ────────────────────────────────────────────
// Se dispara cuando:
//   a) El periodic sync despierta el SW (Android Chrome, con la app cerrada)
//   b) El usuario abre la app y hay un evento hoy que FCM no entregó
// El sistema fired[] evita duplicados con las notificaciones FCM.
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
      if (self.Notification && Notification.permission !== 'granted') continue;
      // FIX: URLs absolutas para icon y badge (relativas fallan cuando el SW
      // está en scope raíz o la app está cerrada)
      await self.registration.showNotification('Oriente Fraterno 148', {
        body:               `Hoy: ${ev.tipo} de ${ev.nombre}`,
        tag:                `of-local-${evId}`,
        icon:               ICON_192,
        badge:              BADGE_URL,
        requireInteraction: true,
        vibrate:            [200, 100, 200, 100, 200],
        data:               { url: APP_BASE },
      });
      fired[fireKey] = true;
      changed = true;
    }
    if (changed) await dbSet('fired', fired);
  } catch (err) { console.warn('[SW] checkAndNotify error:', err); }
}
