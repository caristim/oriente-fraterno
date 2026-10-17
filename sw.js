// Oriente Fraterno 148 — Service Worker v26.0
// CAMBIOS v26.0:
//   - Nuevo handler 'pushsubscriptionchange': si el navegador rota/expira la
//     suscripción push, el SW se re-suscribe y la guarda en Firestore SIN que
//     el usuario abra la app (antes quedaba huérfana y dejaba de notificar).
//   - 'fired' ahora incluye el AÑO (antes el tag era MM-DD y el segundo año
//     la app creía que ya había notificado).
//   - renotify:true -> si queda una notificación vieja con el mismo tag en la
//     bandeja (requireInteraction), la nueva igualmente suena/vibra.
//   - index.html y recursos de la app: red primero, caché de respaldo (antes
//     caché primero: la app nunca se actualizaba sola).
// CORRECCIÓN v25.0:
//   - Migración a WebPush nativo puro en todas las plataformas (Android,
//     Windows/Edge, iOS, Firefox). Se eliminó la dependencia de Firebase
//     Cloud Messaging (FCM) en el cliente y en el workflow de GitHub Actions,
//     porque ese mecanismo exigía un Service Worker especial llamado
//     "firebase-messaging-sw.js" que nunca existía en este proyecto. Esa
//     era la causa de que las notificaciones no llegaran con la app cerrada
//     en Android/Chrome/Edge (solo con la app abierta, vía el SDK en JS).
//   - El evento 'push' de este Service Worker ya estaba correctamente
//     implementado para WebPush nativo y no requería cambios funcionales:
//     intercepta el push aunque la app esté completamente cerrada en
//     cualquier sistema operativo, exactamente igual que en Cumples-Familia.
// CORRECCIÓN v24.3 (se mantiene):
//   - showPushNotification() ya no llama markFiredToday() (que necesitaba
//     IndexedDB llena, solo posible con la app abierta). Ahora guarda
//     directamente fired[evTag] = true usando el tag del propio push.
//   - checkAndNotify() genera el tag con el mismo algoritmo que el workflow
//     ('of-ev-' + nombre-normalizado + '-' + MM-DD), por lo que coincide con
//     el tag guardado por el push externo y evita la doble notificación.
//   - Se elimina markFiredToday() — ya no es necesaria.

const SW_VERSION    = 'of-sw-v26.0';
const DB_NAME       = 'of_sw';
const APP_ROOT      = 'https://caristim.github.io/oriente-fraterno/';
const APP_URL       = 'https://caristim.github.io/oriente-fraterno/';
const ICON_192      = 'https://caristim.github.io/oriente-fraterno/icon-192.png';
const BADGE_URL     = 'https://caristim.github.io/oriente-fraterno/icon-192.png';

const CACHE_NAME    = 'of-cache-v26.0';

// Datos necesarios para re-registrar la suscripción desde el SW
const VAPID_PUBLIC_KEY = 'BIrtqfJ3hWlKntqS1SwaKDxf4sFn5pHYfK-UxK9TvWdHfL-h_5Ebj0s4CMtElLeR_Rjd6mx1b_BhfqOmyokw44M';
const FS_PROJECT       = 'orientefraterno148-2a0c1';
const FS_API_KEY       = 'AIzaSyD9gQW61AvKHhNai6gljNFE7q9rS7KKuN8';
const PRECACHE_URLS = [
  APP_ROOT,
  APP_ROOT + 'index.html',
  APP_ROOT + 'manifest.json',
  APP_ROOT + 'icon-192.png',
  APP_ROOT + 'icon-512.png',
];

// ── Normalización de nombre (igual que el workflow) ───────────────────────────
// Genera el mismo tag que notificacion-eventos.yml para el mismo evento,
// permitiendo que fired{} deduplique entre el push externo y checkAndNotify().
function normalizarNombre(nombre) {
  return nombre
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-').toLowerCase().substring(0, 30);
}
function generarTag(nombre, fecha) {
  // fecha en formato MM-DD (como viene de Firestore y como usa el workflow)
  return 'of-ev-' + normalizarNombre(nombre) + '-' + fecha;
}

