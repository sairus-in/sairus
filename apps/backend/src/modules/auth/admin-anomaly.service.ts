import { AuthAuditEventType } from 'shared';
import { writeAuthAuditEvent } from '../../lib/auth-audit';
import { revokeAdminAuthState } from '../../lib/auth-state-change';
import { redis } from '../../lib/redis';
import * as adminAuthRepository from './admin-auth.repository';

const ADMIN_ANOMALY_SCORE_TTL_SECONDS = 24 * 60 * 60;
const ADMIN_REAUTH_TTL_SECONDS = 8 * 60 * 60;
const ADMIN_STEP_UP_FAILURE_TTL_SECONDS = 5 * 60;
const ANOMALY_REAUTH_THRESHOLD = 30;
const ANOMALY_REVOKE_THRESHOLD = 60;

export type AdminAnomalyAction = 'ALLOW' | 'FORCE_REAUTH' | 'REVOKE_ALL';

type ApplyAdminAnomalyScoreInput = {
  adminId: string;
  sessionVersion: number;
  ipAddress?: string;
  points: number;
  reason: string;
  eventType: string;
  metadata?: Record<string, unknown>;
};

const buildAdminSessionKey = (adminId: string, sessionVersion: number): string =>
  `${adminId}:${sessionVersion}`;

const buildAnomalyScoreKey = (adminId: string, sessionVersion: number): string =>
  `auth:admin:anomaly:score:${buildAdminSessionKey(adminId, sessionVersion)}`;

const buildAnomalyReauthKey = (adminId: string, sessionVersion: number): string =>
  `auth:admin:anomaly:reauth:${buildAdminSessionKey(adminId, sessionVersion)}`;

const buildStepUpFailureKey = (adminId: string, sessionVersion: number): string =>
  `auth:admin:stepup:failed:${buildAdminSessionKey(adminId, sessionVersion)}`;

const buildMarkerKey = (
  kind: string,
  adminId: string,
  sessionVersion: number,
  bucket: string,
): string => `auth:admin:anomaly:marker:${kind}:${buildAdminSessionKey(adminId, sessionVersion)}:${bucket}`;

const setExpiringKeyOnce = async (key: string, ttlSeconds: number): Promise<boolean> => {
  try {
    const result = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  } catch {
    return false;
  }
};

const persistBehaviorEvent = async (input: {
  adminId: string;
  sessionVersion: number;
  eventType: string;
  metadata?: Record<string, unknown>;
}): Promise<void> => {
  try {
    await adminAuthRepository.createAdminBehaviorEvent({
      adminId: input.adminId,
      sessionId: buildAdminSessionKey(input.adminId, input.sessionVersion),
      eventType: input.eventType,
      metadata: input.metadata,
    });
  } catch {
    // Behavior persistence must never break the auth path.
  }
};

const markAdminReauthRequired = async (
  adminId: string,
  sessionVersion: number,
  reason: string,
  score: number,
  ipAddress?: string,
  metadata?: Record<string, unknown>,
): Promise<void> => {
  const key = buildAnomalyReauthKey(adminId, sessionVersion);
  const created = await setExpiringKeyOnce(key, ADMIN_REAUTH_TTL_SECONDS);

  if (created) {
    void writeAuthAuditEvent({
      actorType: 'ADMIN_USER',
      actorId: adminId,
      eventType: AuthAuditEventType.FORCED_RELOGIN_SET,
      ipAddress,
      metadata: {
        reason,
        anomalyScore: score,
        ...metadata,
      },
    });
  }
};

export const clearAdminAnomalyTracking = async (
  adminId: string,
  sessionVersion: number,
): Promise<void> => {
  try {
    await redis.del(
      buildAnomalyScoreKey(adminId, sessionVersion),
      buildAnomalyReauthKey(adminId, sessionVersion),
      buildStepUpFailureKey(adminId, sessionVersion),
    );
  } catch {
    // Fail open. Reauth flags are additive, not critical auth state.
  }
};

