// app2.js - Advanced Features for Salah Tracker
// This file handles modular features like Qibla Finder to keep app.js clean.
import { auth } from './firebase.js';

(function () {
    const KAABA_LAT = 21.422487;
    const KAABA_LNG = 39.826206;

    let userLat = null;
    let userLng = null;
    let qiblaBearing = null;
    let compassHeading = 0;

    // DOM Elements
    const qiblaDisk = document.getElementById('qibla-disk');
    const qiblaBearingText = document.getElementById('qibla-bearing-text');
    const qiblaDistText = document.getElementById('qibla-dist-text');
    const qiblaAccuracyWarning = document.getElementById('qibla-accuracy-warning');
    const qiblaPermissionBtn = document.getElementById('qibla-permission-btn');

    // Initialize Qibla Feature
    function initQibla() {
        // Try to get location from localStorage first (set by app.js)
        const savedLat = localStorage.getItem('userLat');
        const savedLng = localStorage.getItem('userLng');

        if (savedLat && savedLng) {
            updateUserLocation(parseFloat(savedLat), parseFloat(savedLng));
        } else {
            // Fallback to fresh fetch if app.js hasn't saved it yet
            navigator.geolocation.getCurrentPosition(pos => {
                updateUserLocation(pos.coords.latitude, pos.coords.longitude);
            }, err => {
                qiblaBearingText.textContent = t('qibla_loc_required');
            });
        }

        setupCompass();
    }

    function updateUserLocation(lat, lng) {
        userLat = lat;
        userLng = lng;
        qiblaBearing = calculateQibla(lat, lng);
        const distance = calculateDistance(lat, lng, KAABA_LAT, KAABA_LNG);

        qiblaBearingText.textContent = `Qibla: ${Math.round(qiblaBearing)}°`;
        qiblaDistText.textContent = `${Math.round(distance).toLocaleString()} ${t('qibla_dist_from_makkah')}`;

        // Position the Kaaba icon on the disk based on calculated bearing
        const kaabaIcon = document.getElementById('kaaba-pointer');
        if (kaabaIcon) {
            kaabaIcon.style.transform = `translateX(-50%) rotate(${qiblaBearing}deg)`;
        }
    }

    // --- Mathematics: Spherical Trigonometry ---
    function calculateQibla(lat, lng) {
        const phiK = KAABA_LAT * Math.PI / 180;
        const lambdaK = KAABA_LNG * Math.PI / 180;
        const phi = lat * Math.PI / 180;
        const lambda = lng * Math.PI / 180;

        const deltaL = lambdaK - lambda;
        const y = Math.sin(deltaL);
        const x = Math.cos(phi) * Math.tan(phiK) - Math.sin(phi) * Math.cos(deltaL);

        let q = Math.atan2(y, x);
        q = q * 180 / Math.PI;
        return (q + 360) % 360;
    }

    function calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    // --- Compass & Orientation Logic ---
    function setupCompass() {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

        if (isIOS) {
            if (typeof DeviceOrientationEvent.requestPermission === 'function') {
                qiblaPermissionBtn.style.display = 'block';
                qiblaPermissionBtn.onclick = () => {
                    DeviceOrientationEvent.requestPermission()
                        .then(response => {
                            if (response === 'granted') {
                                window.addEventListener('deviceorientation', handleOrientation, true);
                                qiblaPermissionBtn.style.display = 'none';
                            }
                        })
                        .catch(err => console.error(err));
                };
            } else {
                window.addEventListener('deviceorientation', handleOrientation, true);
            }
        } else {
            window.addEventListener('deviceorientationabsolute', handleOrientation, true);
        }
    }

    function handleOrientation(e) {
        let heading = e.webkitCompassHeading || e.alpha;

        if (typeof heading !== 'undefined' && heading !== null) {
            // Android deviceorientationabsolute is usually 0 at North but sometimes inverted
            if (e.absolute === true && !e.webkitCompassHeading) {
                heading = (360 - heading) % 360;
            }

            compassHeading = heading;
            const rotation = -compassHeading;
            qiblaDisk.style.transform = `rotate(${rotation}deg)`;

            // Alignment Feedback: Check if the phone heading matches the Qibla bearing
            // Fixed indicator is at the top (0 deg). 
            // Qibla icon is at qiblaBearing on the disk.
            // Disk is rotated by -heading.
            // Position of Qibla icon relative to screen top = (qiblaBearing - heading)
            let relativeQibla = (qiblaBearing - compassHeading + 360) % 360;

            if (relativeQibla < 3 || relativeQibla > 357) {
                document.getElementById('kaaba-pointer').classList.add('aligned');
                document.getElementById('kaaba-pointer').style.color = '#6ee7b7';
                document.getElementById('kaaba-pointer').style.filter = 'drop-shadow(0 0 15px #6ee7b7)';
                if (navigator.vibrate) navigator.vibrate(20);
            } else {
                document.getElementById('kaaba-pointer').classList.remove('aligned');
                document.getElementById('kaaba-pointer').style.color = '';
                document.getElementById('kaaba-pointer').style.filter = 'drop-shadow(0 0 5px #fcd34d)';
            }

            if (e.absolute === false) {
                qiblaAccuracyWarning.style.display = 'block';
            } else {
                qiblaAccuracyWarning.style.display = 'none';
            }
        }
    }

    // Expose init and cleanup to window for feature activation
    window.activateQibla = initQibla;
    window.deactivateQibla = () => {
        window.removeEventListener('deviceorientation', handleOrientation, true);
        window.removeEventListener('deviceorientationabsolute', handleOrientation, true);
        console.log("[Qibla] Sensor deactivated.");
    };
    // Listen for feature opening (via navigation logic in app.js)
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.target.id === 'feature-qibla') {
                if (mutation.target.style.display !== 'none') {
                    window.activateQibla();
                } else {
                    if (typeof window.deactivateQibla === 'function') window.deactivateQibla();
                }
            }
        });
    });

    const target = document.getElementById('feature-qibla');
    if (target) {
        observer.observe(target, { attributes: true, attributeFilter: ['style'] });
    }

})();

// --- Background Manager (Offline & Counter Sync) ---
(function () {
    window.syncToServiceWorker = async function () {
        if (!('serviceWorker' in navigator)) return;

        try {
            const registration = await navigator.serviceWorker.ready;
            const now = new Date();
            const yyyy = now.getFullYear();
            const mm = (now.getMonth() + 1).toString().padStart(2, '0');
            const dd = now.getDate().toString().padStart(2, '0');
            const dateKey = `${yyyy}-${mm}-${dd}`;

            // Sync with app.js keys
            const timingsRaw = localStorage.getItem(`prayers_${dateKey}`);
            const struggle = localStorage.getItem('userStrugglePrayer') || "";

            // NEW: Get logs if user is logged in
            let logs = {};
            const user = auth.currentUser;
            if (user) {
                const logsRaw = localStorage.getItem(`cache_logs_${user.uid}`);
                if (logsRaw) logs = JSON.parse(logsRaw);
            }

            if (timingsRaw && registration.active) {
                registration.active.postMessage({
                    type: 'SYNC_DATA',
                    prayers: JSON.parse(timingsRaw),
                    struggle: struggle,
                    logs: logs
                });
                console.log(`[Background] Synced prayer times and logs for ${dateKey}`);
            } else if (!registration.active) {
                console.warn("[Background] SW ready but not active. Retry in 2s.");
                setTimeout(syncToServiceWorker, 2000);
            }
        } catch (err) {
            console.warn("[Background] Sync error:", err.message);
        }
    }

    // Run sync on load and periodically
    window.addEventListener('load', () => {
        setTimeout(syncToServiceWorker, 3000);
    });

    // Also sync whenever storage changes
    window.addEventListener('storage', (e) => {
        if (e.key && (e.key.startsWith('prayers_') || e.key === 'userStrugglePrayer')) {
            syncToServiceWorker();
        }
    });

    // Sync on visibility
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') syncToServiceWorker();
    });

    // Handle Background Permission Prompt
    window.requestBackgroundPermission = () => {
        const isAndroid = /Android/i.test(navigator.userAgent);
        if (isAndroid) {
            const modal = document.createElement('div');
            modal.style = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1f2937;color:white;padding:25px;border-radius:20px;z-index:10000;width:85%;max-width:350px;box-shadow:0 10px 25px rgba(0,0,0,0.5);text-align:center;border:1px solid #374151;";
            modal.innerHTML = `
                <h3 style="margin-top:0;color:#6ee7b7;">${t('bg_alive_title')}</h3>
                <p style="font-size:14px;line-height:1.5;color:#9ca3af;">${t('bg_alive_desc')}</p>
                <div style="background:#111827;padding:10px;border-radius:10px;text-align:left;font-size:13px;margin:15px 0;">
                    ${t('bg_battery_steps')}
                </div>
                <button onclick="this.parentElement.remove()" style="background:#374151;color:white;border:none;padding:10px 20px;border-radius:10px;">Got it</button>
            `;
            document.body.appendChild(modal);
        } else {
            alert(t('bg_ios_alert'));
        }
    };
})();