// ── Push: parseo del payload WebPush ───────────────────────────────────────
// El workflow envía SOLO el campo "data" (sin "notification" a nivel raíz).
// Esto garantiza que el SW intercepta el push con la app cerrada en todos los OS.
function readPushJson(e) {
  if (!e.data) return null;
  try { return e.data.json(); } catch (_) {}
  try {
    const text = e.data.text();
    if (text) return JSON.parse(text);
  } catch (_) {}
  return null;
}

// Clave de 'fired' con año: el tag del workflow es MM-DD y se repite cada año.
function firedKey(tag) { return tag + '@' + new Date().getFullYear(); }

// Muestra la notificación y guarda el tag directamente en fired{}.
// No depende de que IndexedDB tenga la lista de eventos (funciona con app cerrada).
async function showPushNotification(titulo, cuerpo, url, evTag) {
  await self.registration.showNotification(titulo, {
    body:               cuerpo,
    icon:               ICON_192,
    badge:              BADGE_URL,
    tag:                evTag,
    renotify:           true,
    requireInteraction: true,
    vibrate:            [200, 100, 200, 100, 200],
    data:               { url },
  });
  // Guardar el tag directamente en fired{} sin necesitar la lista de eventos.
  // Cuando el usuario abra la app, checkAndNotify() generará el mismo tag
  // y lo encontrará en fired{}, evitando la doble notificación.
  try {
    const fired = (await dbGet('fired')) || {};
    const k = firedKey(evTag);
    if (!fired[k]) {
      fired[k] = true;
      await dbSet('fired', fired);
    }
  } catch (err) {
    console.warn('[SW] No se pudo guardar fired[tag]:', err);
  }
}

async function handlePushEvent(e) {
  const raw = readPushJson(e);

  // Sin datos: mostrar notificación genérica
  if (!raw) {
    const text = e.data ? (() => { try { return e.data.text(); } catch (_) { return ''; } })() : '';
    await showPushNotification(
      'Oriente Fraterno 148',
      text || 'Tienes un evento hoy ✦',
      APP_URL,
      'of-fallback-' + Date.now()
    );
    return;
  }

  let titulo = 'Oriente Fraterno 148';
  let cuerpo = 'Tienes un evento hoy ✦';
  let url    = APP_URL;
  let evTag  = 'of-fallback-' + Date.now();

  // El workflow envía solo "data" (sin "notification").
  // Se conserva el bloque legacy por si algún dispositivo tiene payload antiguo en cola.
  if (raw.notification) {
    titulo = raw.notification.title || titulo;
    cuerpo = raw.notification.body  || cuerpo;
    if (raw.data && raw.data.url) url   = raw.data.url;
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

  console.log('[SW-Push] Mostrando notificación:', titulo, '|', cuerpo, '| tag:', evTag);
  await showPushNotification(titulo, cuerpo, url, evTag);
}

self.addEventListener('push', e => {
  console.log('[SW-Push] Evento push recibido (app puede estar cerrada)');
  e.waitUntil(handlePushEvent(e).catch(err => {
    console.error('[SW-Push] Error fatal:', err.message);
  }));
});

// ── Re-suscripción automática (v26) ────────────────────────────────────────
// Chrome/Firefox/Safari pueden invalidar la suscripción (rotación de claves,
// limpieza de datos, expiración del servicio push). Sin este handler la
// suscripción vieja queda en Firestore, el servidor recibe 404/410 y la
// elimina; el dispositivo queda sin notificaciones hasta abrir la app.
function urlB64ToU8(b64) {
  const pad  = '='.repeat((4 - b64.length % 4) % 4);
  const base = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base), c => c.charCodeAt(0));
}
async function sha1Endpoint(ep) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(ep));
  return 'wp_' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function guardarSuscripcion(sub) {
  const j = sub.toJSON();
  if (!j.endpoint || !j.keys || !j.keys.p256dh || !j.keys.auth) return false;
  const id  = await sha1Endpoint(j.endpoint);
  const url = 'https://firestore.googleapis.com/v1/projects/' + FS_PROJECT +
              '/databases/(default)/documents/webpush_subscriptions/' + id + '?key=' + FS_API_KEY;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: {
      endpoint:  { stringValue: j.endpoint },
      p256dh:    { stringValue: j.keys.p256dh },
      auth:      { stringValue: j.keys.auth },
      platform:  { stringValue: 'webpush' },
      updatedAt: { stringValue: new Date().toISOString() },
    } }),
  });
  return r.ok;
}
async function resuscribir(e) {
  try {
    const sub = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToU8(VAPID_PUBLIC_KEY),
    });
    const ok = await guardarSuscripcion(sub);
    console.log('[SW] pushsubscriptionchange: re-suscripción', ok ? 'guardada' : 'NO guardada');
    // Borrar la anterior (best-effort)
    const old = e.oldSubscription;
    if (old && old.endpoint && old.endpoint !== sub.endpoint) {
      const oldId = await sha1Endpoint(old.endpoint);
      await fetch('https://firestore.googleapis.com/v1/projects/' + FS_PROJECT +
        '/databases/(default)/documents/webpush_subscriptions/' + oldId + '?key=' + FS_API_KEY,
        { method: 'DELETE' }).catch(() => {});
    }
  } catch (err) {
    console.warn('[SW] pushsubscriptionchange falló:', err.message);
  }
}
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil(resuscribir(e));
});

