// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

// --- Initialize Firebase ---
let messaging = null;
if (typeof firebase !== 'undefined') {
  firebase.initializeApp({
    apiKey: "AIzaSyDbVJk5nIK3Ltth3ibdERPmMzT8BXmeiUk",
    authDomain: "salah-tracker2.firebaseapp.com",
    projectId: "salah-tracker2",
    messagingSenderId: "1051833345706",
    appId: "1:1051833345706:web:40977957e6bf792b1552d3"
  });
  messaging = firebase.messaging();
}

// --- Offline & Sticky Counter State ---
let prayerTimes = null;
let strugglePrayer = "";
let counterInterval = null;

// Listen for updates from app.js / app2.js
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SYNC_DATA') {
    prayerTimes = event.data.prayers;
    strugglePrayer = event.data.struggle;
    console.log('[FCM SW] Prayer times synced for offline alerts.');
    startCounterLoop();
  }
});

function startCounterLoop() {
  if (counterInterval) clearInterval(counterInterval);
  counterInterval = setInterval(updateStickyNotification, 60000);
  updateStickyNotification();
}

async function updateStickyNotification() {
  if (!prayerTimes) return;
  const now = new Date();
  const sortedPrayers = Object.entries(prayerTimes)
    .map(([name, time]) => {
      const [hrs, mins] = time.split(':').map(Number);
      const pDate = new Date();
      pDate.setHours(hrs, mins, 0, 0);
      return { name, date: pDate, timeStr: time };
    })
    .sort((a, b) => a.date - b.date);

  let next = sortedPrayers.find(p => p.date > now);
  if (!next) {
    return self.registration.showNotification("Day Complete! 🌙", {
      body: "All prayers for today are done. Alhamdulillah.",
      icon: "./icon-192.png",
      tag: 'prayer-counter',
      renotify: false,
      silent: true,
      ongoing: true
    });
  }

  const diffMs = next.date - now;
  const minsLeft = Math.floor(diffMs / 1000 / 60);

  if (minsLeft === 0) triggerAdhanAlert(next.name);

  self.registration.showNotification(`${next.name} in ${minsLeft} mins`, {
    body: `Next: ${next.name} at ${next.timeStr}`,
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    tag: 'prayer-counter',
    renotify: false,
    silent: true,
    ongoing: true
  });
}

function triggerAdhanAlert(prayerName) {
  let title = `🕌 Time for ${prayerName}`;
  let body = "Hayya 'ala-s-Salah! Stand up for prayer.";
  if (prayerName === strugglePrayer) {
    title = `⚠️ High Priority: ${prayerName}`;
    body = "Don't delay! Win against your struggle. 💪";
  }
  self.registration.showNotification(title, {
    body: body,
    icon: "./icon-192.png",
    vibrate: [200, 100, 200, 100, 200, 100, 400],
    tag: 'prayer-alert',
    data: { url: 'https://hasnain4700.github.io/salah-tracker-app/' }
  });
}

// --- Event Handlers ---
if (messaging) {
  messaging.onBackgroundMessage(function (payload) {
    console.log('[FCM SW] Received background message ', payload);
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = 'https://hasnain4700.github.io/salah-tracker-app/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
        if (client.url === urlToOpen && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(urlToOpen);
    })
  );
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-prayers') {
    console.log('[FCM SW] Performing background sync...');
  }
});

// --- Caching Logic ---
const CACHE_NAME = 'salah-tracker-v4.1';
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
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[FCM SW] Caching essential assets...");
      return cache.addAll(ASSETS).catch(err => {
        console.warn("[FCM SW] some assets failed to cache, proceeding anyway.", err);
        // We don't throw here to ensure the SW still installs and allows FCM to work
      });
    })
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
