import { z } from 'zod';

const optionalTrimmed = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().optional());

const optionalUrl = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().url().optional());

const MobileEnvSchema = z.object({
  EXPO_PUBLIC_API_URL: z.string().url(),
  EXPO_PUBLIC_SOCKET_URL: optionalUrl,
  EXPO_PUBLIC_FIREBASE_API_KEY: optionalTrimmed,
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: optionalTrimmed,
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: optionalTrimmed,
  EXPO_PUBLIC_FIREBASE_DATABASE_URL: optionalUrl,
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: optionalTrimmed,
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: optionalTrimmed,
  EXPO_PUBLIC_FIREBASE_APP_ID: optionalTrimmed,
  EXPO_PUBLIC_PROJECT_ID: optionalTrimmed,
  EXPO_PUBLIC_SUPPORT_PHONE: optionalTrimmed.default('+919000000000'),
  EXPO_PUBLIC_ENVIRONMENT: z.enum(['development', 'staging', 'production']).default('development'),
});

const parsedEnv = MobileEnvSchema.safeParse({
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  EXPO_PUBLIC_SOCKET_URL: process.env.EXPO_PUBLIC_SOCKET_URL,
  EXPO_PUBLIC_FIREBASE_API_KEY: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  EXPO_PUBLIC_FIREBASE_DATABASE_URL: process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL,
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  EXPO_PUBLIC_FIREBASE_APP_ID: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  EXPO_PUBLIC_PROJECT_ID: process.env.EXPO_PUBLIC_PROJECT_ID,
  EXPO_PUBLIC_SUPPORT_PHONE: process.env.EXPO_PUBLIC_SUPPORT_PHONE,
  EXPO_PUBLIC_ENVIRONMENT: process.env.EXPO_PUBLIC_ENVIRONMENT,
});

if (!parsedEnv.success) {
  throw new Error(
    `Invalid mobile configuration:\n${parsedEnv.error.issues
      .map((issue) => `- ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')}`,
  );
}

const rawEnv = parsedEnv.data;

export const config = {
  apiUrl: rawEnv.EXPO_PUBLIC_API_URL,
  socketUrl: rawEnv.EXPO_PUBLIC_SOCKET_URL ?? rawEnv.EXPO_PUBLIC_API_URL,
  projectId: rawEnv.EXPO_PUBLIC_PROJECT_ID,
  supportPhone: rawEnv.EXPO_PUBLIC_SUPPORT_PHONE,
  environment: rawEnv.EXPO_PUBLIC_ENVIRONMENT,
  firebase: {
    apiKey: rawEnv.EXPO_PUBLIC_FIREBASE_API_KEY,
    authDomain: rawEnv.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: rawEnv.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    databaseURL: rawEnv.EXPO_PUBLIC_FIREBASE_DATABASE_URL,
    storageBucket: rawEnv.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: rawEnv.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: rawEnv.EXPO_PUBLIC_FIREBASE_APP_ID,
  },
} as const;

export const features = {
  pushNotifications: Boolean(config.projectId),
  firebaseRealtime: Boolean(
    config.firebase.apiKey
    && config.firebase.projectId
    && config.firebase.databaseURL
    && config.firebase.appId,
  ),
} as const;
