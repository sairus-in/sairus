import { getApps } from '@react-native-firebase/app';
import {
  getAuth,
  PhoneAuthProvider,
  signInWithCredential,
  signInWithPhoneNumber,
  signOut,
  type FirebaseAuthTypes,
} from '@react-native-firebase/auth';

const requestPhoneSignIn = signInWithPhoneNumber as unknown as (
  auth: ReturnType<typeof getAuth>,
  phoneNumber: string,
  forceResend?: boolean,
) => Promise<FirebaseAuthTypes.ConfirmationResult>;

function getFirebaseAuth(): ReturnType<typeof getAuth> | null {
  const [app] = getApps();
  return app ? getAuth(app) : null;
}

function requireFirebaseAuth(): ReturnType<typeof getAuth> {
  const firebaseAuth = getFirebaseAuth();

  if (!firebaseAuth) {
    throw new Error('Firebase Auth is not configured for this development build.');
  }

  return firebaseAuth;
}

export function normalizePhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `+91${digits}`;
}

export async function sendPhoneOtp(phone: string, forceResend = false): Promise<string> {
  const firebaseAuth = requireFirebaseAuth();
  const confirmation = await requestPhoneSignIn(firebaseAuth, normalizePhoneNumber(phone), forceResend);

  if (!confirmation.verificationId) {
    throw new Error('Missing Firebase verification ID');
  }

  return confirmation.verificationId;
}

export async function verifyPhoneOtp(verificationId: string, code: string): Promise<string> {
  const firebaseAuth = requireFirebaseAuth();
  const credential = PhoneAuthProvider.credential(verificationId, code);
  const result = await signInWithCredential(firebaseAuth, credential);
  return result.user.getIdToken(true);
}

export async function getFreshFirebaseToken(): Promise<string> {
  const firebaseAuth = requireFirebaseAuth();
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('No Firebase session — cannot refresh token');
  return user.getIdToken(true);
}

export async function clearPhoneAuthSession() {
  const firebaseAuth = getFirebaseAuth();

  if (!firebaseAuth) {
    return;
  }

  if (firebaseAuth.currentUser) {
    await signOut(firebaseAuth);
  }
}
