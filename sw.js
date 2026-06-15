// Oriente Fraterno 148 — Service Worker v20.0
// CORRECCIONES v20.0 sobre v19.0:
//  1. [BUG-A] El listener 'push' nativo ahora identifica mensajes FCM
//     por el campo 'from' del payload (= Firebase messagingSenderId)
//     en lugar del mecanismo débil last_fcm_tag con race condition.
//     Resultado: deduplicación fiable y sin condiciones de carrera.
//  2. [BUG-B] Eliminado el almacenamiento de last_fcm_tag en IndexedDB
//     (ya no es necesario, el mecanismo 'from' es síncrono y determinista).
//  3. Comentarios técnicos actualizados para reflejar el comportamiento real
//     de Firebase SDK compat v10 (stopImmediatePropagation en mensajes FCM).

importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

const SW_VERSION        = 'of-sw-v20.0';
const DB_NAME           = 'of_sw';
const APP_ROOT          = 'https://caristim.github.io/oriente-fraterno/';
const APP_URL           = 'https://caristim.github.io/oriente-fraterno/';
const ICON_192          = 'https://caristim.github.io/oriente-fraterno/icon-192.png';
const BADGE_URL         = 'https://caristim.github.io/oriente-fraterno/icon-192.png';
const FCM_SENDER_ID     = '101867774014'; // messagingSenderId del proyecto Firebase

const CACHE_NAME    = 'of-cache-v20.0';
const PRECACHE_URLS = [
  APP_ROOT,
  APP_ROOT + 'index.html',
  APP_ROOT + 'manifest.json',
  APP_ROOT + 'icon-192.png',
  APP_ROOT + 'icon-512.png',
];

// ── Inicialización Firebase ───────────────────────────────────────────────────
// Defensiva: falla silenciosamente en Firefox/Safari (sin soporte FCM).
// En esos navegadores, fcmMessaging queda null y el listener push nativo
// se encarga de todo.
let fcmMessaging   = null;
let fcmInitialized = false;

function tryInitFirebase() {
  if (fcmInitialized) return;
  fcmInitialized = true;
  try {
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
    console.log('[SW] Firebase + FCM inicializados correctamente.');
  } catch (err) {
    // Normal en Firefox y Safari. El canal Web Push nativo funcionará.
    console.warn('[SW] Firebase no disponible (normal en Firefox/Safari):', err.message);
    fcmMessaging = null;
  }
}

tryInitFirebase();

// ── CANAL 1: FCM BACKGROUND (Chrome/Edge/Android con app CERRADA) ─────────────
//
// Firebase Messaging SDK compat v10:
// - Instala su propio listener 'push' al cargarse via importScripts.
// - Para mensajes FCM, llama stopImmediatePropagation() en el evento push,
//   lo que IMPIDE que el listener nativo del usuario (más abajo) se ejecute.
// - Llama onBackgroundMessage() con el payload decodificado.
// - Firebase SDK envuelve el callback en event.waitUntil() internamente,
//   garantizando que el SW no se termina antes de que showNotification complete.
//
// PAYLOAD: se usa data-only (sin campo "notification:{}").
// Motivo: con "notification:{}" el sistema operativo muestra la notificación
// automáticamente Y silencia onBackgroundMessage en muchos Android,
// impidiendo personalización. Con data-only el SW siempre controla todo.
//
if (fcmMessaging) {
  fcmMessaging.onBackgroundMessage(async payload => {
    console.log('[SW-FCM] onBackgroundMessage recibido:', JSON.stringify(payload));

    const data   = payload.data || {};
    const titulo = data.title || 'Oriente Fraterno 148';
    const cuerpo = data.body  || 'Tenés un evento hoy ✦';
    const url    = data.url   || APP_URL;
    const evTag  = data.tag   || ('of-fcm-' + Date.now());

    await self.registration.showNotification(titulo, {
      body:               cuerpo,
      icon:               ICON_192,
      badge:              BADGE_URL,
      tag:                evTag,
      requireInteraction: true,
      vibrate:            [200, 100, 200, 100, 200],
      data:               { url },
    });

    await markFiredToday();
  });
}