export const clearAdminStepUpFailures = async (
  adminId: string,
  sessionVersion: number,
): Promise<void> => {
  try {
    await redis.del(buildStepUpFailureKey(adminId, sessionVersion));
  } catch {
    // Ignore Redis degradation for auxiliary tracking.
  }
};

export const isAdminReauthRequired = async (
  adminId: string,
  sessionVersion: number,
): Promise<boolean> => {
  try {
    return (await redis.exists(buildAnomalyReauthKey(adminId, sessionVersion))) === 1;
  } catch {
    return false;
  }
};

export const applyAdminAnomalyScore = async (
  input: ApplyAdminAnomalyScoreInput,
): Promise<{ action: AdminAnomalyAction; score: number }> => {
  if (input.points <= 0) {
    return { action: 'ALLOW', score: 0 };
  }

  let score = input.points;

  try {
    score = await redis.incrby(
      buildAnomalyScoreKey(input.adminId, input.sessionVersion),
      input.points,
    );
    if (score === input.points) {
      await redis.expire(
        buildAnomalyScoreKey(input.adminId, input.sessionVersion),
        ADMIN_ANOMALY_SCORE_TTL_SECONDS,
      );
    }
  } catch {
    score = input.points;
  }

  await persistBehaviorEvent({
    adminId: input.adminId,
    sessionVersion: input.sessionVersion,
    eventType: input.eventType,
    metadata: {
      ...input.metadata,
      anomalyReason: input.reason,
      anomalyScore: score,
    },
  });

  if (score >= ANOMALY_REVOKE_THRESHOLD) {
    await revokeAdminAuthState(input.adminId);
    void writeAuthAuditEvent({
      actorType: 'ADMIN_USER',
      actorId: input.adminId,
      eventType: AuthAuditEventType.SESSION_VERSION_BUMPED,
      ipAddress: input.ipAddress,
      metadata: {
        reason: input.reason,
        anomalyScore: score,
        ...input.metadata,
      },
    });

    return { action: 'REVOKE_ALL', score };
  }

  if (score >= ANOMALY_REAUTH_THRESHOLD) {
    await markAdminReauthRequired(
      input.adminId,
      input.sessionVersion,
      input.reason,
      score,
      input.ipAddress,
      input.metadata,
    );

    return { action: 'FORCE_REAUTH', score };
  }

  return { action: 'ALLOW', score };
};

export const recordAdminApiBurst = async (input: {
  adminId: string;
  sessionVersion: number;
  requestCount: number;
  ipAddress?: string;
  path?: string;
  method?: string;
}): Promise<{ action: AdminAnomalyAction; score: number }> => {
  if (input.requestCount < 80) {
    return { action: 'ALLOW', score: 0 };
  }

  const bucket = Math.floor(Date.now() / 60_000).toString();
  const shouldScore = await setExpiringKeyOnce(
    buildMarkerKey('api-burst', input.adminId, input.sessionVersion, bucket),
    60,
  );

  if (!shouldScore) {
    return { action: 'ALLOW', score: 0 };
  }

  return applyAdminAnomalyScore({
    adminId: input.adminId,
    sessionVersion: input.sessionVersion,
    ipAddress: input.ipAddress,
    points: 40,
    reason: 'api_burst_threshold',
    eventType: 'API_BURST',
    metadata: {
      requestCount: input.requestCount,
      path: input.path ?? null,
      method: input.method ?? null,
    },
  });
};

