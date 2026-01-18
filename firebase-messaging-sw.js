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

// --- Offline & Sticky Counter State (Persisted) ---
let prayerTimes = null;
let strugglePrayer = "";
let userLogs = {}; // NEW: Store logs to skip already prayed salahs
let counterInterval = null;

// Helper to persist state so it survives SW suspension
async function saveSyncedData(prayers, struggle, logs) {
  try {
    const cache = await caches.open('salah-internal-state');
    const data = { prayers, struggle, logs, timestamp: Date.now() };
    await cache.put('/sw-state', new Response(JSON.stringify(data)));
    console.log('[FCM SW] State persisted to cache.');
  } catch (e) {
    console.error('[FCM SW] Failed to persist state:', e);
  }
}

async function loadSyncedData() {
  try {
    const cache = await caches.open('salah-internal-state');
    const response = await cache.match('/sw-state');
    if (response) {
      const data = await response.json();
      prayerTimes = data.prayers;
      strugglePrayer = data.struggle;
      userLogs = data.logs || {};
      console.log('[FCM SW] State restored from cache.');
      return true;
    }
  } catch (e) {
    console.error('[FCM SW] Failed to restore state:', e);
  }
  return false;
}

// Listen for updates from app.js / app2.js
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SYNC_DATA') {
    prayerTimes = event.data.prayers;
    strugglePrayer = event.data.struggle;
    userLogs = event.data.logs || {};
    console.log('[FCM SW] Prayer times and logs synced.');
    saveSyncedData(prayerTimes, strugglePrayer, userLogs);
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
  // UPGRADED: Skip prayers already marked as 'prayed'
  const todayStr = now.toDateString();
  const todayLogs = userLogs[todayStr] || {};

  let nextIndex = sortedPrayers.findIndex(p => {
    const isPrayed = todayLogs[p.name] === 'prayed';
    return p.date >= now && !isPrayed;
  });
  let next = sortedPrayers[nextIndex];

  // CRITICAL FIX: Extended window to 20 mins for better reliability (was 15)
  const NOTIFICATION_WINDOW_MINS = 20;

  // Robustness: Check if we JUST passed a prayer (within last 20 mins)
  if (nextIndex > 0) {
    const prevPrayer = sortedPrayers[nextIndex - 1];
    const diffPrev = (now - prevPrayer.date) / 1000 / 60; // Minutes since prev prayer

    const prevKey = `${prevPrayer.name}_${now.toDateString()}`;
    if (diffPrev >= 0 && diffPrev <= NOTIFICATION_WINDOW_MINS && self.lastAdhanNotified !== prevKey) {
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
    if (diffLast >= 0 && diffLast <= NOTIFICATION_WINDOW_MINS && self.lastAdhanNotified !== lastKey) {
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

  // Sticky Notification Update (PREMIUM UPGRADE)
  const isStruggle = next.name === strugglePrayer;
  const title = isStruggle ? `⚠️ ${next.name} (Priority)` : `${next.name} Salah`;
  const bodyText = `${timeLabel} • ${countdownLabel}`;

  try {
    if (self.registration && self.registration.active) {
      const baseUrl = self.registration.scope;
      await self.registration.showNotification(title, {
        body: bodyText,
        icon: baseUrl + "notif-premium-icon.png", // Use premium icon for native feel
        badge: baseUrl + "icon-192.png",
        tag: 'prayer-counter',
        renotify: false,
        silent: true,
        ongoing: true,
        actions: [
          { action: 'open_app', title: 'Open App' },
          { action: 'mark_prayed_notif', title: 'Mark as Prayed' }
        ],
        data: { url: baseUrl }
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
    // FIX: Construction of absolute URL for sound and links to avoid 404s
    const baseUrl = self.registration.scope;

    self.registration.showNotification(title, {
      body: body,
      icon: baseUrl + "notif-premium-icon.png",
      badge: baseUrl + "icon-192.png",
      vibrate: [500, 110, 500, 110, 450, 110, 200, 110, 170, 40, 450, 110, 200, 110, 170, 40, 500],
      tag: 'prayer-alert',
      sound: baseUrl + 'tones/azan_tone.mp3',
      data: { url: baseUrl },
      requireInteraction: true,
      silent: false,
      renotify: true
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

      // State restoration (ensure we have prayer times)
      const performSync = async () => {
        if (!prayerTimes) {
          await loadSyncedData();
        }
        await updateStickyNotification();
      };

      // Note: messaging.onBackgroundMessage doesn't provide an event object, 
      // but the SW lifetime is managed by the browser during this callback.
      performSync();
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
  const action = event.action;
  const notification = event.notification;
  notification.close();

  const baseUrl = self.registration.scope;
  const urlToOpen = (notification.data && notification.data.url) ? notification.data.url : baseUrl;

  if (action === 'mark_prayed_notif') {
    // Logic to handle "Mark as Prayed" from notification
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
        for (var i = 0; i < windowClients.length; i++) {
          var client = windowClients[i];
          if (client.url.startsWith(baseUrl) && 'focus' in client) {
            client.postMessage({ type: 'MARK_CURRENT_PRAYER', prayer: notification.title });
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(urlToOpen + '#mark_current');
        }
      })
    );
  } else {
    // Default click or "Open App" action
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
        for (var i = 0; i < windowClients.length; i++) {
          var client = windowClients[i];
          if (client.url.startsWith(baseUrl) && 'focus' in client) return client.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow(urlToOpen);
      })
    );
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-prayers') {
    console.log('[FCM SW] Performing background sync...');
  }
});

// UPGRADED: Handle Periodic Background Sync (Reliable even when app is closed)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'prayer-sync') {
    event.waitUntil((async () => {
      console.log('[FCM SW] Periodic sync triggered.');
      if (!prayerTimes) await loadSyncedData();
      await updateStickyNotification();
    })());
  }
});

// --- Caching Logic ---
const CACHE_NAME = 'salah-tracker-v4.9';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './app2.js',
  './firebase.js',
  './translations.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './notif-premium-icon.png',
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

  // UPGRADED: Stale-while-revalidate strategy for automatic updates
  e.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      return cache.match(e.request).then(cachedResponse => {

        // Always fetch from network to update cache in background
        const fetchPromise = fetch(e.request).then(networkResponse => {
          // Only cache valid responses from our own origin
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            cache.put(e.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(err => {
          console.warn("[SW] Network failed for:", url);
          // Return cached response if network fails
          return cachedResponse || new Response('Offline. Check connection.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' }
          });
        });

        // CRITICAL: Return cached response immediately (if exists),
        // update cache in background so users get updates next time
        return cachedResponse || fetchPromise;
      });
    })
  );
});
