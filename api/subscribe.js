const admin = require('firebase-admin');

// Validate environment variables
const project_id = (process.env.FCM_PROJECT_ID || '').trim();
const client_email = (process.env.FCM_CLIENT_EMAIL || '').trim();
const private_key = (process.env.FCM_PRIVATE_KEY || '').trim();

module.exports = async (req, res) => {
    // --- CORS Headers ---
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { token, topic } = req.body;
    if (!token || !topic) {
        return res.status(400).json({ success: false, error: 'Token and Topic required' });
    }

    try {
        if (!admin.apps.length) {
            let pk = private_key.replace(/\\n/g, '\n');
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: project_id,
                    clientEmail: client_email,
                    privateKey: pk,
                })
            });
        }

        const messaging = admin.messaging();
        await messaging.subscribeToTopic(token, topic);

        console.log(`[Subscription API] User token subscribed to topic: ${topic}`);
        return res.status(200).json({ success: true, message: `Subscribed to ${topic}` });
    } catch (error) {
        console.error("Subscription Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
};