/**
 * --- DAILY HADITH FEATURE ---
 */
(function () {
    const fallbacks = [
        { text: "Verily, actions are by intentions, and every person will have only what they intended.", ref: "Sahih Bukhari" },
        { text: "The best among you are those who have the best manners and character.", ref: "Sahih Bukhari" },
        { text: "None of you will have faith until he loves for his brother what he loves for himself.", ref: "Sahih Bukhari" },
        { text: "A good word is a form of charity.", ref: "Sahih Bukhari" },
        { text: "A Muslim is the one from whose tongue and hands the Muslims are safe.", ref: "Sahih Bukhari" }
    ];

    async function initDailyHadith() {
        const today = new Date().toDateString();
        const lastShown = localStorage.getItem('last_hadith_date');

        if (lastShown === today) return;

        const hadithContent = document.getElementById('hadith-content');
        const hadithRef = document.getElementById('hadith-ref');
        const hadithModal = document.getElementById('hadith-modal');

        if (!hadithContent || !hadithModal) return;

        // FIXED: API key was invalid and always failed. Using fallback hadiths directly.
        const randomH = fallbacks[Math.floor(Math.random() * fallbacks.length)];
        hadithContent.textContent = randomH.text;
        if (hadithRef) hadithRef.textContent = `— ${randomH.ref}`;
        hadithModal.style.display = 'flex';
        localStorage.setItem('last_hadith_date', today);
    }

    const closeBtn = document.getElementById('close-hadith-btn');
    if (closeBtn) {
        closeBtn.onclick = () => {
            const modal = document.getElementById('hadith-modal');
            if (modal) modal.style.display = 'none';
        };
    }

    // Trigger on load
    window.addEventListener('load', () => setTimeout(initDailyHadith, 5000));
})();

/**
 * --- QURAN READ FEATURE ---
 */
