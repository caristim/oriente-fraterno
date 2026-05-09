importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyD9gQW61AvKHhNai6gljNFE7q9rS7KKuN8',
  authDomain: 'orientefraterno148-2a0c1.firebaseapp.com',
  projectId: 'orientefraterno148-2a0c1',
  storageBucket: 'orientefraterno148-2a0c1.firebasestorage.app',
  messagingSenderId: '101867774014',
  appId: '1:101867774014:web:0b4bb797293910c419716f'
});

const messaging = firebase.messaging();

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

messaging.onBackgroundMessage(payload => {

  const title = payload.notification?.title || 'Oriente Fraterno ✦';

  const options = {
    body: payload.notification?.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    vibrate: [200, 100, 200],
    requireInteraction: true,
    data: payload.data || {}
  };

  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', event => {

  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {

      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow('./');
      }
    })
  );
});
