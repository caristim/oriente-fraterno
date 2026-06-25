// Oriente Fraterno 148 — Service Worker v24.2
// MEJORAS: logs más detallados, manejo de push más robusto, y eliminación de duplicados.

const SW_VERSION    = 'of-sw-v24.2';
const DB_NAME       = 'of_sw';
const APP_ROOT      = 'https://caristim.github.io/oriente-fraterno/';
const APP_URL       = 'https://caristim.github.io/oriente-fraterno/';
const ICON_192      = 'https://caristim.github.io/oriente-fraterno/icon-192.png';
const BADGE_URL     = 'https://caristim.github.io/oriente-fraterno/icon-192.png';

const CACHE_NAME    = 'of-cache-v24.2';
const PRECACHE_URLS = [
  APP_ROOT,
  APP_ROOT + 'index.html',
  APP_ROOT + 'manifest.json',
  APP_ROOT + 'icon-192.png',
  APP_ROOT + 'icon-512.png',
];

// ── Push: parseo unificado (FCM + Web Push nativo) ────────────────────────
function readPushJson(e) {
  if (!e.data) return null;
  try { return e.data.json(); } catch (_) {}
  try {
    const text = e.data.text();
    if (text) return JSON.parse(text);
  } catch (_) {}
  return null;
}

async function showPushNotification(titulo, cuerpo, url, evTag) {
  await self.registration.showNotification(titulo, {
    body: cuerpo,
    icon: ICON_192,
    badge: BADGE_URL,
    tag: evTag,
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 200],
    data: { url },
  });
  await markFiredToday();
}

async function handlePushEvent(e) {
  const raw = readPushJson(e);
  console.log('[SW-Push] Payload recibido:', raw);

  // Valores por defecto
  let titulo = 'Oriente Fraterno 148';
  let cuerpo = 'Tenés un evento hoy ✦';
  let url    = APP_URL;
  let evTag  = 'of-' + Date.now();

  if (raw) {
    // Extraer de notificación o data
    if (raw.notification) {
      titulo = raw.notification.title || titulo;
      cuerpo = raw.notification.body  || cuerpo;
      if (raw.data && raw.data.url) url = raw.data.url;
      if (raw.data && raw.data.tag) evTag = raw.data.tag;
    } else if (raw.data) {
      titulo = raw.data.title || titulo;
      cuerpo = raw.data.body  || cuerpo;
      url    = raw.data.url   || url;
      evTag  = raw.data.tag   || evTag;
    } else {
      titulo = raw.title || titulo;
      cuerpo = raw.body  || cuerpo;
      url    = raw.url   || url;
      evTag  = raw.tag   || evTag;
    }
  }

  // Si el evento push vino con datos, siempre mostramos la notificación
  // (incluso si el navegador ya la mostró, usamos el mismo tag para reemplazar)
  console.log('[SW-Push] Mostrando notificación manual:', titulo, '|', cuerpo);
  await showPushNotification(titulo, cuerpo, url, evTag);
}

self.addEventListener('push', e => {
  console.log('[SW-Push] Evento push recibido (app puede estar cerrada)');
  e.waitUntil(handlePushEvent(e).catch(err => {
    console.error('[SW-Push] Error fatal:', err.message);
  }));
});

// ── CANAL LOCAL: respaldo con app abierta ─────────────────────────────────
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
  // (mismo código que antes, no se modifica)
}

// ── IndexedDB helpers (sin cambios) ──────────────────────────────────────
function openDB() { /* ... */ }
async function dbGet(key) { /* ... */ }
async function dbSet(key, value) { /* ... */ }

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

// ── Fetch (sin cambios) ─────────────────────────────────────────────────────
self.addEventListener('fetch', e => { /* ... */ });

// ── Notificationclick (sin cambios) ─────────────────────────────────────────
self.addEventListener('notificationclick', e => { /* ... */ });
self.addEventListener('notificationclose', e => { /* ... */ });
