// ==========================================
// SERVICE WORKER - ORIENTE FRATERNO 148
// ==========================================

const CACHE_NAME = 'oriente-fraterno-cache-v2';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// ── Instalación ───────────────────────────────────────────────────────────────
self.addEventListener('install', function(event) {
  // Fuerza al nuevo SW a activarse de inmediato sin esperar que cierren las tabs
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(urlsToCache);
    })
  );
});

// ── Activación ────────────────────────────────────────────────────────────────
self.addEventListener('activate', function(event) {
  // Toma control de todas las tabs abiertas de inmediato
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(function(cacheNames) {
        return Promise.all(
          cacheNames.map(function(cacheName) {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          })
        );
      })
    ])
  );
});

// ── Cache: Cache First / Network Fallback ─────────────────────────────────────
self.addEventListener('fetch', function(event) {
  // Solo cachear peticiones GET al mismo origen
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(function(response) {
      return response || fetch(event.request);
    })
  );
});

// ── Almacenamiento de eventos en IndexedDB del SW ─────────────────────────────
const DB_NAME = 'of148_sw_db';
const DB_STORE = 'eventos';

function openDB() {
  return new Promise(function(resolve, reject) {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = function(e) {
      e.target.result.createObjectStore(DB_STORE, { keyPath: 'id' });
    };
    req.onsuccess = function(e) { resolve(e.target.result); };
    req.onerror   = function(e) { reject(e.target.error); };
  });
}

function saveEventsToDB(events) {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx    = db.transaction(DB_STORE, 'readwrite');
      const store = tx.objectStore(DB_STORE);
      store.clear();
      events.forEach(function(ev) { store.put(ev); });
      tx.oncomplete = resolve;
      tx.onerror    = reject;
    });
  });
}

function getEventsFromDB() {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx    = db.transaction(DB_STORE, 'readonly');
      const req   = tx.objectStore(DB_STORE).getAll();
      req.onsuccess = function(e) { resolve(e.target.result || []); };
      req.onerror   = function(e) { reject(e.target.error); };
    });
  });
}

// ── Mensajes desde la app ─────────────────────────────────────────────────────
self.addEventListener('message', function(event) {
  if (!event.data) return;

  // La app envía los eventos para que el SW los guarde y use en background
  if (event.data.type === 'SCHEDULE_EVENTS') {
    const events = event.data.events || [];
    saveEventsToDB(events).then(function() {
      console.log('[SW] Eventos guardados para notificaciones en background:', events.length);
    }).catch(function(e) {
      console.warn('[SW] Error guardando eventos:', e);
    });
  }

  // Permite que un SW en espera tome el control inmediato
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Lógica: ¿Hay eventos hoy o mañana? ───────────────────────────────────────
function getTodayEvents(events) {
  const now   = new Date();
  const month = now.getMonth() + 1; // 1-12
  const day   = now.getDate();

  const todayEvs    = [];
  const tomorrowEvs = [];

  const tomorrow   = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tMonth = tomorrow.getMonth() + 1;
  const tDay   = tomorrow.getDate();

  events.forEach(function(ev) {
    if (!ev.fecha) return;
    const parts = String(ev.fecha).split('-');
    let m, d;
    if (parts.length === 2) { m = +parts[0]; d = +parts[1]; }
    else if (parts.length === 3) { m = +parts[1]; d = +parts[2]; }
    else return;
    if (m === month && d === day)     todayEvs.push(ev);
    if (m === tMonth && d === tDay)   tomorrowEvs.push(ev);
  });

  return { todayEvs, tomorrowEvs };
}

function emojiForTipo(tipo) {
  const map = {
    'Cumpleaños':               '🎂',
    'Fecha de casamiento':      '💍',
    'Aniversario':              '🌹',
    'Pasaje al Oriente Eterno': '✦',
  };
  return map[tipo] || '📅';
}

function showEventNotifications(events) {
  const { todayEvs, tomorrowEvs } = getTodayEvents(events);
  const promises = [];

  todayEvs.forEach(function(ev) {
    const emoji = emojiForTipo(ev.tipo);
    promises.push(
      self.registration.showNotification('Oriente Fraterno · 148', {
        body:    emoji + ' Hoy: ' + ev.tipo + ' de ' + ev.nombre,
        icon:    '/icon-192.png',
        badge:   '/icon-192.png',
        vibrate: [200, 100, 200],
        tag:     'evento-hoy-' + ev.id,
        renotify: false,
        data:    { url: '/', eventId: ev.id },
      })
    );
  });

  tomorrowEvs.forEach(function(ev) {
    const emoji = emojiForTipo(ev.tipo);
    promises.push(
      self.registration.showNotification('Oriente Fraterno · 148', {
        body:    emoji + ' Mañana: ' + ev.tipo + ' de ' + ev.nombre,
        icon:    '/icon-192.png',
        badge:   '/icon-192.png',
        vibrate: [100, 50, 100],
        tag:     'evento-manana-' + ev.id,
        renotify: false,
        data:    { url: '/', eventId: ev.id },
      })
    );
  });

  return Promise.all(promises);
}

// ── Periodic Background Sync (Android Chrome 80+) ─────────────────────────────
// Permite que el SW se despierte periódicamente aunque la app esté cerrada
self.addEventListener('periodicsync', function(event) {
  if (event.tag === 'check-events') {
    event.waitUntil(
      getEventsFromDB().then(function(events) {
        return showEventNotifications(events);
      }).catch(function(e) {
        console.warn('[SW] Error en periodicsync:', e);
      })
    );
  }
});

// ── Push (enviado desde servidor / Firebase Cloud Messaging) ──────────────────
self.addEventListener('push', function(event) {
  let data = { title: 'Oriente Fraterno · 148', body: 'Tienes un evento hoy.' };

  if (event.data) {
    try { data = event.data.json(); }
    catch(e) { data = { title: 'Oriente Fraterno · 148', body: event.data.text() }; }
  }

  // Si el push no trae datos, revisar eventos guardados
  const notifPromise = (data.checkEvents)
    ? getEventsFromDB().then(showEventNotifications)
    : self.registration.showNotification(data.title || 'Oriente Fraterno · 148', {
        body:    data.body,
        icon:    '/icon-192.png',
        badge:   '/icon-192.png',
        vibrate: [200, 100, 200],
        data:    { url: data.url || '/' },
        tag:     data.tag || 'push-notif',
      });

  event.waitUntil(notifPromise);
});

// ── Clic en notificación ──────────────────────────────────────────────────────
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      // Si la app ya está en segundo plano, la trae al frente
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if ('focus' in client) {
          return client.focus();
        }
      }
      // Si estaba completamente cerrada, la abre
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
