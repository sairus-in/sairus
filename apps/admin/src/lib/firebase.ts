import { initializeApp, getApps, getApp } from 'firebase/app';
import { getDatabase, ref, onValue, off, update, get } from 'firebase/database';

const databaseURL = import.meta.env.VITE_FIREBASE_DATABASE_URL || '';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'demo-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'demo-project',
  databaseURL: databaseURL || 'https://demo-project-default-rtdb.firebaseio.com',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || 'demo-app-id',
};

if (!databaseURL) {
  console.warn('⚠️ VITE_FIREBASE_DATABASE_URL not set — Fleet Map live GPS will not work until configured.');
}

// Initialize only once
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const database = getDatabase(app);

export { database, ref, onValue, off, update, get };
export default app;
