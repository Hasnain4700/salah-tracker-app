const admin = require('firebase-admin');

// Validate environment variables
const project_id = (process.env.FCM_PROJECT_ID || '').trim();
const client_email = (process.env.FCM_CLIENT_EMAIL || '').trim();
const private_key = (process.env.FCM_PRIVATE_KEY || '').trim();

module.exports = async (req, res) => {
    // --- CORS Headers ---
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-cron-auth');

    // Handle Preflight request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Basic Auth Check for External Cron
    if (req.headers['x-cron-auth'] !== process.env.CRON_SECRET) {
        console.log("[Cron Job] Unauthorized attempt blocked.");
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!project_id || !client_email || !private_key) {
        return res.status(500).json({ error: 'Missing Credentials' });
    }

    try {
        if (!admin.apps.length) {
            let pk = private_key.replace(/\\n/g, '\n');
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: project_id,
                    clientEmail: client_email,
                    privateKey: pk,
                }),
                databaseURL: `https://${project_id}-default-rtdb.firebaseio.com`
            });
        }

        const db = admin.database();
        const messaging = admin.messaging();

        const now = new Date();
        console.log(`[Cron Job] Starting prayer check at ${now.toISOString()}`);

        // 1. Fetch all users and pairs
        const [usersSnap, pairsSnap] = await Promise.all([
            db.ref('users').once('value'),
            db.ref('pairs').once('value')
        ]);
        const users = usersSnap.val();
        const pairs = pairsSnap.val();

        if (!users) {
            console.log("[Cron Job] No users found in database.");
            return res.status(200).json({ message: 'No users found' });
        }

        const results = [];
        const userEntries = Object.entries(users);
        console.log(`[Cron Job] Scanning ${userEntries.length} users...`);

        for (const [uid, user] of userEntries) {
            if (!user.fcmToken || !user.timezone) {
                console.log(`[Cron Job] User ${uid} skipped: No FCM Token or timezone.`);
                continue;
            }

            try {
                // Get user's current time in their timezone
                const userTimeStr = now.toLocaleString('en-US', { timeZone: user.timezone, hour12: false });
                const userDate = new Date(userTimeStr);

                const yyyy = userDate.getFullYear();
                const mm = (userDate.getMonth() + 1).toString().padStart(2, '0');
                const dd = userDate.getDate().toString().padStart(2, '0');
                const dateKey = `${yyyy}-${mm}-${dd}`;
                const userHHMM = `${userDate.getHours().toString().padStart(2, '0')}:${userDate.getMinutes().toString().padStart(2, '0')}`;

                console.log(`[Cron Job] Checking user ${user.email || uid} (${user.timezone}) - Local Time: ${userHHMM}`);

                // --- Quran Reminder (Personalized) ---
                const sleepTime = user.sleepTime || "21:00"; // Default 9 PM
                if (isTimeMatch(userHHMM, sleepTime, 20)) {
                    const quranNotifKey = `quranNotif_${dateKey}`;
                    if (!user[quranNotifKey]) {
                        await messaging.send({
                            notification: {
                                title: "Quran Reminder 🎧",
                                body: "Sone se pehle chand ayaat sun lein? Dil ko sukoon milega. 🌙"
                            },
                            token: user.fcmToken,
                            webpush: {
                                fcm_options: { link: "https://salah-tracker-app.vercel.app" },
                                notification: {
                                    icon: "https://salah-tracker-app.vercel.app/icon-192.png",
                                    badge: "https://salah-tracker-app.vercel.app/icon-192.png"
                                }
                            }
                        });
                        await db.ref(`users/${uid}/${quranNotifKey}`).set(true);
                        console.log(`[Cron Job] Quran Reminder sent to ${user.email || uid} at ${sleepTime}`);
                    }
                }

                if (!user.prayerTimes) {
                    console.log(`[Cron Job] User ${uid} skipped: No prayerTimes.`);
                    continue;
                }
                const timings = user.prayerTimes[dateKey];
                if (!timings) {
                    console.log(`[Cron Job] User ${uid} has no timings for ${dateKey}`);
                    continue;
                }

                const prayersToCheck = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

                for (const pName of prayersToCheck) {
                    const pTime = timings[pName];
                    if (!pTime) continue;

                    // 1. MAIN PRAYER NOTIFICATION (Due Now)
                    if (isTimeMatch(userHHMM, pTime, 15)) { // 15-minute window for reliability
                        const lastNotifKey = `lastNotif_${pName}_${dateKey}`;
                        if (user[lastNotifKey]) {
                            console.log(`[Cron Job] User ${uid} already notified for ${pName} today.`);
                            continue;
                        }

                        console.log(`[Cron Job] !!! TRIGGERING NOTIFICATION for ${user.email || uid}: ${pName} at ${pTime} !!!`);

                        // Check Priority
                        const isStruggle = (user.strugglePrayer === pName);
                        let title = `🕌 Time for ${pName}`;
                        let body = `Allah-o-Akbar! It's time for ${pName} prayer.`;

                        if (isStruggle) {
                            title = `⚠️ High Priority: ${pName}`;
                            body = `Ye wo namaz hai jo aksar miss hoti hai. Aaj hum ne isay waqt par parhna hai! Shaitaan ko harana hai. 💪`;
                        }

                        await messaging.send({
                            notification: {
                                title: title,
                                body: body,
                                sound: 'azan_tone'
                            },
                            token: user.fcmToken,
                            android: {
                                priority: 'high',
                                notification: {
                                    sound: 'azan_tone',
                                    channelId: 'prayer-notifications',
                                    priority: 'max'
                                }
                            },
                            apns: {
                                payload: {
                                    aps: {
                                        sound: 'azan_tone.caf',
                                        priority: 10
                                    }
                                }
                            },
                            webpush: {
                                fcm_options: { link: "https://salah-tracker-app.vercel.app" },
                                notification: {
                                    icon: "https://salah-tracker-app.vercel.app/icon-192.png",
                                    badge: "https://salah-tracker-app.vercel.app/icon-192.png"
                                }
                            },
                            fcmOptions: {
                                analyticsLabel: 'prayer-notification'
                            }
                        });

                        await db.ref(`users/${uid}/${lastNotifKey}`).set(true);
                        results.push({ uid, prayer: pName });
                    }

                    // 2. PARTNER DELAY NOTIFICATION (Time + 15-35 mins window)
                    // We widen the window to 20 mins to ensure it triggers once within a 10min cron loop
                    if (isTimeMatch(userHHMM, pTime, 20, 15)) {
                        console.log(`[Cron Job] Checking partner delay for ${user.email || uid} (${pName}) at ${userHHMM}`);

                        // Check if user has marked prayer
                        const logs = (user.logs && user.logs[dateKey]) || {};
                        const status = logs[pName];

                        if (!status) { // Not marked yet (No 'prayed' or 'missed')
                            console.log(`[Cron Job] User ${uid} has NOT marked ${pName} yet (15 mins late).`);

                            // Check for partner
                            const pairId = user.twins && user.twins.pairId;
                            if (pairId && pairs && pairs[pairId]) {
                                const pairData = pairs[pairId];
                                const partnerId = (pairData.user1 === uid) ? pairData.user2 : pairData.user1;
                                const partnerUser = users[partnerId];

                                if (partnerUser && partnerUser.fcmToken) {
                                    const delayNotifKey = `delayNotif_${uid}_${pName}_${dateKey}`;
                                    const snap = await db.ref(`users/${partnerId}/${delayNotifKey}`).once('value');

                                    if (!snap.exists()) {
                                        console.log(`[Cron Job] !!! TRIGGERING DELAY ALERT !!! Late: ${uid} -> Notify Partner: ${partnerId}`);

                                        const isStruggle = (user.strugglePrayer === pName);
                                        let title = "Partner Reminder 🤲";
                                        let body = `${user.email?.split('@')[0] || 'Partner'} ne abhi tak ${pName} mark nahi ki. Osko remind karwaein!`;

                                        if (isStruggle) {
                                            title = "⚠️ High Priority Nudge";
                                            body = `${user.email?.split('@')[0] || 'Partner'} is struggling with ${pName} right now. Reach out and motivate them! 💪`;
                                        }

                                        await messaging.send({
                                            notification: { title, body },
                                            token: partnerUser.fcmToken,
                                            android: {
                                                priority: 'high',
                                                notification: {
                                                    sound: 'reminder_tone',
                                                    channelId: 'prayer-notifications',
                                                    priority: 'max'
                                                }
                                            },
                                            webpush: {
                                                fcm_options: { link: "https://salah-tracker-app.vercel.app" },
                                                notification: {
                                                    icon: "https://salah-tracker-app.vercel.app/icon-192.png",
                                                    badge: "https://salah-tracker-app.vercel.app/icon-192.png"
                                                }
                                            }
                                        });
                                        await db.ref(`users/${partnerId}/${delayNotifKey}`).set(true);
                                        results.push({ partnerId, alert: 'delay_nudged' });
                                    } else {
                                        console.log(`[Cron Job] Delay Alert for ${uid} already sent to partner ${partnerId}.`);
                                    }
                                } else {
                                    console.log(`[Cron Job] Cannot notify partner: Partner ${partnerId} has no token.`);
                                }
                            } else {
                                console.log(`[Cron Job] User ${uid} has no active pair/partner in DB.`);
                            }
                        } else {
                            console.log(`[Cron Job] User ${uid} already marked ${pName} as ${status}. No nudge needed.`);
                        }
                    }
                }
            } catch (userErr) {
                console.error(`[Cron Job] Error processing user ${uid}:`, userErr);
            }
        }

        console.log(`[Cron Job] Job finished. Total notifications sent: ${results.length}`);
        return res.status(200).json({ success: true, notified: results });

    } catch (error) {
        console.error("Cron Error:", error);
        return res.status(500).json({ error: error.message });
    }
};

function isTimeMatch(currentTime, targetTime, windowMins = 25, offsetMins = 0) {
    const [currH, currM] = currentTime.split(':').map(Number);
    const [textH, textM] = targetTime.split(':').map(Number);

    const currTotal = currH * 60 + currM;
    const targetTotal = (textH * 60 + textM) + offsetMins;

    // Match if within the window starting from (target + offset)
    return currTotal >= targetTotal && currTotal < targetTotal + windowMins;
}
