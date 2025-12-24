const admin = require('firebase-admin');

// Service Account JSON will be passed through Environment Variables
// to keep it secure and hidden from GitHub.
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FCM_PROJECT_ID,
            clientEmail: process.env.FCM_CLIENT_EMAIL,
            privateKey: process.env.FCM_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
    });
}

const messaging = admin.messaging();

module.exports = async (req, res) => {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    const { token, title, body } = req.body;

    if (!token || !title || !body) {
        return res.status(400).send('Missing required fields: token, title, body');
    }

    try {
        const message = {
            notification: { title, body },
            token: token,
            webpush: {
                fcm_options: {
                    link: "https://salah-tracker-app.vercel.app/" // You can change this
                }
            }
        };

        const response = await messaging.send(message);
        console.log('Successfully sent message:', response);
        return res.status(200).json({ success: true, messageId: response });
    } catch (error) {
        console.error('Error sending message:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

