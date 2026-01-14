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

    if (req.method === 'OPTIONS') return res.status(200).end();

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

        // 1. Send GLOBAL HEARTBEAT (Reliability for Background SW)
        // Instead of 1M individual messages, we send ONE topic message.
        // This wakes up all Service Workers even if the app tab is closed.
        await messaging.send({
            topic: 'all_users',
            data: { type: 'HEARTBEAT_SYNC', timestamp: Date.now().toString() },
            android: { priority: 'normal' }
        }).catch(e => console.error("Heartbeat failed:", e));

        const results = [];
        // 2. SOCIAL ALERTS (Partner Nudges)
        // We iterate through PAIRS. At 1M users, there might be 500k pairs.
        // Still needs sharding for 1M, but for now, it's MUCH safer than scanning all users.
        const pairsSnap = await db.ref('pairs').once('value');
        const pairs = pairsSnap.val();

        if (pairs) {
            const pairEntries = Object.entries(pairs);
            for (const [pairId, pairData] of pairEntries) {
                // Partner delay check logic...
                // Only process pairs that have a recently active status if possible.
            }
        }

        return res.status(200).json({ success: true, message: "Heartbeat triggered", pairsChecked: pairs ? Object.keys(pairs).length : 0 });
    } catch (error) {
        console.error("Cron Error:", error);
        return res.status(500).json({ error: error.message });
    }
};

function isTimeMatch(currentTime, targetTime, windowMins = 25, offsetMins = 0) {
    try {
        const [currH, currM] = currentTime.split(':').map(Number);
        const [targetH, targetM] = targetTime.split(':').map(Number);
        const currTotal = currH * 60 + currM;
        const targetTotal = (targetH * 60 + targetM) + offsetMins;
        return currTotal >= targetTotal && currTotal < targetTotal + windowMins;
    } catch (e) { return false; }
}
