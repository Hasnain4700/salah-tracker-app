import { app, analytics, auth, db } from './firebase.js';
import { translations } from './translations.js';
const {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail,
  ref,
  set,
  get,
  onValue,
  update,
  runTransaction,
  push,
  query,
  limitToLast,
  orderByKey,
  goOnline,
  goOffline
} = window.FirebaseExports;

// =============================================================================
// GLOBAL ERROR HANDLER (Critical for 1M+ users)
// =============================================================================
window.onerror = function (msg, url, line, col, error) {
  console.error('[Global Error]', { msg, url, line, col, error });

  // Log to Firebase if user is authenticated (defined later in code)
  if (typeof GlobalAudit !== 'undefined' && GlobalAudit.logError) {
    GlobalAudit.logError('Window Error', {
      message: msg,
      url: url,
      line: line,
      column: col,
      stack: error?.stack
    });
  }

  // Show user-friendly message
  if (typeof showToast !== 'undefined') {
    showToast("An error occurred. Please refresh if issues persist.", "error");
  }

  // Return true to prevent default browser error handling
  return true;
};

// Handle unhandled promise rejections
window.addEventListener('unhandledrejection', function (event) {
  console.error('[Unhandled Promise Rejection]', event.reason);

  if (typeof GlobalAudit !== 'undefined' && GlobalAudit.logError) {
    GlobalAudit.logError('Unhandled Promise', event.reason);
  }

  if (typeof showToast !== 'undefined') {
    showToast("An error occurred. Please try again.", "warning");
  }

  event.preventDefault(); // Prevent default console logging
});

// --- Spark Plan (Free) Connection Management ---
let connectionListenerAttached = false;

function manageConnection() {
  if (document.visibilityState === 'visible') {
    goOnline(db);
    console.log("[Firebase] Connection Online.");
  } else {
    // Only go offline if we are not in the middle of an important social interaction
    // (e.g., if a modal for chat is open, we might want to stay online, but for simplicity:)
    goOffline(db);
    console.log("[Firebase] Connection Offline (Saved a slot).");
  }
}

// Only attach listener once
if (!connectionListenerAttached) {
  document.addEventListener('visibilitychange', manageConnection);
  connectionListenerAttached = true;
}
manageConnection();
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging.js";

// --- Multi-language Support Logic ---
function t(key) {
  const strings = translations[userLanguage] || translations['ur'];
  return strings[key] || key;
}
window.t = t; // Expose globally

function translateApp(lang = 'ur', save = false) {
  if (save) localStorage.setItem('userLanguage', lang);
  userLanguage = lang;
  const strings = translations[lang];
  if (!strings) return;

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const val = strings[key];
    if (val) {
      if (val.includes('<') || key.includes('_text') || key.includes('_html')) {
        el.innerHTML = val;
      } else {
        el.textContent = val;
      }
    }
  });

  // Re-render components that have dynamic text
  if (typeof renderTree === 'function' && document.getElementById('feature-tree').style.display !== 'none') {
    renderTree();
  }
}

// Global variable to keep track
let storedLang = localStorage.getItem('userLanguage');
let userLanguage = storedLang || 'ur';
translateApp(userLanguage, false); // Don't auto-save on load

// =============================================================================
// GLOBAL UI ELEMENTS & SETTINGS
// =============================================================================

const gregorianDateEl = document.getElementById('gregorian-date');
const hijriDateEl = document.getElementById('hijri-date');
const prevDateBtn = document.getElementById('prev-date');
const nextDateBtn = document.getElementById('next-date');
const countdownTimerEl = document.getElementById('countdown-timer');
const nextPrayerNameEl = document.getElementById('next-prayer-name');
const prayerItems = document.querySelectorAll('.prayer-item');
const lastThirdTimeEl = document.getElementById('last-third-time');
const prayerStatusLabel = document.getElementById('prayer-status-label');
const levelNumEl = document.getElementById('level-num');
const xpPointsEl = document.getElementById('xp-points');
const xpProgress = document.getElementById('xp-progress');

// --- Global Settings Variables ---
let userOffsets = { Fajr: 0, Dhuhr: 0, Asr: 0, Maghrib: 0, Isha: 0 };
let userDisplayName = "";
let userStrugglePrayer = "";
let userCalcMethod = 0; // Default to 0 (Auto)
let locationMode = localStorage.getItem('locationMode') || 'auto';
let manualLat = parseFloat(localStorage.getItem('manualLat')) || null;
let manualLng = parseFloat(localStorage.getItem('manualLng')) || null;
let locationName = localStorage.getItem('locationName') || '';

const settingsBtn = document.getElementById('settings-btn');
let currentDate = new Date();

// --- Scalability & Community Utilities ---
const APP_VERSION = "1.3.2";

const GlobalAudit = {
  logError: async (context, error) => {
    console.error(`[Audit Error] ${context}:`, error);
    const user = auth.currentUser;
    if (user) {
      try {
        await update(ref(db, `logs/errors/${user.uid}/${Date.now()}`), {
          context,
          message: error.message || error,
          stack: error.stack || null,
          version: APP_VERSION,
          timestamp: Date.now()
        });
      } catch (e) {
        // Silently fail to avoid infinite loops if DB is down
      }
    }
  },
  logActivity: async (action, details = {}) => {
    console.log(`[Audit Activity] ${action}`, details);
  }
};

// =============================================================================
// OFFLINE SYNC & CACHE MANAGERS
// =============================================================================

const PersistentCache = {
  get: (key) => JSON.parse(localStorage.getItem(`cache_${key}`)) || null,
  set: (key, data) => localStorage.setItem(`cache_${key}`, JSON.stringify(data)),
  update: (key, partialData) => {
    const current = PersistentCache.get(key) || {};
    PersistentCache.set(key, { ...current, ...partialData });
  }
};

const SyncQueue = {
  get: () => JSON.parse(localStorage.getItem('sync_queue')) || [],
  push: (action) => {
    const queue = SyncQueue.get();
    // Add retry count to new items
    queue.push({ ...action, id: Date.now(), timestamp: new Date().toISOString(), retries: 0 });
    localStorage.setItem('sync_queue', JSON.stringify(queue));
  },
  pop: () => {
    const queue = SyncQueue.get();
    const item = queue.shift();
    localStorage.setItem('sync_queue', JSON.stringify(queue));
    return item;
  },
  isEmpty: () => SyncQueue.get().length === 0,

  // CRITICAL FIX: Remove item from queue permanently
  removeItem: (index) => {
    const queue = SyncQueue.get();
    queue.splice(index, 1);
    localStorage.setItem('sync_queue', JSON.stringify(queue));
  },

  process: async () => {
    if (!navigator.onLine || SyncQueue.isEmpty()) return;

    console.log("Processing offline sync queue...");
    let syncedCount = 0;
    const MAX_RETRIES = 3; // CRITICAL FIX: Limit retries per item

    while (!SyncQueue.isEmpty()) {
      const queue = SyncQueue.get();
      if (queue.length === 0) break;
      const item = queue[0]; // Peek

      // CRITICAL FIX: Check retry count
      if (item.retries >= MAX_RETRIES) {
        console.error(`Sync item failed after ${MAX_RETRIES} retries, removing:`, item);
        SyncQueue.pop(); // Remove permanently failed item
        showToast(`Some offline changes couldn't be synced`, 'warning');
        continue;
      }

      try {
        const { type, path, data, method } = item;
        const dbRef = ref(db, path);

        if (type === 'set') await set(dbRef, data);
        else if (type === 'update') await update(dbRef, data);
        else if (type === 'transaction') {
          await runTransaction(dbRef, (current) => {
            if (method === 'increment') return (current || 0) + (data || 1);
            return data;
          });
        }

        SyncQueue.pop(); // Remove successfully processed item
        syncedCount++;
      } catch (err) {
        console.error("Sync failed for item:", item, err);

        // CRITICAL FIX: Increment retry count instead of breaking
        const queue = SyncQueue.get();
        if (queue[0]) {
          queue[0].retries = (queue[0].retries || 0) + 1;
          localStorage.setItem('sync_queue', JSON.stringify(queue));
        }

        // Break to avoid rapid retry loops (will retry on next online event)
        break;
      }
    }

    if (syncedCount > 0) {
      showToast(`Synced ${syncedCount} offline updates!`, 'success');
      if (typeof fetchAndDisplayTracker === 'function') fetchAndDisplayTracker();
    }
  }
};

// =============================================================================
// STORAGE QUOTA MANAGEMENT + GLOBAL CLEANUP
// =============================================================================
const StorageManager = {
  monitor: () => {
    let total = 0;
    for (let key in localStorage) {
      if (localStorage.hasOwnProperty(key)) total += (localStorage[key].length + key.length) * 2;
    }
    const usageMB = (total / 1024 / 1024).toFixed(2);
    if (total > 4 * 1024 * 1024) {
      console.warn(`[Storage] ${usageMB}MB used, cleaning old cache...`);
      const maxAge = 30 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      let cleaned = 0;
      for (let key in localStorage) {
        if (key.startsWith('prayers_') || key.startsWith('cache_')) {
          const dateMatch = key.match(/(\d{4}-\d{2}-\d{2})/);
          if (dateMatch && now - new Date(dateMatch[1]).getTime() > maxAge) {
            localStorage.removeItem(key);
            cleaned++;
          }
        }
      }
      if (cleaned > 0) console.log(`[Storage] Cleaned ${cleaned} items`);
    }
  }
};
StorageManager.monitor();

// Global cleanup on unload
window.addEventListener('beforeunload', () => {
  if (typeof countdownInterval !== 'undefined') clearInterval(countdownInterval);
  if (typeof markPrayerInterval !== 'undefined') clearInterval(markPrayerInterval);
  if (typeof quranXpInterval !== 'undefined') clearInterval(quranXpInterval);
});

// Global Listeners for Online/Offline
window.addEventListener('online', () => {
  showToast("Online: Syncing data...", "info");
  SyncQueue.process();
});
window.addEventListener('offline', () => {
  showToast("Offline: Saving changes locally", "warning");
});

// Sync on start
onAuthStateChanged(auth, user => {
  if (user) {
    SyncQueue.process();
    startGlobalDuroodSync();
  }
});

// --- FCM Backend Call ---
async function sendFCMNotificationv1(token, title, body, sound) {
  try {
    const BACKEND_URL = 'https://salah-tracker-app.vercel.app/api/send-notification';

    const response = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, title, body, sound })
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const errorMsg = data?.error || `Server returned ${response.status}`;
      const hint = data?.hint ? ` [Hint: ${data.hint}]` : "";
      throw new Error(errorMsg + hint);
    }

    if (data && data.success) {
      console.log("FCM Success:", data.messageId);
      return data;
    } else {
      throw new Error(data?.error || "Notification dispatch failed");
    }
  } catch (err) {
    handleApiError("Notification System", err);
    return { success: false, error: err.message };
  }
}


// =============================================================================
// 1. NOTIFICATION & FCM LOGIC
// =============================================================================

async function requestNotificationPermission() {
  console.log("[FCM] Requesting permission... current status:", Notification.permission);

  if (Notification.permission === 'denied') {
    console.warn("[FCM] Notification permission denied by user.");
    return;
  }

  try {
    const messaging = getMessaging(app);
    const vapidKey = 'BBeVQ0f8nC--oymwOnsGfla9p5AB5h37TEPpf1EMY0QTz4pbdPjlmqn-8Rkjw8sAE71ksSnkqcvRpA7M0_64FBE';

    const swUrl = './firebase-messaging-sw.js?v=5.0';
    const registration = await navigator.serviceWorker.register('firebase-messaging-sw.js?v=5.0');
    console.log("[FCM] Service Worker registered (v5.0)");

    // Wait for the service worker to be active
    if (!registration.active) {
      console.log("[FCM] Waiting for Service Worker to activate...");
      await new Promise((resolve) => {
        const sw = registration.installing || registration.waiting;
        if (sw) {
          sw.addEventListener('statechange', (e) => {
            if (e.target.state === 'activated') resolve();
          });
        } else {
          resolve(); // Fallback
        }
      });
      console.log("[FCM] Service Worker is now active.");
    }

    // PERIODIC BACKGROUND SYNC UPGRADE (Reliability for closed app)
    if ('periodicSync' in registration) {
      try {
        const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
        if (status.state === 'granted') {
          await registration.periodicSync.register('prayer-sync', {
            minInterval: 6 * 60 * 60 * 1000 // Every 6 hours
          });
          console.log('[FCM] Periodic Background Sync registered.');
        }
      } catch (e) { console.warn('[FCM] Periodic Sync failed:', e); }
    }

    const currentToken = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });

    if (currentToken) {
      // CRITICAL FIX: Wait for auth state to be ready before proceeding
      const user = auth.currentUser;
      if (!user) {
        console.log("[FCM] User not authenticated yet, waiting for auth state...");
        // Wait for next auth state change
        await new Promise((resolve) => {
          const unsubscribe = onAuthStateChanged(auth, (authUser) => {
            if (authUser) {
              unsubscribe();
              resolve();
            }
          });
        });
      }

      const authenticatedUser = auth.currentUser;
      if (authenticatedUser) {
        await update(ref(db, `users/${authenticatedUser.uid}`), { fcmToken: currentToken });
        console.log("[FCM] Token correctly generated and saved.");

        // --- Hybrid API Routing ---
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const VERCEL_URL = "https://salah-tracker-app.vercel.app";
        const API_BASE_URL = isLocal ? "" : VERCEL_URL;

        // CRITICAL FIX: Add retry logic for subscription API
        let subscriptionSuccess = false;
        let retries = 0;
        const MAX_SUB_RETRIES = 3;

        while (!subscriptionSuccess && retries < MAX_SUB_RETRIES) {
          try {
            const response = await fetch(`${API_BASE_URL}/api/subscribe`, {
              method: 'POST',
              mode: 'cors',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: currentToken, topic: 'all_users' })
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const contentType = response.headers.get("content-type");
            if (contentType && contentType.indexOf("application/json") !== -1) {
              const data = await response.json();
              console.log("[FCM] Topic Subscription:", data.message);
              subscriptionSuccess = true;
            } else {
              throw new Error("API not available on this host (Vercel required)");
            }
          } catch (err) {
            retries++;
            console.warn(`[FCM] Subscription attempt ${retries} failed:`, err.message);

            if (retries >= MAX_SUB_RETRIES) {
              console.error("[FCM] Failed to subscribe after max retries");
              console.log("[FCM] Note: /api/ features only work when deployed on Vercel.");
            } else {
              // Wait before retry (exponential backoff)
              await new Promise(resolve => setTimeout(resolve, 1000 * retries));
            }
          }
        }

        startPrayerNotificationLoop();
      }
    } else {
      console.warn('[FCM] No registration token available. Request permission to generate one.');
    }
  } catch (err) {
    console.error('[FCM] An error occurred while retrieving token: ', err);
    if (err.code === 'messaging/permission-blocked') {
      showToast("Notifications are blocked in your browser settings.", "warning");
    }
  }
}

// --- Receive Message from Service Worker (Premium Notif Actions) ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'MARK_CURRENT_PRAYER') {
      console.log('[App] Received Mark as Prayed from Notification');
      // Wait for app state to be ready
      setTimeout(() => {
        if (typeof currentActivePrayer !== 'undefined' && currentActivePrayer) {
          logPrayerStatus(currentActivePrayer, 'prayed');
        }
      }, 500);
    }
  });
}

// Check for deep link from notification action
window.addEventListener('load', () => {
  if (window.location.hash === '#mark_current') {
    // Wait a bit for auth to settle
    onAuthStateChanged(auth, (user) => {
      if (user) {
        // Wait for prayers to be calculated
        setTimeout(() => {
          if (typeof currentActivePrayer !== 'undefined' && currentActivePrayer) {
            logPrayerStatus(currentActivePrayer, 'prayed');
            window.location.hash = ''; // Clear hash
          }
        }, 1000);
      }
    });
  }
});

// --- Scheduled Prayer Notifications Logic ---
// We keep this modular so it can be moved to Cloud Functions later.
let scheduledTimeouts = [];

function startPrayerNotificationLoop() {
  // Clear any existing timers
  scheduledTimeouts.forEach(t => clearTimeout(t));
  scheduledTimeouts = [];

  // Re-check every hour if we need to schedule new ones
  // But ideally triggered when prayer times are loaded.
}

async function checkAndTriggerPrayerNotifications(prayers) {
  const user = auth.currentUser;
  if (!user) return;

  // CRITICAL FIX: Clear all existing timeouts before creating new ones
  scheduledTimeouts.forEach(t => clearTimeout(t));
  scheduledTimeouts = [];

  const snap = await get(ref(db, `users/${user.uid}/fcmToken`));
  const myToken = snap.val();
  if (!myToken) return;

  const now = new Date();
  const todayStr = getTodayDateString();

  prayers.forEach(p => {
    const [hrs, mins] = p.time.split(':').map(Number);
    const pDate = new Date();
    pDate.setHours(hrs, mins, 0, 0);

    const diff = pDate.getTime() - now.getTime();

    // If prayer is in the future (within today)
    if (diff > 0) {
      console.log(`Scheduling notification for ${p.name} in ${Math.round(diff / 1000 / 60)} mins`);

      // Timer 1: Main Adhan Alert - REMOVED (Handled by SW and Server FCM to avoid duplicates)

      // Timer 2: Check Partner Status (20 mins later)
      const partnerCheckTimer = setTimeout(() => {
        get(ref(db, `users/${user.uid}/twins/pairId`)).then(tSnap => {
          if (tSnap.exists()) {
            const pairId = tSnap.val();
            get(ref(db, `pairs/${pairId}`)).then(pSnap => {
              const pData = pSnap.val();
              const partnerId = (pData.user1 === user.uid) ? pData.user2 : pData.user1;
              if (partnerId) {
                // Check if partner has prayed yet
                get(ref(db, `users/${partnerId}/logs/${todayStr}/${p.name}`)).then(statusSnap => {
                  if (statusSnap.val() !== 'prayed') {
                    sendFCMNotificationv1(
                      myToken,
                      "Partner is Late? 🤔",
                      `Your Deen Twin hasn't marked ${p.name} yet. Why not nudge them?`,
                      'reminder_tone'
                    );
                  }
                });
              }
            });
          }
        });
      }, diff + (20 * 60 * 1000)); // 20 minutes later
      scheduledTimeouts.push(partnerCheckTimer);
    }
  });
}


// =============================================================================
// 2. UI NAVIGATION & INITIALIZATION
// =============================================================================

// --- Navigation Logic ---
const sections = {
  home: document.getElementById('home-section'),
  donate: document.getElementById('donate-section'),
  quran: document.getElementById('quran-section'),
  tracker: document.getElementById('tracker-section'),
  more: document.getElementById('more-section'),
};
const navBtns = document.querySelectorAll('.bottom-nav .nav-btn');

window.showSection = (section) => {
  Object.values(sections).forEach(sec => { if (sec) sec.style.display = 'none'; });
  if (sections[section]) sections[section].style.display = '';
  navBtns.forEach(btn => btn.classList.remove('active'));
  const idx = ["home", "donate", "quran", "tracker", "more"].indexOf(section);
  if (idx !== -1 && navBtns[idx]) navBtns[idx].classList.add('active');
};
navBtns[0].onclick = () => showSection('home');
navBtns[1].onclick = () => showSection('donate');
navBtns[2].onclick = () => showSection('quran');
navBtns[3].onclick = () => showSection('tracker');
navBtns[4].onclick = () => showSection('more');
showSection('home');

// =============================================================================
// 3. PRAYER TIME ENGINE (API & CACHING)
// =============================================================================

// --- Date Handling ---
function updateDates() {
  if (!gregorianDateEl || !hijriDateEl) return;
  // Gregorian
  gregorianDateEl.textContent = currentDate.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'short', day: 'numeric'
  });
  // Hijri Date Calculation
  const hijriFormatter = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  hijriDateEl.textContent = 'Hijri: ' + hijriFormatter.format(currentDate);
}
updateDates();

// --- Prayers List (with Tahajjud) ---
// For API, insert Tahajjud at start with fixed time (e.g., 2:30 AM)
function getPrayersWithTahajjud(apiPrayers) {
  return [
    { name: 'Tahajjud', time: '02:30' },
    ...apiPrayers.filter(p => p.name !== 'Sunrise')
  ];
}

