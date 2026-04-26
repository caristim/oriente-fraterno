const DB_KEY = 'of_scheduled';

// Persistencia con IndexedDB
async function getScheduled() {
  return new Promise(res => {
    const req = indexedDB.open('of_sw', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('kv');
    req.onsuccess = e => {
      const db = e.target.result;
      const tx = db.transaction('kv','readonly');
      const r  = tx.objectStore('kv').get(DB_KEY);
      r.onsuccess = () => res(new Set(r.result || []));
      r.onerror   = () => res(new Set());
    };
    req.onerror = () => res(new Set());
  });
}

async function saveScheduled(set) {
  return new Promise(res => {
    const req = indexedDB.open('of_sw', 1);
    req.onsuccess = e => {
      const db = e.target.result;
      const tx = db.transaction('kv','readwrite');
      tx.objectStore('kv').put([...set], DB_KEY);
      tx.oncomplete = res;
    };
    req.onerror = res;
  });
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Recibir eventos desde la App
self.addEventListener('message', async e => {
  if (e.data?.type !== 'SCHEDULE_EVENTS') return;
  const events = e.data.events || [];
  
  const req = indexedDB.open('of_sw', 1);
  req.onsuccess = ev => {
    const db = ev.target.result;
    const tx = db.transaction('kv','readwrite');
    tx.objectStore('kv').put(events, 'events');
  };
});

// Verificación de notificaciones
async function checkAndNotify() {
  const events = await new Promise(res => {
    const req = indexedDB.open('of_sw', 1);
    req.onsuccess = e => {
      const db = e.target.result;
      const tx = db.transaction('kv','readonly');
      const r  = tx.objectStore('kv').get('events');
      r.onsuccess = () => res(r.result || []);
      r.onerror   = () => res([]);
    };
    req.onerror = () => res([]);
  });

  const now = new Date();
  const todayStr = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const fired = await getScheduled();

  for (const ev of events) {
    const key = `of-fired-${ev.id}-${now.getFullYear()}`;
    if (ev.fecha === todayStr && !fired.has(key)) {
      fired.add(key);
      await saveScheduled(fired);
      
      self.registration.showNotification('Oriente Fraterno ✦', {
        body: `Hoy: ${ev.tipo} de ${ev.nombre}`,
        icon: './icon-192.png',
        badge: './icon-192.png',
        tag: 'of-' + ev.id,
        requireInteraction: true,
        vibrate: [200, 100, 200]
      });
    }
  }
}

// Escuchar eventos de sincronización
self.addEventListener('periodicsync', e => {
  if (e.tag === 'of-daily-check') e.waitUntil(checkAndNotify());
});

// Fallback: verificar cuando el usuario abre la web
self.addEventListener('fetch', e => {
  e.waitUntil(checkAndNotify());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('./'));
});
