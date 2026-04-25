let events = [];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Recibir eventos desde la app
self.addEventListener('message', (event) => {
  if (event.data.type === 'SYNC_EVENTS') {
    events = event.data.events;
    scheduleNotifications();
  }
});

// Programar notificaciones
function scheduleNotifications() {
  events.forEach(ev => {
    const now = Date.now();
    const eventTime = new Date(ev.date).getTime();

    if (eventTime > now) {
      const delay = eventTime - now;

      setTimeout(() => {
        self.registration.showNotification(ev.title, {
          body: ev.description || 'Recordatorio',
          icon: '/icon.png',
        });
      }, delay);
    }
  });
}
