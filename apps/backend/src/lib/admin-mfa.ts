import * as crypto from 'crypto';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { adminSecurityConfig } from './auth-config';
import { AppError } from './errors';

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;

interface AdminMfaChallenge {
  adminId: string;
  ipHash: string;
  userAgentHash: string;
}

const normalizeSecret = (secret: string): string =>
  secret.replace(/\s+/g, '').replace(/=+$/g, '').toUpperCase();

const hashContextValue = (value: string): string =>
  crypto.createHash('sha256').update(value).digest('hex');

const timingSafeEqualHex = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const getEncryptionKey = (): Buffer => {
  if (!adminSecurityConfig.mfaEncryptionKey) {
    throw new AppError('MFA encryption key is not configured', 500, 'MFA_CONFIGURATION_ERROR');
  }

  return crypto.createHash('sha256').update(adminSecurityConfig.mfaEncryptionKey).digest();
};

export const generateAdminMfaSecret = (): string => normalizeSecret(generateSecret({ length: 20 }));

export const verifyAdminTotpCode = (
  secret: string,
  code: string,
  now = Date.now(),
  allowedWindow = 1
): boolean => {
  const normalizedCode = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalizedCode)) {
    return false;
  }

  const result = verifySync({
    secret: normalizeSecret(secret),
    token: normalizedCode,
    digits: TOTP_DIGITS,
    period: TOTP_STEP_SECONDS,
    epoch: Math.floor(now / 1000),
    epochTolerance: allowedWindow * TOTP_STEP_SECONDS,
  });

  return result.valid;
};

export const encryptAdminMfaSecret = (secret: string): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(normalizeSecret(secret), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
};

export const decryptAdminMfaSecret = (encryptedSecret: string): string => {
  const [ivBase64, authTagBase64, ciphertextBase64] = encryptedSecret.split(':');
  if (!ivBase64 || !authTagBase64 || !ciphertextBase64) {
    throw new AppError('Stored MFA secret is invalid', 500, 'INVALID_MFA_SECRET');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(ivBase64, 'base64')
  );
  decipher.setAuthTag(Buffer.from(authTagBase64, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, 'base64')),
    decipher.final(),
  ]);

  return normalizeSecret(decrypted.toString('utf8'));
};

export const buildAdminMfaOtpAuthUrl = (email: string, secret: string): string =>
  generateURI({
    issuer: adminSecurityConfig.mfaIssuer,
    label: email.toLowerCase().trim(),
    secret: normalizeSecret(secret),
    digits: TOTP_DIGITS,
    period: TOTP_STEP_SECONDS,
  });

export const createAdminMfaChallenge = async (
  adminId: string,
  ipAddress: string,
  userAgent: string
): Promise<string> => {
  const { redis } = await import('./redis');
  const challengeToken = crypto.randomBytes(32).toString('hex');
  const challenge: AdminMfaChallenge = {
    adminId,
    ipHash: hashContextValue(ipAddress),
    userAgentHash: hashContextValue(userAgent),
  };

  await redis.setex(
    `auth:admin:mfa:challenge:${challengeToken}`,
    MFA_CHALLENGE_TTL_SECONDS,
    JSON.stringify(challenge)
  );

  return challengeToken;
};

export const getAdminMfaChallenge = async (challengeToken: string): Promise<AdminMfaChallenge | null> => {
  const { redis } = await import('./redis');
  const challenge = await redis.get(`auth:admin:mfa:challenge:${challengeToken}`);
  if (!challenge) {
    return null;
  }

  return JSON.parse(challenge) as AdminMfaChallenge;
};

export const validateAdminMfaChallenge = (
  challenge: AdminMfaChallenge,
  ipAddress: string,
  userAgent: string
): boolean =>
  timingSafeEqualHex(challenge.ipHash, hashContextValue(ipAddress)) &&
  timingSafeEqualHex(challenge.userAgentHash, hashContextValue(userAgent));

export const deleteAdminMfaChallenge = async (challengeToken: string): Promise<void> => {
  const { redis } = await import('./redis');
  await redis.del(`auth:admin:mfa:challenge:${challengeToken}`);
};

export const adminMfaChallengeTtlSeconds = MFA_CHALLENGE_TTL_SECONDS;
