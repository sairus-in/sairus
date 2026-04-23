import { FastifyReply } from 'fastify';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { AuthAuditEventType } from 'shared';
import { writeAuthAdminCache } from '../../lib/auth-cache';
import { writeAuthAuditEvent } from '../../lib/auth-audit';
import { buildAdminTrustedDeviceHash, evaluateAdminGeoVelocity } from '../../lib/admin-security';
import {
  adminMfaChallengeTtlSeconds,
  buildAdminMfaOtpAuthUrl,
  createAdminMfaChallenge,
  decryptAdminMfaSecret,
  deleteAdminMfaChallenge,
  encryptAdminMfaSecret,
  generateAdminMfaSecret,
  getAdminMfaChallenge,
  validateAdminMfaChallenge,
  verifyAdminTotpCode,
} from '../../lib/admin-mfa';
import { setAdminSessionCookies, clearAdminSessionCookies } from '../../lib/admin-session';
import { jwtConfig } from '../../lib/auth-config';
import { AppError } from '../../lib/errors';
import { redis } from '../../lib/redis';
import {
  checkAdminLoginRateLimit,
  checkAdminMfaRateLimit,
  checkAdminStepUpRateLimit,
  resetAdminLoginRateLimit,
} from '../../lib/rate-limit';
import { revokeAdminAuthState } from '../../lib/auth-state-change';
import {
  clearAdminAnomalyTracking,
  clearAdminStepUpFailures,
  recordAdminStepUpFailure,
} from './admin-anomaly.service';
import { syncAdminFingerprint } from './admin-fingerprint.service';
import * as adminAuthRepository from './admin-auth.repository';

const DUMMY_BCRYPT_HASH = bcrypt.hashSync('dummy-password-for-timing-safety', 12);

type AdminSessionUser = {
  id: string;
  name: string;
  email: string;
  role: 'COORDINATOR' | 'TRANSPORT_OFFICER' | 'FACULTY' | 'MANAGEMENT';
};

type AdminLoginResponse = {
  success: true;
  data:
    | { user: AdminSessionUser }
    | { mfaRequired: true; challengeToken: string; expiresInSeconds: number };
};

type FinalizeLoginContext = {
  ipAddress: string;
  userAgent: string;
  acceptLanguage?: string;
  country?: string;
  mfaVerified: boolean;
};

const STEP_UP_TTL_SECONDS = 5 * 60;

const generateAdminBackupCodes = (count = 8): string[] =>
  Array.from({ length: count }, () => crypto.randomBytes(6).toString('base64url').slice(0, 8).toUpperCase());

const hashAdminBackupCode = async (code: string): Promise<string> => bcrypt.hash(code, 10);

const hashContextValue = (value: string): string =>
  crypto.createHash('sha256').update(value).digest('hex');

const buildAdminSessionUser = (admin: {
  id: string;
  name: string;
  email: string;
  role: AdminSessionUser['role'];
}): AdminSessionUser => ({
  id: admin.id,
  name: admin.name,
  email: admin.email,
  role: admin.role,
});

const issueAdminJwt = (admin: {
  id: string;
  email: string;
  role: AdminSessionUser['role'];
  sessionVersion: number;
}): string =>
  jwt.sign(
    {
      sub: admin.id,
      type: 'ADMIN',
      role: admin.role,
      email: admin.email,
      sv: admin.sessionVersion,
    },
    jwtConfig.secret,
    {
      expiresIn: '8h',
      issuer: jwtConfig.issuer,
      audience: jwtConfig.adminAudience,
      algorithm: jwtConfig.algorithm,
    }
  );

const extractCountryFromLoginMetadata = (metadata: unknown): string | null => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  const country = (metadata as Record<string, unknown>).country;
  return typeof country === 'string' && country.trim().length > 0 ? country.trim().toUpperCase() : null;
};

