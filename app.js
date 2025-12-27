import { app, analytics, auth, db } from './firebase.js';
const {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  ref,
  set,
  get,
  onValue,
  update,
  runTransaction
} = window.FirebaseExports;
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging.js";

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
const settingsBtn = document.getElementById('settings-btn');
let currentDate = new Date();

// --- Scalability & Community Utilities ---
const APP_VERSION = "1.2.0";

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

// --- FCM Backend Call ---
async function sendFCMNotificationv1(token, title, body, sound) {
  try {
    const BACKEND_URL = 'https://salah-tracker-app.vercel.app/api/send-notification';

    // Added security header to harden API
    const response = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-auth': 'CRON_SECRET_PLACEHOLDER' // Ideally this would be a dynamic token, but using the same secret for now
      },
      body: JSON.stringify({ token, title, body, sound })
    });

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.indexOf("application/json") !== -1) {
      const data = await response.json();
      if (!data.success) {
        GlobalAudit.logError("FCM Backend Response", data.error);
      }
      return data;
    } else {
      const text = await response.text();
      GlobalAudit.logError("FCM Non-JSON Response", text);
      return { success: false, error: "Server Error" };
    }
  } catch (err) {
    GlobalAudit.logError("FCM Network/Fetch", err);
  }
}


// =============================================================================
// 1. NOTIFICATION & FCM LOGIC
// =============================================================================

async function requestNotificationPermission() {
  try {
    const messaging = getMessaging(app);
    // Real VAPID KEY from Firebase Console
    const vapidKey = 'BBeVQ0f8nC--oymwOnsGfla9p5AB5h37TEPpf1EMY0QTz4pbdPjlmqn-8Rkjw8sAE71ksSnkqcvRpA7M0_64FBE';

    // Explicitly pass service worker registration to fix "no active service worker"
    const registration = await navigator.serviceWorker.register('./firebase-messaging-sw.js');
    const currentToken = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
    if (currentToken) {
      const user = auth.currentUser;
      if (user) {
        await update(ref(db, `users/${user.uid}`), { fcmToken: currentToken });
        console.log("FCM Token saved:", currentToken);
        // After getting token, we can start checking for prayer alerts
        startPrayerNotificationLoop();
      }
    } else {
      console.log('No registration token available. Request permission to generate one.');
    }
  } catch (err) {
    console.log('An error occurred while retrieving token. ', err);
  }
}

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

      // Timer 1: Main Adhan Alert for the user themselves
      const timer = setTimeout(() => {
        let title = "Adhan Alert! 🕌";
        let body = `It is time for ${p.name}. May Allah accept your prayers.`;

        if (p.name === userStrugglePrayer) {
          title = `⚠️ High Priority: ${p.name}`;
          body = `This is your struggle prayer! Don't let Shaytan win. Stand up now for Allah. 💪`;
        }

        sendFCMNotificationv1(myToken, title, body, 'azan_tone');
      }, diff);
      scheduledTimeouts.push(timer);

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

function showSection(section) {
  Object.values(sections).forEach(sec => { if (sec) sec.style.display = 'none'; });
  if (sections[section]) sections[section].style.display = '';
  navBtns.forEach(btn => btn.classList.remove('active'));
  const idx = ["home", "donate", "quran", "tracker", "more"].indexOf(section);
  if (idx !== -1 && navBtns[idx]) navBtns[idx].classList.add('active');
}
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
  // Hijri (placeholder, real conversion needs API or library)
  hijriDateEl.textContent = 'Hijri: ' + (currentDate.getDate() + 18) + ' Jumada II 1445';
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
let prayersWithTahajjud = [];
let apiDate = new Date();

async function fetchPrayerTimes(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = (date.getMonth() + 1).toString().padStart(2, '0');
  const dd = date.getDate().toString().padStart(2, '0');
  const dateKey = `${yyyy}-${mm}-${dd}`;

  // 1. Try Loading from Local Cache (Offline/Speed)
  const cachedData = localStorage.getItem('prayers_' + dateKey);
  if (cachedData) {
    console.log("Using cached prayer times for", dateKey);
    parseAndRenderPrayers(JSON.parse(cachedData));
    checkAndTriggerPrayerNotifications(prayersWithTahajjud); // Schedule notifications from cache
    // Even if cached, try to update in background if online + location changed
    // But for now, valid cache is enough to be "offline ready"
  } else {
    console.log("No cache found, fetching fresh data...");
  }

  // 2. Get Location (High Accuracy)
  let coords = { lat: 24.7136, lng: 46.6753 }; // Default Riyadh

  // Try getting saved location first for fallback
  const savedLat = localStorage.getItem('userLat');
  const savedLng = localStorage.getItem('userLng');
  if (savedLat && savedLng) {
    coords = { lat: parseFloat(savedLat), lng: parseFloat(savedLng) };
  }

  try {
    const pos = await new Promise((resolve, reject) => {
      if (!navigator.geolocation) reject("No Geo support");
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => reject("Loc error"),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 600000 } // High accuracy, 10s timeout, allow 10min old cached pos
      );
    });
    // Update Coords & Save
    coords = pos;
    localStorage.setItem('userLat', coords.lat);
    localStorage.setItem('userLng', coords.lng);
  } catch (e) {
    console.warn("Location fetch failed, using saved/default:", coords);
    if (!savedLat && !cachedData) showToast("Check Location Permissions!", "#f59e0b");
  }

  // 3. Fetch API (Network)
  if (navigator.onLine) {
    try {
      const url = `https://api.aladhan.com/v1/timings/${dateKey}?latitude=${coords.lat}&longitude=${coords.lng}&method=2`;
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
      console.error("API Fetch Error:", err);
      if (!cachedData) showToast("Using Offline Mode (Data may be old next day)", "#f59e0b");
    }
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
    const [h, m] = prayersWithTahajjud[i].time.split(':').map(Number);
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
setInterval(updateCountdown, 1000);

function calcLastThird() {
  if (!prayersWithTahajjud.length) return;
  const fajr = prayersWithTahajjud[0].time.split(':').map(Number);
  const maghrib = prayersWithTahajjud[4].time.split(':').map(Number);
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

// --- Firebase Auth (basic UI prompt) ---
function showAuthPrompt() {
  const email = prompt('Enter email:');
  const password = prompt('Enter password:');
  signInWithEmailAndPassword(auth, email, password)
    .catch(() => {
      createUserWithEmailAndPassword(auth, email, password);
    });
}
// Consolidated Auth Listener at line 421


// --- Auth Modal Logic ---
const authModal = document.getElementById('auth-modal');
const authEmail = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const authError = document.getElementById('auth-error');
const authSubmit = document.getElementById('auth-submit');
const authSwitchBtn = document.getElementById('auth-switch-btn');
const authSwitchText = document.getElementById('auth-switch-text');
const authModalTitle = document.getElementById('auth-modal-title');

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
  } else {
    authModalTitle.textContent = 'Sign Up';
    authSubmit.textContent = 'Sign Up';
    authSwitchText.textContent = 'Already have an account?';
    authSwitchBtn.textContent = 'Login';
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
    } else {
      await createUserWithEmailAndPassword(auth, email, password);
    }
    hideAuthModal();
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      authError.textContent = 'User not found.';
    } else if (e.code === 'auth/wrong-password') {
      authError.textContent = 'Wrong password.';
    } else if (e.code === 'auth/email-already-in-use') {
      authError.textContent = 'Email already in use.';
    } else if (e.code === 'auth/invalid-email') {
      authError.textContent = 'Invalid email.';
    } else {
      authError.textContent = e.message || 'Authentication error.';
    }
  }
};



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
      userDisplayName = data.displayName || user.email.split('@')[0];
      userStrugglePrayer = data.strugglePrayer || "";

      // Now that offsets are loaded, we can fetch/refresh prayer times
      fetchPrayerTimes(currentDate);
    });

    fetchAndDisplayTracker();
    updateMarkPrayerBtn();
    checkForAppNotification();

    // Check for app updates
    checkAppUpdates();

    // Check if new user needs onboarding
    checkOnboardingStatus(user.uid);

    // Wait for SW to be ready before requesting FCM token
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(() => {
        requestNotificationPermission();
      });
    }
  }
});