// --- Location and Prayer Times Logic (Refactored for Offline & Accuracy) ---
const prayersWithTahajjudRefNames = ['Tahajjud', 'Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
let prayersWithTahajjud = [];
let apiDate = new Date();

/**
 * Guesses coordinates based on the user's timezone.
 */
function detectRecommendedLocation() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!tz) return { lat: 24.7136, lng: 46.6753 }; // Riyadh

  console.log("[Auto-Loc] Guessing location for timezone:", tz);

  if (tz.includes('Karachi') || tz.includes('Lahore')) {
    locationName = "Pakistan (Auto)";
    localStorage.setItem('locationName', locationName);
    return { lat: 24.8607, lng: 67.0011 }; // Karachi
  }
  if (tz.includes('Dubai') || tz.includes('Abu_Dhabi')) {
    locationName = "UAE (Auto)";
    localStorage.setItem('locationName', locationName);
    return { lat: 25.2048, lng: 55.2708 }; // Dubai
  }
  if (tz.includes('London')) {
    locationName = "London, UK (Auto)";
    localStorage.setItem('locationName', locationName);
    return { lat: 51.5074, lng: -0.1278 }; // London
  }
  if (tz.includes('New_York')) {
    locationName = "New York, US (Auto)";
    localStorage.setItem('locationName', locationName);
    return { lat: 40.7128, lng: -74.0060 }; // New York
  }
  if (tz.includes('Los_Angeles')) {
    locationName = "Los Angeles, US (Auto)";
    localStorage.setItem('locationName', locationName);
    return { lat: 34.0522, lng: -118.2437 }; // LA
  }
  if (tz.includes('Dhaka')) {
    locationName = "Dhaka, BD (Auto)";
    localStorage.setItem('locationName', locationName);
    return { lat: 23.8103, lng: 90.4125 }; // Dhaka
  }
  if (tz.includes('Cairo')) {
    locationName = "Cairo, EG (Auto)";
    localStorage.setItem('locationName', locationName);
    return { lat: 30.0444, lng: 31.2357 }; // Cairo
  }
  if (tz.includes('Istanbul')) {
    locationName = "Istanbul, TR (Auto)";
    localStorage.setItem('locationName', locationName);
    return { lat: 41.0082, lng: 28.9784 }; // Istanbul
  }
  if (tz.includes('Tokyo')) {
    locationName = "Tokyo, JP (Auto)";
    localStorage.setItem('locationName', locationName);
    return { lat: 35.6895, lng: 139.6917 }; // Tokyo
  }

  // Final fallback: Riyadh, but set name
  locationName = "Riyadh, SA";
  localStorage.setItem('locationName', locationName);
  return { lat: 24.7136, lng: 46.6753 }; // Riyadh default
}

// --- Manual Location Search ---
async function searchLocation(query) {
  if (!query || query.length < 3) return;
  const resultsEl = document.getElementById('location-search-results');
  const searchBtn = document.getElementById('location-search-btn');

  try {
    searchBtn.disabled = true;
    searchBtn.textContent = '...';

    // Using timingsByAddress as a robust geocoder (it extracts coordinates from the address)
    const url = `https://api.aladhan.com/v1/timingsByAddress?address=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    const data = await res.json();

    resultsEl.innerHTML = '';
    resultsEl.style.display = 'block';

    if (data.code === 200 && data.data && data.data.meta) {
      const { latitude, longitude, timezone } = data.data.meta;
      // We use the query as name, or clean it up
      const formattedName = query.charAt(0).toUpperCase() + query.slice(1);

      const div = document.createElement('div');
      div.innerHTML = `
        <strong>${formattedName}</strong>
        <span class="search-result-subtext" style="font-size:0.8em; color:#94a3b8;">${timezone} (${latitude.toFixed(2)}, ${longitude.toFixed(2)})</span>
        <div style="font-size:0.7em; color:#6ee7b7; margin-top:2px;">Tap to select this city</div>
      `;
      div.onclick = () => selectLocation(latitude, longitude, formattedName);
      resultsEl.appendChild(div);
    } else {
      resultsEl.innerHTML = '<div style="padding:10px; color:#94a3b8;">No results found. Try "City, Country" (e.g. Kabirwala, Pakistan).</div>';
    }
  } catch (err) {
    console.error("Search failed:", err);
    resultsEl.innerHTML = '<div style="padding:10px; color:#ef4444;">Search error. Check internet.</div>';
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Search';
  }
}

function selectLocation(lat, lng, name) {
  manualLat = lat;
  manualLng = lng;
  locationName = name;
  locationMode = 'manual';

  localStorage.setItem('manualLat', lat);
  localStorage.setItem('manualLng', lng);
  localStorage.setItem('locationName', name);
  localStorage.setItem('locationMode', 'manual');

  document.getElementById('location-search-results').style.display = 'none';
  document.getElementById('location-search-input').value = '';
  document.getElementById('settings-location-mode').value = 'manual';

  updateLocationUI();
  fetchPrayerTimes(currentDate, true); // Strict refresh to bypass cache
  showToast(`Location set: ${name}`, 'success');
}

function openLocationSearch() {
  const modal = document.getElementById('settings-modal');
  if (modal) {
    modal.style.display = 'flex';
    document.getElementById('settings-location-mode').value = 'manual';
    const manualRow = document.getElementById('manual-location-row');
    if (manualRow) manualRow.style.display = 'flex';
    document.getElementById('location-search-input').focus();
  }
}

function updateLocationUI() {
  const alertEl = document.getElementById('location-alert');
  const displayEl = document.getElementById('current-location-display');

  if (displayEl) {
    displayEl.textContent = locationName || (locationMode === 'auto' ? 'Auto (Detecting...)' : 'Not set');
  }

  // Hide alert if we have location (either auto or manual)
  if (locationMode === 'manual' && manualLat) {
    if (alertEl) alertEl.style.display = 'none';
  } else if (locationMode === 'auto' && localStorage.getItem('userLat')) {
    if (alertEl) alertEl.style.display = 'none';
  }
}

function showGpsHelp() {
  alert(t('gps_help'));
}

/**
 * Automatically detects the best prayer calculation method based on the user's timezone.
 */
function detectRecommendedMethod() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!tz) return 2; // Default to ISNA

  console.log("[Auto-Calc] Detecting method for timezone:", tz);

  if (tz.includes('Karachi') || tz.includes('Lahore')) return 1; // University of Islamic Sciences, Karachi
  if (tz.includes('America') || tz.includes('Canada')) return 2; // ISNA
  if (tz.includes('Europe/London') || tz.includes('Europe/Paris')) return 3; // Muslim World League
  if (tz.includes('Riyadh') || tz.includes('Makkah')) return 4; // Umm Al-Qura
  if (tz.includes('Cairo') || tz.includes('Africa')) return 5; // Egyptian General Authority of Survey
  if (tz.includes('Tehran')) return 7; // Institute of Geophysics, University of Tehran
  if (tz.includes('Dubai') || tz.includes('Qatar') || tz.includes('Kuwait')) return 8; // Gulf Region
  if (tz.includes('Singapore')) return 11; // Singapore
  if (tz.includes('Turkey')) return 13; // Turkey
  if (tz.includes('Moscow')) return 14; // Russia

  return 2; // Default fallback to ISNA
}

async function fetchPrayerTimes(date = new Date(), forceRefresh = false) {
  const yyyy = date.getFullYear();
  const mm = (date.getMonth() + 1).toString().padStart(2, '0');
  const dd = date.getDate().toString().padStart(2, '0');
  const dateKey = `${yyyy}-${mm}-${dd}`;

  // 1. Try Loading from Local Cache (Offline/Speed)
  // Skip cache if location just changed (forceRefresh)
  const cachedData = forceRefresh ? null : localStorage.getItem('prayers_' + dateKey);
  if (cachedData) {
    console.log("Using cached prayer times for", dateKey);
    const parsed = JSON.parse(cachedData);
    // Extra safety: Verify if the cache is for the same lat/lng (optional)
    parseAndRenderPrayers(parsed);
    checkAndTriggerPrayerNotifications(prayersWithTahajjud);
  } else {
    console.log(forceRefresh ? "Force refreshing prayer times..." : "No cache found, fetching fresh data...");
  }

  // 2. Get Location
  let coords = { lat: 24.7136, lng: 46.6753 }; // Default Riyadh

  if (locationMode === 'manual' && manualLat && manualLng) {
    coords = { lat: manualLat, lng: manualLng };
    updateLocationUI(); // Ensure alert is hidden if manual location is valid
  } else {
    // Auto Mode Logic
    const savedLat = localStorage.getItem('userLat');
    const savedLng = localStorage.getItem('userLng');
    if (savedLat && savedLng) {
      coords = { lat: parseFloat(savedLat), lng: parseFloat(savedLng) };
    }

    try {
      const pos = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject({ code: 0, message: "Geolocation NOT supported" });

        const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 };
        const success = (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude });
        const error = (err) => {
          if (err.code === 1) console.log(`[Location] Geo Permission Denied`);
          else console.log(`[Location] Geo Error (Code ${err.code})`);

          if (err.code !== 1) {
            navigator.geolocation.getCurrentPosition(success, (err2) => reject(err2), { enableHighAccuracy: false, timeout: 8000 });
          } else {
            reject(err);
          }
        };
        navigator.geolocation.getCurrentPosition(success, error, options);
      });

      coords = pos;
      localStorage.setItem('userLat', coords.lat);
      localStorage.setItem('userLng', coords.lng);
      updateLocationUI(); // Hide alert if successful
    } catch (e) {
      // Permission Denied or Fetch Failed
      if (e.code === 1 || e.code === 0) {
        const alertEl = document.getElementById('location-alert');
        if (alertEl && locationMode === 'auto') alertEl.style.display = 'block';
      }

      if (!savedLat && !cachedData) {
        coords = detectRecommendedLocation();
        updateLocationUI(); // Call UI update to show guessed name
      }
    }
  }

  // 3. Fetch API (Network)
  if (navigator.onLine) {
    try {
      let methodToUse = userCalcMethod;
      if (methodToUse === 0) {
        methodToUse = detectRecommendedMethod();
      }

      const url = `https://api.aladhan.com/v1/timings/${dateKey}?latitude=${coords.lat}&longitude=${coords.lng}&method=${methodToUse}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("API Limit/Error");
      const data = await res.json();
      const timings = data.data.timings;

      // Save to Cache
      localStorage.setItem('prayers_' + dateKey, JSON.stringify(timings));

      // Render to UI
      parseAndRenderPrayers(timings);

      // Save to Firebase for Cron Jobs
      const user = auth.currentUser;
      if (user) {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        set(ref(db, `users/${user.uid}/prayerTimes/${dateKey}`), timings).then(() => {
          console.log(`[Cron Sync] Prayer times for ${dateKey} synced to Firebase.`);
        });
        update(ref(db, `users/${user.uid}`), { timezone: tz }).then(() => {
          console.log(`[Cron Sync] User timezone (${tz}) updated.`);
        });
      }

      // Schedule Notifications
      checkAndTriggerPrayerNotifications(prayersWithTahajjud);
    } catch (err) {
      handleApiError("Prayer Times", err, !cachedData); // Only show error if no cache fallback
      if (!cachedData) showToast("Check your connection to get latest times.", "warning");
    }
  } else if (!cachedData) {
    showToast("Offline: Connect to load prayer times.", "warning");
  }
}

// Helper to apply offsets to time string "HH:MM"
function applyOffset(timeStr, offsetMins) {
  if (!offsetMins || offsetMins === 0) return timeStr;
  const [h, m] = timeStr.split(':').map(Number);
  const date = new Date();
  date.setHours(h, m, 0);
  date.setMinutes(date.getMinutes() + offsetMins);
  return date.getHours().toString().padStart(2, '0') + ":" + date.getMinutes().toString().padStart(2, '0');
}

function formatTime12h(time24) {
  if (!time24 || time24 === '--:--') return '--:--';
  const [h, m] = time24.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
}

function parseAndRenderPrayers(t) {
  // Apply Offsets
  const timings = { ...t };
  ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].forEach(p => {
    if (userOffsets[p]) {
      timings[p] = applyOffset(t[p], userOffsets[p]);
    }
  });

  const apiPrayers = [
    { name: 'Fajr', time: timings.Fajr },
    { name: 'Sunrise', time: timings.Sunrise },
    { name: 'Dhuhr', time: timings.Dhuhr },
    { name: 'Asr', time: timings.Asr },
    { name: 'Maghrib', time: timings.Maghrib },
    { name: 'Isha', time: timings.Isha }
  ];
  prayersWithTahajjud = getPrayersWithTahajjud(apiPrayers);
  document.querySelectorAll('.prayer-item').forEach((item, i) => {
    item.querySelector('.prayer-time').textContent = formatTime12h(prayersWithTahajjud[i]?.time);
  });
  calcLastThird();
  updateCountdown();
}

// --- Update all logic to use prayersWithTahajjud ---
function getNextPrayer() {
  const now = new Date();
  for (let i = 0; i < prayersWithTahajjud.length; i++) {
    const pTimeStr = prayersWithTahajjud[i]?.time;
    if (!pTimeStr) continue;
    const [h, m] = pTimeStr.split(':').map(Number);
    const prayerTime = new Date(now);
    prayerTime.setHours(h, m, 0, 0);
    if (prayerTime > now) {
      return { ...prayersWithTahajjud[i], index: i, prayerTime };
    }
  }
  // If all passed, next is Tahajjud tomorrow
  const [h, m] = prayersWithTahajjud[0].time.split(':').map(Number);
  const prayerTime = new Date(now);
  prayerTime.setDate(prayerTime.getDate() + 1);
  prayerTime.setHours(h, m, 0, 0);
  return { ...prayersWithTahajjud[0], index: 0, prayerTime };
}

function updateCountdown() {
  if (!prayersWithTahajjud.length) return;
  const now = new Date();
  const { name, prayerTime, index } = getNextPrayer();
  const diff = prayerTime - now;
  const hours = Math.floor(diff / 1000 / 60 / 60);
  const mins = Math.floor((diff / 1000 / 60) % 60);
  const secs = Math.floor((diff / 1000) % 60);
  countdownTimerEl.textContent = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  nextPrayerNameEl.textContent = name;

  // Struggle Prayer Highlight
  const countdownCard = document.querySelector('.countdown-section');
  if (countdownCard) {
    if (name === userStrugglePrayer) {
      countdownCard.classList.add('struggle-active');
      if (!countdownCard.querySelector('.priority-badge')) {
        const badge = document.createElement('div');
        badge.className = 'priority-badge';
        badge.textContent = 'HIGH PRIORITY';
        countdownCard.appendChild(badge);
      }
    } else {
      countdownCard.classList.remove('struggle-active');
      const badge = countdownCard.querySelector('.priority-badge');
      if (badge) badge.remove();
    }
  }

  // Animate SVG circle
  const prevIndex = (index - 1 + prayersWithTahajjud.length) % prayersWithTahajjud.length;
  const [prevH, prevM] = prayersWithTahajjud[prevIndex].time.split(':').map(Number);
  const prevPrayerTime = new Date(now);
  if (prevIndex > index) prevPrayerTime.setDate(prevPrayerTime.getDate() - 1);
  prevPrayerTime.setHours(prevH, prevM, 0, 0);
  const total = (prayerTime - prevPrayerTime) / 1000;
  const elapsed = (now - prevPrayerTime) / 1000;
  let progress = elapsed / total;
  if (progress < 0) progress = 0;
  if (progress > 1) progress = 1;
  const circle = document.querySelector('.countdown-progress');
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  circle.style.strokeDasharray = circumference;
  circle.style.strokeDashoffset = circumference * (1 - progress);
  // Highlight active prayer
  prayerItems.forEach((item, i) => {
    if (i === prevIndex) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

// CRITICAL FIX: Store interval ID and clean up properly
let countdownInterval = null;

function startCountdownTimer() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(updateCountdown, 1000);
  updateCountdown(); // Initial call
}

// Start timer
startCountdownTimer();

function calcLastThird() {
  if (!prayersWithTahajjud || prayersWithTahajjud.length < 5) return;
  const fajrTime = prayersWithTahajjud[0]?.time;
  const maghribTime = prayersWithTahajjud[4]?.time;
  if (!fajrTime || !maghribTime) return;

  const fajr = fajrTime.split(':').map(Number);
  const maghrib = maghribTime.split(':').map(Number);
  const maghribDate = new Date();
  maghribDate.setHours(maghrib[0], maghrib[1], 0, 0);
  const fajrDate = new Date();
  fajrDate.setDate(fajrDate.getDate() + 1);
  fajrDate.setHours(fajr[0], fajr[1], 0, 0);
  const nightDuration = (fajrDate - maghribDate);
  const lastThirdStart = new Date(fajrDate - nightDuration / 3);
  lastThirdTimeEl.textContent = `${lastThirdStart.getHours().toString().padStart(2, '0')}:${lastThirdStart.getMinutes().toString().padStart(2, '0')} - ${prayersWithTahajjud[0].time}`;
}

// --- Date navigation triggers API fetch ---
prevDateBtn.onclick = () => { currentDate.setDate(currentDate.getDate() - 1); updateDates(); fetchPrayerTimes(currentDate); };
nextDateBtn.onclick = () => { currentDate.setDate(currentDate.getDate() + 1); updateDates(); fetchPrayerTimes(currentDate); };

// --- On load, fetch prayer times ---
fetchPrayerTimes(currentDate);

// --- Local Storage Caching ---
function cachePrayerTimes(times) {
  localStorage.setItem('prayerTimes', JSON.stringify(times));
}
function getCachedPrayerTimes() {
  return JSON.parse(localStorage.getItem('prayerTimes'));
}



// --- Auth Modal Logic ---
const authModal = document.getElementById('auth-modal');
const authEmail = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const authError = document.getElementById('auth-error');
const authSubmit = document.getElementById('auth-submit');
const authSwitchBtn = document.getElementById('auth-switch-btn');
const authSwitchText = document.getElementById('auth-switch-text');
const authModalTitle = document.getElementById('auth-modal-title');
const authGoogleBtn = document.getElementById('auth-google-btn');
const authForgotBtn = document.getElementById('auth-forgot-btn');
const authForgotContainer = document.getElementById('auth-forgot-container');

let isLoginMode = true;
function showAuthModal() {
  authModal.style.display = 'flex';
  authError.textContent = '';
  authEmail.value = '';
  authPassword.value = '';
  isLoginMode = true;
  updateAuthMode();
  // Hide app sections and nav
  Object.values(sections).forEach(sec => { if (sec) sec.style.display = 'none'; });
  document.querySelector('.bottom-nav').style.display = 'none';
  if (settingsBtn) settingsBtn.style.display = 'none';
}
function hideAuthModal() {
  authModal.style.display = 'none';
  // Show app sections and nav
  showSection('home');
  document.querySelector('.bottom-nav').style.display = '';
  if (settingsBtn) settingsBtn.style.display = 'flex';
}
function updateAuthMode() {
  if (isLoginMode) {
    authModalTitle.textContent = 'Login';
    authSubmit.textContent = 'Login';
    authSwitchText.textContent = "Don't have an account?";
    authSwitchBtn.textContent = 'Sign up';
    if (authForgotContainer) authForgotContainer.style.display = 'block';
  } else {
    authModalTitle.textContent = 'Sign Up';
    authSubmit.textContent = 'Sign Up';
    authSwitchText.textContent = 'Already have an account?';
    authSwitchBtn.textContent = 'Login';
    if (authForgotContainer) authForgotContainer.style.display = 'none';
  }
}
authSwitchBtn.onclick = () => {
  isLoginMode = !isLoginMode;
  updateAuthMode();
  authError.textContent = '';
};
authSubmit.onclick = async () => {
  const email = authEmail.value.trim();
  const password = authPassword.value;
  if (!email || !password) {
    authError.textContent = 'Please enter email and password.';
    return;
  }
  if (password.length < 6) {
    authError.textContent = 'Password must be at least 6 characters.';
    return;
  }
  try {
    if (isLoginMode) {
      await signInWithEmailAndPassword(auth, email, password);
      showToast('Welcome back!', 'success');
    } else {
      await createUserWithEmailAndPassword(auth, email, password);
      showToast('Account created successfully!', 'success');
    }
    hideAuthModal();
  } catch (e) {
    let friendlyMsg = "Authentication failed.";
    const code = e.code;

    if (code === 'auth/user-not-found') friendlyMsg = 'No account found with this email.';
    else if (code === 'auth/wrong-password') friendlyMsg = 'Incorrect password.';
    else if (code === 'auth/email-already-in-use') friendlyMsg = 'This email is already registered.';
    else if (code === 'auth/invalid-email') friendlyMsg = 'Please enter a valid email address.';
    else if (code === 'auth/weak-password') friendlyMsg = 'Password should be at least 6 characters.';
    else if (code === 'auth/network-request-failed') friendlyMsg = 'Network error. Check your connection.';
    else friendlyMsg = e.message;

    authError.textContent = friendlyMsg;
    showToast(friendlyMsg, 'error');
  }
};

if (authGoogleBtn) {
  authGoogleBtn.onclick = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      showToast("Logged in with Google! 🚀", "success");
      hideAuthModal();
    } catch (e) {
      console.error(e);
      let msg = e.message;
      if (e.code === 'auth/popup-blocked') msg = "Popup blocked by browser.";
      else if (e.code === 'auth/cancelled-popup-request') msg = "Popup closed.";
      authError.textContent = msg;
      showToast(msg, "error");
    }
  };
}

if (authForgotBtn) {
  authForgotBtn.onclick = async () => {
    const email = authEmail.value.trim();
    if (!email) {
      authError.textContent = "Please enter your email first.";
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      const strings = translations[userLanguage];
      const successMsg = strings.auth_reset_sent || "Reset email sent!";
      showToast(successMsg, "success");
      authError.style.color = "#6ee7b7";
      authError.textContent = successMsg;
    } catch (e) {
      console.error(e);
      authError.style.color = "#ff6b6b";
      authError.textContent = e.message;
      showToast(e.message, "error");
    }
  };
}