const finalizeAdminLogin = async (
  admin: {
    id: string;
    name: string;
    email: string;
    role: AdminSessionUser['role'];
    sessionVersion: number;
  },
  reply: FastifyReply,
  context: FinalizeLoginContext,
): Promise<AdminLoginResponse> => {
  const fingerprintAssessment = await syncAdminFingerprint(admin.id, {
    userAgent: context.userAgent,
    acceptLanguage: context.acceptLanguage,
    ipCountry: context.country,
  });

  if (fingerprintAssessment.action === 'REVOKE') {
    void writeAuthAuditEvent({
      actorType: 'ADMIN_USER',
      actorId: admin.id,
      eventType: AuthAuditEventType.ADMIN_LOGIN_FAILURE,
      ipAddress: context.ipAddress,
      metadata: {
        stage: 'fingerprint_mismatch',
        fingerprintDriftScore: fingerprintAssessment.score,
        changedSignals: fingerprintAssessment.changedSignals,
        country: context.country ?? null,
      },
    });

    throw new AppError(
      'This sign-in was blocked because the device fingerprint changed too sharply. Re-authenticate from a known device or contact an administrator.',
      403,
      'FORBIDDEN',
    );
  }

  const deviceHash = buildAdminTrustedDeviceHash(context.userAgent, context.acceptLanguage);

  await adminAuthRepository.updateLoginInfo(admin.id, {
    lastLoginAt: new Date(),
    lastLoginIp: context.ipAddress,
    lastLoginUserAgent: context.userAgent,
  });

  await adminAuthRepository.upsertTrustedDevice({
    adminId: admin.id,
    deviceHash,
    userAgent: context.userAgent,
    acceptLanguage: context.acceptLanguage,
    ipAddress: context.ipAddress,
    ipCountry: context.country,
  });

  await clearAdminAnomalyTracking(admin.id, admin.sessionVersion);
  setAdminSessionCookies(reply, issueAdminJwt(admin));
  await writeAuthAdminCache(admin.id);

  void writeAuthAuditEvent({
    actorType: 'ADMIN_USER',
    actorId: admin.id,
    eventType: AuthAuditEventType.ADMIN_LOGIN_SUCCESS,
    ipAddress: context.ipAddress,
    metadata: {
      role: admin.role,
      mfaVerified: context.mfaVerified,
      country: context.country ?? null,
      deviceTrusted: true,
      fingerprintVerdict: fingerprintAssessment.verdict,
      fingerprintDriftScore: fingerprintAssessment.score,
      fingerprintChangedSignals: fingerprintAssessment.changedSignals,
    },
  });

  return {
    success: true,
    data: {
      user: buildAdminSessionUser(admin),
    },
  };
};