(function () {
    const surahListEl = document.getElementById('quran-surah-list');
    const versesViewEl = document.getElementById('quran-verses-view');
    const backBtn = document.getElementById('quran-read-back-btn');
    const lastReadEl = document.getElementById('quran-last-read');
    const lastReadTitle = document.getElementById('last-read-title');
    const fontSlider = document.getElementById('quran-font-size');
    const controlsEl = document.getElementById('quran-controls');

    let currentQuranFontSize = localStorage.getItem('quran_font_size') || 1.8;
    if (fontSlider) {
        fontSlider.value = currentQuranFontSize;
        fontSlider.oninput = (e) => {
            currentQuranFontSize = e.target.value;
            localStorage.setItem('quran_font_size', currentQuranFontSize);
            document.querySelectorAll('.quran-verse-text').forEach(el => {
                el.style.fontSize = `${currentQuranFontSize}em`;
            });
        };
    }

    let quranAudio = new Audio();

    async function fetchSurahs() {
        if (!surahListEl) return;

        // Check Last Read
        const lastSurahId = localStorage.getItem('last_read_surah_id');
        const lastSurahName = localStorage.getItem('last_read_surah_name');
        if (lastSurahId && lastSurahName && lastReadEl) {
            lastReadTitle.textContent = `Surah ${lastSurahName}`;
            lastReadEl.style.display = 'block';
            lastReadEl.onclick = () => window.loadSurah(lastSurahId, lastSurahName);
        } else if (lastReadEl) {
            lastReadEl.style.display = 'none';
        }

        try {
            const res = await fetch('https://api.quran.com/api/v4/chapters?language=ur');
            const data = await res.json();
            renderSurahList(data.chapters);
        } catch (err) {
            surahListEl.innerHTML = `<div style="color:#ff6b6b; text-align:center;">${t('quran_load_fail')}</div>`;
        }
    }

    function renderSurahList(chapters) {
        if (!surahListEl) return;
        surahListEl.innerHTML = chapters.map(c => {
            const escapedName = c.name_simple.replace(/'/g, "\\'");
            return `
                <div class="card" style="padding:10px 15px; margin-bottom:8px; cursor:pointer; background:#1e293b; display:flex; justify-content:space-between; align-items:center;" onclick="window.loadSurah(${c.id}, '${escapedName}')">
                    <div>
                        <span style="color:#6ee7b7; font-weight:bold; margin-right:10px;">${c.id}.</span>
                        <span>${c.name_simple}</span>
                    </div>
                    <div style="font-family:'Traditional Arabic', serif; font-size:1.1em;">${c.name_arabic}</div>
                </div>
            `;
        }).join('');
    }

    window.loadSurah = async (id, name) => {
        if (!surahListEl || !versesViewEl) return;

        // Save Last Read
        localStorage.setItem('last_read_surah_id', id);
        localStorage.setItem('last_read_surah_name', name);
        if (lastReadEl) lastReadEl.style.display = 'none';

        surahListEl.style.display = 'none';
        versesViewEl.style.display = 'block';
        if (controlsEl) controlsEl.style.display = 'flex';
        versesViewEl.innerHTML = `<div style="text-align:center; padding:20px; color:#94a3b8;">${t('quran_loading_verses')}</div>`;

        try {
            // Updated API: per_page=300 for full Surah, fields=text_uthmani to fix undefined text
            const res = await fetch(`https://api.quran.com/api/v4/verses/by_chapter/${id}?language=ur&words=false&translations=158&page=1&per_page=300&fields=text_uthmani`);
            const data = await res.json();
            renderVerses(data.verses, name);
        } catch (err) {
            versesViewEl.innerHTML = `<div style="color:#ff6b6b; text-align:center;">${t('quran_verses_fail')}</div>`;
        }
    };

    function renderVerses(verses, surahName) {
        if (!versesViewEl) return;
        versesViewEl.innerHTML = `
            <div style="text-align:center; margin-bottom:20px; padding: 10px;">
                <h2 style="color:#6ee7b7; margin:0; font-size: 1.5em; font-weight: 800;">${surahName}</h2>
            </div>
            ${verses.map(v => `
                <div style="margin-bottom:32px; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:16px; text-align: right;">
                    <!-- Arabic Text (Top) -->
                    <div class="quran-verse-text" style="font-size:${currentQuranFontSize}em; line-height:2.2; font-family:'Traditional Arabic', serif; color:#fff; direction: rtl; margin-bottom: 12px;">
                        ${v.text_uthmani} 
                        <span style="display:inline-flex; align-items:center; gap:5px; vertical-align:middle;">
                           <button onclick="window.playAyah('${v.verse_key}', this)" style="background:rgba(110, 231, 183, 0.1); border:1px solid #6ee7b7; color:#6ee7b7; border-radius:50%; width:30px; height:30px; font-size:0.4em; cursor:pointer; display:flex; align-items:center; justify-content:center;">▶</button>
                           <span style="font-size:0.5em; color:#6ee7b7; border:1px solid #6ee7b7; border-radius:50%; padding:2px 6px;">${v.verse_number}</span>
                        </span>
                    </div>
                    <!-- Urdu Translation (Bottom) -->
                    <div style="font-size:1.05em; color:#a7f3d0; line-height:1.7; font-family:'Noto Nastaliq Urdu', serif; direction: rtl;">
                        ${v.translations[0]?.text || ''}
                    </div>
                </div>
            `).join('')}
            <div style="text-align:center; color:#94a3b8; font-size:0.85em; margin-top:30px; padding-bottom: 20px;">Sadq-Allahu-Azim</div>
        `;
    }

    window.playAyah = async (key, btn) => {
        try {
            if (quranAudio.src && !quranAudio.paused && quranAudio.currentKey === key) {
                quranAudio.pause();
                btn.textContent = '▶';
                return;
            }

            btn.textContent = '⏳';
            // Alafasy recitation ID: 7
            const res = await fetch(`https://api.quran.com/api/v4/recitations/7/by_ayah/${key}`);
            const data = await res.json();
            const audioUrl = data.audio_files[0]?.url;

            if (audioUrl) {
                if (!audioUrl.startsWith('http')) {
                    quranAudio.src = `https://verses.quran.foundation/${audioUrl}`;
                } else {
                    quranAudio.src = audioUrl;
                }
                quranAudio.currentKey = key;

                // FIXED: Handle auto-play policy with proper error handling
                quranAudio.play().then(() => {
                    // Reset other buttons
                    document.querySelectorAll('.quran-verse-text button').forEach(b => b.textContent = '▶');
                    btn.textContent = '⏸';
                    quranAudio.onended = () => {
                        btn.textContent = '▶';
                        // NEW: Increment Global Stat for this Surah
                        const surahId = key.split(':')[0];
                        try {
                            const db = window.FirebaseExports.getDatabase();
                            const statRef = window.FirebaseExports.ref(db, `globalStats/quran/${surahId}`);
                            window.FirebaseExports.runTransaction(statRef, (current) => (current || 0) + 1);
                        } catch (e) { console.warn("Stat inc failed", e); }
                    };
                }).catch(err => {
                    console.warn("Auto-play blocked:", err);
                    btn.textContent = '▶';
                    // Show toast notification if available
                    if (typeof showToast !== 'undefined') {
                        showToast("Tap the play button to start audio", "info");
                    }
                });
            }
        } catch (e) {
            console.error("Audio play error", e);
            btn.textContent = '❌';
            setTimeout(() => { btn.textContent = '▶'; }, 2000);
        }
    };

    if (backBtn) {
        backBtn.onclick = () => {
            if (versesViewEl && versesViewEl.style.display === 'block') {
                versesViewEl.style.display = 'none';
                if (controlsEl) controlsEl.style.display = 'none';
                if (surahListEl) {
                    surahListEl.style.display = 'block';
                    fetchSurahs(); // Refresh to show Last Read banner
                }
                if (quranAudio) quranAudio.pause();
            } else {
                // Custom closeSubFeature logic if it exists globally
                if (window.closeSubFeature) window.closeSubFeature();
            }
        };
    }

    // Activate on display
    const obs = new MutationObserver((muts) => {
        muts.forEach(m => {
            if (m.target.id === 'feature-quran-read' && m.target.style.display !== 'none' && surahListEl && surahListEl.children.length <= 1) {
                fetchSurahs();
            }
        });
    });
    const qReadTarget = document.getElementById('feature-quran-read');
    if (qReadTarget) {
        obs.observe(qReadTarget, { attributes: true, attributeFilter: ['style'] });
    }
})();

/**
 * --- ZAKAT CALCULATOR LOGIC ---
 */
(function () {
    const calcBtn = document.getElementById('calculate-zakat-btn');
    const resultDiv = document.getElementById('zakat-result');
    const amountEl = document.getElementById('zakat-amount');

    if (calcBtn) {
        calcBtn.onclick = () => {
            const cash = parseFloat(document.getElementById('zakat-cash').value) || 0;
            const gold = parseFloat(document.getElementById('zakat-gold').value) || 0;
            const silver = parseFloat(document.getElementById('zakat-silver').value) || 0;
            const assets = parseFloat(document.getElementById('zakat-assets').value) || 0;
            const debts = parseFloat(document.getElementById('zakat-debts').value) || 0;

            const totalWealth = cash + gold + silver + assets - debts;

            // Approx Nisab in PKR (Dec 2023 - Silver rate approx 2300/tola, 52.5 tola = ~120,000)
            // For simplicity, let's keep it around 150k as a safe threshold
            const nisabThreshold = 150000;

            if (amountEl && resultDiv) {
                if (totalWealth >= nisabThreshold) {
                    const zakat = totalWealth * 0.025;
                    amountEl.textContent = `${Math.round(zakat).toLocaleString()} PKR`;
                    resultDiv.style.display = 'block';
                } else {
                    amountEl.textContent = t('zakat_nisab_not_met');
                    amountEl.style.color = "#94a3b8";
                    resultDiv.style.display = 'block';
                }
            }
        };
    }
})();

/**
 * --- MASJID FINDER LOGIC (Free Overpass API) ---
 */
(function () {
    const listEl = document.getElementById('masjid-list');

    async function findMasajid() {
        if (!listEl) return;
        const lat = localStorage.getItem('userLat');
        const lng = localStorage.getItem('userLng');

        if (!lat || !lng) {
            listEl.innerHTML = `
                <div style="text-align:center; padding:20px; color:#ff6b6b;">
                    <div style="font-size:2em; margin-bottom:10px;">⚠️</div>
                    ${t('masjid_location_error')}
                </div>`;
            return;
        }

        listEl.innerHTML = `<div style="text-align:center; padding:20px; color:#94a3b8;">${t('masjid_searching')}</div>`;

        try {
            // Overpass API Query: Mosque within 5km
            const query = `[out:json];node["amenity"="place_of_worship"]["religion"="muslim"](around:5000,${lat},${lng});out body;`;
            const res = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
            if (!res.ok) throw new Error("Overpass API error");
            const data = await res.json();

            if (data.elements && data.elements.length > 0) {
                renderMasajid(data.elements);
            } else {
                listEl.innerHTML = `<div style="text-align:center; padding:20px; color:#94a3b8;">${t('masjid_not_found')}</div>`;
            }
        } catch (err) {
            listEl.innerHTML = `<div style="text-align:center; padding:20px; color:#ff6b6b;">${t('masjid_error')}</div>`;
        }
    }

    function renderMasajid(elements) {
        if (!listEl) return;
        // Simple distance calculation and sort might be needed, but for now we list them
        listEl.innerHTML = elements.map(e => `
            <div class="card" style="padding:15px; margin-bottom:10px; background:#1e293b; border-left:4px solid #6ee7b7;">
                <div style="font-weight:700; color:#fff;">${e.tags.name || 'Masjid (Unnamed)'}</div>
                <div style="font-size:0.85em; color:#94a3b8; margin-top:4px;">
                    ${e.tags['addr:street'] || 'Nearby Area'}
                </div>
                <a href="https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lon}" target="_blank"
                   style="display:inline-block; margin-top:8px; font-size:0.85em; color:#6ee7b7; text-decoration:none;">
                   Open in Maps 🗺️
                </a>
            </div>
        `).join('');
    }

    const obs = new MutationObserver((muts) => {
        muts.forEach(m => {
            if (m.target.id === 'feature-masjid' && m.target.style.display !== 'none' && listEl && listEl.children.length <= 1) {
                findMasajid();
            }
        });
    });
    const mTarget = document.getElementById('feature-masjid');
    if (mTarget) {
        obs.observe(mTarget, { attributes: true, attributeFilter: ['style'] });
    }
})();
/**
 * --- HADITH LIBRARY FEATURE (ENHANCED) ---
 */
(function () {
    const booksGrid = document.getElementById('library-books');
    const contentArea = document.getElementById('library-content');
    const listContainer = document.getElementById('library-list-container');
    const libraryTitle = document.getElementById('library-title');
    const librarySubtitle = document.getElementById('library-subtitle');
    const loadingEl = document.getElementById('library-loading');
    const searchWrap = document.getElementById('library-search-wrap');
    const searchInput = document.getElementById('hadith-search-input');
    const searchClear = document.getElementById('hadith-search-clear');
    const topFab = document.getElementById('library-top-fab');

    const BOOKS = [
        { id: 'bukhari', name: 'Sahih Bukhari', cover: 'assets/sahih al bukhari.png', color: 'linear-gradient(135deg, #34d399, #059669)', editions: { ara: 'ara-bukhari', urd: 'urd-bukhari', eng: 'eng-bukhari' } },
        { id: 'muslim', name: 'Sahih Muslim', cover: 'assets/sahih muslim.png', color: 'linear-gradient(135deg, #60a5fa, #2563eb)', editions: { ara: 'ara-muslim', urd: 'urd-muslim', eng: 'eng-muslim' } },
        { id: 'tirmidhi', name: 'Jamia Tirmidhi', cover: 'assets/jamia tirmidhi.png', color: 'linear-gradient(135deg, #fbbf24, #d97706)', editions: { ara: 'ara-tirmidhi', urd: 'urd-tirmidhi', eng: 'eng-tirmidhi' } },
        { id: 'abudawud', name: 'Sunan Abu Dawud', cover: 'assets/sunan abu dawud.png', color: 'linear-gradient(135deg, #a78bfa, #7c3aed)', editions: { ara: 'ara-abudawud', urd: 'urd-abudawud', eng: 'eng-abudawud' } },
        { id: 'nasai', name: 'Sunan Nasai', cover: 'assets/sunan abu nasai.png', color: 'linear-gradient(135deg, #f472b6, #db2777)', editions: { ara: 'ara-nasai', urd: 'urd-nasai', eng: 'eng-nasai' } },
        { id: 'ibnmajah', name: 'Sunan Ibn Majah', cover: 'assets/Sunan ibn majah.png', color: 'linear-gradient(135deg, #4ade80, #16a34a)', editions: { ara: 'ara-ibnmajah', urd: 'urd-ibnmajah', eng: 'eng-ibnmajah' } }
    ];

    let currentHadiths = [];
    let filteredHadiths = null;
    let displayedCount = 0;
    const PAGE_SIZE = 30;

    function initLibrary() {
        if (!booksGrid) return;
        booksGrid.innerHTML = BOOKS.map(book => `
            <div class="card" onclick="window.loadHadithBook('${book.id}')" 
                 style="padding:25px 15px; text-align:center; cursor:pointer; background:${book.color}; border:none; border-radius:18px; box-shadow:0 8px 20px rgba(0,0,0,0.2); transition:transform 0.2s; position:relative; overflow:hidden;">
                <div style="margin-bottom:15px; position:relative; z-index:2;">
                    <img src="${book.cover}" alt="${book.name}" style="width:70px; height:70px; object-fit:contain; filter:drop-shadow(0 4px 10px rgba(0,0,0,0.3));">
                </div>
                <div style="font-weight:800; color:#fff; font-size:1.1em; letter-spacing:-0.5px; position:relative; z-index:2;">${book.name}</div>
                <div style="font-size:0.7em; color:rgba(255,255,255,0.8); margin-top:5px; text-transform:uppercase; font-weight:700; position:relative; z-index:2;">Full Collection</div>
                <div style="position:absolute; top:-10%; right:-10%; width:120px; opacity:0.1; transform:rotate(15deg); filter:brightness(0) invert(1);">
                     <img src="${book.cover}" style="width:100%;">
                </div>
            </div>
        `).join('');
    }

    window.loadHadithBook = async (bookId) => {
        const book = BOOKS.find(b => b.id === bookId);
        if (!book) return;

        booksGrid.style.display = 'none';
        contentArea.style.display = 'none';
        loadingEl.style.display = 'block';
        libraryTitle.textContent = book.name;
        librarySubtitle.textContent = "Loading full collection...";

        const lang = localStorage.getItem('userLanguage') || 'ur';
        const transKey = lang === 'ur' ? 'urd' : 'eng';

        try {
            const [araRes, transRes] = await Promise.all([
                fetch(`https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/${book.editions.ara}.json`),
                fetch(`https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/${book.editions[transKey]}.json`)
            ]);

            const araData = await araRes.json();
            const transData = await transRes.json();

            currentHadiths = araData.hadiths.map((h, i) => ({
                number: h.hadithnumber,
                arabic: h.text,
                translation: transData.hadiths[i]?.text || 'Translation not available.'
            }));

            filteredHadiths = null;
            displayedCount = 0;
            listContainer.innerHTML = '';
            loadingEl.style.display = 'none';
            contentArea.style.display = 'block';
            searchWrap.style.display = 'block';
            librarySubtitle.textContent = `Search or browse ${currentHadiths.length} Hadiths`;

            renderMoreHadiths();

            contentArea.onscroll = () => {
                // Infinite Scroll
                if (contentArea.scrollTop + contentArea.clientHeight >= contentArea.scrollHeight - 200) {
                    renderMoreHadiths();
                }
                // Show/Hide Top FAB
                if (contentArea.scrollTop > 600) {
                    topFab.style.display = 'flex';
                } else {
                    topFab.style.display = 'none';
                }
            };
        } catch (err) {
            console.error("Hadith Load Error:", err);
            loadingEl.innerHTML = `<div style="color:#ff6b6b; padding:20px;">Failed to load. Please check your internet connection.</div>
            <button onclick="handleLibraryBack()" class="thirty-day-btn" style="background:#334155; color:#fff; margin-top:15px;">Go Back</button>`;
        }
    };

    function renderMoreHadiths(forceData = null) {
        const source = forceData || filteredHadiths || currentHadiths;
        if (!source || displayedCount >= source.length) return;

        const nextBatch = source.slice(displayedCount, displayedCount + PAGE_SIZE);
        const lang = localStorage.getItem('userLanguage') || 'ur';

        const html = nextBatch.map(h => {
            const shareTxt = `${libraryTitle.textContent} - Hadith #${h.number}\n\n${h.translation}\n\nShared via Salah Tracker`;
            return `
            <div class="card glass-card" style="padding:15px; border-radius:16px; margin-bottom:15px; animation: fadeIn 0.4s ease-out;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; font-size:0.85em; color:#6ee7b7; font-weight:800;">
                    <span style="background:rgba(110,231,183,0.1); padding:4px 10px; border-radius:20px;">H# ${h.number}</span>
                    <div style="display:flex; gap:12px;">
                        <button onclick="window.shareHadith('${h.number}', \`${shareTxt.replace(/`/g, '\\`')}\`)" 
                                style="background:none; border:none; color:#64748b; cursor:pointer; font-weight:bold; font-size:0.9em;">📤 Share</button>
                        <button onclick="copyHadith(this)" data-text="${h.arabic.replace(/"/g, '&quot;')}\n\n${h.translation.replace(/"/g, '&quot;')}" 
                                style="background:none; border:none; color:#64748b; cursor:pointer; font-weight:bold; font-size:0.9em;">📋 Copy</button>
                    </div>
                </div>
                <div style="font-family:'Traditional Arabic', serif; font-size:1.6em; line-height:2.2; color:#fff; direction:rtl; margin-bottom:20px; text-align:right;">
                    ${h.arabic}
                </div>
                <hr style="border:none; border-top:1px solid rgba(255,255,255,0.05); margin-bottom:15px;">
                <div style="font-size:1.1em; line-height:1.8; color:#a7f3d0; font-family:'Noto Nastaliq Urdu', serif; direction: ${lang === 'ur' ? 'rtl' : 'ltr'}; text-align: justify; font-weight: 500;">
                    ${h.translation}
                </div>
            </div>
            `;
        }).join('');

        listContainer.insertAdjacentHTML('beforeend', html);
        displayedCount += PAGE_SIZE;

        if (!forceData && !filteredHadiths) {
            librarySubtitle.textContent = `Showing ${displayedCount} of ${currentHadiths.length} Hadiths`;
        }
    }

    window.handleLibraryBack = () => {
        if (contentArea.style.display === 'block' || loadingEl.innerHTML.includes('Failed')) {
            contentArea.style.display = 'none';
            searchWrap.style.display = 'none';
            booksGrid.style.display = 'grid';
            libraryTitle.textContent = "Hadith Library";
            librarySubtitle.textContent = "Choose a collection";
            currentHadiths = [];
            filteredHadiths = null;
            topFab.style.display = 'none';
            loadingEl.style.display = 'none';
            loadingEl.innerHTML = `<div class="spinner"></div><div style="margin-top:15px; color:#94a3b8; font-size:0.9em;">Fetching data...</div>`;
        } else {
            if (window.closeSubFeature) window.closeSubFeature();
        }
    };

    window.handleHadithSearch = () => {
        const query = (searchInput.value || "").trim().toLowerCase();
        if (!query) {
            window.clearHadithSearch();
            return;
        }

        searchClear.style.display = 'block';

        // Check if query is just a number
        const isNum = !isNaN(query);

        if (isNum) {
            filteredHadiths = currentHadiths.filter(h => h.number.toString() === query);
        } else {
            // Keyword Search (Scans Arabic and Translation)
            filteredHadiths = currentHadiths.filter(h =>
                h.arabic.includes(query) ||
                h.translation.toLowerCase().includes(query)
            );
        }

        listContainer.innerHTML = '';
        displayedCount = 0;

        if (filteredHadiths.length > 0) {
            renderMoreHadiths();
            librarySubtitle.textContent = `Found ${filteredHadiths.length} matching Hadiths`;
        } else {
            listContainer.innerHTML = `<div style="text-align:center; padding:40px; color:#94a3b8; animation:fadeIn 0.3s;">No results found for "${query}". Try another number or keyword.</div>`;
            librarySubtitle.textContent = "No results";
        }
    };

    window.clearHadithSearch = () => {
        searchInput.value = '';
        searchClear.style.display = 'none';
        filteredHadiths = null;
        listContainer.innerHTML = '';
        displayedCount = 0;
        librarySubtitle.textContent = `Browsing ${currentHadiths.length} Hadiths`;
        renderMoreHadiths();
    };

    window.scrollLibraryToTop = () => {
        contentArea.scrollTo({ top: 0, behavior: 'smooth' });
    };

    window.shareHadith = (num, text) => {
        if (navigator.share) {
            navigator.share({
                title: `Hadith #${num}`,
                text: text,
                url: window.location.href
            }).catch(e => console.error("Share failed", e));
        } else {
            // Fallback to copy if share not supported
            navigator.clipboard.writeText(text);
            showToast("Copied to clipboard for sharing.");
        }
    };

    window.copyHadith = (btn) => {
        const text = btn.getAttribute('data-text');
        navigator.clipboard.writeText(text).then(() => {
            const original = btn.innerHTML;
            btn.innerHTML = '✅ Copied!';
            setTimeout(() => { btn.innerHTML = original; }, 2000);
        });
    };

    // Show/Hide clear button in real-time
    searchInput.oninput = () => {
        searchClear.style.display = searchInput.value ? 'block' : 'none';
        if (!searchInput.value) window.clearHadithSearch();
    };

    // Activate on display
    const obs = new MutationObserver((muts) => {
        muts.forEach(m => {
            if (m.target.id === 'feature-library' && m.target.style.display !== 'none' && booksGrid.children.length === 0) {
                initLibrary();
            }
        });
    });
    const lTarget = document.getElementById('feature-library');
    if (lTarget) obs.observe(lTarget, { attributes: true, attributeFilter: ['style'] });

})();

