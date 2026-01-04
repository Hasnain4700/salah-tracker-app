// app2.js - Advanced Features for Salah Tracker
// This file handles modular features like Qibla Finder to keep app.js clean.

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
                qiblaBearingText.textContent = "Location required for Qibla";
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
        qiblaDistText.textContent = `${Math.round(distance).toLocaleString()} km from Makkah`;

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

    // Expose init to window for feature activation
    window.activateQibla = initQibla;

    // Listen for feature opening (via navigation logic in app.js)
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.target.id === 'feature-qibla' && mutation.target.style.display !== 'none') {
                window.activateQibla();
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
    async function syncToServiceWorker() {
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

            if (timingsRaw && registration.active) {
                registration.active.postMessage({
                    type: 'SYNC_DATA',
                    prayers: JSON.parse(timingsRaw),
                    struggle: struggle
                });
                console.log(`[Background] Synced prayer times for ${dateKey}`);
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
                <h3 style="margin-top:0;color:#6ee7b7;">Keep App Alive 🔋</h3>
                <p style="font-size:14px;line-height:1.5;color:#9ca3af;">To ensure Adhan and counter work in the background, please disable battery optimization for this app.</p>
                <div style="background:#111827;padding:10px;border-radius:10px;text-align:left;font-size:13px;margin:15px 0;">
                    1. Long-press <b>App Icon</b><br>
                    2. Tap <b>App Info (i)</b><br>
                    3. Go to <b>Battery</b><br>
                    4. Set to <b>'Unrestricted'</b>
                </div>
                <button onclick="this.parentElement.remove()" style="background:#374151;color:white;border:none;padding:10px 20px;border-radius:10px;">Got it</button>
            `;
            document.body.appendChild(modal);
        } else {
            alert("Ensure 'Low Power Mode' is OFF and Notifications are ON for best results.");
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

        try {
            // Using a reliable free Hadith API (hadithapi.com)
            const response = await fetch('https://hadithapi.com/api/hadiths?apiKey=$2y$10$fWfI/kH06z.N.6F9M/Vv7uq3rUe/Yj9Ua5Gv7R8H/n6m/Yj9Ua5Gv7R8H/&limit=1&random=1');
            if (!response.ok) throw new Error("API Limit or DNS issue");
            const data = await response.json();
            const hadith = data.hadiths?.data?.[0];

            if (hadith) {
                hadithContent.textContent = hadith.hadithUrdu || hadith.hadithEnglish;
                if (hadithRef) hadithRef.textContent = `— ${hadith.bookName}, Hadith: ${hadith.hadithNumber}`;
                hadithModal.style.display = 'flex';
                localStorage.setItem('last_hadith_date', today);
            } else {
                showFallback();
            }
        } catch (err) {
            console.warn("Hadith API failed, using fallback.");
            showFallback();
        }

        function showFallback() {
            const randomH = fallbacks[Math.floor(Math.random() * fallbacks.length)];
            hadithContent.textContent = randomH.text;
            if (hadithRef) hadithRef.textContent = `— ${randomH.ref}`;
            hadithModal.style.display = 'flex';
            localStorage.setItem('last_hadith_date', today);
        }
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
            surahListEl.innerHTML = `<div style="color:#ff6b6b; text-align:center;">Failed to load Surahs. Check connection.</div>`;
        }
    }

    function renderSurahList(chapters) {
        if (!surahListEl) return;
        surahListEl.innerHTML = chapters.map(c => {
            const escapedName = c.name_simple.replace(/'/g, "\\'");
            return `
                <div class="card" style="padding:12px; margin-bottom:8px; cursor:pointer; background:#1e293b; display:flex; justify-content:space-between; align-items:center;" onclick="window.loadSurah(${c.id}, '${escapedName}')">
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
        versesViewEl.innerHTML = `<div style="text-align:center; padding:20px; color:#94a3b8;">Loading Verses... 📖</div>`;

        try {
            // Updated API: per_page=300 for full Surah, fields=text_uthmani to fix undefined text
            const res = await fetch(`https://api.quran.com/api/v4/verses/by_chapter/${id}?language=ur&words=false&translations=158&page=1&per_page=300&fields=text_uthmani`);
            const data = await res.json();
            renderVerses(data.verses, name);
        } catch (err) {
            versesViewEl.innerHTML = `<div style="color:#ff6b6b; text-align:center;">Failed to load verses.</div>`;
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
                quranAudio.play();

                // Reset other buttons
                document.querySelectorAll('.quran-verse-text button').forEach(b => b.textContent = '▶');
                btn.textContent = '⏸';

                quranAudio.onended = () => { btn.textContent = '▶'; };
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
                    amountEl.textContent = "Nisab Not Met";
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
                    Location access denied or not found.<br>
                    Please enable GPS and refresh the app.
                </div>`;
            return;
        }

        listEl.innerHTML = `<div style="text-align:center; padding:20px; color:#94a3b8;">Searching nearby Masajid... 🕌</div>`;

        try {
            // Overpass API Query: Mosque within 5km
            const query = `[out:json];node["amenity"="place_of_worship"]["religion"="muslim"](around:5000,${lat},${lng});out body;`;
            const res = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
            if (!res.ok) throw new Error("Overpass API error");
            const data = await res.json();

            if (data.elements && data.elements.length > 0) {
                renderMasajid(data.elements);
            } else {
                listEl.innerHTML = `<div style="text-align:center; padding:20px; color:#94a3b8;">No masajid found within 5km. Try increasing range in future updates.</div>`;
            }
        } catch (err) {
            listEl.innerHTML = `<div style="text-align:center; padding:20px; color:#ff6b6b;">Error searching Masajid. Please try again later.</div>`;
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
