/* sw.js */
self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
  let payload = { title: 'Notificación', body: 'Tienes una notificación' };
  try {
    if (event.data) payload = event.data.json();
  } catch (e) {}
  const options = {
    body: payload.body,
    icon: '/oriente-fraterno/assets/icon-192.png',
    badge: '/oriente-fraterno/assets/icon-192.png'
  };
  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      if (clientList.length > 0) return clientList[0].focus();
      return clients.openWindow('/oriente-fraterno/');
    })
  );
});
