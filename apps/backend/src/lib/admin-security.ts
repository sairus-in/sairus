import * as crypto from 'crypto';

export interface AdminGeoVelocityInput {
  previousCountry?: string | null;
  previousSeenAt?: Date | string | null;
  currentCountry?: string | null;
  currentSeenAt?: Date | string | null;
}

export interface AdminGeoVelocityResult {
  decision: 'ALLOW' | 'REVIEW' | 'BLOCK';
  previousCountry: string | null;
  currentCountry: string | null;
  elapsedHours: number | null;
  reason: string | null;
}

const normalizeToken = (value: string | null | undefined): string =>
  (value ?? '').trim().toLowerCase();

const toDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const buildAdminTrustedDeviceHash = (
  userAgent: string,
  acceptLanguage?: string | null,
): string =>
  crypto
    .createHash('sha256')
    .update(`${normalizeToken(userAgent)}|${normalizeToken(acceptLanguage)}`)
    .digest('hex');

export const evaluateAdminGeoVelocity = (
  input: AdminGeoVelocityInput,
  now: Date = new Date(),
): AdminGeoVelocityResult => {
  const previousCountry = normalizeToken(input.previousCountry) || null;
  const currentCountry = normalizeToken(input.currentCountry) || null;
  const previousSeenAt = toDate(input.previousSeenAt);
  const currentSeenAt = toDate(input.currentSeenAt) ?? now;

  if (!previousCountry || !currentCountry || previousCountry === currentCountry || !previousSeenAt) {
    return {
      decision: 'ALLOW',
      previousCountry,
      currentCountry,
      elapsedHours: null,
      reason: null,
    };
  }

  const elapsedHours = Math.max(
    0,
    Math.round(((currentSeenAt.getTime() - previousSeenAt.getTime()) / (1000 * 60 * 60)) * 10) / 10,
  );

  if (elapsedHours <= 6) {
    return {
      decision: 'BLOCK',
      previousCountry,
      currentCountry,
      elapsedHours,
      reason: 'country_changed_too_quickly',
    };
  }

  if (elapsedHours <= 72) {
    return {
      decision: 'REVIEW',
      previousCountry,
      currentCountry,
      elapsedHours,
      reason: 'country_changed_recently',
    };
  }

  return {
    decision: 'ALLOW',
    previousCountry,
    currentCountry,
    elapsedHours,
    reason: null,
  };
};
