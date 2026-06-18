// ==========================================
// SERVICE WORKER - ORIENTE FRATERNO
// ==========================================

const CACHE_NAME = 'oriente-fraterno-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Instalación del Service Worker
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('Cache abierto correctamente');
        return cache.addAll(urlsToCache);
      })
  );
});

// Activación del Service Worker y limpieza de cachés antiguos
self.addEventListener('activate', function(event) {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Estrategia de Cache: Cache First / Network Fallback
self.addEventListener('fetch', function(event) {
  event.respondWith(
    caches.match(event.request)
      .then(function(response) {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});

// ==========================================
// GESTIÓN DE NOTIFICACIONES PUSH (CORREGIDO)
// ==========================================

// Escucha de eventos Push cuando la app está abierta o cerrada
self.addEventListener('push', function(event) {
  let data = { title: 'Oriente Fraterno', body: 'Tienes un nuevo evento hoy.' };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'Oriente Fraterno', body: event.data.text() };
    }
  }

  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: '1'
    }
  };

  // Corrección crítica: event.waitUntil obliga a Android e iOS a mantener 
  // vivo el hilo del Service Worker hasta que la notificación se dibuje.
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Gestión del clic en la notificación con la app cerrada
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  // Asegura que el sistema operativo procese la apertura de la ventana antes de apagar el SW
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      // Si la app ya está en segundo plano, la trae al frente
      for (let i = 0; i < clientList.length; i++) {
        let client = clientList[i];
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      // Si estaba completamente cerrada, fuerza su apertura en la pantalla de inicio
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