// --- Prayer Logs (Firebase) ---
// --- Tracker/Rewards Logic ---
const rewardsPointsEl = document.getElementById('rewards-points');
const streakCountEl = document.getElementById('streak-count');
const trackerLogTableBody = document.querySelector('#tracker-log-table tbody');
const streakProgress = document.getElementById('streak-progress');
const streakBadgesRow = document.getElementById('streak-badges-row');

let rewards = 0;
let streak = 0;

function updateStreakGamification() {
  // Progress bar: 0-3, 3-7, 7-30, 30-100, 100+
  let max = 3;
  if (streak >= 100) max = 100;
  else if (streak >= 30) max = 100;
  else if (streak >= 7) max = 30;
  else if (streak >= 3) max = 7;
  // streakProgress removed in redesign
  // streakProgress.style.width = Math.min((streak / max) * 100, 100) + '%';
  // Badges
  let badges = '';
  if (streak >= 3) badges += '<span class="badge">🥉 3-Day Streak</span> ';
  if (streak >= 7) badges += '<span class="badge">🥈 7-Day Streak</span> ';
  if (streak >= 30) badges += '<span class="badge">🏅 30-Day Streak</span> ';
  if (streak >= 100) badges += '<span class="badge">🏆 100-Day Streak</span> ';
  if (!badges) badges = '<span style="color:#888;font-size:0.98em;">Earn streak badges by praying all 5 for consecutive days!</span>';
  streakBadgesRow.innerHTML = badges;
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
function showToast(msg, color = '#6ee7b7') {
  toastPopup.textContent = msg;
  toastPopup.style.background = '#222c';
  toastPopup.style.color = color;
  toastPopup.classList.add('show');
  setTimeout(() => toastPopup.classList.remove('show'), 2600);
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

function logPrayerStatus(prayerName, status) {
  GlobalAudit.logActivity("Mark Prayer", { prayer: prayerName, status });
  const user = auth.currentUser;
  if (!user) return;
  const today = getTodayDateString(); // Uses Local Date

  // 1. Get Previous Status First (to adjust global count correctly)
  const logRef = ref(db, `users/${user.uid}/logs/${today}/${prayerName}`);
  get(logRef).then(snap => {
    const prevStatus = snap.exists() ? snap.val() : null;

    // If status is same, do nothing (avoid double count)
    if (prevStatus === status) return;

    // 2. Update to New Status
    set(logRef, status).then(() => {
      // 3. Update Global Counts via Transaction
      const countRef = ref(db, `globalStats/${today}/${prayerName}`);
      runTransaction(countRef, (currentCount) => {
        if (currentCount === null) currentCount = 0;

        // Logic:
        // If changing TO 'prayed' -> +1
        // If changing FROM 'prayed' TO 'missed' -> -1
        // If changing FROM 'null' TO 'missed' -> 0 (no global count change)

        if (status === 'prayed') {
          return currentCount + 1;
        } else if (prevStatus === 'prayed' && status !== 'prayed') {
          return Math.max(0, currentCount - 1);
        }
        return currentCount; // No change for missed -> missed or null -> missed
      });

      // --- Deen Twins Status Sync & Notifications ---
      get(ref(db, `users/${user.uid}/twins/pairId`)).then(tSnap => {
        if (tSnap.exists()) {
          const pairId = tSnap.val();
          update(ref(db, `pairs/${pairId}/dailyStatus/${today}/${user.uid}`), {
            [prayerName]: status
          });

          // Notify Partner if this user clicked 'prayed'
          get(ref(db, `pairs/${pairId}`)).then(pSnap => {
            if (pSnap.exists()) {
              const pData = pSnap.val();
              const partnerId = (pData.user1 === user.uid) ? pData.user2 : pData.user1;

              if (status === 'prayed' && partnerId) {
                // Get Partner's Token
                get(ref(db, `users/${partnerId}/fcmToken`)).then(tokSnap => {
                  const partnerToken = tokSnap.val();
                  if (partnerToken) {
                    sendFCMNotificationv1(
                      partnerToken,
                      "Partner Activity 🌟",
                      `Your Deen Twin has just prayed ${prayerName}! MashaAllah.`,
                      'reminder_tone'
                    );
                  }
                });
              }
            }
          });
        }
      });

      let isTahajjud = (prayerName === 'Tahajjud');
      if (status === 'prayed') {
        // Increment rewards only for prayed
        get(ref(db, `users/${user.uid}/rewards`)).then(snap => {
          let points = snap.exists() ? snap.val() : 0;
          points += isTahajjud ? 20 : 10;
          set(ref(db, `users/${user.uid}/rewards`), points).then(() => {
            rewardsPointsEl.textContent = points;
          });
        });
        // Increment XP
        get(ref(db, `users/${user.uid}/xp`)).then(snap => {
          let xp = snap.exists() ? snap.val() : 0;
          const before = getLevelFromXP(xp).level;
          xp += isTahajjud ? 20 : 10;
          const after = getLevelFromXP(xp).level;
          set(ref(db, `users/${user.uid}/xp`), xp).then(() => {
            if (after > before) showLevelUp(after);
            fetchAndDisplayTracker();
          });
        });
        // Motivational toast
        if (isTahajjud) {
          showToast(tahajjudMsgs[Math.floor(Math.random() * tahajjudMsgs.length)], '#a78bfa');
        } else {
          showToast(prayedMsgs[Math.floor(Math.random() * prayedMsgs.length)], '#6ee7b7');
        }
      } else {
        fetchAndDisplayTracker();
        showToast(missedMsgs[Math.floor(Math.random() * missedMsgs.length)], '#ff6b6b');
      }
      updateMarkPrayerBtn();
    });
  });
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
    })
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

  // Re-trigger animations by toggling a class or clearing/re-adding content
  const grid = document.querySelector('.stats-grid');
  if (grid) {
    grid.style.animation = 'none';
    grid.offsetHeight; // trigger reflow
    grid.style.animation = null;
  }
  document.querySelectorAll('.stat-card-premium').forEach(card => {
    card.style.animation = 'none';
    card.offsetHeight; // trigger reflow
    card.style.animation = null;
  });

  // Fetch last 7 days logs
  const today = new Date();
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(getTodayDateString(d));
  }
  get(ref(db, `users/${user.uid}/logs`)).then(snap => {
    const logs = snap.val() || {};
    let newStreak = 0;
    let maxStreak = 0;
    let tempStreak = 0;
    trackerLogTableBody.innerHTML = '';
    for (let i = 0; i < days.length; i++) {
      const date = days[i];
      const prayers = logs[date] || {};
      const row = document.createElement('tr');
      row.innerHTML = `<td>${date}</td>` +
        ['Tahajjud', 'Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].map(p => {
          if (prayers[p] === 'prayed') return `<td style='color:#6ee7b7;font-weight:bold;'>✅</td>`;
          if (prayers[p] === 'missed') return `<td style='color:#ff6b6b;font-weight:bold;'>❌</td>`;
          return `<td></td>`;
        }).join('');
      trackerLogTableBody.appendChild(row);
      // Streak logic: all 6 prayers done (prayed only)
      if (['Tahajjud', 'Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].every(p => prayers[p] === 'prayed')) {
        tempStreak++;
        if (i === 0) newStreak = tempStreak;
      } else {
        tempStreak = 0;
      }
      if (tempStreak > maxStreak) maxStreak = tempStreak;
    }
    streak = newStreak;
    streakCountEl.textContent = streak;
    updateStreakGamification();
  });
  // Fetch rewards
  get(ref(db, `users/${user.uid}/rewards`)).then(snap => {
    rewards = snap.exists() ? snap.val() : 0;
    rewardsPointsEl.textContent = rewards;
  });
  // Fetch XP/Level
  get(ref(db, `users/${user.uid}/xp`)).then(snap => {
    let xp = snap.exists() ? snap.val() : 0;
    const { level, xpToNext, xpInLevel } = getLevelFromXP(xp);
    levelNumEl.textContent = level;
    xpPointsEl.textContent = xp;

    const progressPercent = Math.min((xpInLevel / xpToNext) * 100, 100);
    xpProgress.style.width = progressPercent + '%';

    // Mini bar and labels
    const xpMiniBar = document.getElementById('xp-progress-mini');
    const xpMiniLabel = document.getElementById('xp-points-mini');
    if (xpMiniBar) xpMiniBar.style.width = progressPercent + '%';
    if (xpMiniLabel) xpMiniLabel.textContent = xp;
  });
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
        alert('Mubarak ho! Aapko 10 rewards mile.');
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

