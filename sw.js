// Oriente Fraterno 148 - Service Worker v17 (Dual Push optimizado)
// Diseñado para máxima fiabilidad con la aplicación cerrada

importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

const SW_VERSION  = 'of-sw-v17';
const DB_NAME     = 'of_sw';
const DB_VERSION  = 1;
const APP_BASE    = 'https://caristim.github.io/oriente-fraterno/';
const ICON_192    = 'https://caristim.github.io/oriente-fraterno/icon-192.png';
const BADGE_URL   = 'https://caristim.github.io/oriente-fraterno/icon-192.png';

const CACHE_NAME = 'of-cache-v17';
const PRECACHE_URLS = [
  'https://caristim.github.io/oriente-fraterno/',
  'https://caristim.github.io/oriente-fraterno/index.html',
  'https://caristim.github.io/oriente-fraterno/manifest.json',
  'https://caristim.github.io/oriente-fraterno/icon-192.png',
  'https://caristim.github.io/oriente-fraterno/icon-512.png',
];

try {
  firebase.initializeApp({
    apiKey:            'AIzaSyD9gQW61AvKHhNai6gljNFE7q9rS7KKuN8',
    authDomain:        'orientefraterno148-2a0c1.firebaseapp.com',
    projectId:         'orientefraterno148-2a0c1',
    storageBucket:     'orientefraterno148-2a0c1.firebasestorage.app',
    messagingSenderId: '101867774014',
    appId:             '1:101867774014:web:0b4bb797293910c419716f',
  });
  const messaging = firebase.messaging();
  
  // Manejador FCM en Background para Android
  messaging.onBackgroundMessage(payload => {
    console.log('[SW-FCM] Mensaje background recibido:', payload);
    // Si viene estructura de notificación nativa, el SDK de Firebase la muestra sola.
    return markFcmFiredToday();
  });
} catch (err) {
  console.warn('[SW] Firebase no se pudo inicializar en este entorno:', err);
}

// ── MANEJADOR UNIFICADO DE PUSH (CRÍTICO PARA APP CERRADA) ──
self.addEventListener('push', e => {
  console.log('[SW-Push] Evento push nativo detectado');

  let titulo = 'Oriente Fraterno 148';
  let cuerpo = 'Tenés un evento hoy ✦';
  let url    = APP_BASE;

  if (e.data) {
    try {
      // Intentamos parsear suponiendo que es un JSON estructurado
      const data = e.data.json();
      titulo = data.title || data.notification?.title || titulo;
      cuerpo = data.body || data.notification?.body || cuerpo;
      url = data.url || data.data?.url || url;
    } catch (_) {
      // Si falla (ej. texto plano enviado por el servidor), usamos el texto directamente
      const textoPlano = e.data.text();
      if (textoPlano) {
        cuerpo = textoPlano;
      }
    }
  }

  // En PWAs, es mandatorio pasarle una promesa que resuelva a showNotification.
  // Si no se hace, el sistema operativo (especialmente iOS) no despierta la app en background.
  const options = {
    body:               cuerpo,
    icon:               ICON_192,
    badge:              BADGE_URL,
    tag:                'of-notification', // Tag fijo para evitar colapsar la pantalla si hay múltiples eventos
    renotify:           true,
    requireInteraction: true,
    vibrate:            [200, 100, 200, 100, 200],
    data:               { url },
  };

  e.waitUntil(
    Promise.all([
      self.registration.showNotification(titulo, options),
      markFcmFiredToday()
    ])
  );
});

// ── Marcar eventos como notificados en la base de datos interna ──
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
      if (evDay.getTime() === today.getTime()) {
        const evId    = ev.docId || ev.id || `${ev.nombre}-${ev.fecha}`;
        const fireKey = `${evId}-${now.getFullYear()}`;
        if (!fired[fireKey]) { fired[fireKey] = true; changed = true; }
      }
    }
    if (changed) await dbSet('fired', fired);
  } catch (err) { console.warn('[SW] markFcmFiredToday error:', err); }
}

// ── IndexedDB Helpers ──
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
  try {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readonly');
      const r  = tx.objectStore('kv').get(key);
      r.onsuccess = () => res(r.result);
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
  } catch (_) { return; }
}

// ── Ciclo de vida estricto para forzar actualización inmediata ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Mensajería desde la App
self.addEventListener('message', async e => {
  if (!e.data) return;
  if (e.data.type === 'SCHEDULE_EVENTS') {
    await dbSet('events', e.data.events || []);
  }
  if (e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Click en la notificación
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
