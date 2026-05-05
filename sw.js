// ── Oriente Fraterno 148 · Service Worker ─────────────────────────────────
// v3 — notificaciones confiables en Android/Chrome
// Estrategia: alarm-store en IndexedDB + check en cada activate/fetch/sync

const SW_VERSION = 'of-sw-v3';
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
  e.waitUntil(self.clients.claim().then(() => checkAndNotify()));
});

// ── Recibir eventos desde la app ───────────────────────────────────────────

self.addEventListener('message', async e => {
  if (!e.data) return;

  if (e.data.type === 'SCHEDULE_EVENTS') {
    const events = e.data.events || [];
    await dbSet('events', events);
    console.log('[SW] events stored:', events.length);
    // Verificar inmediatamente por si hay algo para HOY
    await checkAndNotify();
  }

  if (e.data.type === 'PING') {
    // La app puede verificar que el SW está activo
    e.source && e.source.postMessage({ type: 'PONG', version: SW_VERSION });
  }
});

// ── Background Sync ────────────────────────────────────────────────────────

self.addEventListener('periodicsync', e => {
  if (e.tag === 'of-daily-check') {
    console.log('[SW] periodicsync');
    e.waitUntil(checkAndNotify());
  }
});

// ── Fetch (fallback para activar checkAndNotify cuando el usuario abre la app) ──

self.addEventListener('fetch', e => {
  // Solo disparar check en navegación, no en cada recurso
  if (e.request.mode === 'navigate') {
    checkAndNotify().catch(console.warn);
  }
  // Dejar pasar el fetch normalmente (sin cache propio)
  e.respondWith(fetch(e.request));
});

// ── Notificaciones ─────────────────────────────────────────────────────────

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length) return clients[0].focus();
      return self.clients.openWindow('./');
    })
  );
});

// ── Lógica central: verificar fechas y disparar notificaciones ─────────────

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

      // Parsear fecha MM-DD o YYYY-MM-DD
      const parts = String(ev.fecha).split('-');
      let month, day;
      if (parts.length === 2) {
        [month, day] = parts.map(Number);
      } else if (parts.length === 3) {
        [, month, day] = parts.map(Number);
      } else {
        continue;
      }

      const evDay = new Date(now.getFullYear(), month - 1, day);

      // Si ya pasó este año, apuntar al próximo
      if (evDay < today) evDay.setFullYear(now.getFullYear() + 1);

      const isToday = evDay.getTime() === today.getTime();
      if (!isToday) continue;

      const fireKey = `${ev.id}-${now.getFullYear()}`;
      if (fired[fireKey]) continue; // ya notificamos este año

      // ¡Disparar notificación!
      await self.registration.showNotification('Oriente Fraterno ✦', {
        body:             `Hoy: ${ev.tipo} de ${ev.nombre}`,
        tag:              `of-${ev.id}`,
        icon:             './icon-192.png',
        badge:            './icon-192.png',
        requireInteraction: true,
        vibrate:          [200, 100, 200],
        data:             { eventId: ev.id },
      });

      fired[fireKey] = true;
      changed = true;
      console.log('[SW] notificación enviada para', ev.nombre);
    }

    if (changed) await dbSet('fired', fired);
  } catch (err) {
    console.warn('[SW] checkAndNotify error:', err);
  }
}