// --- 30-Day Button ---
document.querySelector('.thirty-day-btn').onclick = () => {
  alert('30-Day Prayer Times coming soon!');
};

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
    const [h, m] = prayersWithTahajjud[i].time.split(':').map(Number);
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
  get(ref(db, `users/${user.uid}/logs/${today}/${currentActivePrayer}`)).then(snap => {
    if (snap.exists()) {
      const status = snap.val();
      markPrayerBtn.style.display = 'none';
      markMissedBtn.style.display = 'none';
      if (status === 'prayed') {
        prayerStatusLabel.textContent = `You marked this as Prayed ✅`;
        prayerStatusLabel.style.color = '#6ee7b7';
      } else if (status === 'missed') {
        prayerStatusLabel.textContent = `You marked this as Missed ❌`;
        prayerStatusLabel.style.color = '#ff6b6b';
      } else {
        prayerStatusLabel.textContent = '';
      }
    } else {
      markPrayerBtn.style.display = '';
      markMissedBtn.style.display = '';
      markPrayerBtn.textContent = `Mark ${currentActivePrayer} as Prayed`;
      markMissedBtn.textContent = `Mark ${currentActivePrayer} as Missed`;
      markPrayerBtn.disabled = false;
      markMissedBtn.disabled = false;
      prayerStatusLabel.textContent = '';
    }
  });
}
setInterval(updateMarkPrayerBtn, 5000);
updateMarkPrayerBtn();

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
  { file: "Quran para's urdu/Quran Para 1 With Urdu Translation _ Quran Urdu Translation (online-audio-converter.com).mp3", label: 'Para 1 - Urdu Translation' },
  { file: "Quran para's urdu/Quran Para 2 With Urdu Translation  Quran Urdu Translation.mp3", label: 'Para 2 - Urdu Translation' },
  { file: "Quran para's urdu/Quran Para 3 With Urdu Translation  Quran Urdu Translation_2.mp3", label: 'Para 3 - Urdu Translation' },
  { file: "Quran para's urdu/Quran Para 4 With Urdu Translation  Quran Urdu Translation.mp3", label: 'Para 4 - Urdu Translation' },
  { file: "Quran para's urdu/Quran Para 5 With Urdu Translation  Quran Urdu Translation.mp3", label: 'Para 5 - Urdu Translation' },
  { file: "Quran para's urdu/Quran Para 6 With Urdu Translation  Quran Urdu Translation.mp3", label: 'Para 6 - Urdu Translation' },
  { file: "Quran para's urdu/Quran Para 7 With Urdu Translation  Quran Urdu Translation.mp3", label: 'Para 7 - Urdu Translation' },
  { file: "Quran para's urdu/Quran Para 8 With Urdu Translation  Quran Urdu Translation.mp3", label: 'Para 8 - Urdu Translation' },
  { file: "Quran para's urdu/Quran Para 9 With Urdu Translation  Quran Urdu Translation.mp3", label: 'Para 9 - Urdu Translation' },
  { file: "Quran para's urdu/Quran Para 10 With Urdu Translation  Quran Urdu Translation.mp3", label: 'Para 10 - Urdu Translation' },
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
      quranAudioSource.src = para.file;
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
  { title: 'Muskurana', desc: 'Kisi ko dekh kar muskurain, yeh bhi sadqa hai.' },
  { title: 'Ghar walon ki madad', desc: 'Ghar ke kisi fard ki kisi kaam mein madad karein.' },
  { title: 'Surah Ikhlas 3 martaba', desc: 'Surah Ikhlas teen dafa parhein, poore Quran ka sawab milega.' },
  { title: 'Dost ke liye dua', desc: 'Apne kisi dost ke liye dil se dua karein.' },
  { title: 'Sadqa dena', desc: 'Kisi gareeb ko ya masjid mein chhota sa sadqa dein.' },
  { title: 'Kisi ko maaf karna', desc: 'Kisi ko Allah ki khatir maaf kar dein.' },
  { title: 'Quran ka aik safha', desc: 'Quran ka kam az kam aik safha parhein.' },
  { title: '100 martaba Astaghfirullah', desc: '100 dafa “Astaghfirullah” parhein.' },
  { title: 'Rishtedaron se rabta', desc: 'Kisi rishtedar ko call ya message karein.' },
  { title: 'Islami paigham share karna', desc: 'Kisi ko hadith ya Quran ki ayat bhejein.' },
  { title: 'Pani pilana', desc: 'Kisi ko thanda pani pilain.' },
  { title: 'Choti si madad', desc: 'Kisi ki choti si madad karein, jaise darwaza kholna.' },
  { title: 'Subah Bismillah parhna', desc: 'Subah uth kar “Bismillah” parhein.' },
  { title: 'Kisi ki tareef karna', desc: 'Kisi ki achi baat ki tareef karein.' },
  { title: 'Apne liye dua', desc: 'Apne liye bhi Allah se dua karein.' },
  { title: 'Kisi ko salam karna', desc: 'Aaj kam az kam 5 logon ko salam karein.' },
  { title: 'Masjid ki safai', desc: 'Masjid ya ghar ki safai mein hissa lein.' },
  { title: 'Buzurg ki madad', desc: 'Kisi buzurg ki madad karein.' },
  { title: 'Choti bachon se pyaar', desc: 'Chote bachon se pyaar se pesh aayen.' },
  { title: 'Kisi ki himmat barhana', desc: 'Kisi ko positive baat keh kar himmat barhain.' },
  { title: 'Apne parents ki khidmat', desc: 'Aaj parents ki koi khidmat karein.' },
  { title: 'Kisi ki ghalti ko nazarandaz', desc: 'Kisi ki choti ghalti ko maaf kar dein.' },
  { title: 'Subah ki dua', desc: 'Subah uth kar Allah ka shukar ada karein.' },
  { title: 'Kisi ko duaon mein yaad rakhna', desc: 'Aaj kisi ko apni duaon mein yaad rakhein.' },
  { title: 'Kisi ko khush karna', desc: 'Kisi ko hansane ki koshish karein.' },
  { title: 'Apne liye maghfirat ki dua', desc: 'Allah se apni maghfirat ki dua karein.' },
  { title: 'Kisi ki madad bina bataye', desc: 'Chupke se kisi ki madad karein.' },
  { title: 'Apne ghar walon ko shukriya', desc: 'Ghar walon ka shukriya ada karein.' },
  { title: 'Kisi ko gift dena', desc: 'Kisi ko chota sa gift dein.' },
  { title: 'Apne liye ilm hasil karna', desc: 'Aaj kuch naya seekhein.' },
  { title: 'Kisi ki burai se bachna', desc: 'Aaj kisi ki burai na karein.' },
  { title: 'Kisi ki madad ki niyyat', desc: 'Dil se sab ki madad ki niyyat karein.' },
  { title: 'Apne liye sabr ki dua', desc: 'Allah se sabr ki dua karein.' },
  { title: 'Kisi ko Quran sunana', desc: 'Kisi ko Quran ki tilawat sunayein.' },
  { title: 'Kisi ki galti ko chhupa lena', desc: 'Kisi ki ghalti ko sab ke samne na laayen.' },
  { title: 'Apne liye barkat ki dua', desc: 'Allah se rizq mein barkat ki dua karein.' },
  { title: 'Kisi ko positive msg bhejna', desc: 'Kisi ko positive msg ya quote bhejein.' },
  { title: 'Apne liye sehat ki dua', desc: 'Allah se sehat ki dua karein.' },
  { title: 'Kisi ki tareef sab ke samne', desc: 'Kisi ki achi baat sab ke samne bayan karein.' },
  { title: 'Apne liye hidayat ki dua', desc: 'Allah se hidayat ki dua karein.' },
  { title: 'Kisi ko muskurahat dena', desc: 'Kisi ko hansane ki koshish karein.' },
  { title: 'Apne liye duaon ki darkhwast', desc: 'Doston se apne liye dua ki darkhwast karein.' },
  { title: 'Kisi ki madad karne ki dua', desc: 'Allah se madad karne ki taufeeq ki dua karein.' },
  { title: 'Apne liye dosti ki dua', desc: 'Allah se ache doston ki dua karein.' },
  { title: 'Kisi ko Quran ka paigham', desc: 'Kisi ko Quran ki ayat ka paigham dein.' },
  { title: 'Apne liye imaan ki dua', desc: 'Allah se imaan ki mazbooti ki dua karein.' },
  { title: 'Kisi ko chai pilana', desc: 'Kisi ko chai ya cold drink pilain.' },
  { title: 'Apne liye barkat ki dua', desc: 'Allah se har kaam mein barkat ki dua karein.' },
  { title: 'Kisi ko duaon mein yaad rakhna', desc: 'Kisi ko apni duaon mein yaad rakhein.' },
  { title: 'Apne liye maghfirat ki dua', desc: 'Allah se apni maghfirat ki dua karein.' },
  { title: 'Kisi ki madad bina bataye', desc: 'Chupke se kisi ki madad karein.' },
  { title: 'Apne ghar walon ko shukriya', desc: 'Ghar walon ka shukriya ada karein.' },
  { title: 'Kisi ko gift dena', desc: 'Kisi ko chota sa gift dein.' },
  { title: 'Apne liye ilm hasil karna', desc: 'Aaj kuch naya seekhein.' },
  { title: 'Kisi ki burai se bachna', desc: 'Aaj kisi ki burai na karein.' },
  { title: 'Kisi ki madad ki niyyat', desc: 'Dil se sab ki madad ki niyyat karein.' },
  { title: 'Apne liye sabr ki dua', desc: 'Allah se sabr ki dua karein.' },
  { title: 'Kisi ko Quran sunana', desc: 'Kisi ko Quran ki tilawat sunayein.' },
  { title: 'Kisi ki galti ko chhupa lena', desc: 'Kisi ki ghalti ko sab ke samne na laayen.' },
  { title: 'Apne liye barkat ki dua', desc: 'Allah se rizq mein barkat ki dua karein.' },
  { title: 'Kisi ko positive msg bhejna', desc: 'Kisi ko positive msg ya quote bhejein.' },
  { title: 'Apne liye sehat ki dua', desc: 'Allah se sehat ki dua karein.' },
  { title: 'Kisi ki tareef sab ke samne', desc: 'Kisi ki achi baat sab ke samne bayan karein.' },
  { title: 'Apne liye hidayat ki dua', desc: 'Allah se hidayat ki dua karein.' },
  { title: 'Kisi ko muskurahat dena', desc: 'Kisi ko hansane ki koshish karein.' },
  { title: 'Apne liye duaon ki darkhwast', desc: 'Doston se apne liye dua ki darkhwast karein.' },
  { title: 'Kisi ki madad karne ki dua', desc: 'Allah se madad karne ki taufeeq ki dua karein.' },
  { title: 'Apne liye dosti ki dua', desc: 'Allah se ache doston ki dua karein.' },
  { title: 'Kisi ko Quran ka paigham', desc: 'Kisi ko Quran ki ayat ka paigham dein.' },
  { title: 'Apne liye imaan ki dua', desc: 'Allah se imaan ki mazbooti ki dua karein.' },
  { title: 'Kisi ko chai pilana', desc: 'Kisi ko chai ya cold drink pilain.' },
  // ... (add up to 100 unique cards in this style)
];