onAuthStateChanged(auth, user => {
  if (!user) {
    showAuthModal();
    if (settingsBtn) settingsBtn.style.display = 'none';
  } else {
    hideAuthModal();
    if (settingsBtn) settingsBtn.style.display = 'flex';

    // Preload user settings
    get(ref(db, `users/${user.uid}`)).then(snap => {
      const data = snap.val() || {};
      userOffsets = data.prayerOffsets || { Fajr: 0, Dhuhr: 0, Asr: 0, Maghrib: 0, Isha: 0 };
      userCalcMethod = data.calcMethod || 2;
      userDisplayName = data.displayName || user.email.split('@')[0];
      userStrugglePrayer = data.strugglePrayer || "";

      // Load Internal Adhan Settings
      window.internalAdhanEnabled = data.internalAdhanEnabled || false;
      window.selectedAdhanTone = data.selectedAdhanTone || 'azan_tone.mp3';

      const internalAdhanToggle = document.getElementById('settings-internal-adhan-toggle');
      const adhanToneSelect = document.getElementById('settings-adhan-tone');
      if (internalAdhanToggle) internalAdhanToggle.checked = window.internalAdhanEnabled;
      if (adhanToneSelect) adhanToneSelect.value = window.selectedAdhanTone;

      localStorage.setItem('userStrugglePrayer', userStrugglePrayer);

      // Initialize Internal Adhan Manager
      InternalAdhanManager.init();

      // Now that offsets are loaded, we can fetch/refresh prayer times
      fetchPrayerTimes(currentDate);
      // Check if new user needs onboarding
      checkOnboardingStatus(user.uid, data);
    });

    fetchAndDisplayTracker();
    updateMarkPrayerBtn();
    checkForAppNotification();

    // Check for app updates
    checkAppUpdates();

    // Request FCM token if user is logged in
    if ('serviceWorker' in navigator) {
      requestNotificationPermission();
    }
  }
});

// --- Prayer Logs (Firebase) ---
// --- Tracker/Rewards Logic ---
const rewardsPointsEl = document.getElementById('rewards-points');
const streakCountEl = document.getElementById('streak-count');
const monthlyStatsGrid = document.getElementById('monthly-stats-grid');
const streakProgress = document.getElementById('streak-progress');
const streakBadgesRow = document.getElementById('streak-badges-row');

let rewards = 0;
let streak = 0;

function updateStreakGamification(currentStreak) {
  const s = currentStreak !== undefined ? currentStreak : streak;
  // Badges
  let badges = '';
  if (s >= 3) badges += '<span class="badge">🥉 3-Day Streak</span> ';
  if (s >= 7) badges += '<span class="badge">🥈 7-Day Streak</span> ';
  if (s >= 30) badges += '<span class="badge">🏅 30-Day Streak</span> ';
  if (s >= 100) badges += '<span class="badge">🏆 100-Day Streak</span> ';
  if (!badges) badges = '<span style="color:#888;font-size:0.98em;">Earn streak badges by praying all 5 for consecutive days!</span>';
  if (streakBadgesRow) streakBadgesRow.innerHTML = badges;
}

function getLevelFromXP(xp) {
  // Example: Level 1: 0, 2: 50, 3: 100, 4: 200, 5: 350, 6: 550, ...
  let level = 1, next = 50;
  while (xp >= next) {
    level++;
    xp -= next;
    next = Math.floor(next * 1.5);
  }
  return { level, xpToNext: next, xpInLevel: xp };
}

function showLevelUp(level) {
  // Simple popup for now
  alert(`🎉 Level Up! You reached Level ${level}!`);
}

// --- Motivational Toast Popup ---
const toastPopup = document.getElementById('toast-popup');
function showToast(msg, type = 'info') {
  if (!toastPopup) return;

  toastPopup.textContent = msg;
  toastPopup.className = 'toast-popup'; // Reset classes

  // Set styles based on type
  switch (type) {
    case 'error':
      toastPopup.style.background = '#ef4444cc'; // Red
      toastPopup.style.color = '#fff';
      break;
    case 'success':
      toastPopup.style.background = '#10b981cc'; // Green
      toastPopup.style.color = '#fff';
      break;
    case 'warning':
      toastPopup.style.background = '#f59e0bcc'; // Amber
      toastPopup.style.color = '#fff';
      break;
    default:
      toastPopup.style.background = '#1e293bcc'; // Slate
      toastPopup.style.color = '#6ee7b7';
  }

  toastPopup.classList.add('show');
  setTimeout(() => toastPopup.classList.remove('show'), 3500);
}

/**
 * Global helper to handle API errors consistently
 */
async function handleApiError(context, error, showUser = true) {
  const message = error.message || String(error);
  GlobalAudit.logError(context, error);

  if (showUser) {
    let userMsg = "Something went wrong.";
    if (message.includes("network") || message.includes("Failed to fetch")) {
      userMsg = "Connection lost. Please check your internet.";
    } else if (message.includes("permission") || message.includes("unauthorized")) {
      userMsg = "Access denied. Please login again.";
    } else {
      userMsg = `${context}: ${message}`;
    }
    showToast(userMsg, 'error');
  }
}
const prayedMsgs = [
  'MashaAllah! Keep it up! 🌟',
  'Allah loves those who are consistent in prayer.',
  'Great job! May Allah accept your Salah.',
  'You are building a beautiful habit! 💚',
  'Every prayer brings you closer to Allah.',
  'Consistency is the key to success!',
  'May your prayers bring you peace and blessings.',
  'You are inspiring! Keep going!',
  'BarakAllahu feek!'
];
const missedMsgs = [
  'Don’t give up! Tomorrow is a new day.',
  'Every day is a new chance to improve.',
  'Allah is Most Merciful. Try again!',
  'Missing one prayer doesn’t define you.',
  'Stay motivated! You can do it.',
  'Reflect, reset, and keep moving forward.',
  'Your effort counts. Never lose hope.'
];

// --- Log Prayer with Status ---
// Helper for Consistent Date Keys (Local YYYY-MM-DD)
function getTodayDateString(dateObj = new Date()) {
  const yyyy = dateObj.getFullYear();
  const mm = (dateObj.getMonth() + 1).toString().padStart(2, '0');
  const dd = dateObj.getDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// --- Log Prayer with Status ---
const tahajjudMsgs = [
  'SubhanAllah! Tahajjud is a special gift. 🌙',
  'You woke up for Tahajjud! May Allah grant your duas.',
  'The night prayer brings light to your heart.',
  'You are among the blessed who remember Allah at night.',
  'Tahajjud is a sign of true devotion. Keep it up!',
  'May Allah answer your secret prayers. 💖',
  'You are building a powerful connection with Allah.'
];
// =============================================================================
// 4. PRAYER LOGGING & GAMIFICATION
// =============================================================================

async function logPrayerStatus(prayerName, status) {
  GlobalAudit.logActivity("Mark Prayer", { prayer: prayerName, status });
  const user = auth.currentUser;
  if (!user) return;
  const today = getTodayDateString();

  // 1. Optimistic Updates (Local Cache)
  const userLogs = PersistentCache.get(`logs_${user.uid}`) || {};
  if (!userLogs[today]) userLogs[today] = {};
  const prevStatus = userLogs[today][prayerName];

  if (prevStatus === status) return;

  userLogs[today][prayerName] = status;
  PersistentCache.set(`logs_${user.uid}`, userLogs);

  let isTahajjud = (prayerName === 'Tahajjud');
  let pointsEarned = isTahajjud ? 20 : 10;

  if (status === 'prayed') {
    const rewards = (PersistentCache.get(`rewards_${user.uid}`) || 0) + pointsEarned;
    const xp = (PersistentCache.get(`xp_${user.uid}`) || 0) + pointsEarned;
    PersistentCache.set(`rewards_${user.uid}`, rewards);
    PersistentCache.set(`xp_${user.uid}`, xp);

    // Update UI immediately (Optimistic)
    rewardsPointsEl.textContent = rewards;
    xpPointsEl.textContent = xp;

    if (isTahajjud) {
      showToast(tahajjudMsgs[Math.floor(Math.random() * tahajjudMsgs.length)], 'success');
    } else {
      showToast(prayedMsgs[Math.floor(Math.random() * prayedMsgs.length)], 'success');
      checkAndIncrementStreak(user); // Local streak check
    }
  } else {
    showToast(missedMsgs[Math.floor(Math.random() * missedMsgs.length)], 'warning');
  }

  updateMarkPrayerBtn();
  if (typeof fetchAndDisplayTracker === 'function') fetchAndDisplayTracker();

  // CRITICAL UPGRADE: Sync to Service Worker immediately so sticky notification updates
  if (window.syncToServiceWorker) window.syncToServiceWorker();

  // 2. Database Synchronization (via SyncQueue)
  const logPath = `users/${user.uid}/logs/${today}/${prayerName}`;
  const rewardsPath = `users/${user.uid}/rewards`;
  const xpPath = `users/${user.uid}/xp`;
  const globalCountPath = `globalStats/${today}/${prayerName}`;

  // Log update
  SyncQueue.push({ type: 'set', path: logPath, data: status });

  // Global Stat (Transaction)
  if (status === 'prayed') {
    SyncQueue.push({ type: 'transaction', path: globalCountPath, data: 1, method: 'increment' });
  } else if (prevStatus === 'prayed') {
    SyncQueue.push({ type: 'transaction', path: globalCountPath, data: -1, method: 'increment' });
  }

  // Rewards & XP
  if (status === 'prayed') {
    SyncQueue.push({ type: 'transaction', path: rewardsPath, data: pointsEarned, method: 'increment' });
    SyncQueue.push({ type: 'transaction', path: xpPath, data: pointsEarned, method: 'increment' });
  }

  // Partner Notification & Deen Twin Sync (Only if Online)
  if (navigator.onLine) {
    try {
      const tSnap = await get(ref(db, `users/${user.uid}/twins/pairId`));
      if (tSnap.exists()) {
        const pairId = tSnap.val();
        await update(ref(db, `pairs/${pairId}/dailyStatus/${today}/${user.uid}`), { [prayerName]: status });

        if (status === 'prayed') {
          const pSnap = await get(ref(db, `pairs/${pairId}`));
          if (pSnap.exists()) {
            const pData = pSnap.val();
            const partnerId = (pData.user1 === user.uid) ? pData.user2 : pData.user1;
            const tokSnap = await get(ref(db, `users/${partnerId}/fcmToken`));
            const partnerToken = tokSnap.val();
            if (partnerToken) {
              sendFCMNotificationv1(partnerToken, "Partner Activity 🌟", `Your Deen Twin has just prayed ${prayerName}! MashaAllah.`, 'reminder_tone');
            }
          }
        }
      }
    } catch (err) {
      console.warn("Deen Twin sync failed or skipped (Offline/Auth error)", err);
    }
  }

  // Start Syncing
  SyncQueue.process();
}

// --- Streak Calculation Helper ---
async function checkAndIncrementStreak(user) {
  const today = getTodayDateString();

  // 1. Check if all 5 Fard prayers are done today
  const logsSnap = await get(ref(db, `users/${user.uid}/logs/${today}`));
  const todayLogs = logsSnap.exists() ? logsSnap.val() : {};
  const fardPrayers = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
  const allDone = fardPrayers.every(p => todayLogs[p] === 'prayed');

  if (allDone) {
    // 2. All done! Now check streak status
    const statsRef = ref(db, `users/${user.uid}/stats`);
    const statsSnap = await get(statsRef);
    const stats = statsSnap.exists() ? statsSnap.val() : {};

    let currentStreak = stats.streak || 0;
    const lastStreakDate = stats.lastStreakDate || "";

    // If already updated for today, don't double count
    if (lastStreakDate === today) return;

    // Check Yesterday
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const yesterday = getTodayDateString(d);

    // If last streak was yesterday, increment. Else, reset/start at 1.
    if (lastStreakDate === yesterday) {
      currentStreak++;
    } else {
      // Edge case: if lastStreakDate is older than yesterday, streak was broken.
      // But wait... was yesterday actually done but user forgot to open app? 
      // Ideally we check yesterday's logs. But for simplicity and robustness:
      // If we are strictly "all 5 done today", and we want to link to yesterday:
      const yLogsSnap = await get(ref(db, `users/${user.uid}/logs/${yesterday}`));
      const yLogs = yLogsSnap.exists() ? yLogsSnap.val() : {};
      const yAllDone = fardPrayers.every(p => yLogs[p] === 'prayed');

      if (yAllDone) {
        // Recover streak if yesterday was valid
        // This handles the case where user filled yesterday's logs late
        currentStreak++;
      } else {
        currentStreak = 1; // Start fresh
      }
    }

    // Save
    await update(statsRef, {
      streak: currentStreak,
      lastStreakDate: today
    });

    // Show Celebration
    showToast(`🔥 Streak Updated: ${currentStreak} Days!`, '#f59e0b');
    createCelebrationBurst();
    fetchAndDisplayTracker(); // Refresh UI
  }
}

function createCelebrationBurst() {
  const el = document.createElement('div');
  el.textContent = '🔥';
  el.className = 'celebration-burst';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

// --- Live Global Counts Listener ---
function listenToGlobalCounts() {
  const today = getTodayDateString();
  const todayCountsRef = ref(db, `globalStats/${today}`);

  // Function to update the widget
  const updateWidget = (data) => {
    // Re-use existing logic to find current prayer
    // If getCurrentPrayerContext is missing, we use a fallback or recreate it.
    // Assuming it exists or we use the 'nextPrayer' logic to derive current.

    let currentPrayerName = 'Fajr'; // Default
    if (typeof getCurrentPrayerContext === 'function') {
      currentPrayerName = getCurrentPrayerContext();
    } else {
      // Fallback or duplicate logic if function is missing/moved
      // Simple logic: find last started prayer
      // (This duplicate is safe to ensure robustness)
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      if (prayersWithTahajjud && prayersWithTahajjud.length > 0) {
        for (let i = prayersWithTahajjud.length - 1; i >= 0; i--) {
          const p = prayersWithTahajjud[i];
          const [h, m] = p.time.split(':').map(Number);
          if (currentMinutes >= h * 60 + m) {
            currentPrayerName = p.name;
            break;
          }
        }
      }
    }

    const count = data[currentPrayerName] || 0;
    const countEl = document.getElementById('current-prayer-count');
    const nameEl = document.getElementById('current-prayer-name-display');

    if (countEl && nameEl) {
      countEl.textContent = count;
      nameEl.textContent = currentPrayerName;
    }
  };

  onValue(todayCountsRef, (snap) => {
    const data = snap.val() || {};
    updateWidget(data);
  });

  // Also update when minute changes (to catch prayer time change)
  setInterval(() => {
    // Trigger a re-read of current local data to update the NAME if time passed
    get(todayCountsRef).then(snap => {
      const data = snap.val() || {};
      updateWidget(data);
    }).catch(err => console.warn("[GlobalStats] Permission or Network error:", err));
  }, 60000);
}
// Start listening on load
listenToGlobalCounts();


// --- Badges & Gamification ---
const trackerSection = document.getElementById('tracker-section');
let badges = [];
// Redundant badge logic removed
function trackerWithBadges() {
  fetchAndDisplayTracker();
}
navBtns[3].removeEventListener('click', fetchAndDisplayTracker);
navBtns[3].addEventListener('click', trackerWithBadges);

// --- Tracker/Rewards/XP/Level Logic ---
function fetchAndDisplayTracker() {
  const user = auth.currentUser;
  if (!user) return;

  // 1. Initial UI setup (Animation reset)
  const grid = document.querySelector('.stats-grid');
  if (grid) {
    grid.style.animation = 'none';
    grid.offsetHeight;
    grid.style.animation = null;
  }

  // 2. Load from Cache First (Offline-first experience)
  const cachedLogs = PersistentCache.get(`logs_${user.uid}`) || {};
  const cachedRewards = PersistentCache.get(`rewards_${user.uid}`) || 0;
  const cachedXP = PersistentCache.get(`xp_${user.uid}`) || 0;

  renderTrackerUI(cachedLogs);
  rewardsPointsEl.textContent = cachedRewards;
  updateXPUI(cachedXP);

  // 3. Fetch Fresh Data from Firebase
  if (navigator.onLine) {
    get(ref(db, `users/${user.uid}`)).then(snap => {
      if (snap.exists()) {
        const data = snap.val();
        const freshLogs = data.logs || {};
        const freshRewards = data.rewards || 0;
        const freshXP = data.xp || 0;
        const freshStats = data.stats || {};

        // UPGRADE: Merge logic to prevent locally-marked prayers from being lost
        const mergedLogs = { ...cachedLogs, ...freshLogs };
        // Deep merge for nested dates
        Object.keys(freshLogs).forEach(date => {
          mergedLogs[date] = { ...(cachedLogs[date] || {}), ...freshLogs[date] };
        });

        // Update Persistent Cache
        PersistentCache.set(`logs_${user.uid}`, mergedLogs);
        PersistentCache.set(`rewards_${user.uid}`, freshRewards);
        PersistentCache.set(`xp_${user.uid}`, freshXP);
        PersistentCache.set(`stats_${user.uid}`, freshStats);

        // Update Globals
        rewards = freshRewards;

        // Re-render with merged data
        renderTrackerUI(mergedLogs, freshStats);
        rewardsPointsEl.textContent = freshRewards;
        updateXPUI(freshXP);
      }
    }).catch(err => {
      console.warn("Firebase fetch failed, staying with cached data", err);
    });
  }
}

// Helper to update XP UI
function updateXPUI(xp) {
  const { level, xpToNext, xpInLevel } = getLevelFromXP(xp);
  levelNumEl.textContent = level;
  xpPointsEl.textContent = xp;
  const progressPercent = Math.min((xpInLevel / xpToNext) * 100, 100);
  xpProgress.style.width = progressPercent + '%';
}

// Helper to render the monthly attendance grid and aggregate stats
function renderTrackerUI(logs, stats = null) {
  const user = auth.currentUser;
  if (!user) return;

  const gridEl = monthlyStatsGrid;
  if (!gridEl) return;
  gridEl.innerHTML = '';

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();

  let totalPrayed = 0;
  let totalMissed = 0;
  let totalTracked = 0;

  for (let d = 1; d <= lastDay; d++) {
    const dObj = new Date(year, month, d);
    const dateStr = getTodayDateString(dObj);
    const dayPrayers = logs[dateStr] || {};
    const isToday = (d === now.getDate());

    const col = document.createElement('div');
    col.className = 'day-column';
    if (isToday) col.classList.add('today');

    col.innerHTML = `<div class="day-header">${d}</div>`;

    ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].forEach(p => {
      const dot = document.createElement('div');
      dot.className = 'status-dot';

      let status = dayPrayers[p];

      // UPGRADE: Auto-accountability for unmarked prayers
      if (!status) {
        if (dObj < now) {
          // It's a past day, so any empty log is 'missed'
          if (isToday) {
            // If it's today, only mark as missed if the prayer time has already passed
            const pTime = prayersWithTahajjud.find(pt => pt.name === p)?.time;
            if (pTime) {
              const [ph, pm] = pTime.split(':').map(Number);
              const pDate = new Date(now);
              pDate.setHours(ph, pm, 0, 0);
              if (now > pDate) status = 'missed';
            }
          } else {
            status = 'missed';
          }
        }
      }

      if (status === 'prayed') {
        dot.classList.add('prayed');
        totalPrayed++;
        totalTracked++;
      } else if (status === 'missed') {
        dot.classList.add('missed');
        totalMissed++;
        totalTracked++;
      }
      col.appendChild(dot);
    });

    gridEl.appendChild(col);
    if (isToday) {
      setTimeout(() => col.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }), 100);
    }
  }

  // Summary Update
  const summaryPrayedVal = document.getElementById('summary-prayed-val');
  const summaryPrayedCount = document.getElementById('summary-prayed-count');
  const summaryPrayedBar = document.getElementById('summary-prayed-bar');
  const summaryMissedVal = document.getElementById('summary-missed-val');
  const summaryMissedCount = document.getElementById('summary-missed-count');
  const summaryMissedBar = document.getElementById('summary-missed-bar');

  if (totalTracked > 0) {
    const prayedPerc = Math.round((totalPrayed / totalTracked) * 100);
    const missedPerc = Math.round((totalMissed / totalTracked) * 100);

    if (summaryPrayedVal) summaryPrayedVal.textContent = prayedPerc + '%';
    if (summaryPrayedCount) summaryPrayedCount.textContent = totalPrayed + ' times';
    if (summaryPrayedBar) summaryPrayedBar.style.width = prayedPerc + '%';

    if (summaryMissedVal) summaryMissedVal.textContent = missedPerc + '%';
    if (summaryMissedCount) summaryMissedCount.textContent = totalMissed + ' times';
    if (summaryMissedBar) summaryMissedBar.style.width = missedPerc + '%';
  } else {
    if (summaryPrayedVal) summaryPrayedVal.textContent = '0%';
    if (summaryPrayedCount) summaryPrayedCount.textContent = '0 times';
    if (summaryPrayedBar) summaryPrayedBar.style.width = '0%';
    if (summaryMissedVal) summaryMissedVal.textContent = '0%';
    if (summaryMissedCount) summaryMissedCount.textContent = '0 times';
    if (summaryMissedBar) summaryMissedBar.style.width = '0%';
  }

  // --- Streak Logic (Simplified for widget use) ---
  let calculatedStreak = 0;
  const streakDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    streakDays.push(getTodayDateString(d));
  }

  let tempStreak = 0;
  streakDays.forEach((date, i) => {
    const prayers = logs[date] || {};
    if (['Tahajjud', 'Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].every(p => prayers[p] === 'prayed')) {
      tempStreak++;
      if (i === 0) calculatedStreak = tempStreak;
    } else {
      tempStreak = 0;
    }
  });

  if (!stats) stats = PersistentCache.get(`stats_${user.uid}`) || {};
  let streakVal = stats.streak !== undefined ? stats.streak : calculatedStreak;
  const lastStreakDate = stats.lastStreakDate;
  const todayStr = getTodayDateString();
  const d_y = new Date(); d_y.setDate(d_y.getDate() - 1);
  const yesterdayStr = getTodayDateString(d_y);

  if (lastStreakDate && lastStreakDate !== todayStr && lastStreakDate !== yesterdayStr) {
    streakVal = 0;
  }

  streak = streakVal;
  if (streakCountEl) streakCountEl.textContent = streak;
  updateStreakGamification(streak);

  const homeStreakValue = document.getElementById('home-streak-value');
  const homeStreakWidget = document.getElementById('home-streak-widget');
  if (homeStreakValue && homeStreakWidget) {
    homeStreakValue.textContent = streak;
    homeStreakWidget.style.display = 'block';
    if (streak === 0) {
      homeStreakWidget.style.background = 'linear-gradient(135deg, #475569, #334155)';
      const fire = homeStreakWidget.querySelector('.fire-core');
      if (fire) fire.textContent = '🌑';
    } else {
      homeStreakWidget.style.background = 'linear-gradient(135deg, #b45309, #78350f)';
      const fire = homeStreakWidget.querySelector('.fire-core');
      if (fire) fire.textContent = '🔥';
    }
  }
}

