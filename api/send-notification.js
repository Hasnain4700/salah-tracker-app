const admin = require('firebase-admin');

// Validate environment variables early
const project_id = process.env.FCM_PROJECT_ID;
const client_email = process.env.FCM_CLIENT_EMAIL;
const private_key = process.env.FCM_PRIVATE_KEY;

module.exports = async (req, res) => {
    // --- CORS Headers ---
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle Preflight request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // --- Diagnostic GET Handler ---
    if (req.method === 'GET') {
        const pk = private_key || '';
        return res.status(200).json({
            success: true,
            diagnostics: {
                projectId: !!project_id,
                clientEmail: !!client_email,
                privateKeySet: !!pk,
                privateKeyLength: pk.length,
                hasBeginHeader: pk.includes('-----BEGIN PRIVATE KEY-----'),
                hasEndFooter: pk.includes('-----END PRIVATE KEY-----'),
                hasLiteralNewlines: pk.includes('\\n'),
                hasRealNewlines: pk.includes('\n'),
                startsWithQuote: pk.startsWith('"') || pk.startsWith("'"),
            }
        });
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
            error: 'Missing Environment Variables. Please add FCM_PROJECT_ID, FCM_CLIENT_EMAIL, and FCM_PRIVATE_KEY in Vercel.'
        });
    }

    // Initialize Firebase Admin safely
    try {
        if (!admin.apps.length) {
            let pk = private_key.trim();

            // 1. Try to parse as JSON if it's a quoted string from a JSON file
            try {
                if (pk.startsWith('"')) {
                    pk = JSON.parse(pk);
                }
            } catch (e) {
                // If it fails, just strip quotes manually
                pk = pk.replace(/^["']|["']$/g, '');
            }

            // 2. Normalize newlines (handle both literal \n and actual newlines)
            pk = pk.replace(/\\n/g, '\n');

            // 3. Ensure it has correct headers - standard PEM format
            if (!pk.includes('-----BEGIN PRIVATE KEY-----')) {
                // Clean any accidental whitespace between segments if it was flattened
                pk = pk.replace(/\s+/g, '');
                pk = `-----BEGIN PRIVATE KEY-----\n${pk}\n-----END PRIVATE KEY-----`;
            }

            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: project_id.trim(),
                    clientEmail: client_email.trim(),
                    privateKey: pk,
                }),
            });
        }
    } catch (initError) {
        console.error("Firebase Admin Init Error:", initError);
        return res.status(500).json({
            success: false,
            error: 'Firebase Auth Error: ' + initError.message,
            hint: 'Check if FCM_PRIVATE_KEY is a valid PEM key starting with -----BEGIN PRIVATE KEY-----'
        });
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


