import * as crypto from 'crypto';
import type { IncomingHttpHeaders } from 'http';
import * as adminAuthRepository from './admin-auth.repository';

export interface AdminFingerprintInput {
  userAgent: string;
  acceptLanguage: string;
  timezone: string;
  screenRes: string;
  colorDepth: number;
  platform: string;
  hardwareConcurrency: number;
  deviceMemory?: number | null;
  ipCountry: string;
  ipASN: string;
}

export interface AdminFingerprintAssessment {
  isNewFingerprint: boolean;
  verdict: 'MATCH' | 'MINOR_DRIFT' | 'DRIFT' | 'MISMATCH';
  action: 'ALLOW' | 'LOG' | 'FORCE_REAUTH' | 'REVOKE';
  score: number;
  changedSignals: string[];
  fingerprintHash: string;
}

const FINGERPRINT_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

const normalizeToken = (value: string | null | undefined, fallback = 'unknown'): string => {
  const normalized = (value ?? '').trim().toLowerCase();
  return normalized.length > 0 ? normalized : fallback;
};

const normalizeCountry = (value: string | null | undefined): string => {
  const normalized = (value ?? '').trim().toUpperCase();
  return normalized.length > 0 ? normalized : 'ZZ';
};

const parsePositiveInteger = (
  value: string | string[] | undefined,
  fallback: number,
): number => {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(candidate ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseOptionalInteger = (value: string | string[] | undefined): number | null => {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(candidate ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const readHeader = (headers: IncomingHttpHeaders, names: string[]): string | undefined => {
  for (const name of names) {
    const value = headers[name];
    const candidate = Array.isArray(value) ? value[0] : value;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return undefined;
};

export const buildAdminFingerprintInput = (
  input: Partial<AdminFingerprintInput> & {
    userAgent?: string | null;
    acceptLanguage?: string | null;
    ipCountry?: string | null;
    ipASN?: string | null;
  },
): AdminFingerprintInput => ({
  userAgent: normalizeToken(input.userAgent),
  acceptLanguage: normalizeToken(input.acceptLanguage),
  timezone: normalizeToken(input.timezone, 'utc'),
  screenRes: normalizeToken(input.screenRes, 'unknown'),
  colorDepth:
    typeof input.colorDepth === 'number' && Number.isFinite(input.colorDepth) && input.colorDepth > 0
      ? input.colorDepth
      : 24,
  platform: normalizeToken(input.platform),
  hardwareConcurrency:
    typeof input.hardwareConcurrency === 'number' &&
    Number.isFinite(input.hardwareConcurrency) &&
    input.hardwareConcurrency > 0
      ? input.hardwareConcurrency
      : 1,
  deviceMemory:
    typeof input.deviceMemory === 'number' && Number.isFinite(input.deviceMemory) && input.deviceMemory > 0
      ? input.deviceMemory
      : null,
  ipCountry: normalizeCountry(input.ipCountry),
  ipASN: normalizeToken(input.ipASN, 'unknown-asn'),
});

export const extractAdminFingerprintFromHeaders = (
  headers: IncomingHttpHeaders,
): AdminFingerprintInput =>
  buildAdminFingerprintInput({
    userAgent: readHeader(headers, ['user-agent']),
    acceptLanguage: readHeader(headers, ['accept-language']),
    timezone: readHeader(headers, ['x-admin-timezone']),
    screenRes: readHeader(headers, ['x-admin-screen-res']),
    colorDepth: parsePositiveInteger(headers['x-admin-color-depth'], 24),
    platform: readHeader(headers, ['x-admin-platform']),
    hardwareConcurrency: parsePositiveInteger(headers['x-admin-hardware-concurrency'], 1),
    deviceMemory: parseOptionalInteger(headers['x-admin-device-memory']),
    ipCountry: readHeader(headers, [
      'cf-ipcountry',
      'x-vercel-ip-country',
      'x-country-code',
      'x-geo-country',
    ]),
    ipASN: readHeader(headers, ['cf-ray-asn', 'cf-connecting-asn', 'x-vercel-ip-as-number', 'x-ip-asn']),
  });

export const buildAdminFingerprintHash = (input: AdminFingerprintInput): string =>
  crypto
    .createHash('sha256')
    .update(
      [
        input.userAgent,
        input.acceptLanguage,
        input.timezone,
        input.screenRes,
        input.colorDepth.toString(),
        input.platform,
        input.hardwareConcurrency.toString(),
        input.deviceMemory?.toString() ?? '0',
        input.ipCountry,
        input.ipASN,
      ].join('||'),
    )
    .digest('hex');

export const evaluateAdminFingerprintDrift = (
  stored: AdminFingerprintInput,
  current: AdminFingerprintInput,
): Omit<AdminFingerprintAssessment, 'isNewFingerprint' | 'fingerprintHash'> => {
  let score = 0;
  const changedSignals: string[] = [];

  if (stored.userAgent !== current.userAgent) {
    score += 30;
    changedSignals.push('userAgent');
  }
  if (stored.timezone !== current.timezone) {
    score += 25;
    changedSignals.push('timezone');
  }
  if (stored.ipCountry !== current.ipCountry) {
    score += 35;
    changedSignals.push('ipCountry');
  }
  if (stored.screenRes !== current.screenRes) {
    score += 15;
    changedSignals.push('screenRes');
  }
  if (stored.platform !== current.platform) {
    score += 20;
    changedSignals.push('platform');
  }
  if (stored.ipASN !== current.ipASN) {
    score += 20;
    changedSignals.push('ipASN');
  }

  if (score === 0) {
    return {
      verdict: 'MATCH',
      action: 'ALLOW',
      score,
      changedSignals,
    };
  }

  if (score <= 25) {
    return {
      verdict: 'MINOR_DRIFT',
      action: 'LOG',
      score,
      changedSignals,
    };
  }

  if (score <= 50) {
    return {
      verdict: 'DRIFT',
      action: 'FORCE_REAUTH',
      score,
      changedSignals,
    };
  }

  return {
    verdict: 'MISMATCH',
    action: 'REVOKE',
    score,
    changedSignals,
  };
};

export const syncAdminFingerprint = async (
  adminId: string,
  input: Partial<AdminFingerprintInput>,
  now: Date = new Date(),
): Promise<AdminFingerprintAssessment> => {
  const normalizedInput = buildAdminFingerprintInput(input);
  const fingerprintHash = buildAdminFingerprintHash(normalizedInput);
  const stored = await adminAuthRepository.getAdminFingerprint(adminId);

  if (!stored) {
    await adminAuthRepository.upsertAdminFingerprint({
      adminId,
      ...normalizedInput,
      fpHash: fingerprintHash,
      lastVerdict: 'MATCH',
      lastDriftScore: 0,
      lastSeenAt: now,
    });

    return {
      isNewFingerprint: true,
      verdict: 'MATCH',
      action: 'ALLOW',
      score: 0,
      changedSignals: [],
      fingerprintHash,
    };
  }

  const assessment = evaluateAdminFingerprintDrift(
    buildAdminFingerprintInput(stored),
    normalizedInput,
  );

  const shouldPersist =
    assessment.verdict !== 'MISMATCH' &&
    (
      stored.fpHash !== fingerprintHash ||
      stored.lastVerdict !== assessment.verdict ||
      stored.lastDriftScore !== assessment.score ||
      now.getTime() - stored.lastSeenAt.getTime() >= FINGERPRINT_REFRESH_INTERVAL_MS
    );

  if (shouldPersist) {
    await adminAuthRepository.upsertAdminFingerprint({
      adminId,
      ...normalizedInput,
      fpHash: fingerprintHash,
      lastVerdict: assessment.verdict,
      lastDriftScore: assessment.score,
      lastSeenAt: now,
    });
  }

  return {
    isNewFingerprint: false,
    ...assessment,
    fingerprintHash,
  };
};
