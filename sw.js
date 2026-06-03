// Oriente Fraterno 148 - Service Worker v11
// Maneja notificaciones FCM en background y logica local de respaldo

importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

const SW_VERSION = 'of-sw-v11';
const DB_NAME    = 'of_sw';
const DB_VERSION = 1;

firebase.initializeApp({
  apiKey:            'AIzaSyD9gQW61AvKHhNai6gljNFE7q9rS7KKuN8',
  authDomain:        'orientefraterno148-2a0c1.firebaseapp.com',
  projectId:         'orientefraterno148-2a0c1',
  storageBucket:     'orientefraterno148-2a0c1.firebasestorage.app',
  messagingSenderId: '101867774014',
  appId:             '1:101867774014:web:0b4bb797293910c419716f',
});

// Inicializar el SDK de Firebase Messaging en el SW.
const messaging = firebase.messaging();

// Handler para mensajes en background (FCM)
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Mensaje en background recibido:', payload);
  const titulo = payload.data?.title || payload.notification?.title || 'Oriente Fraterno 148';
  const cuerpo = payload.data?.body || payload.notification?.body || 'Hoy hay un evento';
  
  const notificationOptions = {
    body: cuerpo,
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: 'of-fcm',
    data: { url: 'https://caristim.github.io/oriente-fraterno/' },
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 200]
  };

  return self.registration.showNotification(titulo, notificationOptions)
    .then(() => markFcmFiredToday(cuerpo));
});

// ── Handler nativo 'push' (Respaldo para otros navegadores) ───────────────────
self.addEventListener('push', e => {
  if (!e.data) return;

  let titulo = 'Oriente Fraterno 148';
  let cuerpo = 'Hoy hay un evento';

  try {
    const payload = e.data.json();
    if (payload.data) {
      titulo = payload.data.title  || titulo;
      cuerpo = payload.data.body   || cuerpo;
    } else if (payload.notification) {
      titulo = payload.notification.title || titulo;
      cuerpo = payload.notification.body  || cuerpo;
    }
  } catch (_) {
    try { cuerpo = e.data.text() || cuerpo; } catch (__) {}
  }

  console.log('[SW-push] Notificacion recibida:', titulo, cuerpo);

  e.waitUntil(
    self.registration.showNotification(titulo, {
      body:               cuerpo,
      icon:               './icon-192.png',
      badge:              './icon-192.png',
      requireInteraction: true,
      vibrate:            [200, 100, 200, 100, 200],
      tag:                'of-fcm',
      data:               { url: 'https://caristim.github.io/oriente-fraterno/' },
      actions:            [{ action: 'open', title: 'Ver app' }],
    }).then(() => markFcmFiredToday(cuerpo))
  );
});

// ── Marca en fired los eventos notificados por FCM ────────────────────────────
async function markFcmFiredToday(cuerpo) {
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
      if (parts.length === 2) [month, day] = parts.map(Number);
      else if (parts.length === 3) [, month, day] = parts.map(Number);
      else continue;
      if (!month || !day) continue;
      const evDay   = new Date(now.getFullYear(), month - 1, day);
      const isToday = evDay.getTime() === today.getTime();
      if (!isToday) continue;
      const evId    = ev.docId || ev.id || `${ev.nombre}-${ev.fecha}`;
      const fireKey = `${evId}-${now.getFullYear()}`;
      if (!fired[fireKey]) {
        fired[fireKey] = true;
        changed = true;
      }
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
self.addEventListener('install', () => { console.log('[SW]', SW_VERSION); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim().then(() => checkAndNotify())); });

// ── Mensajes desde la app ─────────────────────────────────────────────────────
self.addEventListener('message', async e => {
  if (!e.data) return;
  if (e.data.type === 'SCHEDULE_EVENTS') {
    await dbSet('events', e.data.events || []);
    await checkAndNotify();
  }
  if (e.data.type === 'PING') e.source && e.source.postMessage({ type: 'PONG', version: SW_VERSION });
  if (e.data.type === 'CHECK_NOW') await checkAndNotify();
  if (e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// ── Background sync ───────────────────────────────────────────────────────────
self.addEventListener('periodicsync', e => { if (e.tag === 'of-daily-check') e.waitUntil(checkAndNotify()); });
self.addEventListener('sync', e => { if (e.tag === 'of-check') e.waitUntil(checkAndNotify()); });

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  if (e.request.mode === 'navigate') checkAndNotify().catch(console.warn);
  e.respondWith(fetch(e.request).catch(() => new Response('Sin conexion', { status: 503 })));
});

// ── Clic en notificacion ──────────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const targetUrl = (e.notification.data && e.notification.data.url)
    || 'https://caristim.github.io/oriente-fraterno/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const appClient = clients.find(c => c.url.includes('oriente-fraterno'));
      if (appClient) return appClient.focus();
      return self.clients.openWindow(targetUrl);
    })
  );
});

// ── Notificacion local de respaldo (cuando el usuario abre la app) ────────────
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
      if (parts.length === 2) [month, day] = parts.map(Number);
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
      await self.registration.showNotification('Oriente Fraterno 148', {
        body:               `Hoy: ${ev.tipo} de ${ev.nombre}`,
        tag:                `of-local-${evId}`,
        icon:               './icon-192.png',
        badge:              './icon-192.png',
        requireInteraction: true,
        vibrate:            [200, 100, 200, 100, 200],
      });
      fired[fireKey] = true;
      changed = true;
    }
    if (changed) await dbSet('fired', fired);
  } catch (err) { console.warn('[SW] checkAndNotify error:', err); }
}
