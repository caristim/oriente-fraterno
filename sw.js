// ── Oriente Fraterno 148 · Service Worker ─────────────────────────────────
// v4 — notificaciones confiables en Android/Chrome
// Estrategia: alarma interna a las 9:00 AM + IndexedDB + check en activate/sync/fetch

const SW_VERSION = 'of-sw-v4';
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

// ── Alarma interna: programa un setTimeout hasta las 9:00 AM ──────────────
// Este es el mecanismo principal que permite notificar aunque la app esté
// cerrada (mientras Chrome/Android mantenga el SW vivo — instalado como PWA).

let _alarmTimer = null;

function scheduleNextCheck() {
  if (_alarmTimer) {
    clearTimeout(_alarmTimer);
    _alarmTimer = null;
  }

  const now    = new Date();
  const next9  = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0);

  // Si las 9 AM ya pasaron hoy, programar para mañana
  if (next9 <= now) {
    next9.setDate(next9.getDate() + 1);
  }

  const delay = next9 - now;
  console.log('[SW] próxima alarma en', Math.round(delay / 60000), 'minutos (', next9.toLocaleString(), ')');

  _alarmTimer = setTimeout(async () => {
    console.log('[SW] alarma de las 9 AM disparada');
    await checkAndNotify();
    scheduleNextCheck(); // re-programar para el día siguiente
  }, delay);
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
      await checkAndNotify(); // verificar por si HOY hay algo
      scheduleNextCheck();    // programar alarma de las 9 AM
    })
  );
});

// ── Recibir eventos desde la app ───────────────────────────────────────────

self.addEventListener('message', async e => {
  if (!e.data) return;

  if (e.data.type === 'SCHEDULE_EVENTS') {
    const events = e.data.events || [];
    await dbSet('events', events);
    console.log('[SW] eventos almacenados:', events.length);
    await checkAndNotify();  // verificar por si HOY hay algo
    scheduleNextCheck();     // (re)programar alarma
  }

  if (e.data.type === 'PING') {
    e.source && e.source.postMessage({ type: 'PONG', version: SW_VERSION });
  }

  if (e.data.type === 'CHECK_NOW') {
    await checkAndNotify();
  }
});

// ── Background Sync (Periodic) ─────────────────────────────────────────────

self.addEventListener('periodicsync', e => {
  if (e.tag === 'of-daily-check') {
    console.log('[SW] periodicsync disparado');
    e.waitUntil(checkAndNotify());
  }
});

// ── Background Sync (one-shot, fallback) ──────────────────────────────────

self.addEventListener('sync', e => {
  if (e.tag === 'of-check') {
    console.log('[SW] sync disparado');
    e.waitUntil(checkAndNotify());
  }
});

// ── Fetch ──────────────────────────────────────────────────────────────────
// Activar check cuando el usuario abre la app (navegación), sin romper la red.

self.addEventListener('fetch', e => {
  if (e.request.mode === 'navigate') {
    checkAndNotify().catch(console.warn);
    scheduleNextCheck(); // asegurarse de que la alarma siga activa
  }
  // Pass-through: sin cache propio, red normal
  e.respondWith(
    fetch(e.request).catch(() => new Response('Sin conexión', { status: 503 }))
  );
});

// ── Clic en notificación ───────────────────────────────────────────────────

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
      if (!month || !day) continue;

      const evDay = new Date(now.getFullYear(), month - 1, day);

      const isToday = evDay.getTime() === today.getTime();
      if (!isToday) continue;

      // Clave única por evento y año para no notificar dos veces
      const evId    = ev.docId || ev.id || `${ev.nombre}-${ev.fecha}`;
      const fireKey = `${evId}-${now.getFullYear()}`;
      if (fired[fireKey]) continue;

      // Verificar que el permiso de notificación esté activo
      if (self.Notification && Notification.permission !== 'granted') {
        console.warn('[SW] permiso de notificación no otorgado, omitiendo');
        continue;
      }

      await self.registration.showNotification('Oriente Fraterno ✦', {
        body:               `Hoy: ${ev.tipo} de ${ev.nombre}`,
        tag:                `of-${evId}`,
        icon:               './icon-192.png',
        badge:              './icon-192.png',
        requireInteraction: true,
        vibrate:            [200, 100, 200, 100, 200],
        data:               { eventId: evId },
        actions: [
          { action: 'open', title: 'Ver app' }
        ],
      });

      fired[fireKey] = true;
      changed = true;
      console.log('[SW] notificación enviada para', ev.nombre, '-', ev.tipo);
    }

    if (changed) await dbSet('fired', fired);
  } catch (err) {
    console.warn('[SW] checkAndNotify error:', err);
  }
}
