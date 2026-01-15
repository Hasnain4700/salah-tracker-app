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
  // Increase interval to 5 minutes to save battery, or use shorter if app is active
  counterInterval = setInterval(updateStickyNotification, 300000);
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

  // Find current/next prayer logic
  // "Next" is strictly future. "Current" is what we might have just passed.
  let nextIndex = sortedPrayers.findIndex(p => p.date > now);
  let next = sortedPrayers[nextIndex];

  // Robustness: Check if we JUST passed a prayer (within last 15 mins)
  // If we are at 12:05 and Dhuhr was 12:00, next is Asr. We need to check Dhuhr.
  if (nextIndex > 0) {
    const prevPrayer = sortedPrayers[nextIndex - 1];
    const diffPrev = (now - prevPrayer.date) / 1000 / 60; // Minutes since prev prayer

    const prevKey = `${prevPrayer.name}_${now.toDateString()}`;
    if (diffPrev >= 0 && diffPrev <= 15 && self.lastAdhanNotified !== prevKey) {
      self.lastAdhanNotified = prevKey;
      console.log(`[FCM SW] Triggering Adhan Alert for ${prevPrayer.name} (Caught Late)`);
      triggerAdhanAlert(prevPrayer.name);
    }
  } else if (nextIndex === -1 && sortedPrayers.length > 0) {
    // Logic for Isha/Midnight edge cases if needed, but the main loop above handles most.
    // If nextIndex is -1, it means ALL prayers for today passed.
    const lastPrayer = sortedPrayers[sortedPrayers.length - 1];
    const diffLast = (now - lastPrayer.date) / 1000 / 60;
    const lastKey = `${lastPrayer.name}_${now.toDateString()}`;
    if (diffLast >= 0 && diffLast <= 15 && self.lastAdhanNotified !== lastKey) {
      self.lastAdhanNotified = lastKey;
      triggerAdhanAlert(lastPrayer.name);
    }
  }

  // Handle Maghrib/Isha past midnight or next day Fajr
  if (!next) {
    // Show 'Day Complete' or just wait for next sync
    if (self.registration && self.registration.active) {
      await self.registration.showNotification("Alhamdulillah 🌙", {
        body: "All prayers for today are complete.",
        icon: "./icon-192.png",
        tag: 'prayer-counter',
        renotify: false,
        silent: true,
        ongoing: true
      });
    }
    return;
  }

  const diffMs = next.date - now;
  const totalMins = Math.floor(diffMs / 1000 / 60);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;

  // Format 12h time for body (like WeMuslim)
  const [h24, m24] = next.timeStr.split(':').map(Number);
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 || 12;
  const timeLabel = `${h12}:${m24.toString().padStart(2, '0')} ${period}`;

  // Format Countdown Label
  const countdownLabel = hrs > 0 ? `-${hrs}h ${mins}m` : `-${mins}m`;

  // Sticky Notification Update
  const isStruggle = next.name === strugglePrayer;
  const title = isStruggle ? `⚠️ Next: ${next.name} (Struggle)` : `🕌 Next: ${next.name}`;

  try {
    if (self.registration && self.registration.active) {
      await self.registration.showNotification(title, {
        body: `${timeLabel} • ${countdownLabel}`,
        icon: "./icon-192.png",
        badge: "./icon-192.png",
        tag: 'prayer-counter',
        renotify: false,
        silent: true,
        ongoing: true, // Key for sticky
        placeholder: "Salah Tracker"
      });
    }
  } catch (e) {
    console.warn("[FCM SW] Failed to show sticky notification:", e.message);
  }
}

function triggerAdhanAlert(prayerName) {
  let title = `🕌 Time for ${prayerName}`;
  let body = "Hayya 'ala-s-Salah! Stand up for prayer.";
  if (prayerName === strugglePrayer) {
    title = `⚠️ High Priority: ${prayerName}`;
    body = "Don't delay! Win against your struggle. 💪";
  }
  if (self.registration && self.registration.active) {
    self.registration.showNotification(title, {
      body: body,
      icon: "./icon-192.png",
      badge: "./icon-192.png",
      vibrate: [500, 110, 500, 110, 450, 110, 200, 110, 170, 40, 450, 110, 200, 110, 170, 40, 500],
      tag: 'prayer-alert',
      sound: './tones/azan_tone.mp3', // Note: Browser support for custom sounds in webpush is limited
      data: { url: self.location.origin + '/' },
      requireInteraction: true,
      silent: false
    });
  }
}

// --- Event Handlers ---
if (messaging) {
  messaging.onBackgroundMessage(function (payload) {
    console.log('[FCM SW] Received background message: ', payload);

    // Check if it's a Heartbeat Sync signal from our Cron job
    if (payload.data && payload.data.type === 'HEARTBEAT_SYNC') {
      console.log('[FCM SW] Heartbeat received. Refreshing local notification triggers...');
      updateStickyNotification();
      return;
    }

    // Stop! If the payload has a 'notification' property, the BROWSER ALREADY SHOWS IT automatically in the background.
    // If we call showNotification here, we get a DUPLICATE.
    if (payload.notification) {
      console.log('[FCM SW] Standard notification received (Browser handles this).');
      return;
    }
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = self.location.origin + '/';
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
const CACHE_NAME = 'salah-tracker-v4.7';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './firebase.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './twa-manifest.json',
  './tones/azan_tone.mp3',
  './tones/reminder_tone.mp3'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[FCM SW] Caching essential assets...");
      // Cache assets individually so one failure does not break the entire process
      return Promise.all(
        ASSETS.map(url =>
          cache.add(url).catch(err => console.warn(`[FCM SW] Failed to cache asset: ${url}`, err))
        )
      );
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
      }).catch((err) => {
        // Return original error instead of undefined to satisfy respondWith
        console.warn("[FCM SW] Fetch failed:", url, err);
        return fetch(e.request);
      });
    })
  );
});