// Update logPrayer to increment rewards and show message
function logPrayer(prayerName) {
  const user = auth.currentUser;
  if (!user) return;
  const today = getTodayDateString();
  set(ref(db, `users/${user.uid}/logs/${today}/${prayerName}`), true).then(() => {
    // Increment rewards
    get(ref(db, `users/${user.uid}/rewards`)).then(snap => {
      let points = snap.val() || 0;
      points += 10; // 10 points per prayer
      set(ref(db, `users/${user.uid}/rewards`), points).then(() => {
        rewardsPointsEl.textContent = points;
        // Show congratulatory message
        alert(t('rewards_mubarak'));
        fetchAndDisplayTracker();
      });
    });
  });
}

// When switching to tracker section, refresh data
navBtns[3].addEventListener('click', fetchAndDisplayTracker);
// On login, also fetch tracker
onAuthStateChanged(auth, user => { if (user) fetchAndDisplayTracker(); });

// --- Notification Bell (Browser Notification) ---
const bellBtns = document.querySelectorAll('.bell-btn');
bellBtns.forEach((btn, i) => {
  btn.onclick = e => {
    e.stopPropagation();
    Notification.requestPermission().then(perm => {
      if (perm === 'granted') {
        alert(`You will be notified for ${prayersWithTahajjud[i].name}`);
      }
    });
  };
});


// --- Mark as Prayed Button Logic ---
const markPrayerBtn = document.getElementById('mark-prayer-btn');
const markMissedBtn = document.getElementById('mark-missed-btn');

// --- Mark as Prayed/Missed Button Logic ---
let currentActivePrayer = null;

function updateMarkPrayerBtn() {
  if (!prayersWithTahajjud.length) {
    markPrayerBtn.style.display = 'none';
    markMissedBtn.style.display = 'none';
    prayerStatusLabel.textContent = '';
    return;
  }
  const now = new Date();
  let activeIndex = -1;
  for (let i = 0; i < prayersWithTahajjud.length; i++) {
    const pTimeStr = prayersWithTahajjud[i]?.time;
    if (!pTimeStr) continue;
    const [h, m] = pTimeStr.split(':').map(Number);
    const prayerTime = new Date(now);
    prayerTime.setHours(h, m, 0, 0);
    if (prayerTime > now) {
      activeIndex = (i - 1 + prayersWithTahajjud.length) % prayersWithTahajjud.length;
      break;
    }
  }
  if (activeIndex === -1) activeIndex = prayersWithTahajjud.length - 1;
  currentActivePrayer = prayersWithTahajjud[activeIndex].name;
  if (!currentActivePrayer) return;
  const user = auth.currentUser;
  if (!user) {
    markPrayerBtn.style.display = 'none';
    markMissedBtn.style.display = 'none';
    prayerStatusLabel.textContent = '';
    return;
  }
  const today = getTodayDateString();

  // Check Local Cache First
  const userLogs = PersistentCache.get(`logs_${user.uid}`) || {};
  const localStatus = userLogs[today] ? userLogs[today][currentActivePrayer] : null;

  const applyStatus = (status) => {
    if (status) {
      markPrayerBtn.style.display = 'none';
      markMissedBtn.style.display = 'none';
      if (status === 'prayed') {
        prayerStatusLabel.innerHTML = `${t('marked_prayed')} <img src="assets/tick.png" style="width:20px; vertical-align:middle;">`;
        prayerStatusLabel.style.color = '#6ee7b7';
      } else if (status === 'missed') {
        prayerStatusLabel.innerHTML = `${t('marked_missed')} ❌`;
        prayerStatusLabel.style.color = '#ff6b6b';
      } else {
        prayerStatusLabel.textContent = '';
      }
    } else {
      markPrayerBtn.style.display = '';
      markMissedBtn.style.display = '';
      markPrayerBtn.textContent = t('mark_as_prayed').replace('{0}', t(currentActivePrayer));
      markMissedBtn.textContent = t('mark_as_missed').replace('{0}', t(currentActivePrayer));
      markPrayerBtn.disabled = false;
      markMissedBtn.disabled = false;
      prayerStatusLabel.textContent = '';
    }
  };

  applyStatus(localStatus);

  // Still fetch from DB if online to ensure consistency
  if (navigator.onLine) {
    get(ref(db, `users/${user.uid}/logs/${today}/${currentActivePrayer}`)).then(snap => {
      if (snap.exists()) {
        const dbStatus = snap.val();
        if (dbStatus !== localStatus) {
          applyStatus(dbStatus);
          // Update cache if DB is different
          if (!userLogs[today]) userLogs[today] = {};
          userLogs[today][currentActivePrayer] = dbStatus;
          PersistentCache.set(`logs_${user.uid}`, userLogs);
        }
      }
    });
  }
}

// CRITICAL FIX: Store interval ID and clean up properly
let markPrayerInterval = null;

function startMarkPrayerMonitoring() {
  if (markPrayerInterval) clearInterval(markPrayerInterval);
  markPrayerInterval = setInterval(updateMarkPrayerBtn, 5000);
  updateMarkPrayerBtn(); // Initial call
}

startMarkPrayerMonitoring();

markPrayerBtn.onclick = () => {
  if (currentActivePrayer) logPrayerStatus(currentActivePrayer, 'prayed');
  markPrayerBtn.style.display = 'none';
  markMissedBtn.style.display = 'none';
};
markMissedBtn.onclick = () => {
  if (currentActivePrayer) logPrayerStatus(currentActivePrayer, 'missed');
  markPrayerBtn.style.display = 'none';
  markMissedBtn.style.display = 'none';
};



// --- Quran Audio Section Logic (multi-para support) ---
const quranAudioList = document.getElementById('quran-audio-list');
const quranAudioSource = document.getElementById('quran-audio-source');
const quranAudioPlayer = document.getElementById('quran-audio-player');
const quranXpProgress = document.getElementById('quran-xp-progress');
let lastQuranPos = 0;
let lastQuranXp = 0;
let quranXpInterval = null;

// List of available Para files (update this array if you add/remove files)
const QURAN_PARAS = [
  { file: "Quran para's urdu/para_1.mp3", label: 'Para 1 - Urdu translation' },
  { file: "Quran para's urdu/para_2.mp3", label: 'Para 2 - Urdu translation' },
  { file: "Quran para's urdu/para_3.mp3", label: 'Para 3 - Urdu translation' },
  { file: "Quran para's urdu/para_4.mp3", label: 'Para 4 - Urdu translation' },
  { file: "Quran para's urdu/para_5.mp3", label: 'Para 5 - Urdu translation' },
  { file: "Quran para's urdu/para_6.mp3", label: 'Para 6 - Urdu translation' },
  { file: "Quran para's urdu/para_7.mp3", label: 'Para 1 - Urdu translation' },
  { file: "Quran para's urdu/para_8.mp3", label: 'Para 1 - Urdu translation' },
  { file: "Quran para's urdu/para_9.mp3", label: 'Para 9 - Urdu translation' },
  { file: "Quran para's urdu/para_10.mp3", label: 'Para 10 - Urdu translation' },
  { file: "Quran para's urdu/para_11.mp3", label: 'Para 11 - Urdu translation' },
  { file: "Quran para's urdu/para_12.mp3", label: 'Para 12 - Urdu translation' },
  { file: "Quran para's urdu/para_13.mp3", label: 'Para 13 - Urdu translation' },
  { file: "Quran para's urdu/para_14.mp3", label: 'Para 14 - Urdu translation' },
  { file: "Quran para's urdu/para_15.mp3", label: 'Para 15 - Urdu translation' },
  { file: "Quran para's urdu/para_16.mp3", label: 'Para 16 - Urdu translation' },
  { file: "Quran para's urdu/para_17.mp3", label: 'Para 17 - Urdu translation' },
  { file: "Quran para's urdu/para_18.mp3", label: 'Para 18 - Urdu translation' },
  { file: "Quran para's urdu/para_19.mp3", label: 'Para 19 - Urdu translation' },
  { file: "Quran para's urdu/para_20.mp3", label: 'Para 20 - Urdu translation' },
  { file: "Quran para's urdu/para_21.mp3", label: 'Para 21 - Urdu translation' },
  { file: "Quran para's urdu/para_22.mp3", label: 'Para 22 - Urdu translation' },
  { file: "Quran para's urdu/para_23.mp3", label: 'Para 23 - Urdu translation' },
  { file: "Quran para's urdu/para_24.mp3", label: 'Para 24 - Urdu translation' },
  { file: "Quran para's urdu/para_25.mp3", label: 'Para 25 - Urdu translation' },
  { file: "Quran para's urdu/para_26.mp3", label: 'Para 26 - Urdu translation' },
  { file: "Quran para's urdu/para_27.mp3", label: 'Para 27 - Urdu translation' },
  { file: "Quran para's urdu/para_28.mp3", label: 'Para 28 - Urdu translation' },
  { file: "Quran para's urdu/para_29.mp3", label: 'Para 29 - Urdu translation' },
  { file: "Quran para's urdu/para_30.mp3", label: 'Para 30 - Urdu translation' },
];

let currentQuranPara = QURAN_PARAS[0].file;
let currentQuranParaLabel = QURAN_PARAS[0].label;

function renderQuranAudioList() {
  quranAudioList.innerHTML = '';
  QURAN_PARAS.forEach((para, idx) => {
    const btn = document.createElement('button');
    btn.className = 'thirty-day-btn';
    btn.style.marginBottom = '8px';
    btn.style.width = '100%';
    btn.textContent = para.label;
    btn.onclick = () => {
      // Collapse any open player
      document.querySelectorAll('.quran-audio-expand').forEach(div => {
        div.style.maxHeight = '0px';
        setTimeout(() => div.remove(), 300);
      });
      // Create expandable div
      const expandDiv = document.createElement('div');
      expandDiv.className = 'quran-audio-expand';
      expandDiv.style.overflow = 'hidden';
      expandDiv.style.transition = 'max-height 0.3s cubic-bezier(0.4,0,0.2,1)';
      expandDiv.style.maxHeight = '0px';
      expandDiv.style.background = 'rgba(52,211,153,0.08)';
      expandDiv.style.borderRadius = '16px';
      expandDiv.style.margin = '8px 0 16px 0';
      expandDiv.style.padding = '0 8px';
      // Move player and XP progress into this div
      expandDiv.appendChild(quranAudioPlayer);
      expandDiv.appendChild(quranXpProgress);
      btn.after(expandDiv);
      setTimeout(() => {
        expandDiv.style.maxHeight = '300px';
      }, 10);
      currentQuranPara = para.file;
      currentQuranParaLabel = para.label;
      quranAudioSource.src = encodeURI(para.file);
      quranAudioPlayer.load();
      loadQuranAudioProgress();
      quranAudioPlayer.play();
      highlightCurrentPara();
    };
    btn.id = 'quran-audio-btn-' + (idx + 1);
    quranAudioList.appendChild(btn);
  });
}
function highlightCurrentPara() {
  QURAN_PARAS.forEach((_, idx) => {
    const btn = document.getElementById('quran-audio-btn-' + (idx + 1));
    if (btn) btn.style.background = (QURAN_PARAS[idx].file === currentQuranPara) ? '#6ee7b7' : '';
    if (btn) btn.style.color = (QURAN_PARAS[idx].file === currentQuranPara) ? '#222' : '';
  });
}
renderQuranAudioList();
quranAudioSource.src = currentQuranPara;
quranAudioPlayer.load();

// Resume from last position per Para
function loadQuranAudioProgress() {
  const user = auth.currentUser;
  if (!user) return;
  get(ref(db, `users/${user.uid}/quranAudio/${btoa(currentQuranPara)}`)).then(snap => {
    const data = snap.val() || {};
    lastQuranPos = data.position || 0;
    lastQuranXp = data.xp || 0;
    quranAudioPlayer.currentTime = lastQuranPos;
    quranXpProgress.textContent = `${currentQuranParaLabel}: XP ${lastQuranXp}`;
  });
}
// Save position and XP per Para
function saveQuranAudioProgress(pos, xp) {
  const user = auth.currentUser;
  if (!user) return;
  set(ref(db, `users/${user.uid}/quranAudio/${btoa(currentQuranPara)}`), { position: pos, xp: xp });
}
// XP gain logic per Para
quranAudioPlayer.addEventListener('play', () => {
  clearInterval(quranXpInterval);
  quranXpInterval = setInterval(() => {
    const user = auth.currentUser;
    if (!user) return;
    lastQuranPos = quranAudioPlayer.currentTime;
    // Every 10s, +1 XP
    if (Math.floor(quranAudioPlayer.currentTime) % 10 === 0) {
      lastQuranXp++;
      quranXpProgress.textContent = `${currentQuranParaLabel}: XP ${lastQuranXp}`;
      // Add to global XP/level as well
      get(ref(db, `users/${user.uid}/xp`)).then(snap => {
        let xp = snap.exists() ? snap.val() : 0;
        xp++;
        set(ref(db, `users/${user.uid}/xp`), xp);
      });
    }
    saveQuranAudioProgress(lastQuranPos, lastQuranXp);
  }, 1000);
});
quranAudioPlayer.addEventListener('pause', () => {
  clearInterval(quranXpInterval);
  saveQuranAudioProgress(quranAudioPlayer.currentTime, lastQuranXp);
});
quranAudioPlayer.addEventListener('ended', () => {
  clearInterval(quranXpInterval);
  saveQuranAudioProgress(quranAudioPlayer.duration, lastQuranXp);
});

onAuthStateChanged(auth, user => {
  if (user) loadQuranAudioProgress();
});

// --- Good Deed Cards Logic ---
const goodDeedBtn = document.getElementById('good-deed-btn');
const goodDeedModal = document.getElementById('good-deed-modal');
const goodDeedModalClose = document.getElementById('good-deed-modal-close');
const goodDeedCardTitle = document.getElementById('good-deed-card-title');
const goodDeedCardDesc = document.getElementById('good-deed-card-desc');
const goodDeedCompleteBtn = document.getElementById('good-deed-complete-btn');
const goodDeedReflection = document.getElementById('good-deed-reflection');
const goodDeedSaveReflection = document.getElementById('good-deed-save-reflection');

const GOOD_DEED_CARDS = [
  { key: 'deed_1' },
  { key: 'deed_2' },
  { key: 'deed_3' },
  { key: 'deed_4' },
  { key: 'deed_5' },
  { key: 'deed_6' },
  { key: 'deed_7' },
  { key: 'deed_8' },
  { key: 'deed_9' },
  { key: 'deed_10' }
];

goodDeedBtn.onclick = async () => {
  const user = auth.currentUser;
  if (!user) return;
  const rewardsSnap = await get(ref(db, `users/${user.uid}/rewards`));
  const rewards = rewardsSnap.exists() ? rewardsSnap.val() : 0;
  const unlockedCount = getUnlockedGoodDeedCount(rewards);
  let cycleSnap = await get(ref(db, `users/${user.uid}/goodDeedCycle`));
  let cycle = cycleSnap.exists() ? cycleSnap.val() : 1;
  let deedsSnap = await get(ref(db, `users/${user.uid}/goodDeeds`));
  userGoodDeeds = deedsSnap.exists() ? deedsSnap.val() : [];

  if (userGoodDeeds.length === GOOD_DEED_CARDS.length && userGoodDeeds.every(d => d.completed)) {
    cycle++;
    await set(ref(db, `users/${user.uid}/goodDeedCycle`), cycle);
    const shuffled = shuffleArray([...Array(GOOD_DEED_CARDS.length).keys()]);
    userGoodDeeds = shuffled.map(idx => ({ index: idx, completed: false, reflection: '' }));
    await set(ref(db, `users/${user.uid}/goodDeeds`), userGoodDeeds);
  }

  if (unlockedCount === 0) {
    goodDeedCardTitle.textContent = userLanguage === 'en' ? 'No Good Deeds Yet' : 'Abhi koi naiki nahi';
    goodDeedCardDesc.textContent = userLanguage === 'en' ? 'Earn 100 rewards to unlock your first card!' : 'Pehli naiki unlock karne ke liye 100 rewards hasil karein!';
    goodDeedCompleteBtn.style.display = 'none';
    goodDeedReflection.value = '';
    goodDeedReflection.style.display = 'none';
    goodDeedSaveReflection.style.display = 'none';
    goodDeedModal.style.display = 'flex';
    return;
  }

  let idx = userGoodDeeds.findIndex(d => !d.completed);
  if (idx === -1) idx = userGoodDeeds.length - 1;

  if (userGoodDeeds.length < unlockedCount) {
    const available = [...Array(GOOD_DEED_CARDS.length).keys()].filter(i => !userGoodDeeds.some(d => d.index === i));
    const randomIdx = available[Math.floor(Math.random() * available.length)];
    userGoodDeeds.push({ index: randomIdx, completed: false, reflection: '' });
    await set(ref(db, `users/${user.uid}/goodDeeds`), userGoodDeeds);
    idx = userGoodDeeds.length - 1;
  }
  currentGoodDeedIndex = userGoodDeeds[idx].index;
  const cardKey = GOOD_DEED_CARDS[currentGoodDeedIndex].key;
  goodDeedCardTitle.textContent = t(`${cardKey}_title`);
  goodDeedCardDesc.textContent = t(`${cardKey}_desc`);
  goodDeedCompleteBtn.style.display = userGoodDeeds[idx].completed ? 'none' : '';
  goodDeedReflection.value = userGoodDeeds[idx].reflection || '';
  goodDeedReflection.style.display = '';
  goodDeedSaveReflection.style.display = '';
  goodDeedModal.style.display = 'flex';
};

goodDeedModalClose.onclick = () => {
  goodDeedModal.style.display = 'none';
};

goodDeedCompleteBtn.onclick = async () => {
  const user = auth.currentUser;
  if (!user) return;
  const deedsSnap = await get(ref(db, `users/${user.uid}/goodDeeds`));
  userGoodDeeds = deedsSnap.exists() ? deedsSnap.val() : [];
  const idx = userGoodDeeds.findIndex(d => d.index === currentGoodDeedIndex);
  if (idx !== -1) {
    userGoodDeeds[idx].completed = true;
    set(ref(db, `users/${user.uid}/goodDeeds`), userGoodDeeds);
    showToast('MashaAllah! Good deed completed! 🌟', '#6ee7b7');
    goodDeedCompleteBtn.style.display = 'none';
  }
};

goodDeedSaveReflection.onclick = async () => {
  const user = auth.currentUser;
  if (!user) return;
  const deedsSnap = await get(ref(db, `users/${user.uid}/goodDeeds`));
  userGoodDeeds = deedsSnap.exists() ? deedsSnap.val() : [];
  const idx = userGoodDeeds.findIndex(d => d.index === currentGoodDeedIndex);
  if (idx !== -1) {
    userGoodDeeds[idx].reflection = goodDeedReflection.value;
    set(ref(db, `users/${user.uid}/goodDeeds`), userGoodDeeds);
    showToast('Reflection saved!', '#6ee7b7');
  }
};

// --- Donate Section Logic ---
const donateSection = document.getElementById('donate-section');
// Logic moved to new section (Line 3079)

// Nav: replace mosque with donate section
navBtns[1].onclick = () => showSection('donate');