export const adminLogin = async (
  email: string,
  password: string,
  ipAddress: string,
  userAgent: string,
  acceptLanguage: string,
  country: string,
  reply: FastifyReply
): Promise<AdminLoginResponse> => {
  const normalizedEmail = email.toLowerCase().trim();
  const emailHash = crypto.createHash('sha256').update(normalizedEmail).digest('hex').slice(0, 16);

  await checkAdminLoginRateLimit(normalizedEmail, ipAddress);

  const admin = await adminAuthRepository.getUserByEmailForAuth(normalizedEmail);

  const hashToCompare = admin?.passwordHash ?? DUMMY_BCRYPT_HASH;
  const passwordMatch = await adminAuthRepository.verifyPasswordHash(hashToCompare, password);

  if (!admin || !passwordMatch) {
    void writeAuthAuditEvent({
      actorType: 'ADMIN_USER',
      actorId: admin?.id,
      eventType: AuthAuditEventType.ADMIN_LOGIN_FAILURE,
      ipAddress,
      metadata: { emailHash, stage: 'password' },
    });

    throw new AppError(401, 'UNAUTHORIZED');
  }

  if (admin.isSuspended) {
    void writeAuthAuditEvent({
      actorType: 'ADMIN_USER',
      actorId: admin.id,
      eventType: AuthAuditEventType.ADMIN_LOGIN_FAILURE,
      ipAddress,
      metadata: {
        emailHash,
        stage: 'account_suspended',
        suspendedAt: admin.suspendedAt?.toISOString() ?? null,
      },
    });

    throw new AppError(403, 'ACCOUNT_SUSPENDED');
  }

  if (!admin.isActive) {
    void writeAuthAuditEvent({
      actorType: 'ADMIN_USER',
      actorId: admin.id,
      eventType: AuthAuditEventType.ADMIN_LOGIN_FAILURE,
      ipAddress,
      metadata: {
        emailHash,
        stage: 'account_disabled',
      },
    });

    throw new AppError(403, 'ACCOUNT_DISABLED');
  }

  await resetAdminLoginRateLimit(normalizedEmail);

  const deviceHash = buildAdminTrustedDeviceHash(userAgent, acceptLanguage);
  const [trustedDevice, trustedDeviceCount, latestSuccessfulLogin] = await Promise.all([
    adminAuthRepository.findTrustedDeviceByHash(admin.id, deviceHash),
    adminAuthRepository.countTrustedDevices(admin.id),
    adminAuthRepository.getLatestAdminLoginSuccess(admin.id),
  ]);

  const geoVelocity = evaluateAdminGeoVelocity({
    previousCountry: extractCountryFromLoginMetadata(latestSuccessfulLogin?.metadata),
    previousSeenAt: latestSuccessfulLogin?.createdAt ?? admin.lastLoginAt ?? null,
    currentCountry: country,
  });

  if (geoVelocity.decision === 'BLOCK') {
    void writeAuthAuditEvent({
      actorType: 'ADMIN_USER',
      actorId: admin.id,
      eventType: AuthAuditEventType.ADMIN_LOGIN_FAILURE,
      ipAddress,
      metadata: {
        emailHash,
        stage: 'geo_velocity',
        previousCountry: geoVelocity.previousCountry,
        currentCountry: geoVelocity.currentCountry,
        elapsedHours: geoVelocity.elapsedHours,
      },
    });

    throw new AppError('Geo-velocity policy blocked this sign-in. Use your usual network or contact an administrator.', 403, 'FORBIDDEN');
  }

  const isKnownTrustedDevice = Boolean(trustedDevice && !trustedDevice.revokedAt);
  const isFirstTrustedDevice = trustedDeviceCount === 0;

  if (!isKnownTrustedDevice && !isFirstTrustedDevice && !admin.mfaEnabled) {
    void writeAuthAuditEvent({
      actorType: 'ADMIN_USER',
      actorId: admin.id,
      eventType: AuthAuditEventType.ADMIN_LOGIN_FAILURE,
      ipAddress,
      metadata: {
        emailHash,
        stage: 'new_device_requires_mfa',
        country,
      },
    });

    throw new AppError(
      'A new device was detected for this account. Enable MFA before approving additional devices.',
      403,
      'MFA_REQUIRED',
    );
  }

  if (admin.mfaEnabled) {
    if (!admin.mfaSecretEncrypted) {
      throw new AppError(500, 'INTERNAL_SERVER_ERROR');
    }

    const challengeToken = await createAdminMfaChallenge(admin.id, ipAddress, userAgent);
    return {
      success: true,
      data: {
        mfaRequired: true,
        challengeToken,
        expiresInSeconds: adminMfaChallengeTtlSeconds,
      },
    };
  }

  return finalizeAdminLogin(admin, reply, {
    ipAddress,
    userAgent,
    acceptLanguage,
    country,
    mfaVerified: false,
  });
};

