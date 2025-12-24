const admin = require('firebase-admin');

// Validate environment variables early
const project_id = process.env.FCM_PROJECT_ID;
const client_email = process.env.FCM_CLIENT_EMAIL;
const private_key = process.env.FCM_PRIVATE_KEY;

module.exports = async (req, res) => {
    // Only allow POST requests
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
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: project_id,
                    clientEmail: client_email,
                    // Standard PEM parsing: Replace literal \n with real newlines, 
                    // and remove any accidental quotes at the start/end.
                    privateKey: private_key.replace(/\\n/g, '\n').replace(/^"|"$/g, ''),
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
                    link: "https://" + req.headers.host // Dynamically use the current host
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