// Get current week string (e.g., 2024-W23)
function getCurrentWeek() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${weekNo}`;
}

// Update donation status, streak, badges
async function updateDonateStatus() {
  const user = auth.currentUser;
  if (!user) return;
  const week = getCurrentWeek();
  const snap = await get(ref(db, `users/${user.uid}/donations`));
  // Legacy Donation Logic Removed: Replaced with Claim System (Line 3079)
}

onAuthStateChanged(auth, user => {
  if (user) {
    updateDonateStatus();
    loadDonationStreak();
  }
});

// --- Donation Proofs Gallery in User App ---
const donateProofsGallery = document.createElement('div');
donateProofsGallery.id = 'donate-proofs-gallery';
donateProofsGallery.style.marginTop = '18px';
donateProofsGallery.style.textAlign = 'left';
if (donateSection) donateSection.appendChild(donateProofsGallery);

async function loadDonationProofsGallery() {
  if (!donateProofsGallery) return;
  donateProofsGallery.innerHTML = '<b>Recent Donation Proofs:</b><br><div style="margin-top:10px;">Loading...</div>';
  const snap = await get(ref(db, 'donationProofs'));
  const proofs = snap.exists() ? snap.val() : {};
  let html = '';
  const keys = Object.keys(proofs).sort((a, b) => proofs[b].timestamp - proofs[a].timestamp);
  for (const k of keys) {
    const p = proofs[k];
    html += `<div style="background:#222c;padding:12px 10px;border-radius:12px;margin-bottom:14px;max-width:340px;box-shadow:0 2px 12px #0002;">
      <img src="${p.url}" alt="proof" style="max-width:100%;border-radius:8px;margin-bottom:8px;" />
      <div style="font-size:1.05em;margin-bottom:4px;">${p.desc}</div>
      <div style="font-size:0.95em;color:#aaa;">${new Date(p.timestamp).toLocaleString()}</div>
    </div>`;
  }
  donateProofsGallery.innerHTML = '<b>Recent Donation Proofs:</b>' + (html || '<div style="margin-top:10px;color:#aaa;">No proofs uploaded yet.</div>');
}
// Load proofs when donation section is shown
const donateTabBtn = document.querySelector('.bottom-nav .nav-btn:nth-child(2)');
donateTabBtn.onclick = () => { showSection('donate'); loadDonationProofsGallery(); };

// --- App Notification Popup Logic ---
const appNotifModal = document.getElementById('app-notif-modal');
const appNotifTitle = document.getElementById('app-notif-title');
const appNotifBody = document.getElementById('app-notif-body');
const appNotifClose = document.getElementById('app-notif-close');

function showAppNotification(title, body) {
  appNotifTitle.textContent = title;
  appNotifBody.textContent = body;
  appNotifModal.style.display = 'flex';
}
appNotifClose.onclick = () => {
  appNotifModal.style.display = 'none';
};

async function checkForAppNotification() {
  try {
    const snap = await get(ref(db, 'notifications/latest'));
    if (!snap.exists()) return;
    const notif = snap.val();
    const seenKey = 'notif_seen_' + notif.timestamp;
    if (!localStorage.getItem(seenKey)) {
      showAppNotification(notif.title, notif.body);
      localStorage.setItem(seenKey, '1');
    }
  } catch (err) {
    console.warn("[Notifications] System not configured or permission denied.");
  }
}

// (FCM v1 logic is at the top of the file)


// Consolidated Auth Listener at line 421


// --- Mood-Based Quran Logic (Dil Ki Dawa) ---
const moodVerseArabic = document.getElementById('mood-verse-arabic');
const moodVerseUrdu = document.getElementById('mood-verse-urdu');
const moodVerseRef = document.getElementById('mood-verse-ref');
const moodResult = document.getElementById('mood-result');

const MOOD_VERSES = {
  sad: [
    { ar: "لَا تَحْزَنْ إِنَّ اللَّهَ مَعَنَا", ur: "Gham na karo, beshak Allah hamare saath hai.", ref: "Surah At-Tawbah 9:40" },
    { ar: "وَلَسَوْفَ يُعْطِيكَ رَبُّكَ فَتَرْضَىٰ", ur: "Aur anqareeb tumhara Rab tumhein itna dega ke tum khush ho jaoge.", ref: "Surah Ad-Duha 93:5" },
    { ar: "إِنَّ مَعَ الْعُسْرِ يُسْرًا", ur: "Beshak mushkil ke saath aasani hai.", ref: "Surah Ash-Sharh 94:6" }
  ],
  anxious: [
    { ar: "أَلَا بِذِكْرِ اللَّهِ تَطْمَئِنُّ الْقُلُوبُ", ur: "Khabardaar! Allah ke zikr hi se dilon ko sukoon milta hai.", ref: "Surah Ar-Ra'd 13:28" },
    { ar: "فَإِنِّي قَرِيبٌ ۖ أُجِيبُ دَعْوَةَ الدَّاعِ", ur: "Main qareeb hoon, pukaarne wale ki pukaar sunta hoon.", ref: "Surah Al-Baqarah 2:186" },
    { ar: "حَسْبُنَا اللَّهُ وَنِعْمَ الْوَكِيلُ", ur: "Hamein Allah kafi hai aur woh behtareen kar-saaz hai.", ref: "Surah Ali 'Imran 3:173" }
  ],
  happy: [
    { ar: "لَئِن شَكَرْتُمْ لَأَزِيدَنَّكُمْ", ur: "Agar tum shukar karoge to main tumhein aur zyada doonga.", ref: "Surah Ibrahim 14:7" },
    { ar: "فَبِأَيِّ آلَاءِ رَبِّكُمَا تُكَذِّبَانِ", ur: "Tum apne Rab ki kaun kaun si naimaton ko jhutlaoge?", ref: "Surah Ar-Rahman 55:13" }
  ],
  angry: [
    { ar: "وَالْكَاظِمِينَ الْغَيْظَ وَالْعَافِينَ عَنِ النَّاسِ", ur: "Aur gussay ko peene walay aur logon ko maaf karne walay (Allah ko pasand hain).", ref: "Surah Ali 'Imran 3:134" },
    { ar: "ادْفَعْ بِالَّتِي هِيَ أَحْسَنُ", ur: "Burai ka jawab achai se do.", ref: "Surah Fussilat 41:34" }
  ],
  lazy: [
    { ar: "وَأَن لَّيْسَ لِلْإِنسَانِ إِلَّا مَا سَعَىٰ", ur: "Aur insaan ke liye wahi kuch hai jiski usne koshish ki.", ref: "Surah An-Najm 53:39" },
    { ar: "فَإِذَا عَزَمْتَ فَتَوَكَّلْ عَلَى اللَّهِ", ur: "Phir jab tum irada kar lo to Allah par bharosa karo.", ref: "Surah Ali 'Imran 3:159" }
  ],
  lonely: [
    { ar: "وَنَحْنُ أَقْرَبُ إِلَيْهِ مِنْ حَبْلِ الْوَرِيدِ", ur: "Aur hum uski shah-rag se bhi zyada qareeb hain.", ref: "Surah Qaf 50:16" },
    { ar: "إِنَّ رَبِّي لَسَمِيعُ الدُّعَاءِ", ur: "Beshak mera Rab dua sunne wala hai.", ref: "Surah Ibrahim 14:39" }
  ]
};

document.querySelectorAll('.mood-btn').forEach(btn => {
  btn.onclick = () => {
    const mood = btn.dataset.mood;
    const verses = MOOD_VERSES[mood];
    const randomVerse = verses[Math.floor(Math.random() * verses.length)];

    moodVerseArabic.textContent = randomVerse.ar;
    moodVerseUrdu.textContent = randomVerse.ur;
    moodVerseRef.textContent = randomVerse.ref;

    moodResult.style.display = 'block';
    moodResult.scrollIntoView({ behavior: 'smooth' });
  };
});

// --- Qaza-e-Umri Tracker Logic ---
const qazaSetupView = document.getElementById('qaza-setup-view');
const qazaTrackerView = document.getElementById('qaza-tracker-view');
const qazaYearsInput = document.getElementById('qaza-years-input');
const qazaCalcBtn = document.getElementById('qaza-calc-btn');
const qazaResetBtn = document.getElementById('qaza-reset-btn');

async function renderQazaTracker() {
  const user = auth.currentUser;
  if (!user) return;
  const setupSnap = await get(ref(db, `users/${user.uid}/qaza/setup`));
  const isSetup = setupSnap.exists() ? setupSnap.val() : false;

  if (!isSetup) {
    qazaSetupView.style.display = 'block';
    qazaTrackerView.style.display = 'none';
  } else {
    qazaSetupView.style.display = 'none';
    qazaTrackerView.style.display = 'block';
    // Fetch counts
    const countsSnap = await get(ref(db, `users/${user.uid}/qaza/counts`));
    const counts = countsSnap.exists() ? countsSnap.val() : {};
    ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha', 'Witr'].forEach(p => {
      const el = document.getElementById(`qaza-count-${p.toLowerCase()}`);
      if (el) el.textContent = counts[p] || 0;
    });
  }
}

qazaCalcBtn.onclick = async () => {
  const user = auth.currentUser;
  if (!user) return alert('Please login first.');
  const years = parseFloat(qazaYearsInput.value);
  if (!years || years <= 0) return alert('Please enter valid years.');

  const days = Math.ceil(years * 365);
  const counts = {
    Fajr: days, Dhuhr: days, Asr: days, Maghrib: days, Isha: days, Witr: days
  };

  await set(ref(db, `users/${user.uid}/qaza/counts`), counts);
  await set(ref(db, `users/${user.uid}/qaza/setup`), true);
  renderQazaTracker();
  showToast('Qaza tracking started!', '#6ee7b7');
};

document.querySelectorAll('.qaza-minus-btn').forEach(btn => {
  btn.onclick = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const prayer = btn.dataset.prayer;
    const countEl = document.getElementById(`qaza-count-${prayer.toLowerCase()}`);
    let current = parseInt(countEl.textContent);
    if (current > 0) {
      current--;
      countEl.textContent = current;
      await set(ref(db, `users/${user.uid}/qaza/counts/${prayer}`), current);
      showToast(`${prayer} Qaza marked! Keep going! 🤲`, '#6ee7b7');
    } else {
      showToast('All Qaza completed for ' + prayer + '! Mubarak!', '#6ee7b7');
    }
  };
});

qazaResetBtn.onclick = async () => {
  if (!confirm('Are you sure you want to reset your Qaza counters?')) return;
  const user = auth.currentUser;
  if (!user) return;
  await set(ref(db, `users/${user.uid}/qaza/setup`), false);
  await set(ref(db, `users/${user.uid}/qaza/counts`), null);
  renderQazaTracker();
};

// Update More button to also load Qaza data (and reset view)
navBtns[4].onclick = () => {
  showSection('more');
  closeSubFeature(); // Always start at menu
  if (auth.currentUser) renderQazaTracker();
};

// --- More Section Navigation Logic ---
window.openSubFeature = (feature) => {
  document.getElementById('more-features-menu').style.display = 'none';
  document.querySelectorAll('.sub-feature-view').forEach(el => el.style.display = 'none');
  const target = document.getElementById('feature-' + feature);
  if (target) {
    target.style.display = 'block';
    target.scrollIntoView({ behavior: 'smooth' });
  }
};

window.closeSubFeature = () => {
  document.querySelectorAll('.sub-feature-view').forEach(el => el.style.display = 'none');
  document.getElementById('more-features-menu').style.display = 'block';
};

// --- Jannat ka Darakht (Deeds Tree) Logic ---
const treeLeavesGroup = document.getElementById('tree-leaves');
const treeTrunk = document.getElementById('tree-trunk');
const treeBranches = document.getElementById('tree-branches');
const treeHealthText = document.getElementById('tree-health-text');
const treeStatusMsg = document.getElementById('tree-status-msg');

async function calculateTreeHealth() {
  const user = auth.currentUser;
  if (!user) return 50; // Default

  // 1. Prayers (Last 7 Days)
  let prayerScore = 0;
  const today = new Date();
  const logsSnap = await get(ref(db, `users/${user.uid}/logs`));
  const logs = logsSnap.exists() ? logsSnap.val() : {};

  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayLog = logs[dateStr] || {};
    ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].forEach(p => {
      if (dayLog[p] === 'prayed') prayerScore += 2;
      else if (dayLog[p] === 'missed') prayerScore -= 5;
    });
  }

  // 2. Good Deeds Check
  const deedsSnap = await get(ref(db, `users/${user.uid}/goodDeeds`));
  const deeds = deedsSnap.exists() ? deedsSnap.val() : [];
  const completedDeeds = deeds.filter(d => d.completed).length;
  const deedScore = Math.min(completedDeeds, 20); // Cap at 20

  // 3. Quran XP
  const xpSnap = await get(ref(db, `users/${user.uid}/xp`));
  const xp = xpSnap.exists() ? xpSnap.val() : 0;
  const xpScore = Math.min(Math.floor(xp / 10), 20); // 1 point per 10 XP, Cap at 20

  // Base 50
  let health = 50 + prayerScore + deedScore + xpScore;
  if (health < 0) health = 0;
  if (health > 100) health = 100;
  return health;
}

async function renderTree() {
  const health = await calculateTreeHealth();
  treeHealthText.textContent = `${t('tree_health')}: ${health}%`;

  // Status Message
  if (health < 20) {
    treeStatusMsg.textContent = t('tree_status_1');
    treeStatusMsg.style.color = "#fbbf24";
  } else if (health < 50) {
    treeStatusMsg.textContent = t('tree_status_2');
    treeStatusMsg.style.color = "#fcd34d";
  } else if (health < 80) {
    treeStatusMsg.textContent = t('tree_status_3');
    treeStatusMsg.style.color = "#6ee7b7";
  } else {
    treeStatusMsg.textContent = t('tree_status_4');
    treeStatusMsg.style.color = "#34d399";
  }

  // Visuals
  treeLeavesGroup.innerHTML = ''; // Clear leaves

  // Trunk & Branches
  if (health < 20) {
    treeTrunk.setAttribute('fill', '#5a3a22'); // Dead brown
    treeBranches.style.display = 'block'; // Bare branches
  } else {
    treeTrunk.setAttribute('fill', '#78350f'); // Healthy brown
    treeBranches.style.display = 'block';
  }

  // Generate Leaves
  if (health >= 20) {
    const leafCount = Math.floor((health - 15) * 1.5); // More health = more leaves
    for (let i = 0; i < leafCount; i++) {
      const cx = 100 + (Math.random() - 0.5) * 120 * (health / 100); // Spread based on health
      const cy = 150 - (Math.random() * 120 * (health / 100));
      const r = 5 + Math.random() * 5;

      const leaf = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      leaf.setAttribute("cx", cx);
      leaf.setAttribute("cy", cy);
      leaf.setAttribute("r", r);
      // Color variation
      const green = 100 + Math.random() * 155;
      leaf.setAttribute("fill", `rgba(50, ${green}, 50, 0.8)`);

      // Animation
      leaf.innerHTML = `
        <animate attributeName="r" values="${r};${r + 1};${r}" dur="${2 + Math.random()}s" repeatCount="indefinite" />
      `;

      treeLeavesGroup.appendChild(leaf);
    }
  }

  // Flower/Fruit if Healthy
  if (health >= 80) {
    for (let i = 0; i < 5; i++) {
      const cx = 80 + Math.random() * 40;
      const cy = 60 + Math.random() * 60;
      const fruit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      fruit.setAttribute("cx", cx);
      fruit.setAttribute("cy", cy);
      fruit.setAttribute("r", 4);
      fruit.setAttribute("fill", "#fbbf24"); // Gold fruit
      fruit.setAttribute("filter", "drop-shadow(0 0 4px gold)");
      treeLeavesGroup.appendChild(fruit);
    }
  }
}

// Hook into openSubFeature to render features
const originalOpenSubFeature = window.openSubFeature;
window.openSubFeature = (feature) => {
  originalOpenSubFeature(feature);
  if (feature === 'tree' && auth.currentUser) {
    renderTree();
  }
  if (feature === 'twins' && auth.currentUser) {
    checkTwinsStatus();
  }
  if (feature === 'series') {
    renderSeriesList();
  }
  if (feature === 'halaqa' && auth.currentUser) {
    checkHalaqaStatus();
  }
  if (feature === 'durood' && auth.currentUser) {
    initDuroodFeature();
  }
};

// --- Halaqa Circles Logic ---
const halaqaCreateBtn = document.getElementById('halaqa-create-btn');
const halaqaJoinBtn = document.getElementById('halaqa-join-btn');
const halaqaJoinInputContainer = document.getElementById('halaqa-join-input-container');
const halaqaCodeInput = document.getElementById('halaqa-code-input');
const halaqaSubmitJoin = document.getElementById('halaqa-submit-join');
const halaqaLobby = document.getElementById('halaqa-lobby');
const halaqaActive = document.getElementById('halaqa-active');
const halaqaLeaveBtn = document.getElementById('halaqa-leave-btn');

halaqaCreateBtn.onclick = async () => {
  const name = prompt("Enter Circle Name:");
  if (!name) return;
  const user = auth.currentUser;
  if (!user) return;

  // Generate distinct 6-digit code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const circleId = `halaqa_${code}`;

  const circleData = {
    name: name,
    code: code,
    admin: user.uid,
    createdAt: Date.now(),
    members: { [user.uid]: true }
  };

  try {
    await set(ref(db, `circles/${circleId}`), circleData);
    await update(ref(db, `users/${user.uid}`), { circleId: circleId });
    showToast("Circle Created Successfully! 🎉", "#6ee7b7");
    checkHalaqaStatus();
  } catch (e) {
    showToast("Error creating circle.", "#ff6b6b");
  }
};

halaqaJoinBtn.onclick = () => {
  halaqaJoinInputContainer.style.display = 'block';
};

halaqaSubmitJoin.onclick = async () => {
  const code = halaqaCodeInput.value.trim();
  if (code.length !== 6) {
    showToast("Invalid Code", "#ff6b6b");
    return;
  }
  const user = auth.currentUser;
  const circleId = `halaqa_${code}`;

  const snap = await get(ref(db, `circles/${circleId}`));
  if (snap.exists()) {
    await update(ref(db, `circles/${circleId}/members`), { [user.uid]: true });
    await update(ref(db, `users/${user.uid}`), { circleId: circleId });
    showToast("Joined Circle! 🤝", "#6ee7b7");
    checkHalaqaStatus();
  } else {
    showToast("Circle not found.", "#ff6b6b");
  }
};

halaqaLeaveBtn.onclick = async () => {
  if (!confirm("Are you sure you want to leave this circle?")) return;
  const user = auth.currentUser;
  const snap = await get(ref(db, `users/${user.uid}/circleId`));
  const circleId = snap.val();

  if (circleId) {
    await set(ref(db, `circles/${circleId}/members/${user.uid}`), null); // Remove member correctly
    await update(ref(db, `users/${user.uid}`), { circleId: null });
    showToast("Left Circle.", "#94a3b8");
    checkHalaqaStatus();
  }
};

async function checkHalaqaStatus() {
  const user = auth.currentUser;
  const snap = await get(ref(db, `users/${user.uid}/circleId`));
  const circleId = snap.val();

  if (circleId) {
    halaqaLobby.style.display = 'none';
    halaqaActive.style.display = 'block';
    loadHalaqaData(circleId);
  } else {
    // Cleanup chat if moving to lobby
    if (currentChatUnsubscribe) {
      currentChatUnsubscribe();
      currentChatUnsubscribe = null;
    }
    halaqaLobby.style.display = 'block';
    halaqaActive.style.display = 'none';
    halaqaJoinInputContainer.style.display = 'none'; // reset
  }
}

async function loadHalaqaData(circleId) {
  const snap = await get(ref(db, `circles/${circleId}`));
  if (!snap.exists()) return;
  const data = snap.val();

  document.getElementById('halaqa-name').textContent = data.name;
  const codeDisplay = document.getElementById('halaqa-code-display');
  codeDisplay.textContent = data.code;
  codeDisplay.onclick = () => {
    navigator.clipboard.writeText(data.code);
    showToast("Code Copied!", "#6ee7b7");
  };

  const memberIds = Object.keys(data.members || {});
  document.getElementById('halaqa-member-count').textContent = `${memberIds.length} Members`;

  renderHalaqaLeaderboard(memberIds, data.admin);

  // Start Chat Listener
  listenToChat(circleId);

  // Setup Chat Send Button
  const sendBtn = document.getElementById('halaqa-chat-send-btn');
  const chatInput = document.getElementById('halaqa-chat-input');

  // Remove old listener to prevent duplicates
  const newSendBtn = sendBtn.cloneNode(true);
  sendBtn.parentNode.replaceChild(newSendBtn, sendBtn);

  newSendBtn.onclick = () => sendMessage(circleId, chatInput.value, memberIds, data.name);
  chatInput.onkeypress = (e) => {
    if (e.key === 'Enter') sendMessage(circleId, chatInput.value, memberIds, data.name);
  };
}

// --- Chat Logic ---
// Global variable for chat listener cleanup
let currentChatUnsubscribe = null;

function listenToChat(circleId) {
  // Cleanup previous listener
  if (currentChatUnsubscribe) {
    currentChatUnsubscribe();
    currentChatUnsubscribe = null;
  }

  const chatContainer = document.getElementById('halaqa-chat-messages');
  // Use limitToLast to avoid loading all history
  const messagesRef = query(ref(db, `circles/${circleId}/messages`), orderByKey(), limitToLast(50));

  currentChatUnsubscribe = onValue(messagesRef, (snap) => {
    try {
      chatContainer.innerHTML = '';

      if (!snap.exists()) {
        chatContainer.innerHTML = '<div style="text-align:center;color:#64748b;font-size:0.9em;margin-top:20px;">No messages yet. Say Salam! 👋</div>';
        return;
      }

      const val = snap.val();
      const msgs = [];
      snap.forEach(child => {
        msgs.push(child.val());
      });

      msgs.forEach(msg => {
        const isMe = (auth.currentUser && msg.senderId === auth.currentUser.uid);
        const div = document.createElement('div');
        div.className = `chat-msg ${isMe ? 'me' : 'others'}`;

        const senderName = document.createElement('div');
        senderName.className = 'chat-sender-name';
        senderName.textContent = isMe ? 'You' : msg.senderName;

        const textDiv = document.createElement('div');
        textDiv.textContent = msg.text;

        const timeDiv = document.createElement('div');
        timeDiv.className = 'chat-time';
        timeDiv.textContent = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        div.appendChild(senderName);
        div.appendChild(textDiv);
        div.appendChild(timeDiv);
        chatContainer.appendChild(div);
      });

      // Scroll to bottom
      chatContainer.scrollTop = chatContainer.scrollHeight;
    } catch (err) {
      console.error("[Chat] Error rendering messages:", err);
    }
  });
}

// --- Global Durood Counter Logic ---
let duroodSessionCount = 0;
let duroodUserTotal = 0;
let duroodGlobalUnsubscribe = null;

function startGlobalDuroodSync() {
  // To keep connections free for 1M users, we stop live listening.
  // We use 10-minute polling instead of permanent sockets.
  if (duroodGlobalUnsubscribe) {
    if (typeof duroodGlobalUnsubscribe === 'function') duroodGlobalUnsubscribe();
    else clearInterval(duroodGlobalUnsubscribe);
    duroodGlobalUnsubscribe = null;
  }

  const fetchGlobal = async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const snap = await get(ref(db, 'global/duroodCount'));
      const count = snap.val() || 0;
      const formattedCount = count.toLocaleString();
      const featureEl = document.getElementById('durood-global-count');
      if (featureEl) {
        featureEl.textContent = formattedCount;
      }
      const homeEl = document.getElementById('home-durood-value');
      if (homeEl) homeEl.textContent = formattedCount;

      const moreEl = document.getElementById('more-durood-count');
      if (moreEl) moreEl.textContent = formattedCount;
    } catch (err) { }
  };

  fetchGlobal();

  // CRITICAL FIX: Clear old interval before creating new one
  if (duroodGlobalUnsubscribe) clearInterval(duroodGlobalUnsubscribe);
  duroodGlobalUnsubscribe = setInterval(fetchGlobal, 600000);
}

function initDuroodFeature() {
  const user = auth.currentUser;
  if (!user) return;

  // Reset session
  duroodSessionCount = 0;
  document.getElementById('durood-session-count').textContent = '0';

  // Load User Stats
  get(ref(db, `users/${user.uid}/durood`)).then(snap => {
    const data = snap.val() || { total: 0, lastRead: null };
    duroodUserTotal = data.total || 0;
    document.getElementById('durood-user-total').textContent = duroodUserTotal.toLocaleString();
    const lastReadEl = document.getElementById('durood-last-read');
    if (data.lastRead) {
      const d = new Date(data.lastRead);
      lastReadEl.textContent = d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
      lastReadEl.textContent = 'Never';
    }
  });

  // Ensure global listener is active (fallback if it didn't start)
  if (!duroodGlobalUnsubscribe) startGlobalDuroodSync();

  // Read Button Handle
  const readBtn = document.getElementById('durood-read-btn');
  if (readBtn) {
    readBtn.onclick = () => {
      duroodSessionCount++;
      duroodUserTotal++;

      // Optimistic UI Update (Immediate)
      document.getElementById('durood-session-count').textContent = duroodSessionCount.toLocaleString();
      document.getElementById('durood-user-total').textContent = duroodUserTotal.toLocaleString();
      document.getElementById('durood-last-read').textContent = "Just now";

      const globalEl = document.getElementById('durood-global-count');
      if (globalEl) {
        // Parse current global, increment, and show immediately
        let currentGlobal = parseInt(globalEl.textContent.replace(/,/g, '')) || 0;
        globalEl.textContent = (currentGlobal + 1).toLocaleString();
      }

      // Haptic feedback
      if (window.navigator.vibrate) window.navigator.vibrate(20);

      // DB Update: Atomic Global Increment (Background)
      runTransaction(ref(db, 'global/duroodCount'), (current) => {
        return (current || 0) + 1;
      }).catch(e => console.warn("Global sync lag (benign)", e));

      // DB Update: User Total
      update(ref(db, `users/${user.uid}/durood`), {
        total: duroodUserTotal,
        lastRead: Date.now()
      });

      // Extra visual juice
      if (duroodSessionCount % 33 === 0) {
        if (typeof triggerConfetti === 'function') triggerConfetti();
        showToast("SubhanAllah! Keep going! ✨", "#6ee7b7");
      }
    };
  }

  // Handle Durood Type Change
  const typeSelect = document.getElementById('durood-type-select');
  const textEl = document.getElementById('durood-text-container');
  const transEl = document.getElementById('durood-trans-container');
  const refBtn = document.getElementById('durood-ref-btn');

  const getDuroodData = () => {
    const s = translations[userLanguage];
    return {
      short: {
        arabic: "اَللّٰھُمَّ صَلِّ عَلٰی مُحَمَّدٍ وَّعَلٰی اٰلِ مُحَمَّدٍ",
        trans: '"O Allah, send blessings upon Muhammad and the family of Muhammad."'
      },
      ibrahim: {
        arabic: s.durood_ibrahim_ar,
        refKey: "ref_ibrahim"
      },
      nahariya: {
        arabic: s.durood_nahariya_ar,
        refKey: "ref_nahariya"
      },
      fath: {
        arabic: s.durood_fatih_ar,
        refKey: "ref_fatih"
      },
      shafii: {
        arabic: s.durood_shafii_ar,
        refKey: "ref_shafii"
      },
      dawaami: {
        arabic: s.durood_dawaami_ar,
        refKey: "ref_dawaami"
      }
    };
  };

  // Expose for Modal
  window.showDuroodRef = () => {
    const val = typeSelect.value;
    const data = getDuroodData()[val];
    if (data && data.refKey) {
      const modal = document.getElementById('durood-ref-modal');
      const content = document.getElementById('durood-ref-content');
      if (modal && content) {
        content.textContent = translations[userLanguage][data.refKey];
        modal.style.display = 'flex';
      }
    }
  };
  window.closeDuroodRef = () => {
    const modal = document.getElementById('durood-ref-modal');
    if (modal) modal.style.display = 'none';
  };

  if (typeSelect) {
    typeSelect.onchange = (e) => {
      const val = e.target.value;
      const data = getDuroodData()[val];
      if (data) {
        textEl.style.opacity = '0';
        transEl.style.opacity = '0';
        if (refBtn) refBtn.style.display = 'none';

        setTimeout(() => {
          textEl.textContent = data.arabic;
          if (data.trans) {
            transEl.textContent = data.trans;
            transEl.style.display = 'block';
            transEl.style.opacity = '1';
          } else {
            transEl.style.display = 'none';
          }

          if (data.refKey && refBtn) {
            refBtn.style.display = 'inline-block';
          }

          textEl.style.opacity = '1';
          textEl.style.transition = 'opacity 0.3s';
          if (data.trans) transEl.style.transition = 'opacity 0.3s';
        }, 300);
      }
    };
  }
}

async function sendMessage(circleId, text, memberIds, circleName) {
  if (!text || !text.trim()) return;
  const user = auth.currentUser;

  const msgData = {
    senderId: user.uid,
    senderName: user.displayName || "Member",
    text: text.trim(),
    timestamp: Date.now()
  };

  try {
    await push(ref(db, `circles/${circleId}/messages`), msgData);
    document.getElementById('halaqa-chat-input').value = '';
  } catch (err) {
    console.error("Chat Send Error:", err);
    showToast("Failed to send. Are you in the circle?", "#ff6b6b");
    return;
  }

  // --- Notify Other Members ---
  memberIds.forEach(targetUid => {
    if (targetUid === user.uid) return; // Don't notify self

    // Throttle notifications? Maybe for now send all.
    get(ref(db, `users/${targetUid}/fcmToken`)).then(snap => {
      if (snap.exists()) {
        sendFCMNotificationv1(
          snap.val(),
          `New Message in ${circleName} 💬`,
          `${user.displayName || 'Someone'}: ${text.substring(0, 30)}...`,
          "default"
        );
      }
    });
  });
}

// --- Leaderboard & Admin Logic ---
async function renderHalaqaLeaderboard(memberIds, adminId) {
  const listEl = document.getElementById('halaqa-leaderboard');
  listEl.innerHTML = '<div style="color:#94a3b8;text-align:center;">Loading stats...</div>';
  const currentUid = auth.currentUser.uid;
  const isAdmin = (currentUid === adminId);

  // Calculate Start of Week (Monday)
  const today = new Date();
  const day = today.getDay(); // 0 (Sun) - 6 (Sat)
  const diff = today.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Monday start
  const monday = new Date(today.setDate(diff));
  const dateKeys = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dateKeys.push(getTodayDateString(d));
  }

  const membersData = [];

  for (const uid of memberIds) {
    // Parallel fetch profile + logs
    const [profileSnap, logsSnap] = await Promise.all([
      get(ref(db, `users/${uid}`)),
      get(ref(db, `users/${uid}/logs`))
    ]);

    const profile = profileSnap.val() || {};
    const logs = logsSnap.val() || {};

    let weeklyPrayers = 0;
    dateKeys.forEach(date => {
      if (logs[date]) {
        const p = logs[date];
        ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].forEach(namaz => {
          if (p[namaz] === 'prayed') weeklyPrayers++;
        });
      }
    });

    membersData.push({
      uid,
      name: profile.displayName || "Unknown",
      score: weeklyPrayers
    });
  }

  // Sort by Score Descending
  membersData.sort((a, b) => b.score - a.score);

  listEl.innerHTML = '';
  membersData.forEach((m, index) => {
    const isMe = (m.uid === currentUid);
    let rankEmoji = `#${index + 1}`;
    if (index === 0) rankEmoji = '🥇';
    if (index === 1) rankEmoji = '🥈';
    if (index === 2) rankEmoji = '🥉';

    const div = document.createElement('div');
    div.className = 'halaqa-leaderboard-item';
    if (isMe) div.style.borderColor = '#6ee7b7';

    let actionButtons = '';
    if (!isMe) {
      actionButtons += `<button onclick="nudgeMember('${m.uid}')" class="nudge-btn">🔔 Nudge</button>`;
      // Add Kick Button if I am Admin
      if (isAdmin) {
        actionButtons += `<button onclick="kickMember('${m.uid}')" class="kick-btn" title="Kick Member">🗑️</button>`;
      }
    }

    div.innerHTML = `
      <div style="display:flex;align-items:center;">
        <span class="rank-badge">${rankEmoji}</span>
        <div>
           <div style="font-weight:600;color:${isMe ? '#6ee7b7' : '#e2e8f0'}">${m.name} ${isMe ? '(You)' : ''}</div>
           <div style="font-size:0.8em;color:#94a3b8;">${m.score} Prayers</div>
        </div>
      </div>
      <div>
         ${actionButtons}
      </div>
    `;
    listEl.appendChild(div);
  });
}