// --- PERSONAL RANK & QURAN STATS MODULE ---
(function () {
    // 1. Personalized Rank Logic
    async function checkUserRank() {
        const badgeEl = document.getElementById('user-rank-badge');
        if (!badgeEl) return;

        const user = auth.currentUser;
        if (!user) {
            badgeEl.innerHTML = 'Sign in for Rank 🔒';
            return;
        }

        try {
            // Fetch Top 15 Users by XP
            const topUsersRef = window.FirebaseExports.query(
                window.FirebaseExports.ref(window.FirebaseExports.getDatabase(), 'users'),
                window.FirebaseExports.orderByChild('xp'),
                window.FirebaseExports.limitToLast(15)
            );

            const snapshot = await window.FirebaseExports.get(topUsersRef);
            if (snapshot.exists()) {
                const users = [];
                snapshot.forEach(child => {
                    users.push({ uid: child.key, xp: child.val().xp || 0 });
                });
                // Sort descending (highest XP first)
                users.sort((a, b) => b.xp - a.xp);

                const myRank = users.findIndex(u => u.uid === user.uid);

                if (myRank !== -1) {
                    const rank = myRank + 1;
                    let icon = '🏅';
                    if (rank === 1) icon = '👑';
                    if (rank === 2) icon = '🥈';
                    if (rank === 3) icon = '🥉';

                    badgeEl.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
                    badgeEl.style.border = '1px solid #34d399';
                    badgeEl.style.boxShadow = '0 2px 10px rgba(16, 185, 129, 0.4)';
                    badgeEl.innerHTML = `${icon} You're Top #${rank}!`;
                } else {
                    badgeEl.style.background = 'rgba(0,0,0,0.3)';
                    badgeEl.style.border = '1px solid rgba(255,255,255,0.1)';
                    badgeEl.style.boxShadow = 'none';
                    badgeEl.innerHTML = `Keep Praying! 🚀`; // Motivational fallback
                }
            }
        } catch (e) {
            console.warn("Rank fetch failed:", e);
            badgeEl.style.display = 'none';
        }
    }

    // Run rank check on load and auth change
    window.FirebaseExports.onAuthStateChanged(window.FirebaseExports.getAuth(), (user) => {
        if (user) setTimeout(checkUserRank, 3000);
    });


    // 2. Quran Global Counts Logic
    // We hook into the existing renderSurahList function by overriding it safely or adding a listener
    // Since app2.js is modular, we can add a listener to the `surahListEl` mutation or just run this periodically.

    async function updateSurahCounts() {
        const surahListEl = document.getElementById('quran-surah-list');
        if (!surahListEl || surahListEl.style.display === 'none') return;

        // Fetch global stats for Quran
        try {
            const statsRef = window.FirebaseExports.ref(window.FirebaseExports.getDatabase(), 'globalStats/quran');
            const snap = await window.FirebaseExports.get(statsRef);
            const stats = snap.val() || {};

            // Iterate over surah cards and update badges
            // We assume the card has the Surah ID in its onclick or text content
            // Currently app2.js renders cards with onclick="window.loadSurah(ID, ...)"
            // maximizing usage of existing DOM structure

            const cards = surahListEl.querySelectorAll('.card');
            cards.forEach(card => {
                const onClickAttr = card.getAttribute('onclick');
                if (onClickAttr) {
                    const match = onClickAttr.match(/loadSurah\((\d+),/);
                    if (match && match[1]) {
                        const surahId = match[1];
                        const count = stats[surahId] || 0;

                        // Check if badge already exists
                        let badge = card.querySelector('.quran-count-badge');
                        if (!badge) {
                            badge = document.createElement('div');
                            badge.className = 'quran-count-badge';
                            badge.style = "font-size:0.7em; color:#94a3b8; margin-top:4px; display:flex; align-items:center; gap:3px;";
                            // Insert below name
                            const nameContainer = card.querySelector('div:first-child');
                            if (nameContainer) nameContainer.appendChild(badge);
                        }
                        badge.innerHTML = `🎧 Played ${count.toLocaleString()} times`;
                    }
                }
            });

        } catch (e) {
            console.warn("Quran stats update failed", e);
        }
    }

    // Observer to trigger update when list is rendered
    const obs = new MutationObserver((muts) => {
        if (document.getElementById('quran-surah-list').children.length > 5) {
            updateSurahCounts();
        }
    });
    const listTarget = document.getElementById('quran-surah-list');
    if (listTarget) obs.observe(listTarget, { childList: true });

    // Hook into Play Event to increment counter
    // We wrap the original window.playAyah if possible, or just add a global listener for audio play
    // Since playAyah is async and defines onended, let's hook into `quranAudio` property if exposed, 
    // BUT app2.js defines `let quranAudio` inside a closure. 
    // Strategy: We will expose a public increment function and call it from `playAyah` by modifying app2.js source directly above.

    // Actually, distinct from above, I will Use transaction directly here for simplicity
    window.incrementQuranStat = async (surahId) => {
        // Logic to identify Surah from Verse Key? 
        // Verse Key format: "1:1" -> Surah 1
        // We'll need to pass Surah ID to playAyah or parse it.
    }

})();

// --- PERSONAL RANK & QURAN STATS MODULE ---
(function () {
    // Helper to ensure Firebase is ready (Retry Logic)
    function waitForFirebase(callback) {
        if (window.FirebaseExports && window.FirebaseExports.getAuth) {
            callback();
        } else {
            // Retry every 500ms
            setTimeout(() => waitForFirebase(callback), 500);
        }
    }

    // 1. Personalized Rank Logic
    async function checkUserRank() {
        const badgeEl = document.getElementById('user-rank-badge');
        if (!badgeEl) return;

        if (!window.FirebaseExports) return;
        const auth = window.FirebaseExports.getAuth();
        const user = auth.currentUser;

        if (!user) {
            badgeEl.innerHTML = 'Sign in for Rank 🔒';
            return;
        }

        try {
            const db = window.FirebaseExports.getDatabase();
            const topUsersRef = window.FirebaseExports.query(
                window.FirebaseExports.ref(db, 'users'),
                window.FirebaseExports.orderByChild('xp'),
                window.FirebaseExports.limitToLast(15)
            );

            const snapshot = await window.FirebaseExports.get(topUsersRef);
            if (snapshot.exists()) {
                const users = [];
                snapshot.forEach(child => {
                    users.push({ uid: child.key, xp: child.val().xp || 0 });
                });
                // Sort descending
                users.sort((a, b) => b.xp - a.xp);

                const myRank = users.findIndex(u => u.uid === user.uid);

                if (myRank !== -1) {
                    const rank = myRank + 1;
                    let icon = '🏅';
                    if (rank === 1) icon = '👑';
                    if (rank === 2) icon = '🥈';
                    if (rank === 3) icon = '🥉';

                    badgeEl.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
                    badgeEl.style.border = '1px solid #34d399';
                    badgeEl.innerHTML = `${icon} You're Top #${rank}!`;
                } else {
                    badgeEl.innerHTML = `Keep Praying! 🚀`;
                }
            } else {
                badgeEl.innerHTML = `Keep Praying! 🚀`;
            }
        } catch (e) {
            console.warn("Rank fetch failed:", e);
            badgeEl.innerHTML = `Rank Unavail.`;
        }
    }

    // 2. Quran Global Counts Logic
    async function updateSurahCounts() {
        const surahListEl = document.getElementById('quran-surah-list');
        if (!surahListEl || surahListEl.style.display === 'none') return;

        if (!window.FirebaseExports) return;

        try {
            const db = window.FirebaseExports.getDatabase();
            const statsRef = window.FirebaseExports.ref(db, 'globalStats/quran');
            const snap = await window.FirebaseExports.get(statsRef);
            const stats = snap.val() || {};

            const cards = surahListEl.querySelectorAll('.card');
            cards.forEach(card => {
                const onClickAttr = card.getAttribute('onclick');
                if (onClickAttr) {
                    const match = onClickAttr.match(/loadSurah\((\d+),/);
                    if (match && match[1]) {
                        const surahId = match[1];
                        const count = stats[surahId] || 0;

                        // Always try to update or add badge
                        let badge = card.querySelector('.quran-count-badge');
                        if (count > 0) {
                            if (!badge) {
                                badge = document.createElement('div');
                                badge.className = 'quran-count-badge';
                                badge.style = "font-size:0.75em; color:#94a3b8; margin-top:5px; display:flex; align-items:center; gap:4px; font-weight:600;";
                                const nameContainer = card.querySelector('div:first-child');
                                if (nameContainer) nameContainer.appendChild(badge);
                            }
                            badge.textContent = `🎧 Played ${count.toLocaleString()} times`;
                        }
                    }
                }
            });
        } catch (e) {
            console.warn("Quran stats update failed", e);
        }
    }

    // Initialize logic when Firebase is ready
    waitForFirebase(() => {
        // Initial Rank Check
        const auth = window.FirebaseExports.getAuth();
        window.FirebaseExports.onAuthStateChanged(auth, (user) => {
            if (user) {
                setTimeout(checkUserRank, 2500); // Wait for auth init
                setInterval(checkUserRank, 30000); // Periodic refresh
            }
        });

        // Quran Stats Observer
        const obs = new MutationObserver((muts) => {
            const list = document.getElementById('quran-surah-list');
            if (list) {
                if (window.quranStatsTimeout) clearTimeout(window.quranStatsTimeout);
                window.quranStatsTimeout = setTimeout(updateSurahCounts, 200);
            }
        });
        const listTarget = document.getElementById('quran-surah-list');
        if (listTarget) obs.observe(listTarget, { childList: true });
    });

})();

// --- PERSONAL RANK & QURAN STATS MODULE ---
(function () {
    function waitForFirebase(callback) {
        if (window.FirebaseExports && window.FirebaseExports.getAuth) {
            callback();
        } else {
            setTimeout(() => waitForFirebase(callback), 500);
        }
    }

    // 1. Personalized Rank Logic
    async function checkUserRank() {
        const badgeEl = document.getElementById('user-rank-badge');
        if (!badgeEl) return;

        if (!window.FirebaseExports) return;
        const auth = window.FirebaseExports.getAuth();
        const user = auth.currentUser;

        if (!user) {
            badgeEl.innerHTML = '<span style="font-size:1.2em">🔒</span> Sign in to see Rank';
            return;
        }

        try {
            const db = window.FirebaseExports.getDatabase();
            const topUsersRef = window.FirebaseExports.query(
                window.FirebaseExports.ref(db, 'users'),
                window.FirebaseExports.orderByChild('xp'),
                window.FirebaseExports.limitToLast(15)
            );

            const snapshot = await window.FirebaseExports.get(topUsersRef);
            if (snapshot.exists()) {
                const users = [];
                snapshot.forEach(child => {
                    users.push({ uid: child.key, xp: child.val().xp || 0 });
                });
                users.sort((a, b) => b.xp - a.xp);

                const myRank = users.findIndex(u => u.uid === user.uid);

                if (myRank !== -1) {
                    const rank = myRank + 1;
                    let icon = '🏅';
                    if (rank === 1) icon = '👑';
                    if (rank === 2) icon = '🥈';
                    if (rank === 3) icon = '🥉';

                    badgeEl.style.background = 'linear-gradient(135deg, #065f46 0%, #047857 100%)';
                    badgeEl.style.border = '1px solid #10b981';
                    badgeEl.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.2)';
                    badgeEl.innerHTML = `${icon} MashAllah! You are <b>Top #${rank}</b>`;
                } else {
                    badgeEl.style.background = 'rgba(30, 41, 59, 0.6)';
                    badgeEl.style.border = '1px solid rgba(255,255,255,0.1)';
                    badgeEl.style.boxShadow = 'none';
                    badgeEl.innerHTML = `Keep Praying to reach Top 15! 🚀`;
                }
            } else {
                badgeEl.innerHTML = `Keep Praying! 🚀`;
            }
        } catch (e) {
            console.warn("Rank fetch failed:", e);
            badgeEl.innerHTML = `Rank Unavail.`;
        }
    }

    // 2. Quran Global Counts Logic (For Paras)
    async function updateParaCounts() {
        const paraListEl = document.getElementById('quran-audio-list');
        if (!paraListEl) return;

        if (!window.FirebaseExports) return;

        try {
            const db = window.FirebaseExports.getDatabase();
            const statsRef = window.FirebaseExports.ref(db, 'globalStats/quran');
            const snap = await window.FirebaseExports.get(statsRef);
            const stats = snap.val() || {};

            // The Para list likely contains buttons or divs with text "Para 1..."
            const items = paraListEl.querySelectorAll('div, button, li, .card');

            items.forEach(item => {
                if (item.textContent && item.textContent.includes('Para ') && !item.querySelector('.quran-count-badge')) {
                    const match = item.textContent.match(/Para (\d+)/);
                    if (match && match[1]) {
                        const paraId = match[1];
                        const count = stats[`para_${paraId}`] || 0;

                        if (count > 0) {
                            const badge = document.createElement('span');
                            badge.className = 'quran-count-badge';
                            badge.style = "font-size:0.7em; color:#fff; background:#10b981; padding:2px 6px; border-radius:8px; display:inline-flex; align-items:center; margin-left:8px; font-weight:bold;";
                            badge.innerHTML = `🎧 ${count}`;

                            // Try to append to specific title container if possible, else just append
                            if (item.tagName === 'BUTTON') {
                                item.appendChild(badge);
                            } else {
                                // Look for a heading or first div
                                const head = item.querySelector('h2, h3, h4, div');
                                if (head) head.appendChild(badge);
                                else item.appendChild(badge);
                            }
                            item.dataset.hasBadge = "true";
                        }
                    }
                }
            });

        } catch (e) {
            console.warn("Quran stats update failed", e);
        }
    }

    // 3. Track Audio Plays
    function trackParaUsage() {
        const paraListEl = document.getElementById('quran-audio-list');
        const player = document.getElementById('quran-audio-player');

        if (!paraListEl || !player) return;

        // Capture clicks to know which Para is playing
        paraListEl.addEventListener('click', (e) => {
            const target = e.target.closest('button, div');
            if (target && target.textContent && target.textContent.includes('Para ')) {
                const match = target.textContent.match(/Para (\d+)/);
                if (match && match[1]) {
                    player.setAttribute('data-current-para', match[1]);
                }
            }
        });

        // Hook into Ended event
        player.onended = () => {
            const paraId = player.getAttribute('data-current-para');
            if (paraId && window.FirebaseExports) {
                const db = window.FirebaseExports.getDatabase();
                const statRef = window.FirebaseExports.ref(db, `globalStats/quran/para_${paraId}`);
                window.FirebaseExports.runTransaction(statRef, (c) => (c || 0) + 1);
                // UI update
                setTimeout(updateParaCounts, 500);
            }
        };
    }


    // Initialize
    waitForFirebase(() => {
        // Rank
        const auth = window.FirebaseExports.getAuth();
        window.FirebaseExports.onAuthStateChanged(auth, (user) => {
            if (user) {
                setTimeout(checkUserRank, 2500);
                setInterval(checkUserRank, 30000);
            }
        });

        // Quran Stats
        // Run immediately and periodically
        setTimeout(updateParaCounts, 1000);
        setInterval(updateParaCounts, 5000);

        // Setup Tracker
        trackParaUsage();
    });

})();

// --- PERSONAL RANK & QURAN STATS MODULE ---
(function () {
    function waitForFirebase(callback) {
        if (window.FirebaseExports && window.FirebaseExports.getAuth) {
            callback();
        } else {
            setTimeout(() => waitForFirebase(callback), 500);
        }
    }

    // 1. Personalized Rank Logic
    async function checkUserRank() {
        const badgeEl = document.getElementById('user-rank-badge');
        if (!badgeEl) return;

        if (!window.FirebaseExports) return;
        const auth = window.FirebaseExports.getAuth();
        const user = auth.currentUser;

        if (!user) {
            badgeEl.innerHTML = '<span style="font-size:1.2em">🔒</span> Sign in to see Rank';
            return;
        }

        try {
            const db = window.FirebaseExports.getDatabase();
            const topUsersRef = window.FirebaseExports.query(
                window.FirebaseExports.ref(db, 'users'),
                window.FirebaseExports.orderByChild('xp'),
                window.FirebaseExports.limitToLast(15)
            );

            const snapshot = await window.FirebaseExports.get(topUsersRef);
            if (snapshot.exists()) {
                const users = [];
                snapshot.forEach(child => {
                    users.push({ uid: child.key, xp: child.val().xp || 0 });
                });
                users.sort((a, b) => b.xp - a.xp);

                const myRank = users.findIndex(u => u.uid === user.uid);

                if (myRank !== -1) {
                    const rank = myRank + 1;
                    let icon = '🏅';
                    if (rank === 1) icon = '👑';
                    if (rank === 2) icon = '🥈';
                    if (rank === 3) icon = '🥉';

                    badgeEl.style.background = 'linear-gradient(135deg, #065f46 0%, #047857 100%)';
                    badgeEl.style.border = '1px solid #10b981';
                    badgeEl.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.2)';
                    badgeEl.innerHTML = `${icon} MashAllah! You are <b>Top #${rank}</b>`;
                } else {
                    badgeEl.style.background = 'rgba(30, 41, 59, 0.6)';
                    badgeEl.style.border = '1px solid rgba(255,255,255,0.1)';
                    badgeEl.style.boxShadow = 'none';
                    badgeEl.innerHTML = `Keep Praying to reach Top 15! 🚀`;
                }
            } else {
                badgeEl.innerHTML = `Keep Praying! 🚀`;
            }
        } catch (e) {
            console.warn("Rank fetch failed:", e);
            badgeEl.innerHTML = `Rank Unavail.`;
        }
    }

    // 2. Quran Global Counts Logic (For Paras)
    async function updateParaCounts() {
        const paraListEl = document.getElementById('quran-audio-list');
        if (!paraListEl) return;

        if (!window.FirebaseExports) return;

        try {
            const db = window.FirebaseExports.getDatabase();
            const statsRef = window.FirebaseExports.ref(db, 'globalStats/quran');
            const snap = await window.FirebaseExports.get(statsRef);
            const stats = snap.val() || {};

            // The Para list likely contains buttons or divs with text "Para 1..."
            const items = paraListEl.querySelectorAll('div, button, li, .card');

            items.forEach(item => {
                if (item.textContent && item.textContent.includes('Para ') && !item.querySelector('.quran-count-badge')) {
                    const match = item.textContent.match(/Para (\d+)/);
                    if (match && match[1]) {
                        const paraId = match[1];
                        const count = stats[`para_${paraId}`] || 0;

                        // MODIFIED: Show even if count is 0 to verify UI
                        if (true) {
                            const badge = document.createElement('span');
                            badge.className = 'quran-count-badge';
                            badge.style = "font-size:0.7em; color:#fff; background:#10b981; padding:2px 6px; border-radius:8px; display:inline-flex; align-items:center; margin-left:8px; font-weight:bold;";
                            badge.innerHTML = `🎧 ${count}`;

                            // Try to append to specific title container if possible, else just append
                            if (item.tagName === 'BUTTON') {
                                item.appendChild(badge);
                            } else {
                                // Look for a heading or first div
                                const head = item.querySelector('h2, h3, h4, div');
                                if (head) head.appendChild(badge);
                                else item.appendChild(badge);
                            }
                            item.dataset.hasBadge = "true";
                        }
                    }
                }
            });

        } catch (e) {
            console.warn("Quran stats update failed", e);
        }
    }

    // 3. Track Audio Plays
    function trackParaUsage() {
        const paraListEl = document.getElementById('quran-audio-list');
        const player = document.getElementById('quran-audio-player');

        if (!paraListEl || !player) return;

        // Capture clicks to know which Para is playing
        paraListEl.addEventListener('click', (e) => {
            const target = e.target.closest('button, div');
            if (target && target.textContent && target.textContent.includes('Para ')) {
                const match = target.textContent.match(/Para (\d+)/);
                if (match && match[1]) {
                    player.setAttribute('data-current-para', match[1]);
                }
            }
        });

        // Hook into Ended event
        player.onended = () => {
            const paraId = player.getAttribute('data-current-para');
            if (paraId && window.FirebaseExports) {
                const db = window.FirebaseExports.getDatabase();
                const statRef = window.FirebaseExports.ref(db, `globalStats/quran/para_${paraId}`);
                window.FirebaseExports.runTransaction(statRef, (c) => (c || 0) + 1);
                // UI update
                setTimeout(updateParaCounts, 500);
            }
        };
    }


    // Initialize
    waitForFirebase(() => {
        // Rank
        const auth = window.FirebaseExports.getAuth();
        window.FirebaseExports.onAuthStateChanged(auth, (user) => {
            if (user) {
                setTimeout(checkUserRank, 2500);
                setInterval(checkUserRank, 30000);
            }
        });

        // Quran Stats
        // Run immediately and periodically
        setTimeout(updateParaCounts, 1000);
        setInterval(updateParaCounts, 5000);

        // Setup Tracker
        trackParaUsage();
    });

})();

