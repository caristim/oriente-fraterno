// Oriente Fraterno 148 - Service Worker v11
// Maneja notificaciones FCM en background + foreground cerrado
// Compatible Android + iOS 16.4+ PWA

importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

const SW_VERSION = 'of-sw-v11';
const CACHE_NAME = 'of-cache-v1';
const DB_NAME = 'of_sw';
const DB_VERSION = 1;

firebase.initializeApp({
  apiKey: 'AIzaSyD9gQW61AvKHhNai6gljNFE7q9rS7KKuN8',
  authDomain: 'orientefraterno148-2a0c1.firebaseapp.com',
  projectId: 'orientefraterno148-2a0c1',
  storageBucket: 'orientefraterno148-2a0c1.firebasestorage.app',
  messagingSenderId: '101867774014',
  appId: '1:101867774014:web:0b4bb797293910c419716f',
});

// Inicializar Messaging. No usamos onBackgroundMessage porque el handler 'push'
// nativo es más confiable y evita duplicados en Android + iOS
const messaging = firebase.messaging();

// ── INSTALACIÓN Y ACTIVACIÓN ────────────────────────────
self.addEventListener('install', event => {
  console.log(`[SW ${SW_VERSION}] Instalando...`);
  self.skipWaiting(); // Tomar control inmediato
});

self.addEventListener('activate', event => {
  console.log(`[SW ${SW_VERSION}] Activado`);
  event.waitUntil(self.clients.claim()); // Controlar todas las pestañas
});

// ── HANDLER PUSH: UNICO PUNTO DE ENTRADA PARA NOTIFICACIONES ───────────────────
// Se ejecuta aunque la app esté completamente cerrada en Android y iOS PWA
self.addEventListener('push', event => {
  if (!event.data) {
    console.log('[SW-push] Push sin data');
    return;
  }

  let titulo = 'Oriente Fraterno 148';
  let cuerpo = 'Hoy hay un evento';
  let url = 'https://caristim.github.io/oriente-fraterno/';

  try {
    const payload = event.data.json();
    
    // Formato 1: data-only message desde GitHub Actions
    if (payload.data) {
      titulo = payload.data.title || titulo;
      cuerpo = payload.data.body || cuerpo;
      url = payload.data.url || url;
    }
    
    // Formato 2: notification payload, fallback
    if (payload.notification) {
      titulo = payload.notification.title || titulo;
      cuerpo = payload.notification.body || cuerpo;
    }
  } catch (e) {
    // Si no es JSON, intentar como texto
    try { 
      cuerpo = event.data.text() || cuerpo; 
    } catch (_) {}
  }

  console.log('[SW-push] Mostrando notificación:', titulo);

  const opciones = {
    body: cuerpo,
    icon: './icon-192.png',
    badge: './icon-192.png',
    image: './icon-512.png', // Imagen grande en Android
    requireInteraction: true, // No se cierra sola en desktop
    vibrate: [200, 100, 200, 100, 200],
    tag: 'of-evento-diario', // Agrupa notificaciones del mismo día
    renotify: true, // Si llega otra con mismo tag, vuelve a vibrar
    timestamp: Date.now(),
    data: { 
      url: url,
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      { action: 'open', title: 'Ver eventos', icon: './icon-192.png' },
      { action: 'close', title: 'Cerrar', icon: './icon-192.png' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(titulo, opciones)
     .then(() => markFcmFiredToday(cuerpo))
     .catch(err => console.error('[SW-push] Error showNotification:', err))
  );
});

// ── CLICK EN NOTIFICACIÓN ────────────────────────────────
// Abre la app o enfoca la pestaña si ya está abierta
self.addEventListener('notificationclick', event => {
  console.log('[SW] Click en notificación:', event.action);
  event.notification.close();

  if (event.action === 'close') return;

  const urlToOpen = event.notification.data?.url || 'https://caristim.github.io/oriente-fraterno/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
     .then(clientList => {
        // Si ya hay una ventana abierta, enfocarla
        for (const client of clientList) {
          if (client.url.includes('oriente-fraterno') && 'focus' in client) {
            return client.focus();
          }
        }
        // Si no hay ventana, abrir nueva
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// ── MARCA EVENTOS COMO NOTIFICADOS PARA EVITAR DUPLICADOS ──────────────────────
async function markFcmFiredToday(cuerpo) {
  try {
    const events = await dbGet('events');
    if (!Array.isArray(events) || events.length === 0) return;
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const fired = (await dbGet('fired')) || {};
    let changed = false;
    
    for (const ev of events) {
      if (!ev.fecha ||!ev.nombre) continue;
      
      const parts = String(ev.fecha).split('-');
      let month, day;
      if (parts.length === 2) [month, day] = parts.map(Number);
      else if (parts.length === 3) [, month, day] = parts.map(Number);
      else continue;
      
      if (!month ||!day) continue;
      
      const evDay = new Date(now.getFullYear(), month - 1, day);
      const isToday = evDay.getTime() === today.getTime();
      
      if (!isToday) continue;
      
      const evId = ev.docId || ev.id || `${ev.nombre}-${ev.fecha}`;
      const fireKey = `${evId}-${now.getFullYear()}`;
      
      if (!fired[fireKey]) {
        fired[fireKey] = true;
        changed = true;
      }
    }
    
    if (changed) await dbSet('fired', fired);
  } catch (err) { 
    console.warn('[SW] markFcmFiredToday error:', err); 
  }
}

// ── INDEXEDDB HELPERS ────────────────────────────────────
function dbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(key) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly');
    const req = tx.objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbSet(key, val) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── CACHE BÁSICO PARA OFFLINE ────────────────────────────
self.addEventListener('fetch', event => {
  // Solo cachear GET y archivos estáticos
  if (event.request.method!== 'GET') return;
  
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(response => {
        // No cachear firebase ni APIs externas
        if (!event.request.url.includes('firebase') && 
           !event.request.url.includes('googleapis')) {
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, response.clone());
            return response;
          });
        }
        return response;
      });
    }).catch(() => {
      // Fallback offline
      if (event.request.destination === 'document') {
        return caches.match('./index.html');
      }
    })
  );
});