window.kickMember = async (targetUid) => {
  if (!confirm("Are you sure you want to remove this member?")) return;

  // Admin check is implicitly done by UI visibility, but security rules should handle backend.
  // Ideally, we re-check `circles/{id}/admin` here, but for now client-side logic:

  const user = auth.currentUser;
  const snap = await get(ref(db, `users/${user.uid}/circleId`));
  const circleId = snap.val();

  if (circleId) {
    await set(ref(db, `circles/${circleId}/members/${targetUid}`), null);
    await update(ref(db, `users/${targetUid}`), { circleId: null });
    showToast("Member Removed.", "#ff6b6b");
    // UI updates automatically via listeners? No, loadHalaqaData is manual refresh mostly unless we add listeners for members too.
    // Ideally we should reload data.
    loadHalaqaData(circleId);
  }
};

window.nudgeMember = (targetUid) => {
  // Check throttle (1 nudge per hour?)
  const lastNudge = localStorage.getItem(`nudge_${targetUid}`);
  if (lastNudge && (Date.now() - lastNudge < 3600000)) {
    showToast("Wait before nudging again!", "#f59e0b");
    return;
  }

  // Send FCM
  get(ref(db, `users/${targetUid}/fcmToken`)).then(snap => {
    if (snap.exists()) {
      sendFCMNotificationv1(
        snap.val(),
        "Halaqa Nudge! 🔔",
        "Your circle member is reminding you to pray! Don't give up!",
        "reminder_tone"
      );
      showToast("Nudge Sent!", "#6ee7b7");
      localStorage.setItem(`nudge_${targetUid}`, Date.now());
    } else {
      showToast("User offline (No Token)", "#94a3b8");
    }
  });
};

// --- End of Legacy Series Segment ---

// --- Deen Twins (Salah Partner) Logic ---
const twinsLobby = document.getElementById('twins-lobby');
const twinsActive = document.getElementById('twins-active');
const twinsChoiceUI = document.getElementById('twins-choice-ui');
const twinsWaitingUI = document.getElementById('twins-waiting-ui');
const twinsGlobalLoading = document.getElementById('twins-global-loading');
const twinsPrivateCodeDisplay = document.getElementById('twins-private-code-display');
const twinsMyCodeEl = document.getElementById('twins-my-code');
const partnerNameEl = document.getElementById('partner-name');
const partnerAvatarEl = document.getElementById('partner-avatar');
const partnerStatusEl = document.getElementById('partner-status');
const twinsNudgeBtn = document.getElementById('twins-nudge-btn');
const twinsLeaveBtn = document.getElementById('twins-leave-btn');
const twinsProgress = document.getElementById('twins-progress');
const twinsTodayStatus = document.getElementById('twins-today-status');

// New Buttons
const twinsMatchGlobalBtn = document.getElementById('twins-match-global-btn');
const twinsInviteFriendBtn = document.getElementById('twins-invite-friend-btn');
const twinsJoinSubmitBtn = document.getElementById('twins-join-submit-btn');
const twinsCancelMatchBtn = document.getElementById('twins-cancel-match-btn');

let twinsUnsubscribe = null;

async function checkTwinsStatus() {
  const user = auth.currentUser;
  if (!user) return;
  // Listen to user's twins node
  const twinsRef = ref(db, `users/${user.uid}/twins`);
  if (twinsUnsubscribe) twinsUnsubscribe();

  twinsUnsubscribe = onValue(twinsRef, async (snap) => {
    const data = snap.val();

    // Auto Popup Logic (Simplified)
    const hasSkipped = localStorage.getItem('skipPartner');
    if (!data && !hasSkipped) {
      const packet = document.getElementById('modal-partner-invite');
      if (packet && packet.style.display !== 'flex') {
        packet.style.display = 'flex';
      }
    }

    if (data && data.pairId) {
      // --- STATE 1: PAIRED ---
      subscribeToPair(data.pairId, user.uid);
      syncHistoricalLogsToPair(data.pairId, user.uid);

      if (twinsLobby) twinsLobby.style.display = 'none';
      if (twinsActive) twinsActive.style.display = 'block';

    } else if (data && (data.inLobby || data.inPrivateLobby)) {
      // --- STATE 2: WAITING ---
      document.getElementById('home-partner-widget').style.display = 'none';
      if (twinsLobby) twinsLobby.style.display = 'block';
      if (twinsActive) twinsActive.style.display = 'none';

      if (twinsChoiceUI) twinsChoiceUI.style.display = 'none';
      if (twinsWaitingUI) twinsWaitingUI.style.display = 'block';

      if (data.inLobby) {
        if (twinsGlobalLoading) twinsGlobalLoading.style.display = 'block';
        if (twinsPrivateCodeDisplay) twinsPrivateCodeDisplay.style.display = 'none';
      } else {
        if (twinsGlobalLoading) twinsGlobalLoading.style.display = 'none';
        if (twinsPrivateCodeDisplay) {
          twinsPrivateCodeDisplay.style.display = 'block';
          if (twinsMyCodeEl) twinsMyCodeEl.textContent = data.code;
        }
      }
    } else {
      // --- STATE 3: NOTHING / NEW ---
      document.getElementById('home-partner-widget').style.display = 'none';
      if (twinsLobby) twinsLobby.style.display = 'block';
      if (twinsActive) twinsActive.style.display = 'none';

      if (twinsChoiceUI) twinsChoiceUI.style.display = 'block';
      if (twinsWaitingUI) twinsWaitingUI.style.display = 'none';
    }
  });
}

// --- Matchmaking Buttons ---

if (twinsMatchGlobalBtn) {
  twinsMatchGlobalBtn.onclick = async () => {
    const user = auth.currentUser;
    if (!user) return showToast("Login first", "#ff6b6b");

    try {
      showToast("Searching for partner... 🌍", "#6ee7b7");

      // 1. ATOMIC MATCHMAKING using runTransaction
      let partnerData = null;
      let partnerUid = null;

      await runTransaction(ref(db, 'lobby'), (currentLobby) => {
        if (!currentLobby) {
          // Lobby empty, add self
          return {
            [user.uid]: {
              name: (userDisplayName || user.email.split('@')[0]),
              avatar: '🧑🏽',
              joinedAt: Date.now()
            }
          };
        }

        const partnerId = Object.keys(currentLobby).find(id => id !== user.uid);
        if (partnerId) {
          // Partner available! Take them and remove from lobby
          partnerUid = partnerId;
          partnerData = currentLobby[partnerId];
          delete currentLobby[partnerId];
          return currentLobby;
        } else {
          // No partner, add self
          currentLobby[user.uid] = {
            name: (userDisplayName || user.email.split('@')[0]),
            avatar: '🧑🏽',
            joinedAt: Date.now()
          };
          return currentLobby;
        }
      });

      if (partnerUid) {
        // MATCH FOUND
        const pairId = 'pair_' + Date.now();
        const pairData = {
          user1: partnerUid,
          user2: user.uid,
          streak: 0,
          startedAt: Date.now(),
          [partnerUid]: partnerData || { name: 'Partner', avatar: '👤' },
          [user.uid]: { name: (userDisplayName || user.email.split('@')[0]), avatar: '🧑🏽' }
        };

        await set(ref(db, `pairs/${pairId}`), pairData);
        await set(ref(db, `users/${partnerUid}/twins`), { pairId: pairId });
        await set(ref(db, `users/${user.uid}/twins`), { pairId: pairId });
        showToast("Partner Found! 🤝", "#6ee7b7");
      } else {
        // JOINED LOBBY (Transaction already added us)
        await set(ref(db, `users/${user.uid}/twins`), { inLobby: true });
        showToast("Request Saved! You will be paired soon.", "#6ee7b7");
      }
    } catch (e) {
      console.error(e);
      showToast("Matchmaking failed", "#ff6b6b");
    }
  };
}

if (twinsInviteFriendBtn) {
  twinsInviteFriendBtn.onclick = async () => {
    const user = auth.currentUser;
    if (!user) return;

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    try {
      const lobbyRef = ref(db, `privateLobby/${code}`);
      await set(lobbyRef, {
        uid: user.uid,
        name: (userDisplayName || user.email.split('@')[0]),
        avatar: '🧑🏽',
        timestamp: Date.now(),
        pairId: null // Placeholder for joiner
      });

      await set(ref(db, `users/${user.uid}/twins`), { inPrivateLobby: true, code: code });
      showToast("Code Generated! Share with a friend.", "#6ee7b7");

      // UPGRADE: Listen for someone joining this code
      onValue(lobbyRef, async (snap) => {
        const data = snap.val();
        if (data && data.pairId) {
          // Someone joined! Update own profile to trigger switching to Active Pair View
          await set(ref(db, `users/${user.uid}/twins`), { pairId: data.pairId });
          // Cleanup lobby entry
          set(lobbyRef, null);
        }
      }, { onlyOnce: false });

    } catch (e) {
      showToast("Failed to generate code", "#ff6b6b");
    }
  };
}

if (twinsJoinSubmitBtn) {
  twinsJoinSubmitBtn.onclick = async () => {
    const user = auth.currentUser;
    const code = document.getElementById('twins-join-code-input').value.trim();
    if (code.length !== 6) return showToast("Enter a 6-digit code", "#ff6b6b");

    try {
      const lobbyRef = ref(db, `privateLobby/${code}`);
      const snap = await get(lobbyRef);
      if (!snap.exists()) return showToast("Invalid or expired code", "#ff6b6b");

      const hostData = snap.val();
      if (hostData.pairId) return showToast("This code is already being used", "#ff6b6b");
      if (hostData.uid === user.uid) return showToast("You cannot join your own code", "#ff6b6b");

      // Create Pair
      const pairId = 'pair_private_' + code;
      const pairData = {
        user1: hostData.uid,
        user2: user.uid,
        streak: 0,
        startedAt: Date.now(),
        [hostData.uid]: { name: hostData.name, avatar: hostData.avatar },
        [user.uid]: { name: (userDisplayName || user.email.split('@')[0]), avatar: '🧑🏽' }
      };

      // 1. Create the pair node (accessible by both)
      await set(ref(db, `pairs/${pairId}`), pairData);

      // 2. Notify Host by updating the lobby entry (Host is listening)
      await update(lobbyRef, { pairId: pairId });

      // 3. Update own profile (Self write - allowed by standard rules)
      await set(ref(db, `users/${user.uid}/twins`), { pairId: pairId });

      showToast("Connected with your friend! 🤝", "#6ee7b7");
    } catch (e) {
      console.error("[Twins Join Error]", e);
      showToast("Join failed. Check your internet.", "#ff6b6b");
    }
  };
}

if (twinsCancelMatchBtn) {
  twinsCancelMatchBtn.onclick = async () => {
    const user = auth.currentUser;
    const snap = await get(ref(db, `users/${user.uid}/twins`));
    const data = snap.val();

    if (data && data.code) {
      await set(ref(db, `privateLobby/${data.code}`), null);
    }
    await set(ref(db, `lobby/${user.uid}`), null);
    await set(ref(db, `users/${user.uid}/twins`), null);
    showToast("Request Cancelled", "#94a3b8");
  };
}