function getUnlockedGoodDeedCount(rewards) {
  return Math.floor(rewards / 100);
}

function shuffleArray(arr) {
  // Fisher-Yates shuffle
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Show a random unlocked card (or last completed)
let currentGoodDeedIndex = 0;
let userGoodDeeds = [];

goodDeedBtn.onclick = async () => {
  const user = auth.currentUser;
  if (!user) return;
  // Fetch rewards, completed cards, and cycle
  const rewardsSnap = await get(ref(db, `users/${user.uid}/rewards`));
  const rewards = rewardsSnap.exists() ? rewardsSnap.val() : 0;
  const unlockedCount = getUnlockedGoodDeedCount(rewards);
  let cycleSnap = await get(ref(db, `users/${user.uid}/goodDeedCycle`));
  let cycle = cycleSnap.exists() ? cycleSnap.val() : 1;
  let deedsSnap = await get(ref(db, `users/${user.uid}/goodDeeds`));
  userGoodDeeds = deedsSnap.exists() ? deedsSnap.val() : [];

  // If all cards completed, start new cycle
  if (userGoodDeeds.length === GOOD_DEED_CARDS.length && userGoodDeeds.every(d => d.completed)) {
    cycle++;
    await set(ref(db, `users/${user.uid}/goodDeedCycle`), cycle);
    // Shuffle and reset
    const shuffled = shuffleArray([...Array(GOOD_DEED_CARDS.length).keys()]);
    userGoodDeeds = shuffled.map(idx => ({ index: idx, completed: false, reflection: '' }));
    await set(ref(db, `users/${user.uid}/goodDeeds`), userGoodDeeds);
  }

  // If no cards unlocked yet
  if (unlockedCount === 0) {
    goodDeedCardTitle.textContent = 'No Good Deed Cards Yet';
    goodDeedCardDesc.textContent = 'Earn 100 rewards to unlock your first Good Deed Card!';
    goodDeedCompleteBtn.style.display = 'none';
    goodDeedReflection.value = '';
    goodDeedReflection.style.display = 'none';
    goodDeedSaveReflection.style.display = 'none';
    goodDeedModal.style.display = 'flex';
    return;
  }

  // Show the first incomplete card, or last completed
  let idx = userGoodDeeds.findIndex(d => !d.completed);
  if (idx === -1) idx = userGoodDeeds.length - 1;
  // Unlock new card if needed
  if (userGoodDeeds.length < unlockedCount) {
    // Find not-yet-unlocked indices in this cycle
    const available = [...Array(GOOD_DEED_CARDS.length).keys()].filter(i => !userGoodDeeds.some(d => d.index === i));
    const randomIdx = available[Math.floor(Math.random() * available.length)];
    userGoodDeeds.push({ index: randomIdx, completed: false, reflection: '' });
    await set(ref(db, `users/${user.uid}/goodDeeds`), userGoodDeeds);
    idx = userGoodDeeds.length - 1;
  }
  currentGoodDeedIndex = userGoodDeeds[idx].index;
  goodDeedCardTitle.textContent = GOOD_DEED_CARDS[currentGoodDeedIndex].title;
  goodDeedCardDesc.textContent = GOOD_DEED_CARDS[currentGoodDeedIndex].desc;
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
const donateStatus = document.getElementById('donate-status');
const donateMarkBtn = document.getElementById('donate-mark-btn');
const donateStreak = document.getElementById('donate-streak');
const donateBadges = document.getElementById('donate-badges');
const copySadapayBtn = document.getElementById('copy-sadapay-btn');
const copyJazzcashBtn = document.getElementById('copy-jazzcash-btn');
const sadapayNumber = document.getElementById('sadapay-number').textContent;
const jazzcashNumber = document.getElementById('jazzcash-number').textContent;
copySadapayBtn.onclick = () => {
  navigator.clipboard.writeText(sadapayNumber);
  showToast('Sadapay number copied!', '#6ee7b7');
};
copyJazzcashBtn.onclick = () => {
  navigator.clipboard.writeText(jazzcashNumber);
  showToast('JazzCash number copied!', '#6ee7b7');
};

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
  const donations = snap.exists() ? snap.val() : {};
  const donated = !!donations[week];
  donateStatus.textContent = donated ? 'This week: Donated ✅' : 'This week: Not Donated ❌';
  donateMarkBtn.disabled = donated;
  // Streak
  let streak = 0, maxStreak = 0, tempStreak = 0;
  const weeks = Object.keys(donations).sort();
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (donations[weeks[i]]) tempStreak++;
    else break;
  }
  streak = tempStreak;
  donateStreak.textContent = `Streak: ${streak} week${streak !== 1 ? 's' : ''}`;
  // Badges
  let badges = '';
  if (streak >= 4) badges += '<span class="badge">🌟 4-Week Streak</span> ';
  if (streak >= 12) badges += '<span class="badge">🏅 12-Week Streak</span> ';
  if (streak >= 52) badges += '<span class="badge">🏆 1 Year Streak</span> ';
  donateBadges.innerHTML = badges;
}

