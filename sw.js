// Oriente Fraterno 148 - Service Worker v10

  try {
    payload = event.data.json();
  } catch (e) {
    payload = {
      notification: {
        title: 'Oriente Fraterno 148',
        body: event.data.text()
      }
    };
  }

  event.waitUntil(mostrarNotificacion(payload));
});

messaging.onBackgroundMessage((payload) => {
  console.log('[FCM] background message', payload);
  return mostrarNotificacion(payload);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = 'https://caristim.github.io/oriente-fraterno/';

  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes('oriente-fraterno')) {
          return client.focus();
        }
      }

      return clients.openWindow(targetUrl);
    })
  );
});