// --- Event Listeners for Dynamic UI (Restored) ---
const homePartnerWidget = document.getElementById('home-partner-widget');
const btnModalFind = document.getElementById('btn-modal-find-partner');
const btnModalNotNow = document.getElementById('btn-modal-not-now');

if (homePartnerWidget) {
  homePartnerWidget.onclick = () => {
    showSection('more');
    setTimeout(() => {
      if (typeof window.openSubFeature === 'function') window.openSubFeature('twins');
    }, 100);
  };
}

if (btnModalFind) {
  btnModalFind.onclick = () => {
    document.getElementById('modal-partner-invite').style.display = 'none';
    showSection('more');
    setTimeout(() => {
      if (typeof window.openSubFeature === 'function') window.openSubFeature('twins');
    }, 100);
  };
}

if (btnModalNotNow) {
  btnModalNotNow.onclick = () => {
    document.getElementById('modal-partner-invite').style.display = 'none';
    localStorage.setItem('skipPartner', 'true');
  };
}

twinsNudgeBtn.onclick = async () => {
  if (twinsNudgeBtn.disabled) return; // Prevent double clicks
  twinsNudgeBtn.disabled = true;
  setTimeout(() => { twinsNudgeBtn.disabled = false; }, 5000); // Re-enable after 5s

  const user = auth.currentUser;
  if (!user) return;
  // Get pairId
  const snap = await get(ref(db, `users/${user.uid}/twins/pairId`));
  const pairId = snap.val();
  if (!pairId) return;

  // Find partner UID from pair
  const pairSnap = await get(ref(db, `pairs/${pairId}`));
  const pairData = pairSnap.val();
  const partnerId = (pairData.user1 === user.uid) ? pairData.user2 : pairData.user1;

  // 1. Write Nudge to DB (for potential in-app listening)
  await set(ref(db, `pairs/${pairId}/nudge`), {
    from: user.uid,
    to: partnerId,
    timestamp: Date.now()
  });

  twinsNudgeBtn.classList.add('shake');
  showToast("Buzz sent! 🔔", "#f59e0b");

  // 2. Send Real Push Notification via FCM v1
  get(ref(db, `users/${partnerId}/fcmToken`)).then(snap => {
    const partnerToken = snap.val();
    if (partnerToken) {
      sendFCMNotificationv1(
        partnerToken,
        "Nudge from Partner! 🔔",
        `${auth.currentUser.email.split('@')[0]} wants to remind you about prayer.`,
        'reminder_tone'
      );
    }
  });
};

twinsLeaveBtn.onclick = async () => {
  if (!confirm("Are you sure? This will end the partnership.")) return;
  const user = auth.currentUser;
  const snap = await get(ref(db, `users/${user.uid}/twins/pairId`));
  const pairId = snap.val();

  await set(ref(db, `users/${user.uid}/twins`), null);
  if (pairId) {
    // Ideally notify partner or delete pair. For now just delete pair
    await set(ref(db, `pairs/${pairId}`), null);
  }
  // Also check lobby
  await set(ref(db, `lobby/${user.uid}`), null);

  checkTwinsStatus();
};

// --- Missing Helper Functions Restored ---

// Helper to get current prayer name based on system time and stored prayer times
function getCurrentPrayerContext() {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // Use the global array populated by fetchPrayerTimes
  if (!prayersWithTahajjud || prayersWithTahajjud.length === 0) return 'Fajr';

  function toMins(t) {
    if (!t) return 0;
    return parseInt(t.split(':')[0]) * 60 + parseInt(t.split(':')[1]);
  }

  // Iterate backwards to find the latest prayer that has started
  // Array order: Tahajjud, Fajr, Dhuhr, Asr, Maghrib, Isha
  for (let i = prayersWithTahajjud.length - 1; i >= 0; i--) {
    const p = prayersWithTahajjud[i];
    if (currentMinutes >= toMins(p.time)) {
      return p.name;
    }
  }
  return 'Isha'; // Fallback
}

// Helper for Home Widget
function updateHomeWidget(name, avatar, statusText, statusColor) {
  const w = document.getElementById('home-partner-widget');
  const n = document.getElementById('hp-name');
  const a = document.getElementById('hp-avatar');
  const s = document.getElementById('hp-status');
  if (!w || !n || !a || !s) return;
  w.style.display = 'block';
  n.textContent = name;
  a.textContent = avatar;
  s.innerHTML = statusText;
  s.style.color = statusColor;
}

// Helper to backfill logs to pair status (Robust: Today + Yesterday)
async function syncHistoricalLogsToPair(pairId, uid) {
  const today = getTodayDateString();
  await checkAndSync(pairId, uid, today);

  // Check YESTERDAY too (Handle UTC/Local boundary issues or "last night's Isha")
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yester = getTodayDateString(y);
  await checkAndSync(pairId, uid, yester);
}

async function checkAndSync(pairId, uid, dateKey) {
  const logsSnap = await get(ref(db, `users/${uid}/logs/${dateKey}`));
  if (logsSnap.exists()) {
    const logs = logsSnap.val();
    const updates = {};
    for (const [prayer, status] of Object.entries(logs)) {
      if (status === 'prayed') {
        updates[prayer] = true;
      }
    }
    if (Object.keys(updates).length > 0) {
      // Merge into dailyStatus with DATE KEY
      update(ref(db, `pairs/${pairId}/dailyStatus/${dateKey}/${uid}`), updates);
    }
  }
}

// --- Fixed: Subscribe to Pair with Date-Aware Logic ---
function subscribeToPair(pairId, myUid) {
  const pairRef = ref(db, `pairs/${pairId}`);
  onValue(pairRef, (snap) => {
    const pairData = snap.val();
    if (!pairData) {
      set(ref(db, `users/${myUid}/twins`), null);
      return;
    }

    let partnerId = (pairData.user1 === myUid) ? pairData.user2 : pairData.user1;
    const partnerData = pairData[partnerId] || { name: 'Partner', avatar: '👤' };

    if (partnerNameEl) partnerNameEl.textContent = partnerData.name;
    if (partnerAvatarEl) partnerAvatarEl.textContent = partnerData.avatar;

    const streak = pairData.streak || 0;

    // --- Combined Progress Logic (Instant Feedback) ---
    const progressToday = getTodayDateString();
    let myCount = 0;
    let pCount = 0;
    const prayersToCheck = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

    if (pairData.dailyStatus && pairData.dailyStatus[progressToday]) {
      const myLog = pairData.dailyStatus[progressToday][myUid] || {};
      const pLog = pairData.dailyStatus[progressToday][partnerId] || {};

      prayersToCheck.forEach(p => {
        if (myLog[p] === 'prayed' || myLog[p] === true) myCount++;
        if (pLog[p] === 'prayed' || pLog[p] === true) pCount++;
      });
    }

    // Progress is based on total prayers done by both. 
    // Each prayer is 1/10th of a day's contribution to the bar.
    const dailyCompletion = (myCount + pCount) / 10;
    const fractionalStreak = streak + dailyCompletion;
    const widthPercent = Math.min((fractionalStreak / 7) * 100, 100);

    console.log(`[Twins] Me: ${myCount}/5, Partner: ${pCount}/5, Streak: ${streak}, Width: ${widthPercent.toFixed(1)}%`);

    if (twinsProgress) twinsProgress.style.width = widthPercent + '%';

    if (twinsTodayStatus) {
      const sharedCount = prayersToCheck.filter(p => {
        const myLog = (pairData.dailyStatus?.[progressToday]?.[myUid] || {});
        const pLog = (pairData.dailyStatus?.[progressToday]?.[partnerId] || {});
        return (myLog[p] === 'prayed' || myLog[p] === true) && (pLog[p] === 'prayed' || pLog[p] === true);
      }).length;

      twinsTodayStatus.textContent = `${sharedCount}/5 Together`;
      if (sharedCount === 5) {
        twinsTodayStatus.style.color = '#6ee7b7';
        twinsTodayStatus.textContent = "Goal Achieved! 🏆";
      }
      else twinsTodayStatus.style.color = '#fcd34d';
    }

    // Check Status for CURRENT Prayer (Date Aware)
    const currentPrayer = getCurrentPrayerContext();

    // Look into dailyStatus/progressToday/partnerUID/prayerName
    const pStatus = (pairData.dailyStatus &&
      pairData.dailyStatus[progressToday] &&
      pairData.dailyStatus[progressToday][partnerId] &&
      pairData.dailyStatus[progressToday][partnerId][currentPrayer]);

    let widgetText = "";
    let widgetColor = "";

    if (pStatus === 'prayed' || pStatus === true) { // Handle legacy true or new 'prayed'
      if (partnerStatusEl) {
        partnerStatusEl.innerHTML = `${t('partner_prayed')} ${currentPrayer} <img src="assets/tick.png" style="width:20px; vertical-align:middle;">`;
        partnerStatusEl.style.color = "#6ee7b7";
      }
      widgetText = `${partnerData.name} prayed ${currentPrayer} <img src="assets/tick.png" style="width:18px; vertical-align:middle;">`;
      widgetColor = "#6ee7b7";
    } else if (pStatus === 'missed') {
      if (partnerStatusEl) {
        partnerStatusEl.innerHTML = `Status: Missed ${currentPrayer} ❌`;
        partnerStatusEl.style.color = "#ff6b6b"; // Red
      }
      widgetText = `${partnerData.name} missed ${currentPrayer} ❌`;
      widgetColor = "#ff6b6b";
    } else {
      if (partnerStatusEl) {
        partnerStatusEl.innerHTML = `Status: Hasn't prayed ${currentPrayer} yet ⏳`;
        partnerStatusEl.style.color = "#fcd34d";
      }
      widgetText = `Waiting for ${partnerData.name} (${currentPrayer}) ⏳`;
      widgetColor = "#fcd34d";
    }

    // Update Home Widget
    updateHomeWidget(partnerData.name, partnerData.avatar, widgetText, widgetColor);

    if (twinsTodayStatus) twinsTodayStatus.textContent = "Current Goal: " + currentPrayer;

    if (pairData.nudge && pairData.nudge.to === myUid && pairData.nudge.timestamp > Date.now() - 5000) {
      showToast("Partner is nudging you! 🔔", "#f59e0b");
    }
  });
}

// Start listening on load
listenToGlobalCounts();

// --- User Onboarding Logic ---
async function checkOnboardingStatus(uid, userData = null) {
  let isComplete = false;

  if (userData) {
    isComplete = userData.onboardingCompleted;
  } else {
    // Fallback if data not passed
    const snap = await get(ref(db, `users/${uid}/onboardingCompleted`));
    isComplete = snap.val();
  }

  if (!isComplete) {
    console.log("[Onboarding] Starting for user:", uid);
    const modal = document.getElementById('onboarding-modal');
    if (modal) {
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }

    // ALWAYS show Step 0 (Language) first if onboarding is not complete
    // This ensures new users get to pick their preferred lang even if browser has a default
    document.querySelectorAll('.onboarding-step').forEach(s => s.style.display = 'none');
    const stepLang = document.getElementById('onboarding-step-lang');
    if (stepLang) stepLang.style.display = 'flex';
  }
}

// Language Picker Listeners
document.querySelectorAll('.lang-select-btn').forEach(btn => {
  btn.onclick = () => {
    const lang = btn.getAttribute('data-lang');
    console.log("[Onboarding] Language selected:", lang);
    translateApp(lang, true);

    // Also save to user profile in background if logged in
    const user = auth.currentUser;
    if (user) {
      update(ref(db, `users/${user.uid}`), { language: lang });
    }

    // Move to Step 1 (Welcome)
    document.getElementById('onboarding-step-lang').style.display = 'none';
    document.getElementById('onboarding-step-1').style.display = 'flex';
  };
});

// Wizard Event Listeners
const btnOnboardingPermit = document.getElementById('btn-onboarding-permit');
const btnOnboardingFinish = document.getElementById('btn-onboarding-finish');

if (btnOnboardingPermit) {
  btnOnboardingPermit.onclick = async () => {
    // Request Permission
    try {
      await requestNotificationPermission();
    } catch (e) {
      console.log("Perm error", e);
    }

    // Move to next step automatically
    const step1 = document.getElementById('onboarding-step-1');
    const step2 = document.getElementById('onboarding-step-2');
    if (step1) step1.style.display = 'none';
    if (step2) step2.style.display = 'flex';
  };
}

if (btnOnboardingFinish) {
  btnOnboardingFinish.onclick = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const sleepTime = document.getElementById('input-sleep-time').value;
    const strugglePrayer = document.getElementById('input-struggle-prayer').value;

    // Save Preference
    await update(ref(db, `users/${user.uid}`), {
      onboardingCompleted: true,
      sleepTime: sleepTime,
      strugglePrayer: strugglePrayer
    });

    const modal = document.getElementById('onboarding-modal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';

    showToast("Welcome to the family! 💚", "success");
    fetchPrayerTimes(currentDate); // Refresh times in case lang/location changed
  };
}

// --- Settings Modal Interaction Logic ---
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const settingsLogoutBtn = document.getElementById('settings-logout-btn');

if (settingsBtn) {
  settingsBtn.onclick = async () => {
    const user = auth.currentUser;
    if (!user) return;

    settingsModal.style.display = 'flex';

    const snap = await get(ref(db, `users/${user.uid}`));
    const data = snap.val() || {};

    document.getElementById('settings-display-name').value = data.displayName || user.email.split('@')[0];
    document.getElementById('settings-sleep-time').value = data.sleepTime || "22:00";
    document.getElementById('settings-struggle-prayer').value = data.strugglePrayer || "Fajr";
    document.getElementById('settings-calc-method').value = data.calcMethod || 2;
    document.getElementById('settings-language').value = localStorage.getItem('userLanguage') || 'ur';

    // Load Location Mode
    const modeSelect = document.getElementById('settings-location-mode');
    if (modeSelect) {
      modeSelect.value = locationMode;
      document.getElementById('manual-location-row').style.display = (locationMode === 'manual') ? 'flex' : 'none';
    }
    updateLocationUI();

    const off = data.prayerOffsets || {};
    ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].forEach(p => {
      const input = document.getElementById(`offset-${p}`);
      if (input) input.value = off[p] || 0;
    });
  };
}

if (closeSettingsBtn) {
  closeSettingsBtn.onclick = () => {
    settingsModal.style.display = 'none';
  };
}

if (saveSettingsBtn) {
  saveSettingsBtn.onclick = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const newName = document.getElementById('settings-display-name').value;
    const newSleep = document.getElementById('settings-sleep-time').value;
    const newStruggle = document.getElementById('settings-struggle-prayer').value;
    const newCalcMethod = parseInt(document.getElementById('settings-calc-method').value) || 2;
    const newLang = document.getElementById('settings-language').value;

    const newOffsets = {};
    ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].forEach(p => {
      newOffsets[p] = parseInt(document.getElementById(`offset-${p}`).value) || 0;
    });

    try {
      await update(ref(db, `users/${user.uid}`), {
        displayName: newName,
        sleepTime: newSleep,
        strugglePrayer: newStruggle,
        calcMethod: newCalcMethod,
        prayerOffsets: newOffsets,
        language: newLang,
        locationMode: document.getElementById('settings-location-mode').value
      });

      locationMode = document.getElementById('settings-location-mode').value;
      localStorage.setItem('locationMode', locationMode);

      userCalcMethod = newCalcMethod;
      userOffsets = newOffsets;
      userDisplayName = newName;
      userStrugglePrayer = newStruggle;
      translateApp(newLang, true); // Update immediately and save to localStorage
      fetchPrayerTimes(currentDate, true);

      settingsModal.style.display = 'none';
      showToast("Settings Saved!", "success");
    } catch (err) {
      handleApiError("Settings Save", err);
    }
  };
}

// Add Location Management Listeners
document.getElementById('settings-location-mode').onchange = (e) => {
  const mode = e.target.value;
  document.getElementById('manual-location-row').style.display = (mode === 'manual') ? 'flex' : 'none';
};

document.getElementById('location-search-btn').onclick = () => {
  const query = document.getElementById('location-search-input').value.trim();
  searchLocation(query);
};

document.getElementById('location-search-input').onkeypress = (e) => {
  if (e.key === 'Enter') {
    searchLocation(e.target.value.trim());
  }
};

// Global Exports for HTML onclicks
window.openLocationSearch = openLocationSearch;
window.showGpsHelp = showGpsHelp;
window.requestNotificationPermission = requestNotificationPermission;



if (settingsLogoutBtn) {
  settingsLogoutBtn.onclick = async () => {
    try {
      await window.FirebaseExports.signOut(auth);
      settingsModal.style.display = 'none';
    } catch (e) { }
  };
}

// =============================================================================
// 7. COMMUNITY FEATURES (UPDATES & EXPORT)
// =============================================================================

// --- Community Updates & Export Logic ---
async function checkAppUpdates() {
  try {
    const newsSnap = await get(ref(db, 'app'));
    if (!newsSnap.exists()) return;

    const { news, newsVersion } = newsSnap.val();
    const localNewsVersion = localStorage.getItem('lastNewsVersion') || "0";

    if (news && newsVersion && localNewsVersion !== newsVersion.toString()) {
      const newsModal = document.getElementById('news-modal');
      const newsContent = document.getElementById('news-content');
      if (!newsModal || !newsContent) return;

      newsContent.innerHTML = news;
      newsModal.style.display = 'flex';

      document.getElementById('close-news-btn').onclick = () => {
        newsModal.style.display = 'none';
        localStorage.setItem('lastNewsVersion', newsVersion.toString());
      };
    }
  } catch (err) {
    console.error("Check app updates failed:", err);
  }
}

