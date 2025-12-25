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

    // Handle Preflight request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // --- Diagnostic GET Handler ---
    if (req.method === 'GET') {
        return res.status(200).json({
            success: true,
            diagnostics: {
                projectId: project_id || 'NOT_SET',
                clientEmailMasked: client_email ? `${client_email.substring(0, 5)}...${client_email.split('@')[1]} ` : 'NOT_SET',
                privateKeyLength: private_key.length,
                hasBeginHeader: private_key.includes('-----BEGIN PRIVATE KEY-----'),
                hasRealNewlines: private_key.includes('\n'),
            }
        });
    }

    // Only allow POST requests for the actual notification
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method Not Allowed' });
    }

    if (!project_id || !client_email || !private_key) {
        return res.status(500).json({ success: false, error: 'Missing Credentials in Vercel Settings' });
    }

    // Initialize Firebase Admin safely
    try {
        if (!admin.apps.length) {
            let pk = private_key;

            // Unpack JSON string if needed
            try {
                if (pk.startsWith('"')) pk = JSON.parse(pk);
            } catch (e) {
                pk = pk.replace(/^["']|["']$/g, '');
            }

            pk = pk.replace(/\\n/g, '\n');

            if (!pk.includes('-----BEGIN PRIVATE KEY-----')) {
                pk = pk.replace(/\s+/g, '');
                pk = `----- BEGIN PRIVATE KEY-----\n${pk} \n----- END PRIVATE KEY----- `;
            }

            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: project_id,
                    clientEmail: client_email,
                    privateKey: pk,
                }),
            });
        }

        const messaging = admin.messaging();
        const { token, title, body } = req.body;

        if (!token || !title || !body) {
            return res.status(400).json({ success: false, error: 'Missing token/title/body' });
        }

        const response = await messaging.send({
            notification: { title, body },
            token: token,
            webpush: { fcm_options: { link: "https://salah-tracker-app.vercel.app" } }
        });

        return res.status(200).json({ success: true, messageId: response });

    } catch (error) {
        console.error("FCM Backend Error:", error);
        return res.status(500).json({
            success: false,
            error: error.message,
            code: error.code || 'UNKNOWN',
            hint: error.message.includes('account not found') ? 'Check if Client Email is exactly correct in Vercel' : 'Double check Private Key'
        });
    }
};
