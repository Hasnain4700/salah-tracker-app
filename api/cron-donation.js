const admin = require('firebase-admin');

// Validate environment variables early
const project_id = (process.env.FCM_PROJECT_ID || '').trim();
const client_email = (process.env.FCM_CLIENT_EMAIL || '').trim();
const private_key = (process.env.FCM_PRIVATE_KEY || '').trim();

module.exports = async (req, res) => {
    // --- CORS Headers ---
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle Preflight
    if (req.method === 'OPTIONS') return res.status(200).end();

    // Verify logic: Ensure env vars exist
    if (!project_id || !client_email || !private_key) {
        return res.status(500).json({ success: false, error: 'Missing Credentials' });
    }

    // Initialize Admin
    try {
        if (!admin.apps.length) {
            let pk = private_key;
            try { if (pk.startsWith('"')) pk = JSON.parse(pk); } catch (e) { pk = pk.replace(/^["']|["']$/g, ''); }
            pk = pk.replace(/\\n/g, '\n');
            if (!pk.includes('-----BEGIN PRIVATE KEY-----')) {
                pk = `----- BEGIN PRIVATE KEY-----\n${pk} \n----- END PRIVATE KEY----- `;
            }

            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: project_id,
                    clientEmail: client_email,
                    privateKey: pk,
                }),
                databaseURL: `https://${project_id}-default-rtdb.firebaseio.com` // Optional if using RTDB
            });
        }

        // Logic: Send to "donations" topic OR all users?
        // Ideally, we should subscribe all users to "global_notifications" topic in app.js
        // For now, since topic might be empty, we can try sending to a condition or topic 'all' if setup.
        // Assuming client-side subscribes to 'donations' topic.

        const messaging = admin.messaging();

        const message = {
            topic: 'donations',
            notification: {
                title: 'Jummah Mubarak! 🤲',
                body: 'Aaj Jummah hai! Sadqa dein aur apni aur dusron ki mushkilat aasan karein.',
            },
            webpush: {
                fcm_options: { link: "https://salah-tracker-app.vercel.app" },
                notification: { icon: "https://salah-tracker-app.vercel.app/icon-192.png" }
            },
            android: {
                notification: {
                    sound: 'default',
                    channelId: 'prayer-notifications'
                }
            }
        };

        const response = await messaging.send(message);
        console.log("Successfully sent donation reminder:", response);
        return res.status(200).json({ success: true, messageId: response });

    } catch (error) {
        console.error("Cron Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
};
