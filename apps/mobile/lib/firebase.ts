// lib/firebase.ts — Firebase RTDB initialization with offline persistence
// NOTE: For Expo managed workflow, we use the JS SDK.
// For dev-client/bare workflow, use @react-native-firebase/*

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getDatabase, ref, onValue, off, update } from 'firebase/database';
import { config, features } from './config';

let app: ReturnType<typeof initializeApp> | null = null;
let database: ReturnType<typeof getDatabase> | null = null;

if (features.firebaseRealtime) {
  const firebaseConfig = {
    apiKey: config.firebase.apiKey!,
    authDomain: config.firebase.authDomain ?? undefined,
    projectId: config.firebase.projectId!,
    databaseURL: config.firebase.databaseURL!,
    storageBucket: config.firebase.storageBucket ?? undefined,
    messagingSenderId: config.firebase.messagingSenderId ?? undefined,
    appId: config.firebase.appId!,
  };

  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  database = getDatabase(app);
}

export { database, ref, onValue, off, update };
export default app;