// --- PERSONAL RANK & QURAN STATS MODULE ---
(function () {
    function waitForFirebase(callback) {
        if (window.FirebaseExports && window.FirebaseExports.getAuth) {
            callback();
        } else {
            setTimeout(() => waitForFirebase(callback), 500);
        }
    }

    // 1. Personalized Rank Logic
    async function checkUserRank() {
        const badgeEl = document.getElementById('user-rank-badge');
        if (!badgeEl) return;

        if (!window.FirebaseExports) return;
        const auth = window.FirebaseExports.getAuth();
        const user = auth.currentUser;

        if (!user) {
            badgeEl.innerHTML = '<span style="font-size:1.2em">🔒</span> Sign in to see Rank';
            return;
        }

        try {
            const db = window.FirebaseExports.getDatabase();
            const topUsersRef = window.FirebaseExports.query(
                window.FirebaseExports.ref(db, 'users'),
                window.FirebaseExports.orderByChild('xp'),
                window.FirebaseExports.limitToLast(15)
            );

            const snapshot = await window.FirebaseExports.get(topUsersRef);
            if (snapshot.exists()) {
                const users = [];
                snapshot.forEach(child => {
                    users.push({ uid: child.key, xp: child.val().xp || 0 });
                });
                users.sort((a, b) => b.xp - a.xp);

                const myRank = users.findIndex(u => u.uid === user.uid);

                if (myRank !== -1) {
                    const rank = myRank + 1;
                    let icon = '🏅';
                    if (rank === 1) icon = '👑';
                    if (rank === 2) icon = '🥈';
                    if (rank === 3) icon = '🥉';

                    badgeEl.style.background = 'linear-gradient(135deg, #065f46 0%, #047857 100%)';
                    badgeEl.style.border = '1px solid #10b981';
                    badgeEl.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.2)';
                    badgeEl.innerHTML = `${icon} MashAllah! You are <b>Top #${rank}</b>`;
                } else {
                    badgeEl.style.background = 'rgba(30, 41, 59, 0.6)';
                    badgeEl.style.border = '1px solid rgba(255,255,255,0.1)';
                    badgeEl.style.boxShadow = 'none';
                    badgeEl.innerHTML = `Keep Praying to reach Top 15! 🚀`;
                }
            } else {
                badgeEl.innerHTML = `Keep Praying! 🚀`;
            }
        } catch (e) {
            console.warn("Rank fetch failed:", e);
            badgeEl.innerHTML = `Rank Unavail.`;
        }
    }

    // Capture global stats for Media Session usage
    let globalQuranStats = {};

    // 2. Quran Global Counts Logic (For Paras)
    async function updateParaCounts() {
        const paraListEl = document.getElementById('quran-audio-list');
        if (!paraListEl) return;

        if (!window.FirebaseExports) return;

        try {
            const db = window.FirebaseExports.getDatabase();
            const statsRef = window.FirebaseExports.ref(db, 'globalStats/quran');
            const snap = await window.FirebaseExports.get(statsRef);
            globalQuranStats = snap.val() || {}; // Cache for player

            // The Para list likely contains buttons or divs with text "Para 1..."
            const items = paraListEl.querySelectorAll('div, button, li, .card');

            items.forEach(item => {
                if (item.textContent && item.textContent.includes('Para ') && !item.querySelector('.quran-count-badge')) {
                    const match = item.textContent.match(/Para (\d+)/);
                    if (match && match[1]) {
                        const paraId = match[1];
                        const count = globalQuranStats[`para_${paraId}`] || 0;

                        if (true) {
                            const badge = document.createElement('span');
                            badge.className = 'quran-count-badge';
                            badge.style = "font-size:0.75em; color:#fff; background:#10b981; padding:2px 8px; border-radius:10px; display:inline-flex; align-items:center; margin-left:8px; font-weight:600;";
                            badge.innerHTML = `🎧 ${count}`;

                            if (item.tagName === 'BUTTON') {
                                item.appendChild(badge);
                            } else {
                                const head = item.querySelector('h2, h3, h4, div');
                                if (head) head.appendChild(badge);
                                else item.appendChild(badge);
                            }
                            item.dataset.hasBadge = "true";
                        }
                    }
                } else if (item.dataset.hasBadge === "true" && item.querySelector('.quran-count-badge')) {
                    // Update existing
                    const match = item.textContent.match(/Para (\d+)/);
                    if (match && match[1]) {
                        const paraId = match[1];
                        const count = globalQuranStats[`para_${paraId}`] || 0;
                        item.querySelector('.quran-count-badge').innerHTML = `🎧 ${count}`;
                    }
                }
            });

        } catch (e) {
            console.warn("Quran stats update failed", e);
        }
    }

    // 3. Track Audio Plays & Media Session Override
    function trackParaUsage() {
        const paraListEl = document.getElementById('quran-audio-list');
        const player = document.getElementById('quran-audio-player');

        if (!paraListEl || !player) return;

        // Capture clicks to know which Para is playing
        paraListEl.addEventListener('click', (e) => {
            const target = e.target.closest('button, div');
            if (target && target.textContent && target.textContent.includes('Para ')) {
                const match = target.textContent.match(/Para (\d+)/);
                if (match && match[1]) {
                    const paraId = match[1];
                    player.setAttribute('data-current-para', paraId);

                    // --- MEDIA SESSION OVERRIDE ---
                    // This updates the system notification / lock screen / floating player
                    if ('mediaSession' in navigator) {
                        const count = globalQuranStats[`para_${paraId}`] || 0;
                        navigator.mediaSession.metadata = new MediaMetadata({
                            title: `Para ${paraId}`,
                            artist: `Played ${count} times`,
                            album: 'Salah Tracker Quran',
                            artwork: [
                                { src: 'assets/icon-192.png', sizes: '192x192', type: 'image/png' },
                                { src: 'assets/icon-512.png', sizes: '512x512', type: 'image/png' }
                            ]
                        });

                        navigator.mediaSession.setActionHandler('play', () => { player.play(); });
                        navigator.mediaSession.setActionHandler('pause', () => { player.pause(); });
                    }
                }
            }
        });

        // Hook into Ended event
        player.onended = () => {
            const paraId = player.getAttribute('data-current-para');
            if (paraId && window.FirebaseExports) {
                const db = window.FirebaseExports.getDatabase();
                const statRef = window.FirebaseExports.ref(db, `globalStats/quran/para_${paraId}`);
                window.FirebaseExports.runTransaction(statRef, (c) => (c || 0) + 1);
                setTimeout(updateParaCounts, 500);
            }
        };

        // Ensure metadata persists on play
        player.onplay = () => {
            const paraId = player.getAttribute('data-current-para');
            if (paraId && 'mediaSession' in navigator) {
                const count = globalQuranStats[`para_${paraId}`] || 0;
                // Re-apply metadata to force override any system defaults
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: `Para ${paraId} - Urdu Translation`, // Setting clear title
                    artist: `Played ${count} times`, // This replaces 'XP' text
                    album: 'Salah Tracker',
                    artwork: [
                        { src: 'assets/icon-192.png', sizes: '192x192', type: 'image/png' }
                    ]
                });
            }
        }
    }


    // Initialize
    waitForFirebase(() => {
        // Rank
        const auth = window.FirebaseExports.getAuth();
        window.FirebaseExports.onAuthStateChanged(auth, (user) => {
            if (user) {
                setTimeout(checkUserRank, 2500);
                setInterval(checkUserRank, 30000);
            }
        });

        // Quran Stats
        setTimeout(updateParaCounts, 1000);
        setInterval(updateParaCounts, 5000);

        // Setup Tracker
        trackParaUsage();
    });

})();