// ── CANAL 2: WEB PUSH NATIVO (iOS Safari PWA, Firefox, Edge) ─────────────────
//
// Este listener maneja mensajes Web Push VAPID puros, que son los que
// envía el workflow a la colección webpush_subscriptions.
//
// CUÁNDO SE EJECUTA:
//   - iOS Safari PWA: SIEMPRE (Firebase SDK no corre en iOS Safari).
//   - Firefox: SIEMPRE (Firebase SDK falla silenciosamente y fcmMessaging=null,
//     por lo que Firebase no instala su listener y no hay stopImmediatePropagation).
//   - Chrome/Edge: SOLO para mensajes Web Push puros de webpush_subscriptions.
//     Los mensajes FCM son interceptados por Firebase SDK (ver arriba) y
//     este listener nunca se ejecuta para ellos gracias a stopImmediatePropagation.
//
// IDENTIFICACIÓN FCM vs WEB PUSH PURO:
//   Los mensajes FCM en Chrome incluyen el campo 'from' con el sender ID.
//   Si por algún motivo el SDK NO intercepta el evento (p.ej. error de init),
//   este listener detecta el campo 'from' y lo ignora para evitar duplicados.
//   Esto elimina completamente la race condition del mecanismo last_fcm_tag.
//
self.addEventListener('push', e => {
  console.log('[SW-Push] Evento push nativo recibido');

  let titulo = 'Oriente Fraterno 148';
  let cuerpo = 'Tenés un evento hoy ✦';
  let url    = APP_URL;
  let evTag  = 'of-wp-' + Date.now();
  let isFCM  = false;

  if (e.data) {
    try {
      const data = e.data.json();

      // Detectar si el mensaje proviene de FCM por el campo 'from'.
      // FCM v1 API siempre incluye 'from' con el messagingSenderId.
      // Los mensajes Web Push nativos NO tienen este campo.
      if (data.from === FCM_SENDER_ID || data.from === String(FCM_SENDER_ID)) {
        isFCM = true;
        console.log('[SW-Push] Mensaje identificado como FCM por campo from= ' + data.from + '. Ignorando (FCM handler lo procesa).');
      } else {
        titulo = data.title || titulo;
        cuerpo = data.body  || cuerpo;
        url    = data.url   || url;
        evTag  = data.tag   || evTag;
      }
    } catch (_) {
      // No es JSON: puede ser un ping de verificación o payload de texto plano
      const texto = e.data.text();
      if (texto) cuerpo = texto;
    }
  }

  // Si el mensaje viene de FCM, ya fue manejado por onBackgroundMessage.
  // Salimos sin hacer nada para evitar duplicados.
  if (isFCM) return;

  e.waitUntil(
    (async () => {
      try {
        await self.registration.showNotification(titulo, {
          body:               cuerpo,
          icon:               ICON_192,
          badge:              BADGE_URL,
          tag:                evTag,
          requireInteraction: true,
          vibrate:            [200, 100, 200, 100, 200],
          data:               { url },
        });
        await markFiredToday();
      } catch (err) {
        console.error('[SW-Push] Error mostrando notificación:', err.message);
      }
    })()
  );
});

// ── CANAL 3: VERIFICACIÓN LOCAL (respaldo cuando el usuario abre la app) ──────
//
// Se ejecuta cuando la app envía SCHEDULE_EVENTS al SW.
// Útil como respaldo si FCM/WebPush fallan, pero NO funciona con app cerrada.
// No depende de permisos: showNotification() lanza excepción si el permiso
// fue revocado, que el try/catch captura correctamente.
// NOTA: Notification.permission NO existe en el contexto del SW.
//
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
      if (parts.length === 2)      { [month, day] = parts.map(Number); }
      else if (parts.length === 3) { [, month, day] = parts.map(Number); }
      else continue;

      if (!month || !day) continue;

      const evDay   = new Date(now.getFullYear(), month - 1, day);
      const isToday = evDay.getTime() === today.getTime();
      if (!isToday) continue;

      const evId    = ev.docId || ev.id || `${ev.nombre}-${ev.fecha}`;
      const fireKey = `${evId}-${now.getFullYear()}`;
      if (fired[fireKey]) continue;

      try {
        await self.registration.showNotification('Oriente Fraterno 148', {
          body:               `Hoy: ${ev.tipo} de ${ev.nombre}`,
          icon:               ICON_192,
          badge:              BADGE_URL,
          tag:                `of-local-${evId}`,
          requireInteraction: true,
          vibrate:            [200, 100, 200, 100, 200],
          data:               { url: APP_URL },
        });
        fired[fireKey] = true;
        changed = true;
      } catch (notifErr) {
        console.warn('[SW] showNotification falló (permiso revocado?):', notifErr.message);
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
      if (parts.length === 2)      { [month, day] = parts.map(Number); }
      else if (parts.length === 3) { [, month, day] = parts.map(Number); }
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
      .then(cache => cache.addAll(PRECACHE_URLS).catch(err =>
        console.warn('[SW] Pre-cache parcial (sin conexión?):', err.message)
      ))
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
  if (e.data.type === 'CHECK_NOW') {
    await checkAndNotify();
  }
  if (e.data.type === 'PING') {
    if (e.source) e.source.postMessage({ type: 'PONG', version: SW_VERSION });
  }
  if (e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Fetch (cache-first para recursos propios, network-first para externos) ────
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;

  if (url.startsWith(APP_ROOT)) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(response => {
          if (response && response.status === 200) {
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, response.clone()));
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
      caches.match(e.request).then(cached =>
        cached || new Response('Sin conexión', { status: 503 })
      )
    )
  );
});

// ── Clic en notificación ──────────────────────────────────────────────────────
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

// ── Cierre de notificación ────────────────────────────────────────────────────
self.addEventListener('notificationclose', e => {
  console.log('[SW] Notificación cerrada por el usuario:', e.notification.tag);
});
