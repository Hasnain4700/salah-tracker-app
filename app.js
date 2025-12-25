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
  update
} = window.FirebaseExports;
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging.js";

// --- FCM Backend Call ---
async function sendFCMNotificationv1(token, title, body) {
  try {
    // Use the absolute URL of your Vercel deployment so it works from GitHub/Localhost/APK
    const BACKEND_URL = 'https://salah-tracker-app.vercel.app/api/send-notification';

    const response = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, title, body })
    });

    // Check if response is valid JSON before parsing
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.indexOf("application/json") !== -1) {
      const data = await response.json();
      if (!data.success) {
        console.error("Backend FCM Error Summary:", data.error);
      }
      return data;
    } else {
      const text = await response.text();
      console.error("Backend returned non-JSON response:", text);
      return { success: false, error: "Server Error" };
    }
  } catch (err) {
    console.error("Network or Backend Error:", err);
  }
}


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
        sendFCMNotificationv1(
          myToken,
          "Adhan Alert! 🕌",
          `It is time for ${p.name}. May Allah accept your prayers.`
        );
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
                      `Your Deen Twin hasn't marked ${p.name} yet. Why not nudge them?`
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


// --- UI Elements ---
const gregorianDateEl = document.getElementById('gregorian-date');
const hijriDateEl = document.getElementById('hijri-date');
const prevDateBtn = document.getElementById('prev-date');
const nextDateBtn = document.getElementById('next-date');
const countdownTimerEl = document.getElementById('countdown-timer');
const nextPrayerNameEl = document.getElementById('next-prayer-name');
const prayerItems = document.querySelectorAll('.prayer-item');
const lastThirdTimeEl = document.getElementById('last-third-time');
const logoutBtn = document.getElementById('logout-btn');
const prayerStatusLabel = document.getElementById('prayer-status-label');
const levelNumEl = document.getElementById('level-num');
const xpPointsEl = document.getElementById('xp-points');
const xpProgress = document.getElementById('xp-progress');


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

// --- Date Handling ---
let currentDate = new Date();
function updateDates() {
  // Gregorian
  gregorianDateEl.textContent = currentDate.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'short', day: 'numeric'
  });
  // Hijri (placeholder, real conversion needs API or library)
  hijriDateEl.textContent = 'Hijri: ' + (currentDate.getDate() + 18) + ' Jumada II 1445';
}

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
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 600000 } // High accuracy, 5s timeout, allow 10min old cached pos
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

