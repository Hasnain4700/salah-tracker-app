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
    // Calling our Vercel Serverless Function instead of direct FCM API
    // This keeps our Private Key hidden on the server.
    const response = await fetch('/api/send-notification', {
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
  const getTodayDateString = () => {
    const d = new Date();
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
  };
  const todayStr = getTodayDateString();

  prayers.forEach(p => {
    const [hrs, mins] = p.time.split(':').map(Number);
    const pDate = new Date();
    pDate.setHours(hrs, mins, 0, 0);

    const diff = pDate.getTime() - now.getTime();

    // If prayer is in the future (within today)
    if (diff > 0) {
      console.log(`Scheduling notification for ${p.name} in ${Math.round(diff / 1000 / 60)} mins`);
      const timer = setTimeout(() => {
        sendFCMNotificationv1(
          myToken,
          "Adhan Alert! 🕌",
          `It is time for ${p.name}. May Allah accept your prayers.`
        );
      }, diff);
      scheduledTimeouts.push(timer);
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
    // --- Deen Twins Status Sync (Fixed: Date-Aware & Sync Missed) ---
    get(ref(db, `users/${user.uid}/twins/pairId`)).then(tSnap => {
      if (tSnap.exists()) {
        const pairId = tSnap.val();
        // Store status under specific date key to handle day changes
        update(ref(db, `pairs/${pairId}/dailyStatus/${today}/${user.uid}`), {
          [prayerName]: status // 'prayed' or 'missed'
        });

        // Check for Streak Update (Simple Client-side Check)
        get(ref(db, `pairs/${pairId}`)).then(pSnap => {
          const pData = pSnap.val();
          const partnerId = (pData.user1 === user.uid) ? pData.user2 : pData.user1;
          // Partner Logic would go here in full version
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
    days.push(d.toISOString().slice(0, 10));
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
  const today = new Date().toISOString().slice(0, 10);
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
  const today = new Date().toISOString().slice(0, 10);
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
