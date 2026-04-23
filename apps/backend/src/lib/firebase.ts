import admin from 'firebase-admin';
import { env, isProduction } from './env';

/**
 * Firebase Admin SDK Initialization
 *
 * SECURITY: Service account loaded from FIREBASE_SERVICE_ACCOUNT_JSON env var as a JSON string.
 * Never from a file path because file paths are not portable in containerized deployments.
 *
 * Degrades gracefully for local development when Firebase is not configured.
 */

let firebaseApp: admin.app.App | null = null;

try {
  const projectId = env.FIREBASE_PROJECT_ID;
  const serviceAccountJson = env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (projectId && serviceAccountJson) {
    const serviceAccount = JSON.parse(serviceAccountJson) as admin.ServiceAccount;

    firebaseApp = admin.apps.length
      ? admin.app()
      : admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          databaseURL: env.FIREBASE_DATABASE_URL,
          projectId,
        });

    console.log('Firebase Admin SDK initialized');
  } else if (!isProduction) {
    console.warn('Firebase credentials not configured; running in mock mode for local development');
  }
} catch (err) {
  console.error('Failed to initialize Firebase Admin SDK:', err);
}

export const firebaseAdmin = firebaseApp ? admin : null;