donateMarkBtn.onclick = async () => {
  const user = auth.currentUser;
  if (!user) return;
  const week = getCurrentWeek();
  await set(ref(db, `users/${user.uid}/donations/${week}`), true);
  showToast('JazakAllah! Allah aap ki niyyat qubool farmaye. 🤲', '#6ee7b7');
  updateDonateStatus();
};

onAuthStateChanged(auth, user => {
  if (user) updateDonateStatus();
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
  const snap = await get(ref(db, 'notifications/latest'));
  if (!snap.exists()) return;
  const notif = snap.val();
  const seenKey = 'notif_seen_' + notif.timestamp;
  if (!localStorage.getItem(seenKey)) {
    showAppNotification(notif.title, notif.body);
    localStorage.setItem(seenKey, '1');
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
  treeHealthText.textContent = `Health: ${health}%`;

  // Status Message
  if (health < 20) {
    treeStatusMsg.textContent = "Darakht sookh raha hai! (Pray more!) 🍂";
    treeStatusMsg.style.color = "#fbbf24";
  } else if (health < 50) {
    treeStatusMsg.textContent = "Darakht kamzor hai. Needs care. 🌱";
    treeStatusMsg.style.color = "#fcd34d";
  } else if (health < 80) {
    treeStatusMsg.textContent = "MashaAllah! Darakht hara bhara hai. 🌳";
    treeStatusMsg.style.color = "#6ee7b7";
  } else {
    treeStatusMsg.textContent = "SubhanAllah! Jannat ka bagh ban gaya! 🌺";
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

// Hook into openSubFeature to render tree
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
};

// --- Islamic Series Logic (Migrated to Firebase) ---
let SERIES_DATA = [];

const seriesListView = document.getElementById('series-list-view');
const episodeListView = document.getElementById('episode-list-view');
const articleView = document.getElementById('article-view');
const seriesBackBtn = document.getElementById('series-back-btn');
const seriesHeaderTitle = document.getElementById('series-header-title');
const articleTitleEl = document.getElementById('article-title');
const articleContentEl = document.getElementById('article-content');

let seriesCurrentView = 'list'; // list, episodes, article
let activeSeries = null;

async function renderSeriesList() {
  seriesCurrentView = 'list';
  seriesHeaderTitle.textContent = "Islamic Series";
  seriesListView.style.display = 'block';
  episodeListView.style.display = 'none';
  articleView.style.display = 'none';

  // Fetch from Firebase if not already loaded
  if (SERIES_DATA.length === 0) {
    seriesListView.innerHTML = '<div class="card" style="text-align:center;color:#94a3b8;">Loading Series... ⏳</div>';
    try {
      let snap = await get(ref(db, 'series'));
      // Fallback: Check '0/series' if root/series is missing (User Import Error Fix)
      if (!snap.exists()) {
        console.warn("Root 'series' not found, checking '0/series'...");
        snap = await get(ref(db, '0/series'));
      }

      if (snap.exists()) {
        const val = snap.val();
        // Convert Object to Array if needed (Firebase sometimes treats arrays as objects)
        if (Array.isArray(val)) {
          SERIES_DATA = val;
        } else {
          SERIES_DATA = Object.values(val);
        }
        console.log("Series Data Loaded:", SERIES_DATA);
      } else {
        seriesListView.innerHTML = '<div class="card" style="text-align:center;color:#94a3b8;">No series found in Database.</div>';
        return;
      }
    } catch (err) {
      console.error("Firebase Series Error:", err);
      seriesListView.innerHTML = `<div class="card" style="text-align:center;color:#ff6b6b;">Error loading series: ${err.message}</div>`;
      return;
    }
  }

  seriesListView.innerHTML = SERIES_DATA.map((series, idx) => `
    <div class="card" onclick="openSeriesEpisodes(${idx})" style="display:flex;align-items:center;gap:12px;cursor:pointer;margin-bottom:12px;background:#1e293b;border:1px solid #334155;">
      <div style="background:#334155;width:45px;height:45px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.5em;">📜</div>
      <div style="flex:1;text-align:left;">
        <div style="font-weight:600;font-size:1.1em;color:#6ee7b7;">${series.title}</div>
        <div style="font-size:0.85em;color:#94a3b8;line-height:1.3;">${series.desc}</div>
      </div>
      <div style="color:#6ee7b7;">&#8594;</div>
    </div>
  `).join('');
}
// Migrated series data removed.
// Cleanup start
// End of Islamic Series Migrated Logic

window.openSeriesEpisodes = (idx) => {
  activeSeries = idx;
  seriesCurrentView = 'episodes';
  const series = SERIES_DATA[idx];
  seriesHeaderTitle.textContent = series.title;
  seriesListView.style.display = 'none';
  episodeListView.style.display = 'block';
  articleView.style.display = 'none';

  episodeListView.innerHTML = series.episodes.map((ep, epIdx) => `
    <div class="card" onclick="openSeriesArticle(${epIdx})" style="display:flex;align-items:center;gap:12px;cursor:pointer;margin-bottom:10px;background:#1e293b;border:1px solid #334155;padding:12px;">
      <div style="font-weight:600;color:#fcd34d;font-size:0.9em;">EP ${epIdx + 1}</div>
      <div style="flex:1;text-align:left;">
        <div style="font-weight:600;font-size:1em;">${ep.title}</div>
      </div>
      <div style="color:#6ee7b7;">&#8594;</div>
    </div>
  `).join('');
};

window.openSeriesArticle = (epIdx) => {
  seriesCurrentView = 'article';
  const series = SERIES_DATA[activeSeries];
  const episode = series.episodes[epIdx];
  seriesHeaderTitle.textContent = "Reading Episode";
  seriesListView.style.display = 'none';
  episodeListView.style.display = 'none';
  articleView.style.display = 'block';

  articleTitleEl.textContent = episode.title;
  // Simple markdown conversion for **bold**
  const formattedContent = episode.content.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
  articleContentEl.innerHTML = formattedContent;
  articleView.scrollTop = 0;
};

seriesBackBtn.onclick = () => {
  if (seriesCurrentView === 'article') {
    openSeriesEpisodes(activeSeries);
  } else if (seriesCurrentView === 'episodes') {
    renderSeriesList();
  } else {
    closeSubFeature();
  }
};

// --- Deen Twins (Salah Partner) Logic ---
const twinsLobby = document.getElementById('twins-lobby');
const twinsActive = document.getElementById('twins-active');
const findPartnerBtn = document.getElementById('find-partner-btn');
const twinsLoading = document.getElementById('twins-loading');
const partnerNameEl = document.getElementById('partner-name');
const partnerAvatarEl = document.getElementById('partner-avatar');
const partnerStatusEl = document.getElementById('partner-status');
const twinsNudgeBtn = document.getElementById('twins-nudge-btn');
const twinsLeaveBtn = document.getElementById('twins-leave-btn');
const twinsProgress = document.getElementById('twins-progress');
const twinsTodayStatus = document.getElementById('twins-today-status');

let twinsUnsubscribe = null;

async function checkTwinsStatus() {
  const user = auth.currentUser;
  if (!user) return;
  // Listen to user's twins node
  const twinsRef = ref(db, `users/${user.uid}/twins`);
  if (twinsUnsubscribe) twinsUnsubscribe();

  twinsUnsubscribe = onValue(twinsRef, async (snap) => {
    const data = snap.val();

    // Auto Popup Logic
    const hasSkipped = localStorage.getItem('skipPartner');
    if (!data && !hasSkipped) {
      setTimeout(() => {
        const packet = document.getElementById('modal-partner-invite');
        const twinsSection = document.getElementById('twins-active');
        if (packet && twinsSection.style.display === 'none' && packet.style.display !== 'flex') {
          packet.style.display = 'flex';
        }
      }, 3000);
    }

    if (data && data.pairId) {
      // --- STATE 1: PAIRED ---
      subscribeToPair(data.pairId, user.uid);
      syncHistoricalLogsToPair(data.pairId, user.uid);

      twinsLobby.style.display = 'none';
      twinsActive.style.display = 'block';

    } else if (data && data.inLobby) {
      // --- STATE 2: WAITING IN LOBBY ---
      document.getElementById('home-partner-widget').style.display = 'none';

      twinsLobby.style.display = 'block';
      twinsActive.style.display = 'none';

      twinsLoading.style.display = 'block'; // Show Loading Text
      findPartnerBtn.style.display = 'none'; // Hide Find Button

      let lobbyMsg = "Request Saved! You will be paired automatically when someone joins. You can close the app.";
      if (Notification.permission !== 'granted') {
        lobbyMsg += "<br><br><span style='color:#f59e0b;font-weight:bold;'>⚠️ Please Enable Notifications to get alerted! <button onclick='requestNotificationPermission()' style='background:#f59e0b;color:#000;border:none;padding:4px 8px;border-radius:6px;cursor:pointer;margin-top:4px;'>Enable</button></span>";
      }
      twinsLoading.innerHTML = lobbyMsg;

    } else {
      // --- STATE 3: NOTHING / NEW ---
      document.getElementById('home-partner-widget').style.display = 'none';

      twinsLobby.style.display = 'block';
      twinsActive.style.display = 'none';

      twinsLoading.style.display = 'none'; // Hide Loading Text
      findPartnerBtn.style.display = 'inline-block'; // Show Find Button
    }
  });
}

// --- Event Listeners for Dynamic UI ---
const homePartnerWidget = document.getElementById('home-partner-widget');
const btnModalFind = document.getElementById('btn-modal-find-partner');
const btnModalNotNow = document.getElementById('btn-modal-not-now');

if (homePartnerWidget) {
  homePartnerWidget.onclick = () => {
    // Navigate to Deen Twins
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

findPartnerBtn.onclick = async () => {
  const user = auth.currentUser;
  if (!user) return alert("Please login first.");

  findPartnerBtn.style.display = 'none';
  twinsLoading.style.display = 'block';
  twinsLoading.textContent = "Searching for partner... ⏳";

  try {
    // 1. Check Lobby
    const lobbySnap = await get(ref(db, 'lobby'));
    const lobby = lobbySnap.val();

    console.log("Lobby Snap:", lobby);

    let foundPartnerId = null;

    if (lobby) {
      const ids = Object.keys(lobby);
      // Find one that isn't me
      foundPartnerId = ids.find(id => id !== user.uid);
    }

    if (foundPartnerId) {
      // --- Match found! ---
      const waitingUid = foundPartnerId;
      console.log("Partner Found:", waitingUid);

      // Remove from lobby
      await set(ref(db, `lobby/${waitingUid}`), null);
      // Ensure I am removed too just in case
      await set(ref(db, `lobby/${user.uid}`), null);

      // Create Pair
      const pairId = 'pair_' + Date.now();
      const pairData = {
        user1: waitingUid,
        user2: user.uid,
        streak: 0,
        startedAt: Date.now(),
        [waitingUid]: lobby[waitingUid] || { name: 'Partner', avatar: '👤' },
        [user.uid]: { name: (userDisplayName || user.email.split('@')[0]), avatar: '🧑🏽' }
      };

      await set(ref(db, `pairs/${pairId}`), pairData);

      // Update both users
      await set(ref(db, `users/${waitingUid}/twins`), { pairId: pairId });
      await set(ref(db, `users/${user.uid}/twins`), { pairId: pairId });

      showToast("Partner Found!", "#6ee7b7");

      // --- Notify the Waiting User (Async) ---
      get(ref(db, `users/${waitingUid}/fcmToken`)).then(snap => {
        const token = snap.val();
        if (token) {
          sendFCMNotificationv1(
            token,
            "New Partner Assigned! 🤝",
            `${(userDisplayName || user.email.split('@')[0])} has accepted your partnership request.`,
            'reminder_tone'
          ).catch(err => console.error("Notification Failed:", err));
        }
      });

    } else {
      // --- No one available, join lobby & SAVE REQUEST ---
      console.log("No valid partner found, joining lobby.");

      await set(ref(db, `lobby/${user.uid}`), {
        name: (userDisplayName || user.email.split('@')[0]),
        avatar: '🧑🏽',
        joinedAt: Date.now()
      });

      // Update self state
      await set(ref(db, `users/${user.uid}/twins`), { inLobby: true });

      // Update UI
      let lobbyMsg = "Request Saved! You will be paired automatically when someone joins. You can close the app.";
      if (Notification.permission !== 'granted') {
        lobbyMsg += "<br><br><span style='color:#f59e0b;font-weight:bold;'>⚠️ Please Enable Notifications to get alerted! <button onclick='requestNotificationPermission()' style='background:#f59e0b;color:#000;border:none;padding:4px 8px;border-radius:6px;cursor:pointer;margin-top:4px;'>Enable</button></span>";
      }
      twinsLoading.innerHTML = lobbyMsg;
      showToast("Request Saved 💾", "#6ee7b7");
    }
  } catch (err) {
    console.error("Find Partner Error:", err);
    twinsLoading.textContent = "Error occurred. Please try again.";
    findPartnerBtn.style.display = 'inline-block';
  }
};

twinsNudgeBtn.onclick = async () => {
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
  s.textContent = statusText;
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
        partnerStatusEl.textContent = `Status: Has Prayed ${currentPrayer} ✅`;
        partnerStatusEl.style.color = "#6ee7b7";
      }
      widgetText = `${partnerData.name} prayed ${currentPrayer} ✅`;
      widgetColor = "#6ee7b7";
    } else if (pStatus === 'missed') {
      if (partnerStatusEl) {
        partnerStatusEl.textContent = `Status: Missed ${currentPrayer} ❌`;
        partnerStatusEl.style.color = "#ff6b6b"; // Red
      }
      widgetText = `${partnerData.name} missed ${currentPrayer} ❌`;
      widgetColor = "#ff6b6b";
    } else {
      if (partnerStatusEl) {
        partnerStatusEl.textContent = `Status: Hasn't prayed ${currentPrayer} yet ⏳`;
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
async function checkOnboardingStatus(uid) {
  // Check if onboarding is already done
  const snap = await get(ref(db, `users/${uid}/onboardingCompleted`));
  const isComplete = snap.val();

  if (!isComplete) {
    // Show Wizard
    const modal = document.getElementById('onboarding-modal');
    if (modal) modal.style.display = 'flex';

    // Show Step 1
    const step1 = document.getElementById('onboarding-step-1');
    if (step1) step1.style.display = 'flex';
  }
}

// Wizard Event Listeners
const btnOnboardingPermit = document.getElementById('btn-onboarding-permit');
const btnOnboardingNext2 = document.getElementById('btn-onboarding-next-2');
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

if (btnOnboardingNext2) {
  btnOnboardingNext2.onclick = () => {
    const step2 = document.getElementById('onboarding-step-2');
    const step3 = document.getElementById('onboarding-step-3');
    if (step2) step2.style.display = 'none';
    if (step3) step3.style.display = 'flex';
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

    // Close Modal
    const modal = document.getElementById('onboarding-modal');
    if (modal) modal.style.display = 'none';

    showToast("Welcome to the family! 💚", "#6ee7b7");
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

    const newOffsets = {};
    ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].forEach(p => {
      newOffsets[p] = parseInt(document.getElementById(`offset-${p}`).value) || 0;
    });

    try {
      await update(ref(db, `users/${user.uid}`), {
        displayName: newName,
        sleepTime: newSleep,
        strugglePrayer: newStruggle,
        prayerOffsets: newOffsets
      });

      userOffsets = newOffsets;
      userDisplayName = newName;
      userStrugglePrayer = newStruggle;

      showToast("Settings Saved! ✨", "#6ee7b7");
      settingsModal.style.display = 'none';

      fetchPrayerTimes(currentDate);

    } catch (e) {
      showToast("Error saving settings", "#ff6b6b");
    }
  };
}

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
  const localVersion = localStorage.getItem('appVersion') || "1.0.0";

  if (localVersion !== APP_VERSION) {
    const newsModal = document.getElementById('news-modal');
    const newsContent = document.getElementById('news-content');
    if (!newsModal || !newsContent) return;

    // Latest Update Summary
    newsContent.innerHTML = `
      <ul style="padding-left: 20px;">
        <li><b>Account Settings:</b> Custom Display Names implemented! 🧑🏽</li>
        <li><b>Prayer Offsets:</b> Adjust prayer times by minutes. 🕌</li>
        <li><b>Data Export:</b> Save your history locally anytime. 📥</li>
        <li><b>Security:</b> Hardened API and better error tracking. 🛡️</li>
      </ul>
      <p style="margin-top: 15px; font-style: italic;">We're making Salah Tracker ready for the whole Ummah! Keep us in your Duas. 🤲</p>
    `;

    newsModal.style.display = 'flex';

    document.getElementById('close-news-btn').onclick = () => {
      newsModal.style.display = 'none';
      localStorage.setItem('appVersion', APP_VERSION);
    };
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

// Global listener for new community buttons
document.addEventListener('click', (e) => {
  if (e.target.id === 'export-data-btn') {
    exportUserData();
  } else if (e.target.id === 'send-feedback-btn') {
    window.location.href = "mailto:support@salah-tracker.example.com?subject=Salah Tracker Feedback";
  }
});