// ── Canal local: respaldo cuando la app está abierta ─────────────────────────
// Se activa al recibir SCHEDULE_EVENTS desde la app.
// Usa el mismo algoritmo de tag que el workflow para deduplicar contra fired{}.
async function checkAndNotify() {
  try {
    const events = await dbGet('events');
    if (!Array.isArray(events) || events.length === 0) return;

    const now   = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const fired = (await dbGet('fired')) || {};
    let changed = false;

    // Limpiar marcas de años anteriores
    const yr = '@' + now.getFullYear();
    for (const k of Object.keys(fired)) {
      if (!k.endsWith(yr)) { delete fired[k]; changed = true; }
    }

    for (const ev of events) {
      if (!ev.fecha || !ev.nombre || !ev.tipo) continue;

      // Normalizar fecha a formato MM-DD
      const parts = String(ev.fecha).split('-');
      let mes, dia;
      if (parts.length === 2)      [mes, dia] = parts;
      else if (parts.length === 3) [, mes, dia] = parts;
      else continue;
      if (!mes || !dia) continue;

      const evDay = new Date(now.getFullYear(), Number(mes) - 1, Number(dia));
      if (evDay.getTime() !== today.getTime()) continue;

      // Generar el mismo tag que el workflow para poder cruzar con fired{}
      const fechaMD = mes.padStart(2, '0') + '-' + dia.padStart(2, '0');
      const tag     = generarTag(ev.nombre, fechaMD);

      // Si el push externo ya disparó esta notificación hoy, no duplicar
      if (fired[firedKey(tag)]) continue;

      try {
        await self.registration.showNotification('Oriente Fraterno 148', {
          body:               `Hoy: ${ev.tipo} de ${ev.nombre}`,
          icon:               ICON_192,
          badge:              BADGE_URL,
          tag:                tag,
          renotify:           true,
          requireInteraction: true,
          vibrate:            [200, 100, 200, 100, 200],
          data:               { url: APP_URL },
        });
        fired[firedKey(tag)] = true;
        changed    = true;
      } catch (notifErr) {
        console.warn('[SW] showNotification falló:', notifErr.message);
      }
    }
    if (changed) await dbSet('fired', fired);
  } catch (err) {
    console.warn('[SW] checkAndNotify error:', err);
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
    // Red primero (la app se actualiza sola); caché solo si no hay conexión.
    e.respondWith(
      fetch(e.request).then(response => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, copy));
        }
        return response;
      }).catch(() =>
        caches.match(e.request).then(cached =>
          cached || caches.match(APP_ROOT + 'index.html')
            .then(fb => fb || new Response('Sin conexión', { status: 503 })))
      )
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