export const verifyAdminLoginMfa = async (
  challengeToken: string,
  verification: {
    code?: string;
    backupCode?: string;
  },
  ipAddress: string,
  userAgent: string,
  acceptLanguage: string,
  country: string,
  reply: FastifyReply
): Promise<AdminLoginResponse> => {
  const challenge = await getAdminMfaChallenge(challengeToken);
  if (!challenge) {
    throw new AppError(401, 'INVALID_TOKEN');
  }

  await checkAdminMfaRateLimit(challengeToken, ipAddress);

  if (!validateAdminMfaChallenge(challenge, ipAddress, userAgent)) {
    await deleteAdminMfaChallenge(challengeToken);
    throw new AppError(401, 'INVALID_TOKEN');
  }

  // Fetch full admin data including sessionVersion for JWT
  const admin = await adminAuthRepository.getUserByIdForAuth(challenge.adminId);

  if (!admin || admin.isSuspended || !admin.isActive || !admin.mfaEnabled || !admin.mfaSecretEncrypted) {
    await deleteAdminMfaChallenge(challengeToken);
    if (admin?.isSuspended) {
      throw new AppError(403, 'ACCOUNT_SUSPENDED');
    }
    if (admin && !admin.isActive) {
      throw new AppError(403, 'ACCOUNT_DISABLED');
    }
    throw new AppError(401, 'INVALID_TOKEN');
  }

  const secret = decryptAdminMfaSecret(admin.mfaSecretEncrypted);
  const hasTotpCode = typeof verification.code === 'string' && verification.code.trim().length > 0;
  const hasBackupCode =
    typeof verification.backupCode === 'string' && verification.backupCode.trim().length > 0;

  let verified = false;

  if (hasTotpCode) {
    verified = verifyAdminTotpCode(secret, verification.code!.trim());
  } else if (hasBackupCode) {
    verified = await adminAuthRepository.consumeAdminBackupCode(admin.id, verification.backupCode!);
  }

  if (!verified) {
    void writeAuthAuditEvent({
      actorType: 'ADMIN_USER',
      actorId: admin.id,
      eventType: AuthAuditEventType.ADMIN_LOGIN_FAILURE,
      ipAddress,
      metadata: { stage: hasBackupCode ? 'backup_code' : 'mfa' },
    });

    throw new AppError(401, 'INVALID_MFA_CODE');
  }

  await deleteAdminMfaChallenge(challengeToken);
  return finalizeAdminLogin(admin, reply, {
    ipAddress,
    userAgent,
    acceptLanguage,
    country,
    mfaVerified: true,
  });
};

export const getAdminMfaStatus = async (adminId: string) => {
  const admin = await adminAuthRepository.getMfaConfig(adminId);

  if (!admin) {
    throw new AppError(401, 'UNAUTHORIZED');
  }

  return {
    enabled: admin.mfaEnabled,
    pendingSetup: !admin.mfaEnabled && Boolean(admin.mfaSecretEncrypted),
  };
};

export const startAdminMfaSetup = async (adminId: string) => {
  const admin = await adminAuthRepository.getMfaConfig(adminId);

  if (!admin) {
    throw new AppError(401, 'UNAUTHORIZED');
  }

  if (admin.mfaEnabled) {
    throw new AppError(409, 'RESOURCE_CONFLICT');
  }

  const secret = generateAdminMfaSecret();
  await adminAuthRepository.setMfaSecretForSetup(adminId, encryptAdminMfaSecret(secret));

  return {
    manualEntryKey: secret,
    otpauthUrl: buildAdminMfaOtpAuthUrl(admin.email, secret),
  };
};

export const enableAdminMfa = async (adminId: string, code: string, reply: FastifyReply) => {
  const admin = await adminAuthRepository.getMfaConfig(adminId);

  if (!admin?.mfaSecretEncrypted) {
    throw new AppError(400, 'VALIDATION_ERROR');
  }

  if (admin.mfaEnabled) {
    throw new AppError(409, 'RESOURCE_CONFLICT');
  }

  const secret = decryptAdminMfaSecret(admin.mfaSecretEncrypted);
  if (!verifyAdminTotpCode(secret, code)) {
    throw new AppError(401, 'INVALID_MFA_CODE');
  }

  const backupCodes = generateAdminBackupCodes();
  const backupCodeHashes = await Promise.all(
    backupCodes.map((backupCode) => hashAdminBackupCode(backupCode)),
  );

  await revokeAdminAuthState(adminId, { mfaEnabled: true });
  await adminAuthRepository.replaceAdminBackupCodes(adminId, backupCodeHashes);
  clearAdminSessionCookies(reply);

  return {
    success: true,
    message: 'MFA enabled. Please sign in again with your authenticator code.',
    requiresReauth: true,
    backupCodes,
  };
};

export const disableAdminMfa = async (
  adminId: string,
  password: string,
  code: string,
  reply: FastifyReply
) => {
  const mfaConfig = await adminAuthRepository.getMfaConfig(adminId);

  if (!mfaConfig?.mfaEnabled || !mfaConfig.mfaSecretEncrypted) {
    throw new AppError(400, 'VALIDATION_ERROR');
  }

  const passwordHash = await adminAuthRepository.getPasswordHashForAdmin(adminId);
  if (!passwordHash) {
    throw new AppError(401, 'UNAUTHORIZED');
  }

  const passwordMatch = await adminAuthRepository.verifyPasswordHash(passwordHash, password);
  if (!passwordMatch) {
    throw new AppError(401, 'UNAUTHORIZED');
  }

  const secret = decryptAdminMfaSecret(mfaConfig.mfaSecretEncrypted);
  if (!verifyAdminTotpCode(secret, code)) {
    throw new AppError(401, 'INVALID_MFA_CODE');
  }

  await revokeAdminAuthState(adminId, {
    mfaEnabled: false,
    mfaSecretEncrypted: null,
  });
  await adminAuthRepository.clearAdminBackupCodes(adminId);
  clearAdminSessionCookies(reply);

  return {
    success: true,
    message: 'MFA disabled. Please sign in again.',
    requiresReauth: true,
  };
};

