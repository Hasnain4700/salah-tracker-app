const admin = require('firebase-admin');

// Validate environment variables early
const project_id = process.env.FCM_PROJECT_ID;
const client_email = process.env.FCM_CLIENT_EMAIL;
const private_key = process.env.FCM_PRIVATE_KEY;

module.exports = async (req, res) => {
    // --- CORS Headers ---
    res.setHeader('Access-Control-Origin', '*'); // For development, specific domain later
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle Preflight request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow POST requests for the actual notification
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method Not Allowed' });
    }

    // Check if env variables are missing
    if (!project_id || !client_email || !private_key) {
        console.error("Missing Environment Variables on Vercel!");
        return res.status(500).json({
            success: false,
            error: 'Backend Configuration Error: Missing Environment Variables in Vercel. Please add FCM_PROJECT_ID, FCM_CLIENT_EMAIL, and FCM_PRIVATE_KEY in Vercel Settings.'
        });
    }

    // Initialize Firebase Admin safely
    try {
        if (!admin.apps.length) {
            // --- Bulletproof PEM Normalization ---
            // 1. Remove all quotes (single or double)
            // 2. Replace literal \n with real newlines
            // 3. Trim whitespace
            let pk = private_key.trim();
            if (pk.startsWith('"') || pk.startsWith("'")) pk = pk.substring(1);
            if (pk.endsWith('"') || pk.endsWith("'")) pk = pk.substring(0, pk.length - 1);

            // Critical: Re-insert newlines if they were flattened by Vercel or manual copying
            pk = pk.replace(/\\n/g, '\n');

            // If the key is missing headers (rare but happens), wrap it
            if (!pk.includes('-----BEGIN PRIVATE KEY-----')) {
                pk = `-----BEGIN PRIVATE KEY-----\n${pk}\n-----END PRIVATE KEY-----`;
            }

            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: project_id,
                    clientEmail: client_email,
                    privateKey: pk,
                }),
            });
        }
    } catch (initError) {
        console.error("Firebase Admin Init Error:", initError);
        return res.status(500).json({ success: false, error: 'Firebase Auth Error: ' + initError.message });
    }

    const { token, title, body } = req.body;

    if (!token || !title || !body) {
        return res.status(400).json({ success: false, error: 'Missing required fields: token, title, body' });
    }

    try {
        const messaging = admin.messaging();
        const message = {
            notification: { title, body },
            token: token,
            webpush: {
                fcm_options: {
                    link: "https://salah-tracker-app.vercel.app" // Main app link
                }
            }
        };

        const response = await messaging.send(message);
        console.log('Successfully sent message:', response);
        return res.status(200).json({ success: true, messageId: response });
    } catch (error) {
        console.error('FCM Send Error:', error);
        return res.status(500).json({ success: false, error: 'FCM Error: ' + error.message });
    }
};


