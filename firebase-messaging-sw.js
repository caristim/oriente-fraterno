importScripts("https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyD9gQW61AvKHhNai6gljNFE7q9rS7KKuN8",
  authDomain: "orientefraterno148-2a0c1.firebaseapp.com",
  projectId: "orientefraterno148-2a0c1",
  storageBucket: "orientefraterno148-2a0c1.firebasestorage.app",
  messagingSenderId: "101867774014",
  appId: "1:101867774014:web:0b4bb797293910c419716f"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  self.registration.showNotification(payload.notification.title, {
    body: payload.notification.body,
    icon: "/icon-192.png"
  });
});