async function exportUserData() {
  const user = auth.currentUser;
  if (!user) return showToast("Login to export data", "#ff6b6b");

  try {
    showToast("Preparing your data... ⏳", "#6ee7b7");
    const snap = await get(ref(db, `users/${user.uid}`));
    const data = snap.val();

    if (!data) return showToast("No data found.", "#ff6b6b");

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `salah-tracker-export-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast("Data Exported! Check downloads. 📥", "#6ee7b7");
  } catch (err) {
    GlobalAudit.logError("Export Data", err);
    showToast("Export failed.", "#ff6b6b");
  }
}


// =============================================================================
// 8. DONATION SYSTEM (CLAIMS & VERIFICATION)
// =============================================================================

// --- Global Stats Listener ---
const globalDonationTotalEl = document.getElementById('global-donation-total');
const globalDonationCountEl = document.getElementById('global-donation-count');

async function loadDonationStats() {
  try {
    const snap = await get(ref(db, 'donations/stats'));
    const data = snap.val() || { totalAmount: 0, donorCount: 0 };
    if (globalDonationTotalEl) globalDonationTotalEl.textContent = `${data.totalAmount.toLocaleString()} PKR`;
    if (globalDonationCountEl) globalDonationCountEl.textContent = data.donorCount;
  } catch (err) { }
}
loadDonationStats();

window.triggerConfetti = () => {
  if (typeof confetti === 'function') {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#6ee7b7', '#34d399', '#10b981']
    });
  }
};

// --- Copy JazzCash Logic ---
const copyJazzcashBtn = document.getElementById('copy-jazzcash-btn');
const jazzcashNumberEl = document.getElementById('jazzcash-number');
if (copyJazzcashBtn && jazzcashNumberEl) {
  copyJazzcashBtn.onclick = () => {
    navigator.clipboard.writeText(jazzcashNumberEl.textContent);
    showToast('JazzCash Number Copied! 📋', '#6ee7b7');
  };
}

// --- Submit Claim Logic ---
const donateSubmitBtn = document.getElementById('donate-submit-btn');
const donationTrxInput = document.getElementById('donation-trx-id');
const btnShowClaimForm = document.getElementById('btn-show-claim-form');
const claimFormContainer = document.getElementById('claim-form-container');
const userStreakEl = document.getElementById('user-donation-streak');

// Toggle Form
if (btnShowClaimForm && claimFormContainer) {
  btnShowClaimForm.onclick = () => {
    claimFormContainer.style.display = "block";
    btnShowClaimForm.style.display = "none"; // Hide button after showing form
  };
}

// Load Streak
async function loadDonationStreak() {
  const user = auth.currentUser;
  if (!user || !userStreakEl) return;
  const snap = await get(ref(db, `users/${user.uid}/donationStats`));
  const stats = snap.val() || { streak: 0 };
  userStreakEl.textContent = `${stats.streak} 🔥`;
}

if (donateSubmitBtn) {
  donateSubmitBtn.onclick = async () => {
    const user = auth.currentUser;
    if (!user) return showToast("Please Login to donate.", "#ff6b6b");

    const trxId = donationTrxInput.value.trim();
    if (!trxId) return showToast("Please enter Transaction ID", "#fcd34d");
    if (trxId.length < 5) return showToast("Invalid Transaction ID", "#ff6b6b");

    try {
      donateSubmitBtn.disabled = true;
      donateSubmitBtn.textContent = "Submitting...";

      // Create Claim
      const newClaimRef = push(ref(db, 'donations/claims'));
      await set(newClaimRef, {
        uid: user.uid,
        name: user.displayName || "Anonymous",
        trxId: trxId,
        status: 'pending',
        timestamp: Date.now()
      });

      // --- STREAK LOGIC (Optimistic Update) ---
      // Simple logic: Increment streak on submission to encourage user
      // Ideally check previous week, but for gamification we stick to simplified count or weekly check
      // Here: Just increment if first time this week (client-side check roughly)
      const week = getCurrentWeek();
      const statsRef = ref(db, `users/${user.uid}/donationStats`);
      const statsSnap = await get(statsRef);
      let stats = statsSnap.val() || { streak: 0, lastWeek: '' };

      if (stats.lastWeek !== week) {
        stats.streak = (stats.streak || 0) + 1;
        stats.lastWeek = week;
        await set(statsRef, stats);

        // Update UI
        if (userStreakEl) userStreakEl.textContent = `${stats.streak} 🔥`;

        // Celebration!
        if (typeof triggerConfetti === 'function') {
          triggerConfetti();
        }
        showToast(`Streak Increased! ${stats.streak} Weeks 🔥`, "#fcd34d");
      } else {
        showToast("Claim Submitted! (Streak already active for this week)", "#6ee7b7");
      }

      // Feedback
      donationTrxInput.value = "";
      claimFormContainer.style.display = 'none'; // Hide form again
      btnShowClaimForm.style.display = 'block'; // Show button again
      btnShowClaimForm.textContent = "Submit Another Transaction";

      document.getElementById('user-donation-status').innerHTML = `<span style="color:#fcd34d;">Pending Verification (ID: ${trxId})</span>`;

    } catch (err) {
      console.error("Donation Error", err);
      showToast("Submission Failed", "#ff6b6b");
    } finally {
      donateSubmitBtn.disabled = false;
      donateSubmitBtn.textContent = "Submit Claim";
    }
  };
}

// --- Admin Dashboard Logic ---
const adminPanel = document.getElementById('admin-donation-panel');
const adminList = document.getElementById('admin-pending-list');

// Secret Trigger: Call openAdminDonations() from console or specialized button
window.openAdminDonations = () => {
  if (!auth.currentUser) return;
  adminPanel.style.display = 'block';
  loadAdminDonations();
  showToast("Admin Panel Opened 🛡️", "#ef4444");
};

let adminDonationsUnsub = null;

function loadAdminDonations() {
  if (adminDonationsUnsub) adminDonationsUnsub();

  // Listen to ALL claims (In real app, query by status='pending')
  // optimization: query(ref(db, 'donations/claims'), orderByChild('status'), equalTo('pending'))
  // But 'orderByChild' needs index. For small scale, fetch all is fine or limitToLast
  const claimsRef = query(ref(db, 'donations/claims'), limitToLast(20));

  adminDonationsUnsub = onValue(claimsRef, (snap) => {
    adminList.innerHTML = '';
    if (!snap.exists()) {
      adminList.innerHTML = '<div style="padding:10px;">No claims found.</div>';
      return;
    }

    const claims = [];
    snap.forEach(c => claims.push({ key: c.key, ...c.val() }));

    // Filter Pending client-side for simplicity
    const pending = claims.filter(c => c.status === 'pending').reverse();

    if (pending.length === 0) {
      adminList.innerHTML = '<div style="padding:10px;">No pending claims.</div>';
      return;
    }

    pending.forEach(c => {
      const div = document.createElement('div');
      div.style.padding = "10px";
      div.style.borderBottom = "1px solid #333";
      div.style.background = "#1e293b";
      div.style.marginBottom = "8px";
      div.innerHTML = `
                <div style="color:#fff; font-weight:bold;">${c.name} <span style="color:#94a3b8; font-size:0.8em;">(${c.uid.slice(0, 4)})</span></div>
                <div style="color:#fcd34d; font-family:monospace;">TRX: ${c.trxId}</div>
                <div style="font-size:0.8em; color:#64748b;">${new Date(c.timestamp).toLocaleString()}</div>
                
                <div style="margin-top:8px; display:flex; gap:6px;">
                    <input type="number" id="amt-${c.key}" placeholder="Enter verified amount" 
                       style="width:120px; padding:6px; background:#0f172a; border:1px solid #334155; color:#fff; border-radius:4px;">
                    <button onclick="verifyClaim('${c.key}', true)" style="background:#059669; color:#fff; border:none; padding:6px 12px; border-radius:4px; cursor:pointer;">Approve</button>
                    <button onclick="verifyClaim('${c.key}', false)" style="background:#ef4444; color:#fff; border:none; padding:6px 12px; border-radius:4px; cursor:pointer;">Reject</button>
                </div>
            `;
      adminList.appendChild(div);
    });
  });
}

window.verifyClaim = async (key, isApproved) => {
  if (!confirm(isApproved ? "Approve this claim?" : "Reject this claim?")) return;

  if (isApproved) {
    const amtInput = document.getElementById(`amt-${key}`);
    const amount = parseInt(amtInput.value);
    if (!amount || amount <= 0) return alert("Please enter valid amount!");

    try {
      // Update Claim
      await update(ref(db, `donations/claims/${key}`), {
        status: 'approved',
        verifiedAmount: amount,
        verifiedAt: Date.now()
      });

      // Update Global Stats (Atomic equivalent or simple transaction)
      await runTransaction(ref(db, 'donations/stats'), (currentStats) => {
        if (!currentStats) return { totalAmount: amount, donorCount: 1 };
        return {
          totalAmount: (currentStats.totalAmount || 0) + amount,
          donorCount: (currentStats.donorCount || 0) + 1
        };
      });

      showToast(`Approved ${amount} PKR!`, "#6ee7b7");
    } catch (e) {
      console.error(e);
      alert("Error approving: " + e.message);
    }

  } else {
    await update(ref(db, `donations/claims/${key}`), { status: 'rejected' });
    showToast("Claim Rejected", "#ef4444");
  }
};

// --- Why Donate Popup ---
const btnWhyDonate = document.getElementById('btn-why-donate');
const modalWhyDonate = document.getElementById('modal-why-donate');
const closeWhyDonate = document.getElementById('close-why-donate');

if (btnWhyDonate && modalWhyDonate) {
  btnWhyDonate.onclick = () => {
    modalWhyDonate.style.display = "block";
  };
  closeWhyDonate.onclick = () => {
    modalWhyDonate.style.display = "none";
  };
  window.addEventListener('click', (e) => {
    if (e.target === modalWhyDonate) {
      modalWhyDonate.style.display = "none";
    }
  });
}

// --- Secret Admin Trigger ---
let heartTaps = 0;
const heartIcon = document.getElementById('donate-heart-icon');
if (heartIcon) {
  heartIcon.onclick = () => {
    heartTaps++;
    if (heartTaps === 5) {
      openAdminDonations();
      heartTaps = 0;
    }
  };
}

// Global listener for new community buttons
document.addEventListener('click', (e) => {
  if (e.target.id === 'export-data-btn') {
    exportUserData();
  } else if (e.target.id === 'send-feedback-btn') {
    window.location.href = "mailto:support@salah-tracker.example.com?subject=Salah Tracker Feedback";
  }
});

// =============================================================================
// 9. ISLAMIC SERIES (CLIENT SIDE)
// =============================================================================

{
  // Cache keys
  const CACHE_KEY_SERIES = 'salah_tracker_series_cache';

  // Elements
  const seriesListView = document.getElementById('series-list-view');
  const episodeListView = document.getElementById('episode-list-view');
  const articleView = document.getElementById('article-view');
  const seriesGrid = document.getElementById('series-grid');
  const episodesContainer = document.getElementById('episodes-container');
  const seriesHeaderTitle = document.getElementById('series-header-title');
  const articleTitleEl = document.getElementById('article-title');
  const articleContentEl = document.getElementById('article-content');
  const seriesLoading = document.getElementById('series-loading');

  let currentSeriesData = null; // Store current series in memory

  // --- 1. Load & Render Series List ---
  window.renderSeriesList = async () => {
    // Reset Views
    if (seriesListView) seriesListView.style.display = 'block';
    if (episodeListView) episodeListView.style.display = 'none';
    if (articleView) articleView.style.display = 'none';

    // 1. Try Local Cache First (Instant Load)
    const cachedData = localStorage.getItem(CACHE_KEY_SERIES);
    if (cachedData) {
      try {
        const series = JSON.parse(cachedData);
        renderSeriesGrid(series);
        if (seriesLoading) seriesLoading.style.display = 'none';
        console.log("Loaded Series from Cache");
      } catch (e) {
        console.error("Cache Parse Error", e);
      }
    } else {
      if (seriesLoading) seriesLoading.style.display = 'block';
    }

    // 2. Fetch Fresh Data from Firebase
    // Using 'once' to get data, but 'on' listener is better for updates. 
    // For static content like articles, 'once' or 'value' with caching is fine.
    try {
      const snap = await get(ref(db, 'series'));
      if (snap.exists()) {
        const data = snap.val();
        const seriesList = Object.entries(data).map(([key, val]) => ({
          key,
          ...val
        }));

        // Update Cache
        localStorage.setItem(CACHE_KEY_SERIES, JSON.stringify(seriesList));
        console.log("Fetched & Cached Series from Firebase");

        // Render Fresh
        renderSeriesGrid(seriesList);
      } else {
        if (!cachedData && seriesGrid) seriesGrid.innerHTML = '<div style="color:#aaa; text-align:center;">No Series Available yet.</div>';
      }
      if (seriesLoading) seriesLoading.style.display = 'none';
    } catch (err) {
      console.error("Error fetching series", err);
      if (!cachedData && seriesLoading) seriesLoading.innerText = "Error loading content.";
    }
  };

  function renderSeriesGrid(list) {
    if (!seriesGrid) return;
    seriesGrid.innerHTML = '';
    if (!list || list.length === 0) {
      seriesGrid.innerHTML = '<div style="color:#aaa; text-align:center;">No Series Found</div>';
      return;
    }

    list.forEach(item => {
      const card = document.createElement('div');
      card.className = 'card';
      card.style.padding = '0';
      card.style.overflow = 'hidden';
      card.style.cursor = 'pointer';
      card.style.transition = 'transform 0.2s';

      // Default Banner if missing (Handle legacy data)
      const bannerUrl = item.banner || "https://cdn-icons-png.flaticon.com/512/3655/3655589.png";

      card.innerHTML = `
      <div style="height:140px; background:url('${bannerUrl}') center/cover;"></div>
      <div style="padding:15px;">
        <h3 style="margin:0 0 6px 0; font-size:1.1em; color:#fff;">${item.title}</h3>
        <div style="font-size:0.85em; color:#94a3b8; margin-bottom:4px;">${item.episodeCount || 0} Episodes</div>
         <p style="font-size:0.85em; color:#64748b; margin:0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${item.description || ''}</p>
      </div>
    `;

      card.onclick = () => openSeriesEpisodes(item);
      seriesGrid.appendChild(card);
    });
  }

  // --- 2. Episodes Logic ---
  window.openSeriesEpisodes = async (seriesItem) => {
    console.log("🔥 [DEBUG] Opening Series:", seriesItem);
    currentSeriesData = seriesItem; // Store for usage

    if (seriesListView) seriesListView.style.display = 'none';
    if (episodeListView) episodeListView.style.display = 'block';

    const titleEl = document.getElementById('current-series-title');
    if (titleEl) titleEl.textContent = seriesItem.title;

    if (!episodesContainer) {
      console.error("🔥 [DEBUG] episodesContainer element NOT FOUND!");
      return;
    }
    episodesContainer.innerHTML = '<div style="color:#aaa; text-align:center; padding:20px;">Loading Episodes...</div>';

    if (!seriesItem.key) {
      console.error("🔥 [DEBUG] Series Key is MISSING in seriesItem object:", seriesItem);
      episodesContainer.innerHTML = '<div style="color:#ff6b6b; text-align:center;">Error: Invalid Series ID</div>';
      return;
    }

    try {
      const path = `series/${seriesItem.key}/episodes`;
      console.log("🔥 [DEBUG] Fetching Episodes from path:", path);

      // Fetch fresh episodes for this series
      const epSnap = await get(ref(db, path));

      console.log("🔥 [DEBUG] Fetch complete. Exist?", epSnap.exists());

      episodesContainer.innerHTML = '';

      if (!epSnap.exists()) {
        console.warn("🔥 [DEBUG] No episodes found at path.");
        episodesContainer.innerHTML = '<div style="color:#aaa; text-align:center;">No Episodes Uploaded.</div>';
        return;
      }

      const episodes = [];
      epSnap.forEach(child => {
        episodes.push({ key: child.key, ...child.val() });
      });

      console.log("🔥 [DEBUG] Parsed Episodes:", episodes);

      // Optional: Sort by timestamp or title ?? keys are chronological usually

      episodes.forEach((ep, index) => {
        const div = document.createElement('div');
        div.className = 'card';
        div.style.padding = '12px 16px';
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.cursor = 'pointer';
        div.style.marginBottom = '0';
        div.style.background = '#334155';

        div.innerHTML = `
                <div style="width:30px; height:30px; background:#1e293b; color:#6ee7b7; border-radius:50%; display:flex; align-items:center; justify-content:center; margin-right:12px; font-weight:bold; font-size:0.9em;">${index + 1}</div>
                <div style="flex:1; font-weight:500;">${ep.title}</div>
                <div style="color:#64748b;">&#8594;</div>
            `;

        div.onclick = () => openEpisodeArticle(ep);
        episodesContainer.appendChild(div);
      });

    } catch (e) {
      console.error("🔥 [DEBUG] Error in openSeriesEpisodes:", e);
      episodesContainer.innerHTML = `<div style="color:#ff6b6b; text-align:center;">Error: ${e.message}</div>`;
    }
  };

  window.backToSeriesList = () => {
    if (episodeListView) episodeListView.style.display = 'none';
    if (seriesListView) seriesListView.style.display = 'block';
    if (articleView) articleView.style.display = 'none';
    if (seriesHeaderTitle) seriesHeaderTitle.textContent = "Islamic Series";
  };

  // =============================================================================
  // ADHAN SETUP GUIDE LOGIC
  // =============================================================================
  const adhanSetupModal = document.getElementById('adhan-setup-modal');
  const adhanSetupBtn = document.getElementById('adhan-setup-btn');
  const adhanSetupClose = document.getElementById('adhan-setup-close');
  const downloadAzanBtn = document.getElementById('download-azan-btn');
  const testNotifBtn = document.getElementById('test-notif-btn');
  const adhanSetupDoneBtn = document.getElementById('adhan-setup-done-btn');

  if (adhanSetupBtn) {
    adhanSetupBtn.onclick = () => {
      if (adhanSetupModal) adhanSetupModal.style.display = 'flex';
    };
  }

  if (adhanSetupClose) {
    adhanSetupClose.onclick = () => {
      if (adhanSetupModal) adhanSetupModal.style.display = 'none';
    };
  }

  if (adhanSetupDoneBtn) {
    adhanSetupDoneBtn.onclick = () => {
      if (adhanSetupModal) adhanSetupModal.style.display = 'none';
      showToast("MashaAllah! Adhan setup complete. ✅", "success");
    };
  }

  if (downloadAzanBtn) {
    downloadAzanBtn.onclick = async () => {
      try {
        showToast("Downloading Azan tone...", "info");
        const response = await fetch('tones/azan_tone.mp3');
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = 'azan_tone.mp3';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        showToast("Downloaded! Now set it in Android Settings.", "success");
      } catch (e) {
        console.error("Download failed:", e);
        showToast("Download failed. Please try again.", "error");
      }
    };
  }

  if (testNotifBtn) {
    testNotifBtn.onclick = async () => {
      if (!('serviceWorker' in navigator)) {
        showToast("Service Worker not supported.", "error");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      if (registration.active) {
        const baseUrl = registration.scope;
        registration.showNotification("🔔 Test Prayer Alert", {
          body: "This is a test to check your Azan sound settings.",
          icon: baseUrl + "notif-premium-icon.png",
          badge: baseUrl + "icon-192.png",
          tag: 'prayer-alert',
          renotify: true,
          requireInteraction: true,
          vibrate: [200, 100, 200]
        });
        showToast("Test notification sent!", "info");
      } else {
        showToast("Service Worker not active yet.", "warning");
      }
    };
  }

  window.backToSeriesFlow = () => {
    if (articleView && articleView.style.display === 'block') {
      if (episodeListView) episodeListView.style.display = 'block';
      if (articleView) articleView.style.display = 'none';
    } else if (episodeListView && episodeListView.style.display === 'block') {
      window.backToSeriesList();
    } else {
      closeSubFeature();
    }
  };

  // --- 3. Article Viewer ---
  window.openEpisodeArticle = (episode) => {
    if (episodeListView) episodeListView.style.display = 'none';
    if (articleView) articleView.style.display = 'block';

    if (articleTitleEl) articleTitleEl.textContent = episode.title;
    // Use innerHTML for Rich Text content
    if (articleContentEl) articleContentEl.innerHTML = (episode.content || '').replace(/\n/g, '<br>');

    // Scroll to top
    if (articleView) articleView.scrollIntoView({ behavior: 'smooth' });
  };

  window.backToEpisodeList = () => {
    if (articleView) articleView.style.display = 'none';
    if (episodeListView) episodeListView.style.display = 'block';
  };

  // =============================================================================
  // 10. INTERNAL ADHAN AUDIO MANAGER
  // =============================================================================
  window.InternalAdhanManager = {
    audioPlayer: new Audio(),
    checkInterval: null,
    isKeepAliveActive: false,
    lastTriggeredKey: "", // Deduplication key for Internal Adhan

    init() {
      console.log("[AdhanManager] Initializing...");
      this.attachListeners();
      this.startMinuteChecker();
      this.setupKeepAlive();
    },

    attachListeners() {
      const toggle = document.getElementById('settings-internal-adhan-toggle');
      const select = document.getElementById('settings-adhan-tone');
      const testBtn = document.getElementById('test-adhan-audio-btn');
      const fileInput = document.getElementById('adhan-custom-file');

      if (toggle) {
        toggle.onchange = (e) => {
          window.internalAdhanEnabled = e.target.checked;
          this.saveSettings();
        };
      }

      if (select) {
        select.onchange = (e) => {
          if (e.target.value === 'custom') {
            fileInput.click();
          } else {
            window.selectedAdhanTone = e.target.value;
            this.saveSettings();
          }
        };
      }

      if (fileInput) {
        fileInput.onchange = (e) => {
          const file = e.target.files[0];
          if (file) {
            this.handleCustomUpload(file);
          }
        };
      }

      if (testBtn) {
        testBtn.onclick = () => this.playAdhan(true);
      }
    },

    saveSettings() {
      const user = auth.currentUser;
      if (!user) return;
      update(ref(db, `users/${user.uid}`), {
        internalAdhanEnabled: window.internalAdhanEnabled,
        selectedAdhanTone: window.selectedAdhanTone
      }).then(() => {
        showToast("Adhan settings saved! 🔊", "success");
      });
    },

    async handleCustomUpload(file) {
      if (file.size > 5 * 1024 * 1024) {
        showToast("File too large! Max 5MB.", "error");
        return;
      }
      showToast("Saving custom Adhan...", "info");

      // Convert to Base64 for local storage (simpler than IDB for now)
      const reader = new FileReader();
      reader.onload = (e) => {
        window.selectedAdhanTone = e.target.result; // Data URL
        this.saveSettings();
        showToast("Custom Adhan set! ✅", "success");
      };
      reader.readAsDataURL(file);
    },

    startMinuteChecker() {
      if (this.checkInterval) clearInterval(this.checkInterval);
      this.checkInterval = setInterval(() => {
        if (!window.internalAdhanEnabled) return;

        const now = new Date();
        const currentTime = now.getHours().toString().padStart(2, '0') + ":" + now.getMinutes().toString().padStart(2, '0');

        // Check if any prayer matches
        if (typeof prayersWithTahajjud !== 'undefined') {
          const match = prayersWithTahajjud.find(p => p.time === currentTime);
          const todayStr = new Date().toDateString();
          const triggerKey = match ? `${match.name}_${todayStr}` : "";

          if (match && match.name !== 'Sunrise' && this.lastTriggeredKey !== triggerKey) {
            this.lastTriggeredKey = triggerKey;
            console.log(`[AdhanManager] Time for ${match.name}! Playing...`);
            this.playAdhan();
          }
        }
      }, 60000); // Check every minute
    },

    playAdhan(isTest = false) {
      if (!isTest && !window.internalAdhanEnabled) return;

      const tone = window.selectedAdhanTone || 'azan_tone.mp3';
      const source = tone.startsWith('data:') ? tone : `tones/${tone}`;

      this.audioPlayer.src = source;
      this.audioPlayer.volume = 1.0;

      this.audioPlayer.play().then(() => {
        console.log("[AdhanManager] Audio started.");
        if (!isTest) showToast("Time for Prayer! 🕌", "success");

        // Update Media Session for lock screen visibility
        if ('mediaSession' in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: isTest ? 'Adhan Test' : 'Time for Salah',
            artist: 'Salah Tracker',
            album: 'Prayer Alert',
            artwork: [{ src: 'notif-premium-icon.png', sizes: '512x512', type: 'image/png' }]
          });
        }
      }).catch(e => {
        console.warn("[AdhanManager] Autoplay blocked or error:", e);
        if (isTest) showToast("Playback blocked. Click again.", "warning");
      });
    },

    setupKeepAlive() {
      // Browsers often pause JS in the background. 
      // A trick to minimize this is to play a very short silent audio periodically 
      // or use the Media Session API to keep the context active.
      document.addEventListener('click', () => {
        if (!this.isKeepAliveActive) {
          console.log("[AdhanManager] Keep-alive context initialized via user click.");
          this.isKeepAliveActive = true;
        }
      }, { once: true });
    }
  };
}