export const recordAdminFingerprintAnomaly = async (input: {
  adminId: string;
  sessionVersion: number;
  verdict: 'DRIFT' | 'MISMATCH';
  score: number;
  changedSignals: string[];
  ipAddress?: string;
  path?: string;
}): Promise<{ action: AdminAnomalyAction; score: number }> => {
  return applyAdminAnomalyScore({
    adminId: input.adminId,
    sessionVersion: input.sessionVersion,
    ipAddress: input.ipAddress,
    points: input.verdict === 'MISMATCH' ? 70 : 35,
    reason: input.verdict === 'MISMATCH' ? 'fingerprint_mismatch' : 'fingerprint_drift',
    eventType: input.verdict === 'MISMATCH' ? 'FINGERPRINT_MISMATCH' : 'FINGERPRINT_DRIFT',
    metadata: {
      path: input.path ?? null,
      fingerprintDriftScore: input.score,
      changedSignals: input.changedSignals,
    },
  });
};

export const recordAdminStepUpFailure = async (input: {
  adminId: string;
  sessionVersion: number;
  ipAddress?: string;
}): Promise<{ action: AdminAnomalyAction; score: number; failureCount: number }> => {
  let failureCount = 1;

  try {
    failureCount = await redis.incr(buildStepUpFailureKey(input.adminId, input.sessionVersion));
    if (failureCount === 1) {
      await redis.expire(
        buildStepUpFailureKey(input.adminId, input.sessionVersion),
        ADMIN_STEP_UP_FAILURE_TTL_SECONDS,
      );
    }
  } catch {
    failureCount = 1;
  }

  await persistBehaviorEvent({
    adminId: input.adminId,
    sessionVersion: input.sessionVersion,
    eventType: 'FAILED_STEP_UP_ATTEMPT',
    metadata: {
      failureCount,
    },
  });

  if (failureCount < 3) {
    return { action: 'ALLOW', score: 0, failureCount };
  }

  const bucket = Math.floor(Date.now() / ADMIN_STEP_UP_FAILURE_TTL_SECONDS).toString();
  const shouldScore = await setExpiringKeyOnce(
    buildMarkerKey('stepup-fail', input.adminId, input.sessionVersion, bucket),
    ADMIN_STEP_UP_FAILURE_TTL_SECONDS,
  );

  if (!shouldScore) {
    return { action: 'ALLOW', score: 0, failureCount };
  }

  const result = await applyAdminAnomalyScore({
    adminId: input.adminId,
    sessionVersion: input.sessionVersion,
    ipAddress: input.ipAddress,
    points: 50,
    reason: 'failed_step_up_threshold',
    eventType: 'FAILED_STEP_UP_THRESHOLD',
    metadata: {
      failureCount,
    },
  });

  return {
    ...result,
    failureCount,
  };
};

export const recordAdminUnusualHour = async (input: {
  adminId: string;
  sessionVersion: number;
  timezone: string;
  ipAddress?: string;
  path?: string;
  method?: string;
  now?: Date;
}): Promise<{ action: AdminAnomalyAction; score: number }> => {
  let hour: number;

  try {
    hour = Number.parseInt(
      new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        hour12: false,
        timeZone: input.timezone,
      }).format(input.now ?? new Date()),
      10,
    );
  } catch {
    return { action: 'ALLOW', score: 0 };
  }

  if (hour >= 8 && hour < 18) {
    return { action: 'ALLOW', score: 0 };
  }

  const bucket = `${new Intl.DateTimeFormat('en-CA', {
    timeZone: input.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(input.now ?? new Date())}:${hour}`;

  const shouldScore = await setExpiringKeyOnce(
    buildMarkerKey('unusual-hour', input.adminId, input.sessionVersion, bucket),
    60 * 60,
  );

  if (!shouldScore) {
    return { action: 'ALLOW', score: 0 };
  }

  return applyAdminAnomalyScore({
    adminId: input.adminId,
    sessionVersion: input.sessionVersion,
    ipAddress: input.ipAddress,
    points: 20,
    reason: 'unusual_access_hour',
    eventType: 'UNUSUAL_HOUR',
    metadata: {
      localHour: hour,
      timezone: input.timezone,
      path: input.path ?? null,
      method: input.method ?? null,
    },
  });
};
