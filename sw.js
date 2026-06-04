// Oriente Fraterno 148 - Service Worker v11
// Maneja notificaciones FCM en background. Optimizado para Android + iOS 16.4+

importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

const SW_VERSION = 'of-sw-v11';

firebase.initializeApp({
  apiKey: 'AIzaSyD9gQW61AvKHhNai6gljNFE7q9rS7KKuN8',
  authDomain: 'orientefraterno148-2a0c1.firebaseapp.com',
  projectId: 'orientefraterno148-2a0c1',
  storageBucket: 'orientefraterno148-2a0c1.firebasestorage.app',
  messagingSenderId: '101867774014',
  appId: '1:101867774014:web:0b4bb797293910c419716f',
});

const messaging = firebase.messaging();

// Handler principal: funciona con app cerrada en Android y iOS PWA instalada
self.addEventListener('push', e => {
  if (!e.data) return;

  let titulo = 'Oriente Fraterno 148';
  let cuerpo = 'Hoy hay un evento';
  let url = 'https://caristim.github.io/oriente-fraterno/';

  try {
    const payload = e.data.json();
    // Priorizar data-only payload de GitHub Actions
    if (payload.data) {
      titulo = payload.data.title || titulo;
      cuerpo = payload.data.body || cuerpo;
      url = payload.data.url || url;
    }
    // Fallback para payload notification
    if (payload.notification) {
      titulo = payload.notification.title || titulo;
      cuerpo = payload.notification.body || cuerpo;
    }
  } catch (_) {
    try { cuerpo = e.data.text() || cuerpo; } catch (__) {}
  }

  console.log('[SW-push] Notificación:', titulo, cuerpo);

  const options = {
    body: cuerpo,
    icon: './icon-192.png',
    badge: './icon-192.png',
    requireInteraction: true, // En Android mantiene la noti hasta que el user la toque
    vibrate: [200, 100, 200, 100, 200],
    tag: 'of-evento-diario', // Agrupa notis del mismo día
    renotify: true, // Si llega otra, suena de nuevo
    data: { url: url },
    actions: [{ action: 'open', title: 'Ver evento' }]
  };

  e.waitUntil(self.registration.showNotification(titulo, options));
});

// Click en notificación abre la app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || 'https://caristim.github.io/oriente-fraterno/';
  e.waitUntil(clients.openWindow(url));
});

// Cache básico para que la PWA funcione offline
self.addEventListener('install', e => {
  console.log('[SW] Instalado', SW_VERSION);
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  console.log('[SW] Activado', SW_VERSION);
  e.waitUntil(self.clients.claim());
});
