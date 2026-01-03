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
