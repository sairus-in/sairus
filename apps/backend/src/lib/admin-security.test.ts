import { describe, expect, it } from 'vitest';
import { buildAdminTrustedDeviceHash, evaluateAdminGeoVelocity } from './admin-security';

describe('buildAdminTrustedDeviceHash', () => {
  it('normalizes case and whitespace', () => {
    const left = buildAdminTrustedDeviceHash(' Mozilla/5.0 ', ' en-US,en;q=0.9 ');
    const right = buildAdminTrustedDeviceHash('mozilla/5.0', 'en-us,en;q=0.9');

    expect(left).toBe(right);
  });
});

describe('evaluateAdminGeoVelocity', () => {
  it('allows same-country logins', () => {
    const result = evaluateAdminGeoVelocity({
      previousCountry: 'IN',
      previousSeenAt: '2026-04-07T00:00:00.000Z',
      currentCountry: 'IN',
    }, new Date('2026-04-07T02:00:00.000Z'));

    expect(result.decision).toBe('ALLOW');
  });

  it('blocks rapid cross-country changes', () => {
    const result = evaluateAdminGeoVelocity({
      previousCountry: 'IN',
      previousSeenAt: '2026-04-07T00:00:00.000Z',
      currentCountry: 'US',
    }, new Date('2026-04-07T03:00:00.000Z'));

    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toBe('country_changed_too_quickly');
  });

  it('flags medium-window country changes for review', () => {
    const result = evaluateAdminGeoVelocity({
      previousCountry: 'IN',
      previousSeenAt: '2026-04-01T00:00:00.000Z',
      currentCountry: 'US',
    }, new Date('2026-04-02T12:00:00.000Z'));

    expect(result.decision).toBe('REVIEW');
  });
});
