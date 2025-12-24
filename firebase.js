// Firebase App (the core Firebase SDK) is always required and must be listed first
const firebaseConfig = {
  apiKey: "AIzaSyDbVJk5nIK3Ltth3ibdERPmMzT8BXmeiUk",
  authDomain: "salah-tracker2.firebaseapp.com",
  databaseURL: "https://salah-tracker2-default-rtdb.firebaseio.com",
  projectId: "salah-tracker2",
  storageBucket: "salah-tracker2.firebasestorage.app",
  messagingSenderId: "1051833345706",
  appId: "1:1051833345706:web:40977957e6bf792b1552d3",
  measurementId: "G-E16NL1XPSZ"
};

const {
  initializeApp,
  getAnalytics,
  getAuth,
  getDatabase
} = window.FirebaseExports;

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getDatabase(app);

export { app, analytics, auth, db }; 