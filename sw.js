const DB_KEY = 'of_scheduled';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Función para verificar eventos y disparar notificación
async function checkAndNotify() {
  const req = indexedDB.open('of_sw', 1);
  req.onupgradeneeded = e => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
  };

  req.onsuccess = async e => {
    const db = e.target.result;
    const tx = db.transaction('kv', 'readonly');
    const store = tx.objectStore('kv');
    
    const eventsReq = store.get('events');
    eventsReq.onsuccess = async () => {
      const events = eventsReq.result || [];
      const now = new Date();
      const todayStr = `${String(now.getMonth() + 1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      
      for (const ev of events) {
        if (ev.fecha === todayStr) {
          self.registration.showNotification('Oriente Fraterno ✦', {
            body: `Hoy: ${ev.tipo} de ${ev.nombre}`,
            icon: 'icon-192.png',
            badge: 'icon-192.png',
            tag: `of-${ev.id}`
          });
        }
      }
    };
  };
}

self.addEventListener('push', e => checkAndNotify());