export const getAdminBackupCodeSummary = async (adminId: string) => {
  const summary = await adminAuthRepository.getAdminBackupCodeSummary(adminId);

  if (!summary.enabled) {
    return {
      totalCount: 0,
      remainingCount: 0,
      lastUsedAt: summary.lastUsedAt?.toISOString() ?? null,
    };
  }

  return {
    totalCount: summary.totalCount,
    remainingCount: summary.remainingCount,
    lastUsedAt: summary.lastUsedAt?.toISOString() ?? null,
  };
};

export const regenerateAdminBackupCodes = async (adminId: string) => {
  const admin = await adminAuthRepository.getMfaConfig(adminId);

  if (!admin?.mfaEnabled || !admin.mfaSecretEncrypted) {
    throw new AppError(400, 'VALIDATION_ERROR');
  }

  const backupCodes = generateAdminBackupCodes();
  const backupCodeHashes = await Promise.all(
    backupCodes.map((backupCode) => hashAdminBackupCode(backupCode)),
  );

  await adminAuthRepository.replaceAdminBackupCodes(adminId, backupCodeHashes);

  return {
    backupCodes,
    totalCount: backupCodes.length,
  };
};

export const initiateAdminStepUp = async (
  adminId: string,
  sessionVersion: number,
  password: string,
  ipAddress: string,
  userAgent: string,
) => {
  await checkAdminStepUpRateLimit(adminId, ipAddress);

  const passwordHash = await adminAuthRepository.getPasswordHashForAdmin(adminId);
  if (!passwordHash) {
    throw new AppError(401, 'UNAUTHORIZED');
  }

  const passwordMatch = await adminAuthRepository.verifyPasswordHash(passwordHash, password);
  if (!passwordMatch) {
    await recordAdminStepUpFailure({
      adminId,
      sessionVersion,
      ipAddress,
    });

    void writeAuthAuditEvent({
      actorType: 'ADMIN_USER',
      actorId: adminId,
      eventType: AuthAuditEventType.ADMIN_LOGIN_FAILURE,
      ipAddress,
      metadata: { stage: 'step_up' },
    });

    throw new AppError(401, 'UNAUTHORIZED');
  }

  const token = crypto.randomBytes(32).toString('base64url');
  await redis.setex(
    `auth:admin:step-up:${token}`,
    STEP_UP_TTL_SECONDS,
    JSON.stringify({
      adminId,
      sessionVersion,
      ipHash: hashContextValue(ipAddress),
      userAgentHash: hashContextValue(userAgent),
    }),
  );
  await clearAdminStepUpFailures(adminId, sessionVersion);

  return {
    stepUpToken: token,
    expiresInSeconds: STEP_UP_TTL_SECONDS,
  };
};

export const consumeAdminStepUpToken = async (
  token: string,
  adminId: string,
  sessionVersion: number,
  ipAddress: string,
  userAgent: string,
) => {
  const redisKey = `auth:admin:step-up:${token}`;
  const stored = await redis.get(redisKey);
  if (!stored) {
    return false;
  }

  await redis.del(redisKey);

  type StepUpRecord = {
    adminId?: string;
    sessionVersion?: number;
    ipHash?: string;
    userAgentHash?: string;
  };

  let parsed: StepUpRecord;

  try {
    parsed = JSON.parse(stored) as StepUpRecord;
  } catch {
    return false;
  }

  return (
    parsed.adminId === adminId &&
    parsed.sessionVersion === sessionVersion &&
    parsed.ipHash === hashContextValue(ipAddress) &&
    parsed.userAgentHash === hashContextValue(userAgent)
  );
};
