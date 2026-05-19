// ── Oriente Fraterno 148 · Service Worker ─────────────────────────────────
// Combina OneSignal (notificaciones push a las 9 AM via GitHub Actions)
// con la logica propia de la app (sync de eventos, notificaciones locales).

importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');

const SW_VERSION = 'of-sw-v7';
const DB_NAME    = 'of_sw';
const DB_VERSION = 1;

// ── IndexedDB helpers ──────────────────────────────────────────────────────

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

// ── Lifecycle ──────────────────────────────────────────────────────────────

self.addEventListener('install', () => {
  console.log('[SW] install', SW_VERSION);
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  console.log('[SW] activate', SW_VERSION);
  e.waitUntil(
    self.clients.claim().then(async () => {
      await checkAndNotify();
    })
  );
});

// ── Mensajes desde la app ──────────────────────────────────────────────────

self.addEventListener('message', async e => {
  if (!e.data) return;

  if (e.data.type === 'SCHEDULE_EVENTS') {
    const events = e.data.events || [];
    await dbSet('events', events);
    console.log('[SW] eventos almacenados:', events.length);
    await checkAndNotify();
  }

  if (e.data.type === 'PING') {
    e.source && e.source.postMessage({ type: 'PONG', version: SW_VERSION });
  }

  if (e.data.type === 'CHECK_NOW') {
    await checkAndNotify();
  }
});

// ── Background Sync ────────────────────────────────────────────────────────

self.addEventListener('periodicsync', e => {
  if (e.tag === 'of-daily-check') {
    e.waitUntil(checkAndNotify());
  }
});

self.addEventListener('sync', e => {
  if (e.tag === 'of-check') {
    e.waitUntil(checkAndNotify());
  }
});

// ── Fetch ──────────────────────────────────────────────────────────────────

self.addEventListener('fetch', e => {
  if (e.request.mode === 'navigate') {
    checkAndNotify().catch(console.warn);
  }
  e.respondWith(
    fetch(e.request).catch(() => new Response('Sin conexion', { status: 503 }))
  );
});

// ── Clic en notificacion ───────────────────────────────────────────────────

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const focused = clients.find(c => c.focused);
      if (focused)        return focused.focus();
      if (clients.length) return clients[0].focus();
      return self.clients.openWindow('./');
    })
  );
});

// ── Check local (respaldo para cuando el usuario abre la app) ─────────────
// La notificacion principal a las 9 AM viene de GitHub Actions via OneSignal.
// Este check actua de respaldo: si el usuario abre la app el dia del evento
// y el push no llego, igual avisa.

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
      if (parts.length === 2) {
        [month, day] = parts.map(Number);
      } else if (parts.length === 3) {
        [, month, day] = parts.map(Number);
      } else {
        continue;
      }
      if (!month || !day) continue;

      const evDay   = new Date(now.getFullYear(), month - 1, day);
      const isToday = evDay.getTime() === today.getTime();
      if (!isToday) continue;

      const evId    = ev.docId || ev.id || `${ev.nombre}-${ev.fecha}`;
      const fireKey = `${evId}-${now.getFullYear()}`;
      if (fired[fireKey]) continue;

      if (self.Notification && Notification.permission !== 'granted') continue;

      await self.registration.showNotification('Oriente Fraterno', {
        body:               `Hoy: ${ev.tipo} de ${ev.nombre}`,
        tag:                `of-local-${evId}`,
        icon:               './icon-192.png',
        badge:              './icon-192.png',
        requireInteraction: true,
        vibrate:            [200, 100, 200, 100, 200],
        data:               { eventId: evId },
        actions: [{ action: 'open', title: 'Ver app' }],
      });

      fired[fireKey] = true;
      changed = true;
      console.log('[SW] notificacion local para', ev.nombre);
    }

    if (changed) await dbSet('fired', fired);
  } catch (err) {
    console.warn('[SW] checkAndNotify error:', err);
  }
}