// --- PERSONAL RANK & QURAN STATS MODULE ---
(function () {
    function waitForFirebase(callback) {
        if (window.FirebaseExports && window.FirebaseExports.getAuth) {
            callback();
        } else {
            setTimeout(() => waitForFirebase(callback), 500);
        }
    }

    // 1. Personalized Rank Logic
    async function checkUserRank() {
        const badgeEl = document.getElementById('user-rank-badge');
        if (!badgeEl) return;

        if (!window.FirebaseExports) return;
        const auth = window.FirebaseExports.getAuth();
        const user = auth.currentUser;

        if (!user) {
            badgeEl.innerHTML = '<span style="font-size:1.2em">🔒</span> Sign in to see Rank';
            return;
        }

        try {
            const db = window.FirebaseExports.getDatabase();
            const topUsersRef = window.FirebaseExports.query(
                window.FirebaseExports.ref(db, 'users'),
                window.FirebaseExports.orderByChild('xp'),
                window.FirebaseExports.limitToLast(15)
            );

            const snapshot = await window.FirebaseExports.get(topUsersRef);
            if (snapshot.exists()) {
                const users = [];
                snapshot.forEach(child => {
                    users.push({ uid: child.key, xp: child.val().xp || 0 });
                });
                users.sort((a, b) => b.xp - a.xp);

                const myRank = users.findIndex(u => u.uid === user.uid);

                if (myRank !== -1) {
                    const rank = myRank + 1;
                    let icon = '🏅';
                    if (rank === 1) icon = '👑';
                    if (rank === 2) icon = '🥈';
                    if (rank === 3) icon = '🥉';

                    badgeEl.style.background = 'linear-gradient(135deg, #065f46 0%, #047857 100%)';
                    badgeEl.style.border = '1px solid #10b981';
                    badgeEl.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.2)';
                    badgeEl.innerHTML = `${icon} MashAllah! You are <b>Top #${rank}</b>`;
                } else {
                    badgeEl.style.background = 'rgba(30, 41, 59, 0.6)';
                    badgeEl.style.border = '1px solid rgba(255,255,255,0.1)';
                    badgeEl.style.boxShadow = 'none';
                    badgeEl.innerHTML = `Keep Praying to reach Top 15! 🚀`;
                }
            } else {
                badgeEl.innerHTML = `Keep Praying! 🚀`;
            }
        } catch (e) {
            console.warn("Rank fetch failed:", e);
            badgeEl.innerHTML = `Rank Unavail.`;
        }
    }

    // 2. Quran Global Counts Logic (For Paras)
    async function updateParaCounts() {
        const paraListEl = document.getElementById('quran-audio-list');
        if (!paraListEl) return;

        if (!window.FirebaseExports) return;

        try {
            const db = window.FirebaseExports.getDatabase();
            const statsRef = window.FirebaseExports.ref(db, 'globalStats/quran');
            const snap = await window.FirebaseExports.get(statsRef);
            const stats = snap.val() || {};

            // The Para list likely contains buttons or divs with text "Para 1..."
            const items = paraListEl.querySelectorAll('div, button, li, .card');

            items.forEach(item => {
                if (item.textContent && item.textContent.includes('Para ') && !item.querySelector('.quran-count-badge')) {
                    const match = item.textContent.match(/Para (\d+)/);
                    if (match && match[1]) {
                        const paraId = match[1];
                        const count = stats[`para_${paraId}`] || 0;

                        // MODIFIED: Show even if count is 0 to verify UI
                        if (true) {
                            const badge = document.createElement('span');
                            badge.className = 'quran-count-badge';
                            badge.style = "font-size:0.7em; color:#fff; background:#10b981; padding:2px 6px; border-radius:8px; display:inline-flex; align-items:center; margin-left:8px; font-weight:bold;";
                            badge.innerHTML = `🎧 ${count}`;

                            // Try to append to specific title container if possible, else just append
                            if (item.tagName === 'BUTTON') {
                                item.appendChild(badge);
                            } else {
                                // Look for a heading or first div
                                const head = item.querySelector('h2, h3, h4, div');
                                if (head) head.appendChild(badge);
                                else item.appendChild(badge);
                            }
                            item.dataset.hasBadge = "true";
                        }
                    }
                }
            });

        } catch (e) {
            console.warn("Quran stats update failed", e);
        }
    }

    // 3. Track Audio Plays
    function trackParaUsage() {
        const paraListEl = document.getElementById('quran-audio-list');
        const player = document.getElementById('quran-audio-player');

        if (!paraListEl || !player) return;

        // Capture clicks to know which Para is playing
        paraListEl.addEventListener('click', (e) => {
            const target = e.target.closest('button, div');
            if (target && target.textContent && target.textContent.includes('Para ')) {
                const match = target.textContent.match(/Para (\d+)/);
                if (match && match[1]) {
                    player.setAttribute('data-current-para', match[1]);
                }
            }
        });

        // Hook into Ended event
        player.onended = () => {
            const paraId = player.getAttribute('data-current-para');
            if (paraId && window.FirebaseExports) {
                const db = window.FirebaseExports.getDatabase();
                const statRef = window.FirebaseExports.ref(db, `globalStats/quran/para_${paraId}`);
                window.FirebaseExports.runTransaction(statRef, (c) => (c || 0) + 1);
                // UI update
                setTimeout(updateParaCounts, 500);
            }
        };
    }


    // Initialize
    waitForFirebase(() => {
        // Rank
        const auth = window.FirebaseExports.getAuth();
        window.FirebaseExports.onAuthStateChanged(auth, (user) => {
            if (user) {
                setTimeout(checkUserRank, 2500);
                setInterval(checkUserRank, 30000);
            }
        });

        // Quran Stats
        // Run immediately and periodically
        setTimeout(updateParaCounts, 1000);
        setInterval(updateParaCounts, 5000);

        // Setup Tracker
        trackParaUsage();
    });

})();
