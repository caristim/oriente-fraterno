// sw.js - Service Worker para Oriente Fraterno 148
// Archivo separado (necesario para Android - los Blob URL SW no funcionan en Android)

const DB_NAME = 'of_sw';
const DB_VERSION = 1;
const STORE_NAME = 'kv';
const DB_KEY = 'of_scheduled';
const EVENTS_KEY = 'events';

// ── IndexedDB helpers ──────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => e.target.result.createObjectStore(STORE_NAME);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function dbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const r  = tx.objectStore(STORE_NAME).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror   = () => reject(r.error);
  });
}

async function dbPut(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}

async function getScheduled() {
  try {
    const data = await dbGet(DB_KEY);
    return new Set(data || []);
  } catch (_) {
    return new Set();
  }
}

async function saveScheduled(set) {
  try {
    await dbPut(DB_KEY, [...set]);
  } catch (_) { /* ignore */ }
}

// ── Parseo de fecha: soporta MM-DD y YYYY-MM-DD ───────────────────────────

function parseFecha(fecha) {
  if (!fecha) return null;
  const parts = String(fecha).split('-');
  let m, d;
  if (parts.length === 2) {
    [m, d] = parts;
  } else if (parts.length === 3) {
    [, m, d] = parts;
  } else {
    return null;
  }
  return { m: parseInt(m, 10), d: parseInt(d, 10) };
}

// ── Ciclo de vida del SW ───────────────────────────────────────────────────

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// ── Recibe eventos desde la app principal ─────────────────────────────────

self.addEventListener('message', async e => {
  if (e.data?.type !== 'SCHEDULE_EVENTS') return;

  const events    = e.data.events || [];
  const scheduled = await getScheduled();

  for (const ev of events) {
    const key = 'of-' + (ev.id || ev.docId) + '-' + new Date().getFullYear();
    if (!scheduled.has(key)) {
      scheduled.add(key);
    }
  }

  await saveScheduled(scheduled);

  // Guarda la lista completa de eventos para usarla en checkAndNotify
  try {
    await dbPut(EVENTS_KEY, events);
  } catch (_) { /* ignore */ }
});

// ── Periodic Background Sync ──────────────────────────────────────────────

self.addEventListener('periodicsync', e => {
  if (e.tag === 'of-daily-check') {
    e.waitUntil(checkAndNotify());
  }
});

// ── Fallback: verificar en cada fetch ────────────────────────────────────
// (solo si estamos en horario de notificación para no degradar rendimiento)

self.addEventListener('fetch', () => {
  const hour = new Date().getHours();
  if (hour >= 8 && hour <= 11) {
    checkAndNotify().catch(() => {});
  }
});

// ── Lógica principal de notificación ─────────────────────────────────────

async function checkAndNotify() {
  let events;
  try {
    events = (await dbGet(EVENTS_KEY)) || [];
  } catch (_) {
    events = [];
  }

  if (!events.length) return;

  const now   = new Date();
  const hour  = now.getHours();

  // Solo disparar entre las 8 y las 11 AM
  if (hour < 8 || hour > 11) return;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const fired = await getScheduled();

  for (const ev of events) {
    const parsed = parseFecha(ev.fecha);
    if (!parsed) continue;

    const { m, d } = parsed;
    const evDay = new Date(now.getFullYear(), m - 1, d);

    if (evDay.getTime() !== today.getTime()) continue;

    const key = 'of-fired-' + (ev.id || ev.docId) + '-' + now.getFullYear();
    if (fired.has(key)) continue;

    fired.add(key);
    await saveScheduled(fired);

    await self.registration.showNotification('Oriente Fraterno ✦', {
      body:               'Hoy: ' + ev.tipo + ' de ' + ev.nombre,
      tag:                'of-' + (ev.id || ev.docId),
      requireInteraction: true,
      icon:               './icon-192.png',
      badge:              './icon-192.png',
    });
  }
}

// ── Clic en notificación: abre la app ────────────────────────────────────

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      if (clients.length > 0) {
        return clients[0].focus();
      }
      return self.clients.openWindow('./');
    })
  );
});