function parseAndRenderPrayers(t) {
  const apiPrayers = [
    { name: 'Fajr', time: t.Fajr },
    { name: 'Sunrise', time: t.Sunrise },
    { name: 'Dhuhr', time: t.Dhuhr },
    { name: 'Asr', time: t.Asr },
    { name: 'Maghrib', time: t.Maghrib },
    { name: 'Isha', time: t.Isha }
  ];
  prayersWithTahajjud = getPrayersWithTahajjud(apiPrayers);
  document.querySelectorAll('.prayer-item').forEach((item, i) => {
    item.querySelector('.prayer-time').textContent = prayersWithTahajjud[i]?.time || '--:--';
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
  logoutBtn.style.display = 'none';
}
function hideAuthModal() {
  authModal.style.display = 'none';
  // Show app sections and nav
  showSection('home');
  document.querySelector('.bottom-nav').style.display = '';
  logoutBtn.style.display = '';
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
    logoutBtn.style.display = 'none';
  } else {
    hideAuthModal();
    logoutBtn.style.display = '';
    fetchAndDisplayTracker();
    updateMarkPrayerBtn();
    checkForAppNotification();

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
function logPrayerStatus(prayerName, status) {
  const user = auth.currentUser;
  if (!user) return;
  const today = getTodayDateString(); // Uses Local Date

  set(ref(db, `users/${user.uid}/logs/${today}/${prayerName}`), status).then(() => {
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
                    `Your Deen Twin has just prayed ${prayerName}! MashaAllah.`
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
}

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

logoutBtn.onclick = async () => {
  try {
    await window.FirebaseExports.signOut(auth);
  } catch (e) { }
  showAuthModal();
  Object.values(sections).forEach(sec => { if (sec) sec.style.display = 'none'; });
  document.querySelector('.bottom-nav').style.display = 'none';
  logoutBtn.style.display = 'none';
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

// --- Islamic Series Logic ---
const SERIES_DATA = [
  {
    title: "The End of Times",
    desc: "Qayamat ki nishaniyon aur aakhir-e-zamana ke fitnon ka silsila.",
    episodes: [
      {
        title: "Episode 1: The Great Fitna Begins",
        content: `**Aik Nayi Silsilay Ka Aaghaz: Aakhir-e-Zamana Kay Nishaniyan**

Bismillahir Rahmanir Raheem.

Assalamu Alaikum. Mera naam Furqan Qureshi hai, aur aaj say hum ek bilkul nayaa silsila shuru kar rahay hain. "Aakhir-e-Zamana" ka silsila, Qayamat ki nishaniyon par.

**Takhir Ka Wajih**
Yeh silsila us qareeb aane walay fitnon par hai. Mujhay kai mahinon say is project ko shuru karne ki targeeb di ja rahi thi, lekin haqeeqat yeh hai kay main nay isay do dafa taala diya. Dar-asal, isay taala dene ka ek wajih tha. Main jaanta hoon kay hamari nasl aakhir-e-zamana ki nishaniyon par bahut baat karna pasand karti hai. Dajjal aur Ibn Sayyad ki kahaniyan, ya oonchay oonchay imaratun ka ban-na, paighambar-e-aakhri (S.A.W.) ki batayein anjaam ko pohanchtay dekhna, imaan ko mazboot karta hai. Dunya waqai bilkul waisi hi ho rahi hai jaisa unhon nay farmaya tha.

**Dil Chheen Lenay Wali Haqeeqat**
Lekin aaj main aap ko sach bataon? Kehta hoon kay yeh silsila jab aage barhay ga, to aap kay honton par lagi muskaan ghayab ho jaye gi. Aap ka dil be-chain honay lage ga, aur aisa waqt aaye ga jab aap khud say sawal karen gay keh kya main bhi kisi fitnay ka shikaar ho chuka hoon? Main yeh is liye keh raha hoon kyun keh isi silsilay ki tayyari kartay huay yeh meray saath bhi hua. Jitna main fitnon aur aazmaishon kay baray main janta gaya, meray chehray say muskaan aur dil say sukoon ghayab hota gaya, aur ek khauf ne gher liya keh shayad main bhi ek azeem fitnay may mubtila ho chuka hoon.

**Khaufnaak Fitnay**
Aap jantay hain keh fitnon may say aik aisa hoga jo behra aur goonga hoga, aur insaan yeh samajhay ga keh main is say mehfooz hoon, aur bas jhaank kar dekh lun, lekin sirf usay dekhna hi us shaks ko is ka shikaar bana de ga. Fitnon ka daur itna shadeed hone wala hai. Lihaza apne aap ko tayyar kar lein, kyun keh aaj say hum aik aisi safar ka aaghaz kar rahay hain jahan har episode kay saath aap kay liye hairat kay darwazay khultay chalay jayen gay.

**Duniya Ka Anjaam: Aik Aam Tasawwur**
Duniya ka khatma ek aisa tasawwur hai jo har mulk, har mazhab, har nasal aur duniya kay har konay may paya jata hai. Agar aap scientiston say poochen, to woh bhi kehain gay: haan, ab yeh duniya apne anjaam say bohat door nahi. Climate change ka tareeqa, Arctic Ocean ka barf tezi say pighalna, Greenland aur Antarctica ki barf ki chaddaron ka pighalna, har saal garmi kay naye record ban-na, be-mausam aur be-qaaida barasat aur khushk saal lambay hotay jaana, aisa mehsoos hota hai keh qayamat ka din dheemay dheemay humaray qareeb aa raha hai.

**Science Ki Nazar May Anjaam-e-Duniya Kay Aur Zariye**
Lekin climate change duniya kay khatmay ka ek hi khatra nahi. Aur bhi kayi tareeqay hain jis say scientifically duniya khatam ho sakti hai.

**1. Virus (Waba)**
Masalan, aisa virus paida ho jaye jis ki koi dawa na ho. 1347 may Yersinia pestis virus Europe may sirf chand dinon may phail gaya. Is virus say mubtila mareez ko pehlay bukhaar aata phir jism dard, phir haath paon thanday parh jatay, zubaan sukh jati aur dil ki dhadkan tez ho jati. 24 ghanton kay andar jism par soojan aati, jinka dard itna shadeed hota keh mareez chillata aur cheekhta rahta aur cheekhtay huay hi dam tor deta. Lekin itna hi nahi, maut kay baad bhi kai ghanton tak un kay jism may larjhahat hoti, aur kai maamlaat may lagta keh woh maut kay baad bhi zinda hain. Asal may, zombies ka tasawwur yahin say paida hua. Kher, aaj hum is virus ya waba ko Black Death kehtay hain, aur yeh itna khaufnaak virus tha keh 4 saal kay andar duniya ki aadhi say ziyada abadi khatam ho gai. Is virus ki koi dawa 1796 tak nahi thi, yani chaar sadiyon kay baad is virus ki vaccine ban saki. Aur aap ko maloom hai keh abhi bhi jungli janwaron, Siberia, Antarctica aur Alaska ke door daraz barfili paharoon, samandar ki gehraiyon, gehraiyon say bhari gufaon aur ghanay junglon kay markazon may scientists kehtay hain keh 1 say 1.5 million aise virus maujood ho sakte hain jinkay baray may hum kuch nahi jantay. Asal may, aap ko yaad ho ga keh 2014 may scientists nay Siberia kay barfili junglon say 30,000 saal purana virus nikal kar dekha tha. Unhon nay naya virus daryaft kiya tha aur phir khabardar kiya tha keh jaisay jaisay duniya ka barf pighalay ga, yeh virus nikalte rahen gay, aur in may say kuch nihayat khatarnak ho sakte hain.

**2. Asteroid Ki Takkar (Shahab-e-Saqib)**
Climate change aur virus kay baad teesra sabab ho sakta hai asteroid impact, aik asteroid ki takkar. Main aap ko bataon, har roz hamari Earth khatray may hoti hai. Chhotay patthar har roz is par girte hain. In may say kuch chawal kay daane say bhi chhotay hotay hain. Jabke kuch aap ki mutthi say bade nahi hotay. Lekin har kuch karodon saal may aisa zaroor hota hai keh pahar jitna bara meteorite zameen ki taraf aata hai. Aakhri dafa aisa tab hua jab dinosaurs duniya par hakoomat karte thay. 165 million saal tak dinosaurs nay is duniya par raj kiya, lekin aik din 10 ya 12 kilometer bara, Mount Everest say bhi bara aik pathar, meteorite, zameen ki taraf aaya aur itni zor say takraya keh jahan lagga wahan 200 kilometer crater bana diya. Aur yahi woh meteorite tha jis nay 165 million saal tak chalne walay daur ka khatma kar diya. Us waqt zameen par har bara jaanwar tabaah ho gaya. Un ke liye woh din qayamat ka din tha. To kaun jaane kab aisa koi aur pahar jaisa bara pathar phir is duniya ki taraf modh le? Lekin agar aisa na bhi ho, to aap ko maloom hai hamara kainaat musalsal phel raha hai. Har sitaron ka jhurmat, har galaxy aik doosray say door hoti ja rahi hai. Kainaat kay phelaao ki ek daleel Surah Al-Dhariyat may bhi milti hai: "Aur hum nay asman ko apni qudrat say banaya, aur beshak hum hi wasee' karne walay hain." Jab sab kuch door hota jaye ga, aur physics kay qawaneen kehtay hain keh agar yeh phelaao yunhi chalta raha, aur sitaron kay darmiyan fasla bohat ziyada barh jaye, to aik din yeh sitaray thanday ho kar bujh jayen gay. Sab kuch thand aur andheray may dafan ho jaye ga. Aur yeh kainaat ki thandi maut hogi. Lekin aisa bhi ho sakta hai keh jaisay kainaat phelta hai, phoolta hai, jaise aik balloon hawa bharne say phoolta hai. Agar aap balloon ko hawa say bhartay jayen, bhartay jayen, to aik naqta par kya hoga? Bilkul wahi hamaray kainaat kay saath bhi ho sakta hai.

**Deen Aur Qayamat**
To yeh thay kuch scienci aqwaat jahan science bhi maanti hai keh yeh saara kainaat dheemay dheemay apne anjaam ki taraf barh raha hai. Lekin tamam mazhab, khaas tor par Islam, is qayamat kay din par bohat zor deta hai. Quran pak ka aisa koi safa nahi jahan qayamat kay din ya us din ki koi baat zikr na hui ho. Islami aqaid ki buniyad is duniya kay tabaah honay aur us kay baad nayee zindagi kay aaghaz par hai. Baqarah ki aik aayat may hai keh neki yeh nahi keh aap apna rukh mashriq ya magrib ki taraf kar lein, balke haqeeqat may nekar insaan woh hai jo Allah aur aakhirat kay din par iman laye.

**Quran May Qayamat Kay 17 Naam**
Meri research may yeh baat samnay aayi keh is qayamat kay din kay liye Quran pak may kam az kam 17 naam hain:
1.  **As-Saa'ah:** Woh ghadi jab sab kuch tabaah ho jaye ga.
2.  **Yawm al-Ba'ath:** Qayamat ka din, jab sab kuch tabaah honay kay baad log qabron say uthayen gay.
3.  **Yawm al-Deen:** Insaaf ka din, yani jab sab kuch tabaah ho chuka hoga to insaaf hoga, pichli zindagi kay aamal ki buniyad par faisla hoga.
4.  **Yawm al-Hasrah:** Pachtaawah ka din, jab buray aamal walon ko pachtawah hogi.
5.  **Yawm al-Tanad:** Pukar ka din.
6.  **Yawm al-Fasl:** Faislay ka din, jab har faisla aamal ki buniyad par hoga.
7.  **Yawm al-Jam'aa:** Jama honay ka din, jab har makhlooq aik jagah jama ho gi.
8.  **Yawm al-Hisab:** Hisaab kitab ka din.
9.  **Yawm al-Wa'id:** Dar ya khabardar karne ka din. Isi liye hum bar bar is say dara kar ehthyat baratnay ko kehtay hain. Qayamat qareeb aa rahi hai.
10. **Yawm al-Khuruj:** Nikalnay ka din, jab har koi apni qabar say niklay ga.
11. **Al-Waaqiya:** Woh qayam shuda aafat jo waqai honay wali hai.
12. **Al-Haqqah:** Woh haqiqat jo waqai honay wali hai aur jisay nakara nahi ja sakta.
13. **Al-Tammatul Kubra:** Woh azeem aafat, kuch nahi bas tabaahi.
14. **As-Sakhkhah:** Woh kanpata hua, chinghari barsata hua dhamaka.
15. **Al-Azifah:** Woh jo aa kar rahnay wali hai.
16. **Al-Qaariya:** Woh khanjanay wali, jis kay aane say sab kuch larazne lage ga.
17. **Yawm al-Qiyamah:** Qayamat ka din. Is lafz "Qayamat" ki asal Arabic lafz "Qiyam" say aayi hai, jis kay ma'ani hain "khara hona". Yani woh din jab asmaan-o-zameen aur yeh kainaat aur is may jo kuch hai sab tabaah ho jaye ga, lekin us kay baad nayee dariya khule gi aur jo log mar chukay hongay, har koi apnay Rubb kay hukum say apni qabar say uth khara hoga, aur woh qayamat ka din hoga.

**Qayamat Ka Din: Marhalay, Raaz Aur Nishaniyan**

Islam may Qayamat kay din ka tasawwur bilkul wazih aur sidha hai, jo teen bari marhalon may guzarta hai.

**Pehla Marhala:** Yeh kay aasmaan, zameen aur jaisi jaan kar hum zindagi basar kar rahay hain, uska anjaam ho jaye ga.
**Dosra Marhala:** Yahan har makhlooq dobara zinda ho gi. Aur log apni qabron say niklay aur ek muqarrar jagah ki taraf rawana hon gay.
**Teesra Marhala:** Wahan puhanch kar, hum mein say har ek ko uski jaza ya saza say aagah kiya jaye ga. Is bunyad par keh hum ne is zindagi may kya kam kiye thay.

**Aik Ahem Aur Sangin Sawal: Qayamat Kab Aaye Gi?**
Ab aik bohat hi sangin sawal: Qayamat, jo itna aham din hai, aakhir kab aaye gi? Yeh woh raaz hai jo sadiyon say insani dilon may goonjta raha hai. Lekin us din ki haqeeqat sirf Allah Ta'ala kay paas hai; na koi falsafi, na koi scientist, na koi farishta is ka jawab de sakta hai. Yahan tak keh aakhri Nabi Muhammad (S.A.W.) say bhi kaha gaya tha keh "yeh log aap say qayamat kay waqt kay baray may puch rahay hain. Keh dijiye keh is ka ilm to sirf mere Rubb kay paas hai." Nabi (S.A.W.) nay ek martaba farmaya: "Panch cheezein aisi hain jinka ilm sirf Allah ko hai aur kisi ko nahi."
1.  Koi nahi janta keh maa kay pait may kya hai.
2.  Koi nahi janta keh kal kya hoga.
3.  Koi nahi janta keh kab barasat hogi.
4.  Koi nahi janta keh insaan kahan mare ga.
5.  Aur koi nahi janta keh Qayamat kab aaye gi.

**Hadith-e-Jibreel Aur Ahmiyat-e-Nishaniyan**
Phir aik sab say mashhoor hadith hai jo Hadith-e-Jibreel kehlati hai. Hazrat Umar ibn Al-Khattab (R.A.) se rivayat hai keh ek dafa hum Rasul Allah (S.A.W.) kay saath baithey thay. Achanak ek shaks aaya. Uski shakal-dekhal, kapron ki safayi aur baal ka siyah hona humaray liye hairat ka baais tha. Us shaks nay Nabi (S.A.W.) kay samnay beth kar teen ahem sawal puche. Pehla sawal tha: "Imaan kya hai?" Nabi (S.A.W.) nay uska khoobsurat aur tafseeli jawab diya. Dosra sawal "Ihsan" kay baray may tha. Aur teesra sawal yeh tha: **"Aye Allah kay Rasool (S.A.W.), Qayamat kab aaye gi?"**

Is kay jawab may Nabi (S.A.W.) nay farmaya: **"Jawab dene wala, sawal karne walay say ziyada ilm rakhne wala nahi hai."** Yani, jis tarah tum nahi jantay, main bhi nahi janta keh woh kab aaye gi. Phir us majhool shaks nay kuch nishaniyan poochin. Is hadith say yeh bhi samajh aata hai keh Qayamat ka **waqt** sirf Allah kay ilm may hai, lekin us ki **nishaniyon** ka ilm hasil karna zaroori hai. In nishaniyon ka maqsad duniya ki faniyat yaad dilana, imtihaan ki tayyari, waqt ki qadr, aur maut ki tayyari karna hai.

**Qayamat Ki Nishaniyon Par Be-Laghu Taweelat Ka Khhatra**
Leki aik bohat ahem baat: Qayamat ki nishaniyon par bahas kartay waqt aap kay zehn may sab say bara usool yeh hona chahiye keh har ma'lumat ka sarchashma sirf Quran-e-Hakim, Sahih Hadith, aur Sahabah kay aasaar hon. Aaj-kal bahut say log ek nishani ka ek pehlu utha kar us par apni kahani tashreeh kar daalte hain, jis say nishani ki asl haisiyat hi badal jati hai. Lihaza hum har maamlay ko Quran aur sahih hadith ki roshni may hi dekhen gay. Hum apni taraf say taweel nahi karen gay.

**Dosra Ahem Usool: Sab Nishaniyan Humaray Zamane May Poori Nahin Hon Gi**
Is baat ka koi zaroori nahi keh har nishani humaray zamane may poori ho chuki ho. Yaqeenan hum aakhir-e-zamana may jeetay hain, lekin kuch bari nishaniyan abhi baqi hain. Maslan, **Dabbat-ul-Arz** (zameen say nikalne wala janwar) abhi tak saamne nahi aaya. Lihaza, hum in nishaniyon ko dekhen gay, samjhen gay, lekin apnay zamane par har nishani lagane ki jaldi nahi karen gay.

**Aik Taqreeb: Fajr Se Maghrib Tak Nishaniyon Ka Bayan**
Hazrat Abu Zayd ibn Akhtar (R.A.) se rivayat hai keh ek dafa Fajr ki namaz kay baad Nabi (S.A.W.) mimbar par tashreef laaye aur Qayamat ki nishaniyon bayan karna shuru kar diya. Aap (S.A.W.) isi tarhan bayan farmatay rahey, yahan tak keh Maghrib ki azaan ho gai. Sahaba (R.A.) farmatay hain keh us din Nabi (S.A.W.) nay Qayamat tak ki koi bhi ahem fitna ya waqia chorra nahi, sab bayan farma diya. Unhon nay in fitnon ko ginna shuru kiya to dekha keh kuch fitne baday thay aur kuch chhotay. Lekin teen fitne aise hongay **jin say koi bhi mehfooz nahi rahay ga.**

**Nabi (S.A.W.) Ka Aana Aur Jana Bhi Nishaniyan Hain**
Khud Nabi (S.A.W.) ka mab'oos hona bhi Qayamat ki nishaniyon may say hai. Aap (S.A.W.) nay farmaya: "Main aur Qayamat is tarhan bhejay gaye hain," aur phir apni shahadat ki ungli aur beech ki ungli ko milaya. Isi tarhan Nabi (S.A.W.) ki wafat bhi Qayamat ki nishaniyon may say hai.

**Fitna Ka Ma'ana Aur Farq**
Urdu may "fitna" ka lafz fasaad ke liye istemal hota hai, lekin Arabic may is ka asl ma'ana hai "**Imtihaan, Aazmaish, Trial**." Lihaza, Qayamat ke qareeb aisi sakht aazmaishen saamne aayen gi keh insaan ke liye apna imaan bachana mushkil ho jaye ga. Nabi (S.A.W.) nay farmaya yeh fitnay raat ke tukron ki tarhan aayen gay. In may log thode say duniya ke maal ke badlay apna deen bech den gay.

**Aik Azeem Fitna**
Aur main nay aap ko bataya tha keh aisa aik fitna hoga jo **behra, goonga, andha** hoga, lekin agar koi shaks us may sirf **jhaank kar** bhi dekh lay, to woh us ka shikaar ho jaye ga. Fitnon ka zahoor ruka nahi. Guzishte 14 sau saal ke dauraan itne fitne ubharay ke un ka ihata hi nahin kiya ja sakta.

**Nabi (S.A.W.) Ki Paishangoiyan**
Aap (S.A.W.) ne farmaya: "Aisa girooh paida hoga jo Quran parhay ga lekin woh un ke halq se neeche na utray ga... Phir bhi woh deen se nikal jayen gay." Ek martaba Nabi (S.A.W.) Madeena ki ek oonchi jagah par tashreef farma kar pukaray: "Kya tum woh cheez dekh rahay ho jo main dekh raha hoon? Qareeb hai ke tumhare gharon par fitney is tarhan barasain jis tarah barish ke qatray barastay hain."

**Chhotay Dajjal: Jhootay Anbiya Ka Zahoor**
Ek hadees ke mutabiq Qayamat tab tak nahi aaye gi jab tak **30 jhootay Dajjal** zahoor nahi kar lete, jo khud ko Allah ka Nabi keh rahay hon gay. Halanke haqeeqat yeh hai keh Hazrat Muhammad (S.A.W.) aakhir-e-zaman ke Nabi aur khatam-un-nabiyyin hain. Un ke baad koi nabi nahi aaye ga. Ulema kehte hain keh ab tak Musaylimah samet **24** chhotay Dajjal aa chukay hain. **30** ki tadaad poori honay ke baad aakhri, **"Aaka" (Bara) Ainda Dajjal** zahoor karey ga.

**Naee Silsilay Ka Aaghaz**
Nabi (S.A.W.) ne farmaya: "Tumhari umar agli qaumon ki umar ke muqable mein itni hai jaise Asr se Maghrib tak ka waqt." Yeh silsila unhi Qayamat ki nishaniyon aur fitnon ke baare mein hoga ke woh kya hain, kaise aayen gay, aur hum InshaAllah un se apna bachao kaise kar saken gay.

InshaAllah agli qist mein baqi aur aage ki baten. Shukriya, aur Allah Hafiz.`
      },
      {
        title: "Episode 2: How The Time Will Change Near Qayamat",
        content: `**Bismillahir Rahmanir Raheem**

Assalamu Alaikum. Mera naam Furqan Qureshi hai aur aaj hum dekh rahay hain "Aakhir-e-Zamana" silsilay ki dusri qist. Aaj ki qist bohat khaas hai kyun ke aaj hum baat karen gay Qayamat ki kuch ahem nishaniyon ke baare mein. Un mein se aik nishani waqt ke mutaaliq hai, ke aakhir-e-zamana ke qareeb waqt kaise girftaar-e-zawal ho jaye ga.

**Duniya Ki Hifazat: Khudawandi Nizam**
Yeh hamari duniya, yeh zameen, hamara ghar hai. Quran-e-Hakim ne is ghar ke khuobsifat siftat bayan ki hain. Maslan, yeh zameen insaan ke liye qarar gaah banayi gai hai aur Allah Ta'ala ne behtareen tadbeer se isay paida kiya hai. In behtareen tadbeeron mein zameen ke gird quwwatwar hifazati nizam hain jo isay kainati hamlon se bachatay hain. Maslan, Ozone Layer jo asmaan se aane wali ultraviolet radiation se hifazat karti hai. Agar Ozone Layer na hoti to hum mein se har shaks jild ke cancer jaisi bimariyon ka shikar ho sakta tha. Phir is ke baad, zameen ka Magnetic Field – aik aisa ghair-maroosi libaas jo hamari duniya ko lipat kar rakha hai, aur jo sooraj aur faza se aane wali harqat dar radiation se hifazat karta hai. Agar yeh magnetic field na hota to shayad is zameen par kisi qisam ki zindagi mumkin na hoti.

**Khatra: Kamzoor Hota Hua Magnetic Field**
Lekin kuch arsey pehle scientists ne aik chonkanay wala inkishaaf kiya: hamara magnetic field kamzoor ho raha hai. 2014 mein pehli martaba Atlantic Ocean ke oopar is field mein aik darar payi gai. Us waqt darar bohat choti thi, lekin 2025 tak, yaani sirf 11 saal mein, yeh darar Europe ke aadhey hissey ke barabar ho chuki hai. Ab scientists kehtay hain ke yeh magnetic field flip hone ke bohat qareeb hai. Aur jab yeh field flip ho jaye gi, to jaaniye ke hamari technology bhi Stone Age ki taraf palat jaye gi. Communication systems, GPS, satellites, computers, internet – sab kuch bekaar ho jayega aur hum phir se hazaron saal pechay, teer-o-kamaan ke daur mein pahunchen gay.

**Mythology Mein Tasawwurat: Wapasi Stone Age Ki**
Aise daur ke mutaaliq duniya ki taqreeban har deen aur mythology mein paishangoiyan maujood hain. Norse mythology (Ragnarok), Hinduism, Bible (Book of Revelations), Chinese mythology, aur Mayan aur Aztec tahzeeb – sab mein is baat ka zikr hai ke duniya ke anjaam se pehle phir se pathron, lakrion aur talwaron ka daur aaye ga.

**Deen-e-Islam: Nishaniyon Ka Khazana**
Lekin Qayamat se pehle ke aakhir daur ki nishaniyon aur paishangoiyon ka jo khazana Islam ki roshni mein milta hai, usey dekh kar insaan hairan reh jata hai. Islami adab mein Qayamat ke qareeb hone par 70 se 100 chhoti aur 10 se 20 bari nishaniyon ka zikr milta hai.

**Aik Khaas Nishani: Waqt Ka Tezi Se Guzarna**
In mein se aik ahem nishani hai: **waqt ka tezi se guzarna**. Sahih Hadith mein aata hai ke Nabi (S.A.W.) ne farmaya: "Qayamat tab tak qayam nahi hogi jab tak waqt qareeb na aa jaye, (yani) aik saal mahine ki tarah ho jaye, aik mahina haftay ki tarah, hafta din ki tarah, din ghante ki tarah, aur ghanta is tarah ho jaye jaise aag ki chingari."

**Aam Tabeer: Barkat Ka Uth Jana**
Is ki aam tabeer yeh ki jati hai ke waqt se barkat uth jaye gi. Mahina shuru huwa aur khatam ho gaya, aisa mehsoos hoga. Lekin is Hadith mein chupa huwa ek bara raaz bhi hai.

**Gregorian Calendar: Waqt Ke Saath Khilwad**
Hamara aaj ka calendar – January, February – jisey Gregorian Calendar kehtay hain, duniya bhar mein istemal hota hai. Kya aap jantay hain ke yeh calendar hamari zindagiyan tabah kar raha hai? Yeh calendar 1582 mein Pope Gregory XIII ne jaari kiya tha, aur is ka maqsad waqt ka hisaab rakhna nahi, balke Easter ke din ko yaad rakhna tha. Is calendar ko banatay waqt waqt ke saath bari khilwad ki gai:
* Mahinon ke din taqreeban be-tarteeb hain.
* Mahinon ke naam un ke asal tartib se nahi miltay. Maslan, 'September' lafz 'septem' (7) se bana hai lekin yeh 9va mahina hai. 'October' 'octa' (8) se, lekin yeh 10va mahina hai. Yani naam kuch aur, haqeeqat kuch aur.
* October 1582 mein logon ne 4 October ki raat ko so kar 15 October ki subah dekhi – 10 din insani tareekh se hamesha ke liye ghayab kar diye gaye!

**Nateeja: Masnoi Nizam Mein Zindagi**
Is tarah waqt ke tabdeel shuda, masnoi nizam ke tehat hum zindagi basar kar rahay hain. Isi liye hum waqt ke saat ham-ahang nahi. Hamein mehsoos hota hai waqt bhaag raha hai, waqt kam hai. Humara poora din tana-ao mein guzar jata hai.

**Khulasaa**
Haqeeqat yeh hai ke aakhir-e-zamana ki yeh bari nishani sirf barkat ke uth janay tak mehdood nahi, balke is ke piche ek bohat bari haqeeqat chupi hui hai. Hum ek aisi dunia mein reh rahe hain jahan waqt ki pemaish hi tabdeel shuda hai. Gregorian Calendar ne waqt ke tabii daur ko kharab kar ke humein ek aisi khud-sakhta ghulami mein dhaal diya hai jis ka anjaam sirf be-chaini aur zehni tashannuj hi nahi, balke aakhir-e-kar us azeem inqilab ki taraf bhi ishara hai jis ka zikr hadith mein milta hai.

**Waqt Ki Haqeeqat: Masnoi Nizam Ka Shikar**
Kainaat keh rahi hai ke main to apni rawish par chalti rahoon gi, lekin tum log kisi aur hi calendar ke tehat "new year" mana rahay ho. Asal mein, 24 ghantay ek masnoi pemaish hain. Insani fitrat kabhi bhi 24 ghantay ke lehaaz se design nahi thi. Yeh "linear time" ka ghalat aqeedah hai – ke waqt sirf seedhi line ki tarah barhta chala jata hai. Aaj hum jantay hain ke waqt linear nahi, balke **spiral** hai, jaise keh seedhi. Har cheez kainaat mein dairein lagati hai, chakkar kaati hai: din-raat ka chakra, mausamon ka chakra, chaand-sooraj ka chakra. Quran farmata hai: Sooraj, chaand, din, raat – har aik apne apne dairay mein tair raha hai. Yeh charon mil kar hamara waqt banatay hain.

**Ajeeb Haqeeqat: Har Janwar Ke Liye Waqt Mukhtalif**
Har makhlooq ke liye waqt ka anjam mukhtalif hai. **Flicker Fusion Rate** ke mutabiq, insani dimaag aik second mein 30 "frames" dekh sakta hai, jabke baaz (falcon) ka dimaag 100 frames/second dekh sakta hai – jo keh humaray liye slow motion hai. Isi liye baaz itni tez raftaar se hamla kar sakta hai. Makkhi 250 frames/second dekh sakti hai, us ke nazdeek waqt ultra-slow motion mein chalta hai. Isi tarhan **Ashaab-e-Kahf** ke liye 309 saal ka neend sirf din ke kisi hissey ke barabar tha, kyun ke Allah Ta'ala ne unhen waqt ke spiral ke ek hissey se doosray hissey mein seedha phuncha diya tha.

**Dajjal Aur Waqt Ki Khilwad**
Aagay chal kar, **Dajjal** waqt ke saath phir khilwad karey ga. Woh calendar ko aur ulta-pulta karey ga, khayali manazir paida karey ga. Din ko raat aur raat ko din dikhaye ga. Us ke 40 dinon mein se ek din ek saal ke barabar hoga, ek din ek mahine ke, ek din ek haftay ke barabar hoga – bilkul usi tarhan jaise Pope Gregory XIII ne 10 din ghayab kar ke ek din bana diya tha. Dajjal tabii waqt ke daur ko kharab karey ga aur usi waqt ke ikhtilaf (temporal distortion) mein se us ka gadha (jo keh bohat baray kaanon wala hoga) zahoor karey ga.

**Ilm Ka Uth Jana: Aik Azeem Nishani**
Dusri bari nishani **ilm ka uth jana** hai. Yeh is tarhan nahi keh kitabain ghayab ho jayen gi, balke Allah Ta'ala **auliyā-e-ilm** (scholars) ko utha le ga. Jab aalim na rahen, to log jahilon ko apna rahnuma banayen gay. Yeh jahil log be-ilmi fatwe jarien karen gay, khud bhi gumraah hongay aur dusron ko bhi gumraah karen gay.

**Amli Misalen: Ilm Ke Zawal Ki**
Is ki amli misal Morocco, Algeria, Tunisia aur Africa ke baaz musalman ilaqon mein maujood "sects" hain. Yeh log apne aap ko musalman kehtay hain lekin un ke amal mein jinnat ko khush karne ke liye raqas, dhol, qurbaniyan aur khoon charhana shamil hai. America mein **Nation of Islam** naam ka girooh 1930 mein ek aise shaks ne banaya jo khud ko "khuda" kehne ka da'wa karne laga (naudhubillah). Yeh sab is baat ki nishani hain ke jab aalim utha liye jatay hain to log gumraah ko hi rahnuma bana lete hain.

**Aagay Anay Wala Daur: Zikr-e-Ilahi Ka Khatam Hona**
Hazrat Hudhaifah (R.A.) se rivayat hai keh Nabi (S.A.W.) ne farmaya: "Islam is tarhan zawal pazir ho ga jaise kapray ka rang ud jata hai... log na namaz ko pehchanen gay, na roze ko, na hajj ko, na zakat ko... phir aik raat Quran bhi utha liya jaye ga." Hazrat Abdullah ibn Mas'ud (R.A.) ke mutabiq, log raat ko Quran parh kar so jayen gay aur subah uth kar sirf "La ilaha illallah" tak bhool jayen gay. Is daur se pehle hi Allah humein apne paas bula le. Ameen.

**Haram Cheezon Ko Halal Kar Lena**
Aik aur nishani yeh hai keh log **zina, resham, sharab aur aalaat-e-mosiqi** (musical instruments) ko halal kar len gay. Aaj ke daur mein zina aur sharab to aam hai, lekin sharab ko dusray naamoon (jaise "dawaai") se peeya ja raha hai.

**Resham (Silk) Ki Hurmat Ka Raaz**
Resham ki hurmat ke peechay char parat hain:
1.  **Zahiri Ma'ani:** Yeh mehnga kapra hai jo ghuroor aur fakhr ka baais banta hai.
2.  **Ishara:** Resham narmi aur nazaqat ki nishani hai, jabke mardon ke liye Islam sadgi, javanmardi aur saabit-qadmi ki targeeb deta hai.
3.  **Ibraat:** Jannat mein resham ka libas ata hai. Dunya mein is se parheiz jannat ki talab ko zahir karta hai.
4.  **Raaz (Chothi Teh):** Resham banane ka tareeqa zaalimana hai. Resham ka keera apna kokoon banata hai. Insan is kokoon ko khaulte huay pani mein daal kar keere ko zinda jala deta hai takay resham ka dhaga nikal sake. **Aik resham ka kurta 10,000 se ziyada bekas keeron ki qurbani mangta hai** – yeh ek be-mehrangi, zahiri araam aur tabahi ka nishan hai.

**Khatma**
Aaj ki bahas yahan khatam karte hain. In nishaniyon ko samajhna hamaray liye chatan ka waqt aane se pehle bedari ka kaam hai. Apna waqt tabii daur se jorain, asal ilm haasil karne ki koshish karein, aur haram se bach kar rahein. 

**Shukriya, Allah Hafiz.**`
      },
      {
        title: "Episode 3: Music, Dajjal and the End of Times",
        content: `**Bismillahir Rahmanir Raheem.**

Assalamu Alaikum. Mera naam Furqan Qureshi hai aur aaj hum dekh rahay hain 'Aakhir-e-Zamana' silsilay ki teesri qist. Jis mein hum baat karain gay kuch aisi bohat ahem nishaniyon ke baare mein jo qayamat ki nishaniyan hain. Aisi nishaniyan jo is waqt hamari rozmarra ki zindagi ka hissa hain.

Kuch nishaniyon par hum mukhtasiran guzarish karen gay, lekin kuch nishaniyon ki hum aaj bohat tafseel mein jaan karen gay. Aur in mein se pehli nishani hai mosiqi ka inteshaar.

Hamare piyare Nabi, aakhir Nabi, Muhammad (Sallallahu Alaihi Wasallam) ne riwayat farmaya ke meri ummat par "khasf", "qazf" aur "maskh" aayega. Yani zameen dhans jaye gi, aasman se patthar barasain gay aur chehre badal jayen gay.

Log hairat mein parh gaye aur poocha: "Aye Allah ke Rasool (Sallallahu Alaihi Wasallam), yeh kab hoga?"
Aap ne jawab diya: "Jab log sharab peen gay, aur gaane walian (awaz ke saath) gaayen gi, aur mosiqi bajai jaye gi."

Hum aaj is hadith par tafseel se, InshaAllah, nazar dalain gay ke zameen kaise dhans sakti hai, patthar kaise baras saktay hain aur chehre kaise bigar saktay hain.

Main aap se darkhwast karta hoon ke video shuru hone se pehle Allah Ta'ala se ek martaba astaghfar zaroor parh lein, taake woh aaj humein jin fitnon ke baare mein jaan kar rahen hain, un sab se hifazat farmaye.

**Sab se pehle, mosiqi ke baare mein kuch ma'alumaat, aakhir yeh hai kya? Mosiqi ki tareekh kya hai? Aur sab se ahem, isko haraam kyun samjha jata hai? Aur itni tafseel mein janay ki wajah yeh hai ke aaj kal ke daur mein taqreeban har shaks, chand logon ko chod kar, mosiqi mein mubtila hai.**

Mosiqi ki tareekh bohat purani hai. Aaj se 40,000 saal pehle bhi insaan khaali haddiyon se bansi jaisay aalaaz banatay thay. Aur Germany mein khudai ke douran mili "Vogelherd Flute" aisi bansi ki aik umda misaal hai.

Qadeem Mísr aur Mesopotamia mein bhi mosiqi ka aik ahem roohani darja tha. Aur Mesopotamia, yani Sumeria aur Babylon waghera, wahan ke log baqaida "hymns" gaaya karte thay. Yani aik qisam ke mazhabi geet.

Phir qadeem Hindustan. Aap ko maloom hi hoga ke sanatam dharm ke qadeem sastro mein bhi paak geeton ka zikar milta hai. Khaas taur par **Sama Veda** mein. Sama Veda ko raagon ki maa kaha jata hai, aur yahin se raag, taal, lay jaise lafz nikalay.

Lekin mosiqi ko sab se pehle aik scienci mutala ke taur par qadeem Yunanion ne dekha. **Pythagoras** pehla Yunaní falsafi tha jis ne suron ke darmiyan nisbat (ratios) daryaft kiye.

Is ke baad musalman scienciyon ne bhi mosiqi mein chupi razon par bohat kaam kiya. 10vi sadi ka aik musalman scienci **Al-Farabi** ne asal mein ek mukammal kitab "Kitab al-Musiqi al-Kabir" likhi jis mein suron aur un ki physics ka mukammal tajzia kiya gaya.

Yeh mosiqi ki mukhtasir tareekh thi. Lekin musalmanon ki baat ki jaye to Nabi (Sallallahu Alaihi Wasallam) ke zamane mein sirf **daf** ka riwaj tha. Hadith se zaahir hai ke Eid, shadiyon aur jung se wapasi jaise mauqon par daf aksar bajayi jati thi. Aur jab Rasoolullah (Sallallahu Alaihi Wasallam) pehli martaba Madeena tayyaba tashreef laye to us waqt Bani Najjar ki larkiyon ne bhi daf baja kar aap ka istiqbal kiya tha.

Fi'al-haal, duniya mein mosiqi paida karne ke liye taqreeban 1500 mukhtalif aalaaz maujood hain. Lekin Nabi (Sallallahu Alaihi Wasallam) ke zamane mein sirf daf hi bajayi jati thi, aur daf hi kyun? Is ki wajah bhi main aage batata hoon.

Balki, Nabi (Sallallahu Alaihi Wasallam) ke baad musalman duniya mein mosiqi tezi se taraqqi karne lagi. Baghdad ke dour mein khalifa Haroon-ur-Rashid aur Mamoon-ur-Rashid ne funoon ko bohat himayat di. Mosiqi ki nayee soorten ubhar kar saamne aain.

Usi dour mein aik funkaar paida hua jo us daur ka fashion designer, musician aur artist tha, aap keh sakte hain. Jis ne Cordoba mein aik institute qaim kiya jahan mosiqi ki taleem di jati thi.

11vi se 13vi sadi tak, jab Rumi aur Amir Khusro jaise sho'ara mashhoor thay, us waqt mehfilon aur qawwali ko bohat promote kiya gaya. Phir Mughal daur aaya.

Badshah Akbar ke darbaar mein **Tansen** naam ka shaks tha, jis ke baare mein mein yaqeenan aap ne suna hoga. Un ka asal naam Ram Tanu Pandey tha, lekin baad mein unhon ne Islam qabool kar liya. Usey Hindustani mosiqi ka imam kehtay hain aur kehte hain ke unhon ne kuch sur aisay banaye, jaise Miyan Ki Malhar aur Deepak Raag, jis se barish ke qatray girnay lagtay thay aur bujhi hui mashalain jal uthti thin. Yeh kehte hain, tareekhi tor par yeh cheezein haqeeqat hain ya nahi, yeh alag baat hai.

Har shaam Mughal darbaar mein mosiqi ki mehfil jamti thi. Badshah Jahangir khud bohat ache gaate thay. Un ko suron ka bhi gehra ilm tha, jabke Shah Jahan ke daur mein fine arts apni inteha ko pahunch chuki thin.

Unhon ne aik **Naubat Khana** (royal music house) bhi banwaya jahan roz muqarrra waqt par shehnaian aur tablay bajtay thay. Phir Taj Mahal hai, jise Shah Jahan ne banwaya, lekin us ke sab se barey goombad ki acoustic design aisi hai ke jab koi gawwaiya neeche khara ho kar gaata hai to hawa mein us raag ki aawaz kayi martaba gunjti hai.

Lekin baad mein, Aurangzeb Alamgir, jo deen ki taraf ziyada maail thay, unhon ne mosiqi par pabandi lagadi, aur aik bohat mashhoor waqia hai. Ek dafa Aurangzeb Jumma ki namaz se wapas aa rahay thay aur unhon ne kuch logon ko taboot uthaye huay dekha. To Aurangzeb ne pucha: "Kiska janaza hai?" Logon ne jawab diya: "Huzoor, aap ne mosiqi ko qatal kar diya hai, usi ka janaza hai." Aurangzeb tez-tab' thay, kehne lagay: "Achha, theek hai, le jao, lekin achi tarah dafna dena, khabardar jo qayamat se pehle bahar aayi."

Lekin aaj, khwa musalman duniya ho ya ghair-musalman duniya, mosiqi ne har mulk ko apne gird gher liya hai. Duniya bhar mein har roz hazaaron concerts ho rahay hain. England mein **Live Nation** naam ka aik institute hai, aur unhon ne report di ke sirf 2023 mein hi unhon ne 50,000 concerts organize kiye, aur har concert mein kam az kam 5,000 log shamil hotay hain.

Ab aik aham sawal yeh hai ke mosiqi ko haraam kyun samjha jata hai? **Surah Luqman** mein aik aayat hai ke: "Logon mein se kuch aise bhi hain jo 'lahwal hadith' (bay-faida baat) khareedte hain, taake logon ko Allah ke raaste se behka den."

Nabi (Sallallahu Alaihi Wasallam) ke sahabi, Hazrat Abdullah bin Masood (Radiallahu Anhu) ne qasam kha kar bayan kiya ke yeh aayat **mosiqi aur gano** ke hawalay se nazil hui hai. Aur Ibn Abbas (Radiallahu Anhu) ne bhi yahi tafseer di. Wohi tafseer ke agar mosiqi Allah ke zikr se gaflat dalay ya gunah ki taraf lay jaye, to yeh bhi is aayat mein zikr ki gayi 'bay-faida goi' ki definition mein aata hai.

Phir **Surah Al-Isra** ki aayat 64 mein zikr hai ke jab Allah Ta'ala ne Iblis se farmaya ke aasman se nikal ja. Us mein Iblis se yeh bhi kaha gaya: "Ja... jis ko bhi tu apni aawaz se bahka sakta hai, insaano mein se, bahka le. Mere sachay bandon par tera koi zabt nahi."

To kuch mufassireen is aayat ki tafseer karte hain ke Iblis ki aawaz asal mein gaana-baja hi ka dusra naam hai.

Is tarah, in aayaton ki roshni mein Quran ka hukam wazih hai ke mosiqi haraam hai. Aur kyun haraam? Is ki wajoohat ko do badey aasan mein taqseem kiya ja sakta hai.

Pehli qisam akhlaqi wajoohat hain, jo ke bohat seedhi hain, ke gaano mein jo lyrics istemal hotay hain, woh aksar insaan par asar daalte hain, kabhi bohat sharmnaak tareeqon se. Is hissay ki tayyari ke douran, khaas taur par pichle kuch saalon mein, main aise geet dekhe hain jinke lyrics itne fahash hain ke main aap ke saamne un ka zikr bhi nahi kar sakta. Aise geet jo aap apne khandaan ke saath beth kar sun bhi nahi sakte.

To akhlaqi wajoohat ka aik pehlu yeh hai ke aise geet muashray mein burai ko promote karte hain.

Lekin mosiqi ke haraam honay ki scienci wajoohat bhi kuch kam nahi hain. Yahan se kuch lafz technical hon gay, lekin phir bhi main apni puri koshish karoon ga ke bahas ko itna aasan rakhun.

Dekhiye, tez le (high tempo) ya bohat ziyada bass wali mosiqi dimaag mein woh hormones release karti hai jo lutf (pleasure) ka baais bantay hain. Science ki zubaan mein in hormones ko **dopamine** kehte hain. Aur jab insaan aise geet bar bar suntay rehtay hain, to dimaag tabii khushi ki bajaye is masnoi khushi ka aadi ho jata hai, aur yeh woh halat hai jisey Quran 'lahw' ya gaflat mein kho janay se yaani tabii khushi ki bajaye masnoi khushi ki talab se ta'beer karta hai.

Dosri scienci wajah: Lagatar aawaz ka shor ya tez le ki mosiqi, jaise heavy metal ya dark-trap genres, sympathetic nervous system ko ziyada activate kar deti hai, jis se khauf, be-chainī aur pareshani jaisi halatein paida hoti hain. Yani insaan ka jism har waqt be-jaa chokanna rehta hai, jaise khatre mein ho, jis se din bhar be-chainī banī rehti hai.

Teesri wajah, jaise neuroscience batati hai, mosiqi ka dimaag ke khaas hissay par ziyada asar hota hai, wohi hissa jis par narcotics (drugs) ka asar hota hai. Is liye mosiqi ki lambi aadat aik qisam ki aadat (addiction) ya inhisaar paida kar sakti hai. Aur isi liye kuch log kaam nahi kar patay, mosiqi ke baghair apna kaam poora nahi kar patay. Un ke liye sona mushkil ho jata hai, ya khamoshi bardasht ke qabil nahi rehti. Aap aise logon ko dekhen gay jo tez ya buland aawaz wali mosiqi ke baghair drive hi nahi kar sakte. Psychology ki zubaan mein ise **psychological dependence** kehte hain. Islam ki zubaan mein ise roohani ghulami kehte hain.

2016 ki **Frontiers in Psychology** ki aik study ke mutabiq, woh log jo rozana 4 se 6 ghantay mosiqi suntay hain, agar yeh mosiqi band kar di jaye to yeh log **withdrawal symptoms** dikhanay lagtay hain. Maslan, tanao, chirchira pan, ya depression, kyun ke unhen woh cheez nahi mil rahi jo woh chahtay hain. Yeh aik qisam ki aadat hai.

Chothi wajah, udaas ya ranjgeen geet insaan ke dimaag mein takrari jazbaati daire (emotional loops) paida kar detay hain. Matlab woh dimaag mein wahi jazbaat bar bar paida karte hain. Is surat-e-haal mein woh udaasi aur gham ke jazbaat ko aur bhi shadeed kar dete hain, jis ka nateeja yeh hota hai ke insaan aur bhi pareshaan aur stressed ho jata hai.

To yeh thi woh akhlaqi aur scienci wajoohat jin ki bina par mosiqi ko haraam (forbidden) samjha jata hai. Haan, lekin **daf** aisa aala hai jiska zikr Hadith mein aaya hai.

Hazrat Aisha Siddiqa (Radiallahu Anha) se rivayat hai ke ek baar Eid ke din Nabi (Sallallahu Alaihi Wasallam) ghar tashreef laaye. Aur do larkiyan daf baja rahi thin. Hazrat Abu Bakr (Radiallahu Anhu) ne unhen rokna chaaha, lekin Nabi (Sallallahu Alaihi Wasallam) ne farmaya: "Chorh do unhen, aye Abu Bakr. Har qaum ke liye Eid hoti hai jis mein woh khushi manaate hain."

Is ke alawa daf se mutaliq aur bhi bahut si Hadith hain. Is liye ulema kehte hain ke daf kuch shara'it ke tehat bajaya ja sakta hai.

To sawal yeh hai ke daf mein aisa kya hai jo isay dusri qisam ki mosiqi se mukhtalif banata hai? Jawab yeh hai ke daf bohat hi saada aala hai jo **sur (melody)** paida nahi karta, balke sirf **taal (rhythm)** paida karta hai. Is ki aawaz tabii dil ki dhadkan ya qadam ki chaap jaisi hoti hai, jo ke uksahati to deti hai lekin bohat hi mehdud andaz mein. Qadeem ulema kehte hain daf "beat" hai lekin "sur" nahi.

Phir science yeh batati hai ke daf 70 se 130 Hz ke darmiyan kaam karta hai, aur yeh woh daaira hai jis mein dil ki dhadkan aur dimaag ki **theta waves** kaam karti hain. Yani woh halat-e-dimaag jo tabii sukoon mein haasil hoti hai. Phir, baqi mosiqi ke aalaaz **harmonic overtones** paida karte hain, jo phir dopamine ya masnoi lutf paida karte hain, jabke daf sirf ek beat paida karta hai, jaise dil ki tabii thapki.

Aur bhi bahut si wajoohat hain, lekin daf bajana bhi ek hadd tak jaiz hai. Ek martaba ek kali aurat ne araz ki: "Aye Allah ke Rasool (Sallallahu Alaihi Wasallam), main ne yeh mannat mani thi ke aap jung se salaamat wapas aaye to main khushi ka izhaar daf baja kar karoon gi." Nabi (Sallallahu Alaihi Wasallam) ne farmaya: "Agar tum ne mannat mani hai to bajao, warna nahi."

To mosiqi ki tareekh aur is ke haraam honay ki yeh baat khatam hui. Aur main ne aap ko bataya tha ke main itni tafseel mein is liye ja raha hoon kyun ke aaj kal taqreeban har ghar mosiqi jaise amoor mein mubtila hai.

Ab ham us asli hadith ki taraf barhtay hain ke jab poore jazbay ke saath gaane aur mosiqi ke intezam kiye jayen gay, aur mosiqi aam ho jaye gi, to zameen dhans jaye gi, patthar barasain gay aur chehre bigar jayen gay.

Yeh baat Rasoolullah (Sallallahu Alaihi Wasallam) ne farmayi. Yeh hamara aqeeda hai. Quran aur Hadith ne jo kuch bataya hai, humein us par bilkul yaqeen hai. Haan, lekin aik zeli sawal zehan mein uthta hai ke kya mosiqi ka zameen ke dhansnay ya patthar girnay se koi seedha talluq hai? Ya kya koi tabii mazhar se is ka seedha ta'aluq hai? Zahir mein aisa lagta hai ke mosiqi aur zameen ke dhansnay mein kya talluq hai? Lekin agar aap gaur karein to aap aik hairat angez nateeje par pahonchen gay.

Mosiqi hai kya? Woh **larzishein aur vibrations** hain. Jab guitar ka taar chheda jata hai, to wah tezi se larzta hai, aur nateeja woh aawaz hai jo hum suntay hain.

Ab main ne aap ko bataya ke is waqt duniya bhar mein hazaaron concerts ho rahay hain. Is waqt bhi, jab aap yeh video dekh rahay hain, to kaun jaane duniya bhar mein kitni live shows aur concerts chal rahi hain, itni mosiqi ki larzishon ke saath. Yehn sab larzishein duniya ki zameen, hawa aur pani ko mutasir karein gi.

Buland aawaazein ya larzishon ka lagatar silsila zameen ki crust mein micro movements paida karta hai. Geophysics ke tajarbaat ne sabit kiya hai ke lagatar larzishein dheelhey matti ke zarrat ko hilati hain. Yeh dhansnay ki ibtidaayi soorat hai.

To zameen, jo Quran ki aik surah ke mutabiq, aik zainda hasti hai, us ki shaooriyat hai. Jab insaan apni anokhi mosiqi se us ke roohani dairey (field) ko kharab kare ga, to zaahir hai ke zameen is par react kare gi. Woh pareshan ho gi. Aur phir woh zameen ke dhansnay ki soorat mein saamne aati hai, matlab aasan alfaaz mein yeh mumkin hai ke barhti hui mosiqi aur us ki larzishein micro level par is duniya ko badal rahi hain.

Dusri cheez hai **'qazf'**, yani aasman se patthar girna. **Olay (hailstones)** aasman se girte hain, yeh to hum sab jantay hain. Kabhi kabhi olay nihayat khatarnak ho jate hain, hum ne yeh bhi dekha hai. 1360 mein, France ki kuch jungon ke douran bohat shadeed aur barey olay ka toofan aaya, aur woh olay itni shadeedī se gir rahay thay ke France mein aik hi raat mein 1000 se ziyada sipaahī qatal ho gaye. Aaj bhi yeh waqia history mein **Black Monday Hailstorm** ke naam se milta hai, aur tareekh-daaron ne likha hai ke woh olay shutar-murghabi (ostrich) ke andon jitnay baray thay aur aasman se pattharon ki tarah gir rahay thay.

Phir 1986 mein Bangladesh mein tareekh ka sab se burā olay ka toofan aaya. Har olay ka wazan taqreeban aik kilo tha. Aur aisa lag raha tha jaise chhotay patthar aasman se gir rahay hon.

Phir Himalayas mein aik jheel hai **Roopkund Lake** ke naam se. Kuch saal pehle wahan sau insaano ki haddiyan milin, aur National Geographic ne apni research ke baad report kiya ke yeh shayad woh haaji thay jo wahan pahunche aur ek azeem olay ke toofan mein phans kar sau ki tadad mein qatal ho gaye.

Asal mein, mujhe yaad hai ke kuch mah pehle Pakistan mein bhi ek shadeed olay ka toofan aaya tha, jis ne solar panels ko kafi nuqsan pahonchaya. Ab yahan se aap ko bohat gaur se sunna hai.

Olay tab bantay hain jab badalon ke andar darja-e-hararat jamad honay se neeche chala jata hai. Paani ke qatray barf mein badal jatay hain, lekin kabhi kabhi hawa ki gard is barf ke tukdon mein phans jati hai. Aur us waqt olay technically ek barfīla patthar ban jata hai. Aur ab sochiye, agar olay is soorat mein barey barey girnay lagain, to yaqeenan aisa lagta hai jaise barey patthar aasman se gir rahay hain. Yeh pehle bhi tareekh mein hua hai aur phir hoga. Yahan hum Allah Ta'ala se dua karte hain ke woh humein is khaufnaak azaab se mahfooz rakhe.

Aur ab teesri cheez hai **'maskh'**, yani chehron ka badalna. Ek hadith mein zikr hai jahan Nabi Muhammad (Sallallahu Alaihi Wasallam) ne farmaya ke meri ummat ke kuch log sharab is ka naam badal kar peen gay. Gawwaye gaayen gay aur geet pesh karen gay. Woh poori raat in cheezon mein guzaren gay, aur subah un ke chehre bandaron aur suwaron mein badal chukay hon gay. Hum is bad-tareen azaab se mehfooz rakhe jayen. Aameen.

Woh log poori raat mosiqi aur sharab mein guzaren gay, aur subah uth kar suwaron aur bandaron mein tabdeel ho chukay hon gay. To kya mosiqi sunnay se insaan ki soorat badal sakti hai?

**Surah Al-Isra**, aayat 59 mein irshad hai:
"Hum apni nishaniyan is liye nahin bhejte ke logon ko darayein." Sooraton ki tabdeeli ek nishani hai jo darane ke liye bheji jati hai aur dusron ke liye sabaq ban jati hai.

Yeh nishani pehle bhi aa chuki hai. Masalan, **Surah Al-Ma'idah** ki aayat 60 mein, jahan Allah ne kuch logon par la'nat ki aur unhen bandaron aur suwaron mein tabdeel kar diya. Aur in mukhaffaf logon ka zikr **Surah Al-Baqarah** aur **Al-A'raaf** mein bhi milta hai.

To kya aaj duniya mein maujood suwar ya bandar wohi mukhaffaf qaumien hain? Aap ko maloom hai, suwar ka DNA insani DNA se qareeban 95% milta julta hai. Dusre mulkon mein **Xenotransplantation** ke liye, jab janwar ka koi organ insani jism mein lagaya jata hai, to pehla janwar jis ka khayal kiya jata hai woh suwar hai. Aur shayad aap ko yaad ho ke do sade pehle unhon ne suwar ka dil ek insan ke jism mein transplant kiya tha.

Phir us ka hazmi nizam bilkul insan jaisa hai. Lekin us mein ek cheez aisi hai jo misali si ban gai hai. Woh aasman ki taraf nahi dekh sakta kyun ke us ki gardan ke pathay bohat chhotay aur sakht hain, is liye uska sir hamesha zameen ki taraf jhuka rehta hai. To yeh cheez aik tarah se ramzi ban gai, ke yeh janwar aasman se mahrūm hai, yeh tabdeel shuda qaum hai. Is liye ise aasman ki taraf dekhne se rok diya gaya.

Aur isi tarhan bandar. Un ka DNA insan se 93% milta hai. To kya matlab yeh ke tamam suwar aur bandar, kya yeh tabdeel shuda qaumein ho sakti hain? To jawab hai: nahi.

Hazrat Abdullah ibn Masud (Radiallahu Anhu) riwayat karte hain ke ek dafa hum ne Nabi (Sallallahu Alaihi Wasallam) se pucha ke kya yeh bandar aur suwar pehli qaumon ki mukhaffaf sooraten hain? Nabi (Sallallahu Alaihi Wasallam) ne jawab diya: "Nahi." Jis qaum par Allah ne la'nat ki aur un ki soorten bigaardi, un ki nasal un ke baad baqi nahi rahi. Yeh janwar un se pehle se maujood thay, lekin jab qaumon ko azaab diya gaya to un ki soorten un jaisi kar di gai.

Aur Nabi (Sallallahu Alaihi Wasallam) ne sahi farmaya. Suwar is duniya mein taqreeban 20 crore saal se maujood hain. Aur aaj un ki 500 se ziyada aqsam hain. Phir bandar 3 se 4 crore saal purana janwar hai, aur aaj duniya mein 250 se ziyada aqsam hain. Lekin yeh bilkul alag janwar hain. Yeh mukhaffaf qaumein nahi hain.

Balki, kuch logon ko aisa azaab diya gaya hai ke un ki soorten badal di gai. Unhen un jaise bana diya gaya, aur mustaqbil mein bhi aisa hi azaab un logon par nazil hoga jo gaane aur mosiqi mein ja-mu'ī se mubtila hon gay.

Aaj kal aap dekh sakte hain gaana aur mosiqi kitna aam ho gaya hai, aur ek shadi ka function mosiqi ki raat ke baghair mukammal nahi samjha jata. Kitne din tak mosiqi ke programs poore intezam ke saath chalte hain?

Sahih Bukhari ki ek hadith mein kuch maghroor ameer logon ka zikr hai. Ke woh zina, sharab aur mosiqi ko jaiz samjhen gay. Aur woh pahar ki choti par reh rahay hon gay aur un ke paas bohat se naukar hon gay jo subah-o-shaam un ke janwar charane le jayen gay aur le aayen gay. Main hadith ka matlab bata raha hoon. Aur ek din ek mohtaaj insaan apni haajat lekar un ke paas jaye ga, aur woh usey hatakar kahen gay: "Kal aana." Lekin raat rahte Allah ta'ala pahar un par ulta de de ga, aur un mein se bahuton ko qayamat tak ke liye bandaron aur suwaron mein tabdeel kar de ga. Aur yeh sab ziyada gaana, mosiqi aur sharab ki wajah se hoga.

Merī du'a hai ke Allah humein aur hamari aulad ko aise fitnon se mehfooz rakhe. Aameen.

Phir ek aur bari nishani hai imaraten bananay par fakhr karna. Is silsile ki shuru'at mein main ne aap ko Hadith-e-Jibreel ka zikr kiya tha. Jab Hazrat Jibreel (Alaihis Salam) Nabi Muhammad (Sallallahu Alaihi Wasallam) ke paas aaye. Unhon ne paanch sawal puche, aur un mein se ek tha: "Aye Allah ke Rasool! Mujhe qayamat ki nishaniyon ke baare mein bataiye." Us waqt Nabi (Sallallahu Alaihi Wasallam) ne nishaniyon mein se ek ka zikr kiya. Ke **nangay-paon, nanga-sar, ghareeb, bhed charanay walay** log oonchi imaraten bananay par fakhr karen gay.

Khuda ki qasam, main is baat ko bayan karne se qaasir hoon ke Nabi (Sallallahu Alaihi Wasallam) ne is nishani ko kitni mukammal tareeqe se alfaaz mein bayan kiya. Yeh nishani bayan ki gai. Yeh aisi nishani hai jo Nabi (Sallallahu Alaihi Wasallam) ke zamane ke kuch arse baad hi zahir hona shuru ho gai.

Lekin taqreeban 150 saal pehle. Shayad yeh nishani apni inteha ko pahunch chuki hai. Is waqt duniya ki sab se oonchi imaraten, sky scrapers, China mein hain. Aur China ke baad phir UAE mein. Yeh saaf dikhata hai ke woh log jo yeh sky scrapers bana rahay hain, woh kabhi ghareeb aur mohtaaj thay, aur aap in donon mulkon ki tareekh dekh sakte hain.

China, jo ab sky scrapers banane mein number one hai, ki aabadi ka assi fisad taqreeban 18vi aur 19vi sadi tak nihayat ghareeb, mohtaaj aur bhukay thay. Karodon log. Bhook aur ghulami mein gharq thay. 18vi sadi ke darmiyan karodon log bhook, bemari aur jungon ki wajah se mar chuke thay, aur UAE ka bhi haal kuch aisa hi tha.

19vi sadi se pehle, UAE ke logon ki aamdani ka aik hi zariya samundar se moti nikalna (pearl diving) tha. Hazaron log, ghareeb, Gulf ya Gulf of Oman ke gehray pani mein gota lagate thay, jahan munafa kam aur maut ka khatra ziyada tha. Barish ki kami ki wajah se qaht (famine) aam tha. 1934 mein British hukoomat ne aik report jari ki ke Gulf countries ke log us waqt duniya ke sab se ghareeb logon mein shumar hotay thay.

Aur jab Dosri Jahangi Jang hui. World War II ke baad Japan ne masnoi moti industry paida ki, jis ne in ghareeb logon ke moti ke karobar ka khatma kar diya. 1940 aur 1950 ka da'ira woh da'ira tha jab poori Gulf region qarz, bhook aur qaht se guzar rahi thi.

Log mulk chhornay lagay, lekin phir 1958 mein, Abu Dhabi ke qareeb tel ke zakhair daryaft huay, aur sirf chaar saal ke andar. Tel ki export ke sath, ret ke teelon ki jagah pukhta sarakain bannay lagin. Machhero ki jhonpriyon ki jagah aasman ko chhooti imaraten bannay lagin.

Aahista chalne walon oonton ki jagah desert safari mein daudnay walay Land Cruisers, aur phir oonchi imaraten bananay ka muqabla shuru ho gaya. Jo log moti ke liye samundar mein gota lagate thay, woh ab qaumi fakhr, dolat aur modernism ke izhar ke liye oonchi imaraten bana rahay thay.

Har nayi imarat aik quwwat ka bayan ban rahi thi ke hum oonchay hain, hum modern hain, aur hum baqi duniya par asar daalain gay.

Jab duniya ki sab se oonchi imarat, Burj Khalifa, 2010 mein bani, to Dubai ne elaan kiya ke hum imaraten nahi bana rahay, balke landmarks bana rahay hain. Phir Burj Khalifa ke foran baad Saudi Arabia ne elaan kiya ke hum Jeddah Tower banayen gay. Woh Burj Khalifa se bhi ooncha hoga. Aur wahi haal China ka hai. Jahan oonchayi ki jung jari hai. Har shehar apna sab se numayan tower bananay ki koshish mein hai. Aur woh race jo Empire State aur Chrysler Building se shuru hui, ab Asia aur Middle East shift ho gai hai.

Paigham ki takmeel. Ke ghareeb aur bhed charanay walay. Aik dusray se oonchi imaraten bananay mein muqabla karen gay.

By the way, main aap ko yeh zeli ma'lumat bhi deta hoon ke yeh nishani sirf sky scrapers hi nahi, balke khoobsurat imaraton par bhi lagu hoti hai. Nabi Muhammad (Sallallahu Alaihi Wasallam) ne farmaya ke qayamat ki aik nishani yeh hai. Ke log masajid bananay mein aik dusray par fakhr karen gay. Aur Saeed ibn Abi Saeed (Radiallahu Anhu) ne riwayat kiya ke "Jab tum masajid ko aarasta karo gay aur masaahif ko sanwaro gay, to tab un par tabahi aaye gi." Is waqt hum ne yeh nishani poori hotay dekhi hai.

Log namazion aur taqwa ki bajaye masjid ke design aur architecture ki baat kar rahay hain. Us ke size par muqabla kar rahay hain. Aur yeh aisi daleel hai jo kisi aik mulk tak mehdood nahi, balke pure duniya bhar mein dekhi ja sakti hai.

Hadith-e-Jibreel mein, Nabi Muhammad (Sallallahu Alaihi Wasallam) ne Hazrat Jibreel se farmaya: Qayamat ki nishaniyon mein se ek yeh bhi zikr ki gayi thi ke **bandi apne aaqa ko janam de gi.**

Is nishani ki bahut si tabeerein di gai hain. Kuch ulema kehte hain ke aulad itni na-farmaan ho jaye gi ke woh apni maa par aaqa ki tarah hukoomat kare gi. Kuch ulema kehte hain. Ke yeh nishani **surrogacy**, yani kiraye ki maaon, ki taraf ishara karti hai. Hum sab jantay hain ke aaj kal be-nasib joḍe Ukraine ya India jaise mulkon ka safar karte hain taake surrogate mothers dhoondh saken, jo phir un ke liye bachay paida karti hain – aur technically, woh bachay un surrogate mothers ke qanooni maalik kehlaatay hain.

Lekin haqeeqat yeh hai, ke bandi ke apne aaqa ko janam dene ki nishani shayad bohat pehle poori ho chuki hai. Haan, jo main ne aap ko bataya, woh bhi theek ho sakta hai. Woh bhi theek ho sakte hain, lekin yeh bhi ek tareekhi haqeeqat hai. Ke Islami tareekh mein kuch bandi auraton ke bachay riyasat ke sultan tak pahonchay.

Masalan, Khalifa Mamoon-ur-Rashid ki walida ek Farsi bandi aurat thi jis ka naam Marajil tha. Khalifa Al-Mu'tasim Billah ek Turkish bandi aurat ke betay thay. Khalifa Al-Wathiq Billah ki walida bhi ek Roman bandi aurat thi. Aur yeh teen Abbasid daur ke mashhoor khulafa hain.

Yeh silsila Ottoman Empire mein bhi jari raha. Sultan Suleiman the Magnificent ki walida, Hafeeza Sultana, ek bandi aurat thin. Sultan Selim II ki walida, Roxelana, ek larki thi jo baad mein badshah begam ban gai. Aur un ke bachay mahal ki sab se oonchi martabaon tak pahonchay, sultan banay. Balki, 15vi sadi ki Mamluk Sultanate poori tor par ghulamon ki nasal par qaim thi.

Yaad rakhiye, yeh zaroori nahi ke koi sultan kisi bandi ka beta ho. Muhammad bin Qasim, Allah un par rehm farmaye, jinhon ne Sindh fateh kiya, un ki bachpan ki umar nihayat ghurbat mein guzri kyun ke woh Bani Saqeef ke ek ghareeb khandan ki nasal se thay. 

Lekin dekhiye baad mein kya hua? Sindh ki tareekh ka mu'allif likhta hai ke jab Muhammad bin Qasim ka inteqal hua to shehr Keeraj ke Hinduon aur Buddhist rahbiyon ne un ki moorti banayi aur us ke saath bohat izzat ka bartao kiya. Un ka itna umda sulook tha. Muhammad bin Qasim ke saath, woh log. Ya jaise main ne abhi Mamluks ka zikr kiya thaa. Sultan Salahuddin Ayubi ki hukoomat kamzor ho gai thi. To un ke military ghulam, jo ke Mamluks kehlatay thay, ne ek nayi hukoomat qaim ki jise Mamluk Sultanate, ya Ghulamon ki Sultanat kehte hain. Aur yeh azeem log thay. Main aap ko bataon ke Hulagu Khan ne ek martaba kaha tha. Ke main musalmanon par ek ghaib se azaab ban kar aaya hoon. Kyun ke barhvi sadi mein Mongols woh taaqat thay jo Baghdad, Aleppo, Damascus par toot paray thay aur aage barhtay ja rahay thay, rokne wala koi nahi tha.

To yeh ek Mamluk Sultan, Sultan Saifuddin Qutz, thay jinhon ne aik mazboot na'ara uthaya "Wa Islamah!" ke aagey. Yani "Aagey barho! Aye Islam ke sipahiyon." To har riyasti sipahi shadeed dil-chaspi aur jazbay ke saath tha, aur us waqt unhon ne duniya ki superpower, Mongols, ki saffain chakna-chur kar di thin.

To woh kamyab Mamluks thay jinhon ne Mongol toofan ki taaqat ko tor diya. Is liye yeh zaroori nahi ke koi sultan kisi kaneez ka beta ho. Quran ka usool bilkul wazih hai. "Tum mein sab se ziyada izzat wala woh hai jo tum mein sab se ziyada parheizgar hai." Haan, yeh yaqeenan qayamat ki ek nishani hai. Ke bandi apne aaqa ko janam de gi. Aur yeh sab is nishani ki mukhtalif tabeerein hain, jabke asal ilm to sirf mere piyare Rubb ke paas hai.

Hum to sirf talab-ul-ilm hain jo in donon aankhon se sari raat kitabein parhte hain. In donon haathon se notes likhte hain jab thak jaate hain. Lekin phir bhi hum yeh kehte hain. Ke hum to sirf talab-ul-ilm hain, jabke saara ilm mere piyare Rubb ke paas hai.

Yeh woh nishaniyan thin jin ki hum ne aaj tafseel karni thi. Lekin kuch nishaniyan aisi hain jo yaqeenan bohat wazih hain. Lekin woh bohat chonkanay wali hain. Masalan, logon par aisa waqt aa jaye ga. Ke aadmi ko is ki parvah hi nahi hogi ke wo maal kahan se aa raha hai. Halal tareeqe se aa raha ya haram tareeqe se.

Apne gird-o-naazir dekhiye ke yeh nishani kaise poori hui hai. Koi parvah nahi ke sach bol ke aa raha hai ya jhoot bol ke.

Phir tabahi aur khoon-rezi. Nabi-e-Islam ne farmaya ke aisa waqt aa jaye ga na qaatil ko pata hoga ke woh kyun qatal kar raha hai, na maqtool ko pata hoga ke usey kyun mara ja raha hai. Is par bhi apna gird-o-naazir dekhiye. Pure duniya ka gird-o-naazir dekhiye ke yeh nishani kaise poori hui hai.

Main narm dil insaan hoon, main qatal aur khoon-rezi jaise mauzu'at par ziyada guftagu nahi karta. Lekin United Nations aur isi tarah ki reports batati hain ke fi'al haal taqreeban har ghante 52 qatal ho rahay hain, sirf Pakistan mein hi nahi balke pure duniya mein, khaas taur par Latin America, Caribbean, aur kuch African mulkon mein jahan rates bohat ziyada hain. Aur yeh itna sangin mamla hai.

Ke Abdullah (Radiallahu Anhu) se rivayat hai ke qayamat ke din logon mein sab se pehle faislay qatal ke mamle mein hongay. Matlab, yeh itna sangin mamla hai.

Balki, aik aur nishani aisi hai jo zaahiran bilkul aman aur intezam bhi qayamat ki nishaniyon mein se hoga. Ek martaba ek aadmi Nabi (Sallallahu Alaihi Wasallam) ke paas aaya aur shikayat ki ke raaste bohat naa-amaan ho gaye hain.

To Nabi (Sallallahu Alaihi Wasallam) ne paas bethay huay ek sahabi se, Adi bin Hatim (Radiallahu Anhu), se poocha: "Kya tum ne 'Hira' naam ki jagah dekhi hai?" Yeh Adi bin Hatim, Hatim Tai ke betay thay, Hatim Tai ke zamane se mashhoor. To unhon ne kaha: "Aye Allah ke Rasool (Sallallahu Alaihi Wasallam), main ne nahi dekhi, lekin haan, main ne us ke baare mein zaroor suna hai." Hira asal mein Iraq ke shehr Kufa ke qareek ek chhota qasba hai.

Nabi (Sallallahu Alaihi Wasallam) ne farmaya ke ek din tum dekho gay ke ek aurat haudah mein bethi, akeli, Hira se safar karti hui Makkah pahunche gi, tawaaf karne ke liye. Aur raaste mein usey Allah ke siwa kisi cheez ka khauf nahi hoga.

Isi tarah ki aik hadith Musnad Ahmad mein bhi maujood hai ke qayamat tab tak qayam nahi hogi jab tak Arab zameen nehron aur nadiyon se bhar na jaye aur ek sawaar Iraq aur Makkah ke darmiyan bilkul aman se safar kare. Gumrah honay ke siwa usey koi aur khatra na ho.

Donon hadithon ko dekhte huay aisa lagta hai ke aisi halat ek martaba Sahaba (Radiallahu Anhum) ke daur mein bhi hui thi aur mustaqbil mein phir hogi.

Arab mein nehren aur nadiyan kaise wapas aayen gi? Is par hum, InshaAllah, kisi aur hissay mein baat karen gay. Lekin raaste ki aman wali hadith is ki taraf ishara karti hai ke qayamat se pehle ek aman ka daur wapas aaye ga. Aur kuch ulema ka khayal hai. Ke yeh daur Imam Mehdi ya Nabi Isa (Alaihis Salam) ke zamane ka ho sakta hai, jis par phir ek alag episode hoga, InshaAllah.

Phir ek aur mashhoor nishani thi Hijaz se nikalnay wali aag ke mutaaliq. Aur asal mein, woh nishani poori ho chuki hai. Rasoolullah (Sallallahu Alaihi Wasallam) ne farmaya ke Hijaz ki zameen se ek aag nikalegi jo Busra (Syria) ke oonton ki gardanen roshan kar degi.

Busra Syria ka ek bohat tareekhi shehr hai. Aur yahi woh jagah hai jahan Bahira naam ke ek rahib ne Nabi (Sallallahu Alaihi Wasallam) ko Islam ki azeem shakhsiyat ke taur pehchana tha. Aur phir unhon ne aap ke chacha, Abu Talib (Radiallahu Anhu), se kaha tha: "Kya aap isay Syria ke Yahudion se door le jayen gay?" Main ne woh sara waqia Seerah series mein bayan kiya tha. To, Busra ek bohat tareekhi shehr hai, aur jab musalmanon ne Syria fateh kiya to Busra pehla shehr tha jise unhone fateh kiya.

Aur yeh aag 1256 Hijri mein zahir hui, aur Imam Nawawi (Allah un par rehm farmaye) us waqt maujood thay. Woh Nawa shehr mein rehtay thay, Busra se sirf 60 kilometer door. Aur isi liye hum unhen Nawa ke Imam Nawawi kehte hain. Unhon ne yeh aag apni aankhon se dekhi, aur woh riwayat karte hain ke yeh bohat bari aag thi jo Madeena ke mashriq (east) se nikal kar aai thi. Aur jab hum Busra ke paharon par khade huay to hum ne is aag ko door se dekha. Itna ke raat ke waqt bhi hamaray oonton ki gardanen roshan nazar aati thin.

Yaqeenan, hamaray piyare Nabi Muhammad (Sallallahu Alaihi Wasallam) ki zubaan se nikla har lafz sach hai. Un par dil ki gehraiyon se durood-o-salam.

Yahan tak aaj ki qist khatam hoti hai, aur ab aap ke do ahem kaam hain: pehla, is video ke neeche like ka button zaroor dabayein taake yeh khoobsurat ma'alumat hamari YouTube family ke baqi afrad tak bhi pahunche. Aur doosra, meri pinned comment, meri top comment, comment section mein zaroor parhain. Kyun ke is taleemi safar ko jari rakhne ke liye us comment mein aap ke liye ek bohat ahem paigham hai.

Shukriya aur Allah Hafiz.`
      },
      {
        title: "Episode 4: The worst fitnah will return",
        content: `**Bismillahir Rahmanir Rahim.**

Assalamu Alaikum. Mera naam Furqan Qureshi hai aur aaj hum dekh rahay hain 'Aakhir-e-Zamana' silsilay ki teesri qist. Jis mein hum baat karain gay kuch aisi bohat ahem nishaniyon ke baare mein jo qayamat ki nishaniyan hain. Aisi nishaniyan jo is waqt hamari rozmarra ki zindagi ka hissa hain.

Kuch nishaniyon par hum mukhtasiran guzarish karen gay, lekin kuch nishaniyon ki hum aaj bohat tafseel mein jaan karen gay. Aur in mein se pehli nishani hai mosiqi ka inteshaar.

Hamare piyare Nabi, aakhir Nabi, Muhammad (Sallallahu Alaihi Wasallam) ne riwayat farmaya ke meri ummat par "khasf", "qazf" aur "maskh" aayega. Yani zameen dhans jaye gi, aasman se patthar barasain gay aur chehre badal jayen gay.

Log hairat mein parh gaye aur poocha: "Aye Allah ke Rasool (Sallallahu Alaihi Wasallam), yeh kab hoga?"
Aap ne jawab diya: "Jab log sharab peen gay, aur gaane walian (awaz ke saath) gaayen gi, aur mosiqi bajai jaye gi."

Hum aaj is hadith par tafseel se, InshaAllah, nazar dalain gay ke zameen kaise dhans sakti hai, patthar kaise baras saktay hain aur chehre kaise bigar saktay hain.

Main aap se darkhwast karta hoon ke video shuru hone se pehle Allah Ta'ala se ek martaba astaghfar zaroor parh lein, taake woh aaj humein jin fitnon ke baare mein jaan kar rahen hain, un sab se hifazat farmaye.

**Sab se pehle, mosiqi ke baare mein kuch ma'alumaat, aakhir yeh hai kya? Mosiqi ki tareekh kya hai? Aur sab se ahem, isko haraam kyun samjha jata hai? Aur itni tafseel mein janay ki wajah yeh hai ke aaj kal ke daur mein taqreeban har shaks, chand logon ko chod kar, mosiqi mein mubtila hai.**

Mosiqi ki tareekh bohat purani hai. Aaj se 40,000 saal pehle bhi insaan khaali haddiyon se bansi jaisay aalaaz banatay thay. Aur Germany mein khudai ke douran mili "Vogelherd Flute" aisi bansi ki aik umda misaal hai.

Qadeem Mísr aur Mesopotamia mein bhi mosiqi ka aik ahem roohani darja tha. Aur Mesopotamia, yani Sumeria aur Babylon waghera, wahan ke log baqaida "hymns" gaaya karte thay. Yani aik qisam ke mazhabi geet.

Phir qadeem Hindustan. Aap ko maloom hi hoga ke sanatam dharm ke qadeem sastro mein bhi paak geeton ka zikar milta hai. Khaas taur par **Sama Veda** mein. Sama Veda ko raagon ki maa kaha jata hai, aur yahin se raag, taal, lay jaise lafz nikalay.

Lekin mosiqi ko sab se pehle aik scienci mutala ke taur par qadeem Yunanion ne dekha. **Pythagoras** pehla Yunaní falsafi tha jis ne suron ke darmiyan nisbat (ratios) daryaft kiye.

Is ke baad musalman scienciyon ne bhi mosiqi mein chupi razon par bohat kaam kiya. 10vi sadi ka aik musalman scienci **Al-Farabi** ne asal mein ek mukammal kitab "Kitab al-Musiqi al-Kabir" likhi jis mein suron aur un ki physics ka mukammal tajzia kiya gaya.

Yeh mosiqi ki mukhtasir tareekh thi. Lekin musalmanon ki baat ki jaye to Nabi (Sallallahu Alaihi Wasallam) ke zamane mein sirf **daf** ka riwaj tha. Hadith se zaahir hai ke Eid, shadiyon aur jung se wapasi jaise mauqon par daf aksar bajayi jati thi. Aur jab Rasoolullah (Sallallahu Alaihi Wasallam) pehli martaba Madeena tayyaba tashreef laye to us waqt Bani Najjar ki larkiyon ne bhi daf baja kar aap ka istiqbal kiya tha.

Fi'al-haal, duniya mein mosiqi paida karne ke liye taqreeban 1500 mukhtalif aalaaz maujood hain. Lekin Nabi (Sallallahu Alaihi Wasallam) ke zamane mein sirf daf hi bajayi jati thi, aur daf hi kyun? Is ki wajah bhi main aage batata hoon.

Balki, Nabi (Sallallahu Alaihi Wasallam) ke baad musalman duniya mein mosiqi tezi se taraqqi karne lagi. Baghdad ke dour mein khalifa Haroon-ur-Rashid aur Mamoon-ur-Rashid ne funoon ko bohat himayat di. Mosiqi ki nayee soorten ubhar kar saamne aain.

Usi dour mein aik funkaar paida hua jo us daur ka fashion designer, musician aur artist tha, aap keh sakte hain. Jis ne Cordoba mein aik institute qaim kiya jahan mosiqi ki taleem di jati thi.

11vi se 13vi sadi tak, jab Rumi aur Amir Khusro jaise sho'ara mashhoor thay, us waqt mehfilon aur qawwali ko bohat promote kiya gaya. Phir Mughal daur aaya.

Badshah Akbar ke darbaar mein **Tansen** naam ka shaks tha, jis ke baare mein mein yaqeenan aap ne suna hoga. Un ka asal naam Ram Tanu Pandey tha, lekin baad mein unhon ne Islam qabool kar liya. Usey Hindustani mosiqi ka imam kehtay hain aur kehte hain ke unhon ne kuch sur aisay banaye, jaise Miyan Ki Malhar aur Deepak Raag, jis se barish ke qatray girnay lagtay thay aur bujhi hui mashalain jal uthti thin. Yeh kehte hain, tareekhi tor par yeh cheezein haqeeqat hain ya nahi, yeh alag baat hai.

Har shaam Mughal darbaar mein mosiqi ki mehfil jamti thi. Badshah Jahangir khud bohat ache gaate thay. Un ko suron ka bhi gehra ilm tha, jabke Shah Jahan ke daur mein fine arts apni inteha ko pahunch chuki thin.

Unhon ne aik **Naubat Khana** (royal music house) bhi banwaya jahan roz muqarrra waqt par shehnaian aur tablay bajtay thay. Phir Taj Mahal hai, jise Shah Jahan ne banwaya, lekin us ke sab se barey goombad ki acoustic design aisi hai ke jab koi gawwaiya neeche khara ho kar gaata hai to hawa mein us raag ki aawaz kayi martaba gunjti hai.

Lekin baad mein, Aurangzeb Alamgir, jo deen ki taraf ziyada maail thay, unhon ne mosiqi par pabandi lagadi, aur aik bohat mashhoor waqia hai. Ek dafa Aurangzeb Jumma ki namaz se wapas aa rahay thay aur unhon ne kuch logon ko taboot uthaye huay dekha. To Aurangzeb ne pucha: "Kiska janaza hai?" Logon ne jawab diya: "Huzoor, aap ne mosiqi ko qatal kar diya hai, usi ka janaza hai." Aurangzeb tez-tab' thay, kehne lagay: "Achha, theek hai, le jao, lekin achi tarah dafna dena, khabardar jo qayamat se pehle bahar aayi."

Lekin aaj, khwa musalman duniya ho ya ghair-musalman duniya, mosiqi ne har mulk ko apne gird gher liya hai. Duniya bhar mein har roz hazaaron concerts ho rahay hain. England mein **Live Nation** naam ka aik institute hai, aur unhon ne report di ke sirf 2023 mein hi unhon ne 50,000 concerts organize kiye, aur har concert mein kam az kam 5,000 log shamil hotay hain.

Ab aik aham sawal yeh hai ke mosiqi ko haraam kyun samjha jata hai? **Surah Luqman** mein aik aayat hai ke: "Logon mein se kuch aise bhi hain jo 'lahwal hadith' (bay-faida baat) khareedte hain, taake logon ko Allah ke raaste se behka den."

Nabi (Sallallahu Alaihi Wasallam) ke sahabi, Hazrat Abdullah bin Masood (Radiallahu Anhu) ne qasam kha kar bayan kiya ke yeh aayat **mosiqi aur gano** ke hawalay se nazil hui hai. Aur Ibn Abbas (Radiallahu Anhu) ne bhi yahi tafseer di. Wohi tafseer ke agar mosiqi Allah ke zikr se gaflat dalay ya gunah ki taraf lay jaye, to yeh bhi is aayat mein zikr ki gayi 'bay-faida goi' ki definition mein aata hai.

Phir **Surah Al-Isra** ki aayat 64 mein zikr hai ke jab Allah Ta'ala ne Iblis se farmaya ke aasman se nikal ja. Us mein Iblis se yeh bhi kaha gaya: "Ja... jis ko bhi tu apni aawaz se bahka sakta hai, insaano mein se, bahka le. Mere sachay bandon par tera koi zabt nahi."

To kuch mufassireen is aayat ki tafseer karte hain ke Iblis ki aawaz asal mein gaana-baja hi ka dusra naam hai.

Is tarah, in aayaton ki roshni mein Quran ka hukam wazih hai ke mosiqi haraam hai. Aur kyun haraam? Is ki wajoohat ko do badey aasan mein taqseem kiya ja sakta hai.

Pehli qisam akhlaqi wajoohat hain, jo ke bohat seedhi hain, ke gaano mein jo lyrics istemal hotay hain, woh aksar insaan par asar daalte hain, kabhi bohat sharmnaak tareeqon se. Is hissay ki tayyari ke douran, khaas taur par pichle kuch saalon mein, main aise geet dekhe hain jinke lyrics itne fahash hain ke main aap ke saamne un ka zikr bhi nahi kar sakta. Aise geet jo aap apne khandaan ke saath beth kar sun bhi nahi sakte.

To akhlaqi wajoohat ka aik pehlu yeh hai ke aise geet muashray mein burai ko promote karte hain.

Lekin mosiqi ke haraam honay ki scienci wajoohat bhi kuch kam nahi hain. Yahan se kuch lafz technical hon gay, lekin phir bhi main apni puri koshish karoon ga ke bahas ko itna aasan rakhun.

Dekhiye, tez le (high tempo) ya bohat ziyada bass wali mosiqi dimaag mein woh hormones release karti hai jo lutf (pleasure) ka baais bantay hain. Science ki zubaan mein in hormones ko **dopamine** kehte hain. Aur jab insaan aise geet bar bar suntay rehtay hain, to dimaag tabii khushi ki bajaye is masnoi khushi ka aadi ho jata hai, aur yeh woh halat hai jisey Quran 'lahw' ya gaflat mein kho janay se yaani tabii khushi ki bajaye masnoi khushi ki talab se ta'beer karta hai.

Dosri scienci wajah: Lagatar aawaz ka shor ya tez le ki mosiqi, jaise heavy metal ya dark-trap genres, sympathetic nervous system ko ziyada activate kar deti hai, jis se khauf, be-chainī aur pareshani jaisi halatein paida hoti hain. Yani insaan ka jism har waqt be-jaa chokanna rehta hai, jaise khatre mein ho, jis se din bhar be-chainī banī rehti hai.

Teesri wajah, jaise neuroscience batati hai, mosiqi ka dimaag ke khaas hissay par ziyada asar hota hai, wohi hissa jis par narcotics (drugs) ka asar hota hai. Is liye mosiqi ki lambi aadat aik qisam ki aadat (addiction) ya inhisaar paida kar sakti hai. Aur isi liye kuch log kaam nahi kar patay, mosiqi ke baghair apna kaam poora nahi kar patay. Un ke liye sona mushkil ho jata hai, ya khamoshi bardasht ke qabil nahi rehti. Aap aise logon ko dekhen gay jo tez ya buland aawaz wali mosiqi ke baghair drive hi nahi car sakte. Psychology ki zubaan mein ise **psychological dependence** kehte hain. Islam ki zubaan mein ise roohani ghulami kehte hain.

2016 ki **Frontiers in Psychology** ki aik study ke mutabiq, woh log jo rozana 4 se 6 ghantay mosiqi suntay hain, agar yeh mosiqi band kar di jaye to yeh log **withdrawal symptoms** dikhanay lagtay hain. Maslan, tanao, chirchira pan, ya depression, kyun ke unhen woh cheez nahi mil rahi jo woh chahtay hain. Yeh aik qisam ki aadat hai.

Chothi wajah, udaas ya ranjgeen geet insaan ke dimaag mein takrari jazbaati daire (emotional loops) paida kar detay hain. Matlab woh dimaag mein wahi jazbaat bar bar paida karte hain. Is surat-e-haal mein woh udaasi aur gham ke jazbaat ko aur bhi shadeed kar dete hain, jis ka nateeja yeh hota hai ke insaan aur bhi pareshaan aur stressed ho jata hai.

To yeh thi woh akhlaqi aur scienci wajoohat jin ki bina par mosiqi ko haraam (forbidden) samjha jata hai. Haan, lekin **daf** aisa aala hai jiska zikr Hadith mein aaya hai.

Hazrat Aisha Siddiqa (Radiallahu Anha) se rivayat hai ke ek baar Eid ke din Nabi (Sallallahu Alaihi Wasallam) ghar tashreef laaye. Aur do larkiyan daf baja rahi thin. Hazrat Abu Bakr (Radiallahu Anhu) ne unhen rokna chaaha, lekin Nabi (Sallallahu Alaihi Wasallam) ne farmaya: "Chorh do unhen, aye Abu Bakr. Har qaum ke liye Eid hoti hai jis mein woh khushi manaate hain."

Is ke alawa daf se mutaliq aur bhi bahut si Hadith hain. Is liye ulema kehte hain ke daf kuch shara'it ke tehat bajaya ja sakta hai.

To sawal yeh hai ke daf mein aisa kya hai jo isay dusri qisam ki mosiqi se mukhtalif banata hai? Jawab yeh hai ke daf bohat hi saada aala hai jo **sur (melody)** paida nahi karta, balke sirf **taal (rhythm)** paida karta hai. Is ki aawaz tabii dil ki dhadkan ya qadam ki chaap jaisi hoti hai, jo ke uksahati to deti hai lekin bohat hi mehdud andaz mein. Qadeem ulema kehte hain daf "beat" hai lekin "sur" nahi.

Phir science yeh batati hai ke daf 70 se 130 Hz ke darmiyan kaam karta hai, aur yeh woh daaira hai jis mein dil ki dhadkan aur dimaag ki **theta waves** kaam karti hain. Yani woh halat-e-dimaag jo tabii sukoon mein haasil hoti hai. Phir, baqi mosiqi ke aalaaz **harmonic overtones** paida karte hain, jo phir dopamine ya masnoi lutf paida karte hain, jabke daf sirf ek beat paida karta hai, jaise dil ki tabii thapki.

Aur bhi bahut si wajoohat hain, lekin daf bajana bhi ek hadd tak jaiz hai. Ek martaba ek kali aurat ne araz ki: "Aye Allah ke Rasool (Sallallahu Alaihi Wasallam), main ne yeh mannat mani thi ke aap jung se salaamat wapas aaye to main khushi ka izhaar daf baja kar karoon gi." Nabi (Sallallahu Alaihi Wasallam) ne farmaya: "Agar tum ne mannat mani hai to bajao, warna nahi."

To mosiqi ki tareekh aur is ke haraam honay ki yeh baat khatam hui. Aur main ne aap ko bataya tha ke main itni tafseel mein is liye ja raha hoon kyun ke aaj kal taqreeban har ghar mosiqi jaise amoor mein mubtila hai.

Ab ham us asli hadith ki taraf barhtay hain ke jab poore jazbay ke saath gaane aur mosiqi ke intezam kiye jayen gay, aur mosiqi aam ho jaye gi, to zameen dhans jaye gi, patthar barasain gay aur chehre bigar jayen gay.

Yeh baat Rasoolullah (Sallallahu Alaihi Wasallam) ne farmayi. Yeh hamara aqeeda hai. Quran aur Hadith ne jo kuch bataya hai, humein us par bilkul yaqeen hai. Haan, lekin aik zeli sawal zehan mein uthta hai ke kya mosiqi ka zameen ke dhansnay ya patthar girnay se koi seedha talluq hai? Ya kya koi tabii mazhar se is ka seedha ta'aluq hai? Zahir mein aisa lagta hai ke mosiqi aur zameen ke dhansnay mein kya talluq hai? Lekin agar aap gaur karein to aap aik hairat angez nateeje par pahonchen gay.

Mosiqi hai kya? Woh **larzishein aur vibrations** hain. Jab guitar ka taar chheda jata hai, to wah tezi se larzta hai, aur nateeja woh aawaz hai jo hum suntay hain.

Ab main ne aap ko bataya ke is waqt duniya bhar mein hazaaron concerts ho rahay hain. Is waqt bhi, jab aap yeh video dekh rahay hain, to kaun jaane duniya bhar mein kitni live shows aur concerts chal rahi hain, itni mosiqi ki larzishon ke saath. Yehn sab larzishein duniya ki zameen, hawa aur pani ko mutasir karein gi.

Buland aawaazein ya larzishon ka lagatar silsila zameen ki crust mein micro movements paida karta hai. Geophysics ke tajarbaat ne sabit kiya hai ke lagatar larzishein dheelhey matti ke zarrat ko hilati hain. Yeh dhansnay ki ibtidaayi soorat hai.

To zameen, jo Quran ki aik surah ke mutabiq, aik zainda hasti hai, us ki shaooriyat hai. Jab insaan apni anokhi mosiqi se us ke roohani dairey (field) ko kharab kare ga, to zaahir hai ke zameen is par react kare gi. Woh pareshan ho gi. Aur phir woh zameen ke dhansnay ki soorat mein saamne aati hai, matlab aasan alfaaz mein yeh mumkin hai ke barhti hui mosiqi aur us ki larzishein micro level par is duniya ko badal rahi hain.

Dusri cheez hai **'qazf'**, yani aasman se patthar girna. **Olay (hailstones)** aasman se girte hain, yeh to hum sab jantay hain. Kabhi kabhi olay nihayat khatarnak ho jate hain, hum ne yeh bhi dekha hai. 1360 mein, France ki kuch jungon ke douran bohat shadeed aur barey olay ka toofan aaya, aur woh olay itni shadeedī se gir rahay thay ke France mein aik hi raat mein 1000 se ziyada sipaahī qatal ho gaye. Aaj bhi yeh waqia history mein **Black Monday Hailstorm** ke naam se milta hai, aur tareekh-daaron ne likha hai ke woh olay shutar-murghabi (ostrich) ke andon jitnay baray thay aur aasman se pattharon ki tarah gir rahay thay.

Phir 1986 mein Bangladesh mein tareekh ka sab se burā olay ka toofan aaya. Har olay ka wazan taqreeban aik kilo tha. Aur aisa lag raha tha jaise chhotay patthar aasman se gir rahay hon.

Phir Himalayas mein aik jheel hai **Roopkund Lake** ke naam se. Kuch saal pehle wahan sau insaano ki haddiyan milin, aur National Geographic ne apni research ke baad report kiya ke yeh shayad woh haaji thay jo wahan pahunche aur ek azeem olay ke toofan mein phans kar sau ki tadad mein qatal ho gaye.

Asal mein, mujhe yaad hai ke kuch mah pehle Pakistan mein bhi ek shadeed olay ka toofan aaya tha, jis ne solar panels ko kafi nuqsan pahonchaya. Ab yahan se aap ko bohat gaur se sunna hai.

Olay tab bantay hain jab badalon ke andar darja-e-hararat jamad honay se neeche chala jata hai. Paani ke qatray barf mein badal jatay hain, lekin kabhi kabhi hawa ki gard is barf ke tukdon mein phans jati hai. Aur us waqt olay technically ek barfīla patthar ban jata hai. Aur ab sochiye, agar olay is soorat mein barey barey girnay lagain, to yaqeenan aisa lagta hai jaise barey patthar aasman se gir rahay hain. Yeh pehle bhi tareekh mein hua hai aur phir hoga. Yahan hum Allah Ta'ala se dua karte hain ke woh humein is khaufnaak azaab se mahfooz rakhe.

Aur ab teesri cheez hai **'maskh'**, yani chehron ka badalna. Ek hadith mein zikr hai jahan Nabi Muhammad (Sallallahu Alaihi Wasallam) ne farmaya ke meri ummat ke kuch log sharab is ka naam badal kar peen gay. Gawwaye gaayen gay aur geet pesh karen gay. Woh poori raat in cheezon mein guzaren gay, aur subah un ke chehre bandaron aur suwaron mein badal chukay hon gay. Hum is bad-tareen azaab se mehfooz rakhe jayen. Aameen.

Woh log poori raat mosiqi aur sharab mein guzaren gay, aur subah uth kar suwaron aur bandaron mein tabdeel ho chukay hon gay. To kya mosiqi sunnay se insaan ki soorat badal sakti hai?

**Surah Al-Isra**, aayat 59 mein irshad hai:
"Hum apni nishaniyan is liye nahin bhejte ke logon ko darayein." Sooraton ki tabdeeli ek nishani hai jo darane ke liye bheji jati hai aur dusron ke liye sabaq ban jati hai.

Yeh nishani pehle bhi aa chuki hai. Masalan, **Surah Al-Ma'idah** ki aayat 60 mein, jahan Allah ne kuch logon par la'nat ki aur unhen bandaron aur suwaron mein tabdeel kar diya. Aur in mukhaffaf logon ka zikr **Surah Al-Baqarah** aur **Al-A'raaf** mein bhi milta hai.

To kya aaj duniya mein maujood suwar ya bandar wohi mukhaffaf qaumien hain? Aap ko maloom hai, suwar ka DNA insani DNA se qareeban 95% milta julta hai. Dusre mulkon mein **Xenotransplantation** ke liye, jab janwar ka koi organ insani jism mein lagaya jata hai, to pehla janwar jis ka khayal kiya jata hai woh suwar hai. Aur shayad aap ko yaad ho ke do sade pehle unhon ne suwar ka dil ek insan ke jism mein transplant kiya tha.

Phir us ka hazmi nizam bilkul insan jaisa hai. Lekin us mein ek cheez aisi hai jo misali si ban gai hai. Woh aasman ki taraf nahi dekh sakta kyun ke us ki gardan ke pathay bohat chhotay aur sakht hain, is liye uska sir hamesha zameen ki taraf jhuka rehta hai. To yeh cheez aik tarah se ramzi ban gai, ke yeh janwar aasman se mahrūm hai, yeh tabdeel shuda qaum hai. Is liye ise aasman ki taraf dekhne se rok diya gaya.

Aur isi tarhan bandar. Un ka DNA insan se 93% milta hai. To kya matlab yeh ke tamam suwar aur bandar, kya yeh tabdeel shuda qaumein ho sakti hain? To jawab hai: nahi.

Hazrat Abdullah ibn Masud (Radiallahu Anhu) riwayat karte hain ke ek dafa hum ne Nabi (Sallallahu Alaihi Wasallam) se pucha ke kya yeh bandar aur suwar pehli qaumon ki mukhaffaf sooraten hain? Nabi (Sallallahu Alaihi Wasallam) ne jawab diya: "Nahi." Jis qaum par Allah ne la'nat ki aur un ki soorten bigaardi, un ki nasal un ke baad baqi nahi rahi. Yeh janwar un se pehle se maujood thay, lekin jab qaumon ko azaab diya gaya to un ki soorten un jaisi kar di gai.

Aur Nabi (Sallallahu Alaihi Wasallam) ne sahi farmaya. Suwar is duniya mein taqreeban 20 crore saal se maujood hain. Aur aaj un ki 500 se ziyada aqsam hain. Phir bandar 3 se 4 crore saal purana janwar hai, aur aaj duniya mein 250 se ziyada aqsam hain. Lekin yeh bilkul alag janwar hain. Yeh mukhaffaf qaumein nahi hain.

Balki, kuch logon ko aisa azaab diya gaya hai ke un ki soorten badal di gai. Unhen un jaise bana diya gaya, aur mustaqbil mein bhi aisa hi azaab un logon par nazil hoga jo gaane aur mosiqi mein ja-mu'ī se mubtila hon gay.

Aaj kal aap dekh sakte hain gaana aur mosiqi kitna aam ho gaya hai, aur ek shadi ka function mosiqi ki raat ke baghair mukammal nahi samjha jata. Kitne din tak mosiqi ke programs poore intezam ke saath chalte hain?

Sahih Bukhari ki ek hadith mein kuch maghroor ameer logon ka zikr hai. Ke woh zina, sharab aur mosiqi ko jaiz samjhen gay. Aur woh pahar ki choti par reh rahay hon gay aur un ke paas bohat se naukar hon gay jo subah-o-shaam un ke janwar charane le jayen gay aur le aayen gay. Main hadith ka matlam bata raha hoon. Aur ek din ek mohtaaj insaan apni haajat lekar un ke paas jaye ga, aur woh usey hatakar kahen gay: "Kal aana." Lekin raat rahte Allah ta'ala pahar un par ulta de de ga, aur un mein se bahuton ko qayamat tak ke liye bandaron aur suwaron mein tabdeel kar de ga. Aur yeh sab ziyada gaana, mosiqi aur sharab ki wajah se hoga.

Merī du'a hai ke Allah humein aur hamari aulad ko aise fitnon se mehfooz rakhe. Aameen.

Phir ek aur bari nishani hai imaraten bananay par fakhr karna. Is silsile ki shuru'at mein main ne aap ko Hadith-e-Jibreel ka zikr kiya tha. Jab Hazrat Jibreel (Alaihis Salam) Nabi Muhammad (Sallallahu Alaihi Wasallam) ke paas aaye. Unhon ne paanch sawal puche, aur un mein se ek tha: "Aye Allah ke Rasool! Mujhe qayamat ki nishaniyon ke baare mein bataiye." Us waqt Nabi (Sallallahu Alaihi Wasallam) ne nishaniyon mein se ek ka zikr kiya. Ke **nangay-paon, nanga-sar, ghareeb, bhed charanay walay** log oonchi imaraten bananay par fakhr karen gay.

Khuda ki qasam, main is baat ko bayan karne se qaasir hoon ke Nabi (Sallallahu Alaihi Wasallam) ne is nishani ko kitni mukammal tareeqe se alfaaz mein bayan kiya. Yeh nishani bayan ki gai. Yeh aisi nishani hai jo Nabi (Sallallahu Alaihi Wasallam) ke zamane ke kuch arse baad hi zahir hona shuru ho gai.

Lekin taqreeban 150 saal pehle. Shayad yeh nishani apni inteha ko pahunch chuki hai. Is waqt duniya ki sab se oonchi imaraten, sky scrapers, China mein hain. Aur China ke baad phir UAE mein. Yeh saaf dikhata hai ke woh log jo yeh sky scrapers bana rahay hain, woh kabhi ghareeb aur mohtaaj thay, aur aap in donon mulkon ki tareekh dekh sakte hain.

China, jo ab sky scrapers banane mein number one hai, ki aabadi ka assi fisad taqreeban 18vi aur 19vi sadi tak nihayat ghareeb, mohtaaj aur bhukay thay. Karodon log. Bhook aur ghulami mein gharq thay. 18vi sadi ke darmiyan karodon log bhook, bemari aur jungon ki wajah se mar chuke thay, aur UAE ka bhi haal kuch aisa hi tha.

19vi sadi se pehle, UAE ke logon ki aamdani ka aik hi zariya samundar se moti nikalna (pearl diving) tha. Hazaron log, ghareeb, Gulf ya Gulf of Oman ke gehray pani mein gota lagate thay, jahan munafa kam aur maut ka khatra ziyada tha. Barish ki kami ki wajah se qaht (famine) aam tha. 1934 mein British hukoomat ne aik report jari ki ke Gulf countries ke log us waqt duniya ke sab se ghareeb logon mein shumar hotay thay.

Aur jab Dosri Jahangi Jang hui. World War II ke baad Japan ne masnoi moti industry paida ki, jis ne in ghareeb logon ke moti ke karobar ka khatma kar diya. 1940 aur 1950 ka da'ira woh da'ira tha jab poori Gulf region qarz, bhook aur qaht se guzar rahi thi.

Log mulk chhornay lagay, lekin phir 1958 mein, Abu Dhabi ke qareeb tel ke zakhair daryaft huay, aur sirf chaar saal ke andar. Tel ki export ke sath, ret ke teelon ki jagah pukhta sarakain bannay lagin. Machhero ki jhonpriyon ki jagah aasman ko chhooti imaraten bannay lagin.

Aahista chalne walon oonton ki jagah desert safari mein daudnay walay Land Cruisers, aur phir oonchi imaraten bananay ka muqabla shuru ho gaya. Jo log moti ke liye samundar mein gota lagate thay, woh ab qaumi fakhr, dolat aur modernism ke izhar ke liye oonchi imaraten bana rahay thay.

Har nayi imarat aik quwwat ka bayan ban rahi thi ke hum oonchay hain, hum modern hain, aur hum baqi duniya par asar daalain gay.

Jab duniya ki sab se oonchi imarat, Burj Khalifa, 2010 mein bani, to Dubai ne elaan kiya ke hum imaraten nahi bana rahay, balke landmarks bana rahay hain. Phir Burj Khalifa ke foran baad Saudi Arabia ne elaan kiya ke hum Jeddah Tower banayen gay. Woh Burj Khalifa se bhi ooncha hoga. Aur wahi haal China ka hai. Jahan oonchayi ki jung jari hai. Har shehar apna sab se numayan tower bananay ki koshish mein hai. Aur woh race jo Empire State aur Chrysler Building se shuru hui, ab Asia aur Middle East shift ho gai hai.

Paigham ki takmeel. Ke ghareeb aur bhed charanay walay. Aik dusray se oonchi imaraten bananay mein muqabla karen gay.

By the way, main aap ko yeh zeli ma'lumat bhi deta hoon ke yeh nishani sirf sky scrapers hi nahi, balke khoobsurat imaraton par bhi lagu hoti hai. Nabi Muhammad (Sallallahu Alaihi Wasallam) ne farmaya ke qayamat ki aik nishani yeh hai. Ke log masajid bananay mein aik dusray par fakhr karen gay. Aur Saeed ibn Abi Saeed (Radiallahu Anhu) ne riwayat kiya ke "Jab tum masajid ko aarasta karo gay aur masaahif ko sanwaro gay, to tab un par tabahi aaye gi." Is waqt hum ne yeh nishani poori hotay dekhi hai.

Log namazion aur taqwa ki bajaye masjid ke design aur architecture ki baat kar rahay hain. Us ke size par muqabla kar rahay hain. Aur yeh aisi daleel hai jo kisi aik mulk tak mehdood nahi, balke pure duniya bhar mein dekhi ja sakti hai.

Hadith-e-Jibreel mein, Nabi Muhammad (Sallallahu Alaihi Wasallam) ne Hazrat Jibreel se farmaya: Qayamat ki nishaniyon mein se ek yeh bhi zikr ki gayi thi ke **bandi apne aaqa ko janam de gi.**

Is nishani ki bahut si tabeerein di gai hain. Kuch ulema kehte hain ke aulad itni na-farmaan ho jaye gi ke woh apni maa par aaqa ki tarah hukoomat kare gi. Kuch ulema kehte hain. Ke yeh nishani **surrogacy**, yani kiraye ki maaon, ki taraf ishara karti hai. Hum sab jantay hain ke aaj kal be-nasib joḍe Ukraine ya India jaise mulkon ka safar karte hain taake surrogate mothers dhoondh saken, jo phir un ke liye bachay paida karti hain – aur technically, woh bachay un surrogate mothers ke qanooni maalik kehlaatay hain.

Lekin haqeeqat yeh hai, ke bandi ke apne aaqa ko janam dene ki nishani shayad bohat pehle poori ho chuki hai. Haan, jo main ne aap ko bataya, woh bhi theek ho sakta hai. Woh bhi theek ho sakte hain, lekin yeh bhi ek tareekhi haqeeqat hai. Ke Islami tareekh mein kuch bandi auraton ke bachay riyasat ke sultan tak pahonchay.

Masalan, Khalifa Mamoon-ur-Rashid ki walida ek Farsi bandi aurat thi jis ka naam Marajil tha. Khalifa Al-Mu'tasim Billah ek Turkish bandi aurat ke betay thay. Khalifa Al-Wathiq Billah ki walida bhi ek Roman bandi aurat thi. Aur yeh teen Abbasid daur ke mashhoor khulafa hain.

Yeh silsila Ottoman Empire mein bhi jari raha. Sultan Suleiman the Magnificent ki walida, Hafeeza Sultana, ek bandi aurat thin. Sultan Selim II ki walida, Roxelana, ek larki thi jo baad mein badshah begam ban gai. Aur un ke bachay mahal ki sab se oonchi martabaon tak pahonchay, sultan banay. Balki, 15vi sadi ki Mamluk Sultanate poori tor par ghulamon ki nasal par qaim thi.

Yaad rakhiye, yeh zaroori nahi ke koi sultan kisi bandi ka beta ho. Muhammad bin Qasim, Allah un par rehm farmaye, jinhon ne Sindh fateh kiya, un ki bachpan ki umar nihayat ghurbat mein guzri kyun ke woh Bani Saqeef ke ek ghareeb khandan ki nasal se thay. Lekin dekhiye baad mein kya hua? Sindh ki tareekh ka mu'allif likhta hai ke jab Muhammad bin Qasim ka inteqal hua to shehr Keeraj ke Hinduon aur Buddhist rahbiyon ne un ki moorti banayi aur us ke saath bohat izzat ka bartao kiya. Un ka itna umda sulook tha. Muhammad bin Qasim ke saath, woh log.

Ya jaise main ne abhi Mamluks ka zikr kiya thaa. Sultan Salahuddin Ayubi ki hukoomat kamzor ho gai thi. To un ke military ghulam, jo ke Mamluks kehlatay thay, ne ek nayi hukoomat qaim ki jise Mamluk Sultanate, ya Ghulamon ki Sultanat kehte hain. Aur yeh azeem log thay. Main aap ko bataon ke Hulagu Khan ne ek martaba kaha tha. Ke main musalmanon par ek ghaib se azaab ban kar aaya hoon. Kyun ke barhvi sadi mein Mongols woh taaqat thay jo Baghdad, Aleppo, Damascus par toot paray thay aur aage barhtay ja rahay thay, rokne wala koi nahi tha.

To yeh ek Mamluk Sultan, Sultan Saifuddin Qutz, thay jinhon ne aik mazboot na'ara uthaya **"Wa Islamah!"** ke aagey. Yani **"Aagey barho! Aye Islam ke sipahiyon."** To har riyasti sipahi shadeed dil-chaspi aur jazbay ke saath tha, aur us waqt unhon ne duniya ki superpower, Mongols, ki saffain chakna-chur kar di thin.

To woh kamyab Mamluks thay jinhon ne Mongol toofan ki taaqat ko tor diya. Is liye yeh zaroori nahi ke koi sultan kisi kaneez ka beta ho. Quran ka usool bilkul wazih hai. **"Tum mein sab se ziyada izzat wala woh hai jo tum mein sab se ziyada parheizgar hai."** Haan, yeh yaqeenan qayamat ki ek nishani hai. Ke bandi apne aaqa ko janam de gi. Aur yeh sab is nishani ki mukhtalif tabeerein hain, jabke asal ilm to sirf mere piyare Rubb ke paas hai.

Hum to sirf talab-ul-ilm hain jo in donon aankhon se sari raat kitabein parhte hain. In donon haathon se notes likhte hain jab thak jaate hain. Lekin phir bhi hum yeh kehte hain. Ke hum to sirf talab-ul-ilm hain, jabke saara ilm mere piyare Rubb ke paas hai.

Yeh woh nishaniyan thin jin ki hum ne aaj tafseel karni thi. Lekin kuch nishaniyan aisi hain jo yaqeenan bohat wazih hain. Lekin woh bohat chonkanay wali hain. Masalan, logon par aisa waqt aa jaye ga. Ke aadmi ko is ki parvah hi nahi hogi ke wo maal kahan se aa raha hai. Halal tareeqe se aa raha hai ya haram tareeqe se.

Apne gird-o-naazir dekhiye ke yeh nishani kaise poori hui hai. Koi parvah nahi ke sach bol ke aa raha hai ya jhoot bol ke.

Phir tabahi aur khoon-rezi. Nabi-e-Islam ne farmaya ke aisa waqt aa jaye ga na qaatil ko pata hoga ke woh kyun qatal kar raha hai, na maqtool ko pata hoga ke usey kyun mara ja raha hai. Is par bhi apna gird-o-naazir dekhiye. Pure duniya ka gird-o-naazir dekhiye ke yeh nishani kaise poori hui hai.

Main narm dil insaan hoon, main qatal aur khoon-rezi jaise mauzu'at par ziyada guftagu nahi karta. Lekin United Nations aur isi tarah ki reports batati hain ke fi'al haal taqreeban har ghante 52 qatal ho rahay hain, sirf Pakistan mein hi nahi balke pure duniya mein, khaas taur par Latin America, Caribbean, aur kuch African mulkon mein jahan rates bohat ziyada hain. Aur yeh itna sangin mamla hai.

Ke Abdullah (Radiallahu Anhu) se rivayat hai ke qayamat ke din logon mein sab se pehle faislay qatal ke mamle mein hongay. Matlab, yeh itna sangin mamla hai.

Balki, aik aur nishani aisi hai jo zaahiran bilkul aman aur intezam bhi qayamat ki nishaniyon mein se hoga. Ek martaba ek aadmi Nabi (Sallallahu Alaihi Wasallam) ke paas aaya aur shikayat ki ke raaste bohat naa-amaan ho gaye hain.

To Nabi (Sallallahu Alaihi Wasallam) ne paas bethay huay ek sahabi se, Adi bin Hatim (Radiallahu Anhu), se poocha: **"Kya tum ne 'Hira' naam ki jagah dekhi hai?"** Yeh Adi bin Hatim, Hatim Tai ke betay thay, Hatim Tai ke zamane se mashhoor. To unhon ne kaha: **"Aye Allah ke Rasool (Sallallahu Alaihi Wasallam), main ne nahi dekhi, lekin haan, main ne us ke baare mein zaroor suna hai."** Hira asal mein Iraq ke shehr Kufa ke qareek ek chhota qasba hai.

Nabi (Sallallahu Alaihi Wasallam) ne farmaya ke ek din tum dekho gay ke ek aurat haudah mein bethi, akeli, Hira se safar karti hui Makkah pahunche gi, tawaaf karne ke liye. Aur raaste mein usey Allah ke siwa kisi cheez ka khauf nahi hoga.

Isi tarah ki aik hadith Musnad Ahmad mein bhi maujood hai ke qayamat tab tak qayam nahi hogi jab tak Arab zameen nehron aur nadiyon se bhar na jaye aur ek sawaar Iraq aur Makkah ke darmiyan bilkul aman se safar kare. Gumrah honay ke siwa usey koi aur khatra na ho.

Donon hadithon ko dekhte huay aisa lagta hai ke aisi halat ek martaba Sahaba (Radiallahu Anhum) ke daur mein bhi hui thi aur mustaqbil mein phir hogi.

Arab mein nehren aur nadiyan kaise wapas aayen gi? Is par hum, InshaAllah, kisi aur hissay mein baat karen gay. Lekin raaste ki aman wali hadith is ki taraf ishara karti hai ke qayamat se pehle ek aman ka daur wapas aaye ga. Aur kuch ulema ka khayal hai. Ke yeh daur Imam Mehdi ya Nabi Isa (Alaihis Salam) ke zamane ka ho sakta hai, jis par phir ek alag episode hoga, InshaAllah.

Phir ek aur mashhoor nishani thi Hijaz se nikalnay wali aag ke mutaaliq. Aur asal mein, woh nishani poori ho chuki hai. Rasoolullah (Sallallahu Alaihi Wasallam) ne farmaya ke Hijaz ki zameen se ek aag nikalegi jo Busra (Syria) ke oonton ki gardanen roshan kar degi.

Busra Syria ka ek bohat tareekhi shehr hai. Aur yahi woh jagah hai jahan Bahira naam ke ek rahib ne Nabi (Sallallahu Alaihi Wasallam) ko Islam ki azeem shakhsiyat ke taur pehchana tha. Aur phir unhon ne aap ke chacha, Abu Talib (Radiallahu Anhu), se kaha tha: **"Kya aap isay Syria ke Yahudion se door le jayen gay?"** Main ne woh sara waqia Seerah series mein bayan kiya tha. To, Busra ek bohat tareekhi shehr hai, aur jab musalmanon ne Syria fateh kiya to Busra pehla shehr tha jise unhone fateh kiya.

Aur yeh aag 1256 Hijri mein zahir hui, aur Imam Nawawi (Allah un par rehm farmaye) us waqt maujood thay. Woh Nawa shehr mein rehtay thay, Busra se sirf 60 kilometer door. Aur isi liye hum unhen Nawa ke Imam Nawawi kehte hain. Unhon ne yeh aag apni aankhon se dekhi, aur woh riwayat karte hain ke yeh bohat bari aag thi jo Madeena ke mashriq (east) se nikal kar aai thi. Aur jab hum Busra ke paharon par khade huay to hum ne is aag ko door se dekha. Itna ke raat ke waqt bhi hamaray oonton ki gardanen roshan nazar aati thin.

Yaqeenan, hamaray piyare Nabi Muhammad (Sallallahu Alaihi Wasallam) ki zubaan se nikla har lafz sach hai. Un par dil ki gehraiyon se durood-o-salam.

Yahan tak aaj ki qist khatam hoti hai, aur ab aap ke do ahem kaam hain: pehla, is video ke neeche like ka button zaroor dabayein taake yeh khoobsurat ma'alumat hamari YouTube family ke baqi afrad tak bhi pahunche. Aur doosra, meri pinned comment, meri top comment, comment section mein zaroor parhain. Kyun ke is taleemi safar ko jari rakhne ke liye us comment mein aap ke liye ek bohat ahem paigham hai.

Shukriya aur Allah Hafiz.`
      }
    ]
  }
];

const seriesListView = document.getElementById('series-list-view');
const episodeListView = document.getElementById('episode-list-view');
const articleView = document.getElementById('article-view');
const seriesBackBtn = document.getElementById('series-back-btn');
const seriesHeaderTitle = document.getElementById('series-header-title');
const articleTitleEl = document.getElementById('article-title');
const articleContentEl = document.getElementById('article-content');

let seriesCurrentView = 'list'; // list, episodes, article
let activeSeries = null;

function renderSeriesList() {
  seriesCurrentView = 'list';
  seriesHeaderTitle.textContent = "Islamic Series";
  seriesListView.style.display = 'block';
  episodeListView.style.display = 'none';
  articleView.style.display = 'none';

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
      // Show popup if not paired and not skipped
      // Use a small delay to let UI settle, check if modal already shown to avoid flicker
      setTimeout(() => {
        const packet = document.getElementById('modal-partner-invite');
        const twinsSection = document.getElementById('twins-active');
        // Only show if we are NOT already in the Twins section (which might mean user navigated there)
        if (packet && twinsSection.style.display === 'none' && packet.style.display !== 'flex') {
          packet.style.display = 'flex';
        }
      }, 3000);
    }

    if (data && data.pairId) {
      // Paired! Listen to the pair data
      subscribeToPair(data.pairId, user.uid);
      // Sync historical logs (in case user prayed before pairing or before update)
      syncHistoricalLogsToPair(data.pairId, user.uid);

      twinsLobby.style.display = 'none';
      twinsActive.style.display = 'block';
    } else if (data && data.inLobby) {
      // In Lobby waiting
      document.getElementById('home-partner-widget').style.display = 'none'; // Hide if in lobby
      twinsLobby.style.display = 'block';
      twinsActive.style.display = 'none';
      twinsLoading.style.display = 'block';
      twinsLoading.textContent = "Waiting for a partner to join... ⏳";
      findPartnerBtn.style.display = 'none';
    } else {
      // Not in anything
      document.getElementById('home-partner-widget').style.display = 'none'; // Hide
      twinsLobby.style.display = 'block';
      twinsActive.style.display = 'none';
      twinsLoading.style.display = 'none';
      findPartnerBtn.style.display = 'inline-block';
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

  // 1. Check Lobby
  const lobbySnap = await get(ref(db, 'lobby'));
  const lobby = lobbySnap.val();

  if (lobby) {
    // Match found!
    const waitingUid = Object.keys(lobby)[0];
    if (waitingUid === user.uid) return; // Self?

    // Remove from lobby
    await set(ref(db, `lobby/${waitingUid}`), null);

    // Create Pair
    const pairId = 'pair_' + Date.now();
    const pairData = {
      user1: waitingUid,
      user2: user.uid,
      streak: 0,
      startedAt: Date.now(),
      [waitingUid]: lobby[waitingUid], // Store waiting user info
      [user.uid]: { name: user.email.split('@')[0], avatar: '🧑🏽' } // Store my info
    };

    await set(ref(db, `pairs/${pairId}`), pairData);

    // Update both users
    await set(ref(db, `users/${waitingUid}/twins`), { pairId: pairId });
    await set(ref(db, `users/${user.uid}/twins`), { pairId: pairId });

    showToast("Partner Found!", "#6ee7b7");

  } else {
    // No one available, join lobby
    await set(ref(db, `lobby/${user.uid}`), {
      name: user.email.split('@')[0],
      avatar: '🧑🏽',
      joinedAt: Date.now()
    });

    // Update self state
    await set(ref(db, `users/${user.uid}/twins`), { inLobby: true });
    twinsLoading.textContent = "Waiting for a partner to join... ⏳";
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
        `${auth.currentUser.email.split('@')[0]} wants to remind you about prayer.`
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
    if (twinsProgress) twinsProgress.style.width = Math.min((streak / 7) * 100, 100) + '%';

    // Check Status for CURRENT Prayer (Date Aware)
    const currentPrayer = getCurrentPrayerContext();
    const today = getTodayDateString();

    // Look into dailyStatus/TODAY/partnerUID/prayerName
    const pStatus = (pairData.dailyStatus &&
      pairData.dailyStatus[today] &&
      pairData.dailyStatus[today][partnerId] &&
      pairData.dailyStatus[today][partnerId][currentPrayer]);

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
