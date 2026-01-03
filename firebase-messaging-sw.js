// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDbVJk5nIK3Ltth3ibdERPmMzT8BXmeiUk",
  authDomain: "salah-tracker2.firebaseapp.com",
  projectId: "salah-tracker2",
  messagingSenderId: "1051833345706",
  appId: "1:1051833345706:web:40977957e6bf792b1552d3"
});

const messaging = firebase.messaging();

// --- Background Notifications ---
messaging.onBackgroundMessage(function (payload) {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  // Note: We don't call self.registration.showNotification here because 
  // the Firebase SDK automatically handles 'notification' payloads on most browsers.
  // Calling it manually often causes duplicate notifications.
});

// --- Caching Logic (Merged from sw.js) ---
const CACHE_NAME = 'salah-tracker-v3.6';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './firebase.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './favicon.ico',
  './twa-manifest.json'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  // --- STOP extension errors and only handle HTTP(S) ---
  if (!url.startsWith('http')) return;

  // --- Do NOT cache API calls or external Firebase/Prayer APIs ---
  if (
    url.includes('api.aladhan.com') ||
    url.includes('googleapis.com') ||
    url.includes('/api/') ||
    e.request.method !== 'GET'
  ) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(e.request).then((networkResponse) => {
        // Only cache valid responses from our own origin
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, responseToCache);
        });

        return networkResponse;
      }).catch(() => {
        // Fail silently
      });
    })
  );
});
