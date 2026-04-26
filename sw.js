// Service Worker para Oriente Fraterno
const CACHE_NAME = 'of-cache-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Escuchar mensajes de la App para actualizar eventos
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SET_EVENTS') {
    // Guardamos los eventos en IndexedDB para acceso offline del SW
    const request = indexedDB.open('OF_DB', 1);
    request.onupgradeneeded = (e) => e.target.result.createObjectStore('store');
    request.onsuccess = (e) => {
      const db = e.target.result;
      db.transaction('store', 'readwrite').objectStore('store').put(event.data.events, 'events_list');
    };
  }
});

// Tarea de verificación de notificaciones
async function checkNotifications() {
  const request = indexedDB.open('OF_DB', 1);
  request.onsuccess = async (e) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains('store')) return;
    
    const getEvents = db.transaction('store', 'readonly').objectStore('store').get('events_list');
    getEvents.onsuccess = () => {
      const events = getEvents.result || [];
      const today = new Date();
      const todayStr = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      
      events.forEach(ev => {
        if (ev.fecha === todayStr) {
          self.registration.showNotification('Oriente Fraterno ✦', {
            body: `Hoy: ${ev.tipo} de ${ev.nombre}`,
            icon: './icon-192.png',
            badge: './icon-192.png',
            tag: `notif-${ev.id}-${todayStr}` // Evita repeticiones el mismo día
          });
        }
      });
    };
  };
}

// Intentar verificar al abrir o sincronizar
self.addEventListener('fetch', (event) => {
  event.waitUntil(checkNotifications());
});
