import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  AdminActionResponse,
  AdminMfaBackupCodesResponse,
  AdminMfaBackupCodeSummary,
  AdminMfaEnableResponse,
  AdminMfaSetupResponse,
  AdminMfaStatusResponse,
  AdminTrustedDeviceListResponse,
} from 'shared';
import { AdminStepUpModal } from '../../components/auth/AdminStepUpModal';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';
import { clearAdminSessionState } from '../../lib/session';
import { useAuthStore } from '../../store/auth.store';

const cardStyle: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 20,
  padding: '1.5rem',
  boxShadow: '0 18px 40px rgba(15, 23, 42, 0.06)',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 14,
  border: '1px solid #CBD5E1',
  padding: '0.85rem 1rem',
  fontSize: '0.95rem',
  background: '#FFFFFF',
};

type StepUpRequest =
  | {
      title: string;
      description: string;
      actionLabel: string;
      onAuthorized: (token: string) => Promise<void>;
    }
  | null;

export const Security: React.FC = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthStore();
  const [status, setStatus] = useState<AdminMfaStatusResponse | null>(null);
  const [setup, setSetup] = useState<AdminMfaSetupResponse | null>(null);
  const [backupSummary, setBackupSummary] = useState<AdminMfaBackupCodeSummary | null>(null);
  const [devices, setDevices] = useState<AdminTrustedDeviceListResponse['devices']>([]);
  const [enableCode, setEnableCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [freshBackupCodes, setFreshBackupCodes] = useState<string[]>([]);
  const [stepUpRequest, setStepUpRequest] = useState<StepUpRequest>(null);

  const loadSecurityState = async () => {
    setLoading(true);
    setError(null);

    try {
      const [nextStatus, nextDevices, nextBackupSummary] = await Promise.all([
        api.get<AdminMfaStatusResponse>('/v1/admin/auth/mfa/status'),
        api.get<AdminTrustedDeviceListResponse>('/v1/admin/auth/devices'),
        api.get<AdminMfaBackupCodeSummary>('/v1/admin/auth/mfa/backup-codes'),
      ]);

      setStatus(nextStatus);
      setDevices(nextDevices.devices);
      setBackupSummary(nextBackupSummary);

      if (!nextStatus.pendingSetup) {
        setSetup(null);
      }
    } catch (loadError) {
      setError(extractApiError(loadError).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      void loadSecurityState();
    }
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const forceRelogin = () => {
    clearAdminSessionState();
    navigate('/login', { replace: true });
  };

  const handleSetup = async () => {
    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const payload = await api.post<AdminMfaSetupResponse>('/v1/admin/auth/mfa/setup');
      setSetup(payload);
      setStatus({ enabled: false, pendingSetup: true });
      setMessage('Scan the authenticator setup entry, then confirm with a 6-digit code.');
    } catch (setupError) {
      setError(extractApiError(setupError).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEnable = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const response = await api.post<AdminMfaEnableResponse>('/v1/admin/auth/mfa/enable', {
        code: enableCode.trim(),
      });
      setFreshBackupCodes(response.backupCodes ?? []);
      setEnableCode('');
      setStatus({ enabled: true, pendingSetup: false });
      setBackupSummary({
        totalCount: response.backupCodes?.length ?? 0,
        remainingCount: response.backupCodes?.length ?? 0,
        lastUsedAt: null,
      });
      setMessage(response.message ?? 'MFA enabled. Save your recovery codes before signing in again.');
    } catch (enableError) {
      setError(extractApiError(enableError).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDisable = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const response = await api.post<AdminActionResponse>('/v1/admin/auth/mfa/disable', {
        password,
        code: disableCode.trim(),
      });
      setMessage(response.message ?? 'MFA disabled. Sign in again to continue.');
      setPassword('');
      setDisableCode('');
      forceRelogin();
    } catch (disableError) {
      setError(extractApiError(disableError).message);
    } finally {
      setSubmitting(false);
    }
  };

  const requestBackupCodeRegeneration = () => {
    setStepUpRequest({
      title: 'Regenerate backup codes',
      description: 'This replaces every existing recovery code. Old backup codes stop working immediately.',
      actionLabel: 'Regenerate codes',
      onAuthorized: async (stepUpToken) => {
        const response = await api.post<AdminMfaBackupCodesResponse>(
          '/v1/admin/auth/mfa/backup-codes/regenerate',
          undefined,
          {
            headers: {
              'x-admin-step-up': stepUpToken,
            },
          },
        );

        setFreshBackupCodes(response.backupCodes);
        setBackupSummary({
          totalCount: response.totalCount,
          remainingCount: response.totalCount,
          lastUsedAt: null,
        });
        setMessage('Backup codes regenerated. Save the new set now.');
      },
    });
  };

  const requestDeviceRevocation = (deviceId: string, label: string | null) => {
    setStepUpRequest({
      title: 'Remove trusted device',
      description: `This removes ${label ?? 'the selected device'} from your trusted list and signs out every active admin session for this account.`,
      actionLabel: 'Remove device',
      onAuthorized: async (stepUpToken) => {
        await api.delete<AdminActionResponse>(`/v1/admin/auth/devices/${deviceId}`, {
          headers: {
            'x-admin-step-up': stepUpToken,
          },
        });

        forceRelogin();
      },
    });
  };

  return (
    <>
      <div style={{ display: 'grid', gap: '1.5rem', maxWidth: 980 }}>
        <div>
          <p style={{ margin: 0, color: '#0F766E', fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Security
          </p>
          <h1 style={{ margin: '0.5rem 0 0', fontSize: '2rem', color: '#0F172A' }}>Admin authentication controls</h1>
          <p style={{ margin: '0.75rem 0 0', color: '#475569', lineHeight: 1.6 }}>
            Manage MFA, recovery codes, and trusted devices for the admin session you are using now.
          </p>
        </div>

        {error && (
          <div style={{ ...cardStyle, background: '#FEF2F2', color: '#B91C1C', borderColor: '#FECACA' }}>
            {error}
          </div>
        )}

        {message && (
          <div style={{ ...cardStyle, background: '#ECFDF5', color: '#047857', borderColor: '#A7F3D0' }}>
            {message}
          </div>
        )}

        {freshBackupCodes.length > 0 && (
          <div style={{ ...cardStyle, background: '#FFF7ED', borderColor: '#FED7AA' }}>
            <h2 style={{ margin: 0, color: '#9A3412' }}>Recovery codes</h2>
            <p style={{ margin: '0.5rem 0 1rem', color: '#9A3412', lineHeight: 1.6 }}>
              These codes are shown once. Store them securely. Each code can be used only one time during login.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
              {freshBackupCodes.map((code) => (
                <div key={code} style={{ borderRadius: 14, background: '#FFFFFF', border: '1px solid #FDBA74', padding: '0.85rem 1rem', fontFamily: 'monospace', fontSize: '1rem', fontWeight: 700, letterSpacing: '0.08em', color: '#7C2D12', textAlign: 'center' }}>
                  {code}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(freshBackupCodes.join('\n'))}
                style={{ borderRadius: 14, border: '1px solid #FDBA74', background: '#FFFFFF', color: '#9A3412', padding: '0.85rem 1rem', fontWeight: 700, cursor: 'pointer' }}
              >
                Copy codes
              </button>

              {status?.enabled && (
                <button
                  type="button"
                  onClick={forceRelogin}
                  style={{ borderRadius: 14, border: 0, background: '#9A3412', color: '#FFFFFF', padding: '0.85rem 1rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  Continue to sign in
                </button>
              )}
            </div>
          </div>
        )}

        <div style={cardStyle}>
          {loading ? (
            <div style={{ color: '#475569' }}>Loading security controls...</div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div>
                  <h2 style={{ margin: 0, color: '#0F172A' }}>Multi-factor authentication</h2>
                  <p style={{ margin: '0.5rem 0 0', color: '#475569' }}>
                    {status?.enabled ? 'MFA is enabled for this account.' : 'MFA is not enabled for this account.'}
                  </p>
                </div>

                {!status?.enabled && (
                  <button
                    type="button"
                    onClick={() => void handleSetup()}
                    disabled={submitting}
                    style={{
                      border: 0,
                      borderRadius: 14,
                      background: submitting ? '#94A3B8' : '#0F766E',
                      color: '#FFFFFF',
                      padding: '0.85rem 1rem',
                      fontWeight: 700,
                      cursor: submitting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {status?.pendingSetup ? 'Rotate setup secret' : 'Start setup'}
                  </button>
                )}
              </div>

              {setup && !status?.enabled && (
                <div style={{ marginTop: '1.5rem', display: 'grid', gap: '1rem' }}>
                  <div style={{ borderRadius: 16, background: '#F8FAFC', border: '1px solid #E2E8F0', padding: '1rem' }}>
                    <p style={{ margin: 0, color: '#334155', fontWeight: 600 }}>Manual entry key</p>
                    <code style={{ display: 'block', marginTop: '0.5rem', color: '#0F172A', wordBreak: 'break-all' }}>
                      {setup.manualEntryKey}
                    </code>
                  </div>

                  <div style={{ borderRadius: 16, background: '#F8FAFC', border: '1px solid #E2E8F0', padding: '1rem' }}>
                    <p style={{ margin: 0, color: '#334155', fontWeight: 600 }}>Authenticator link</p>
                    <a
                      href={setup.otpauthUrl}
                      style={{ display: 'block', marginTop: '0.5rem', color: '#0F766E', wordBreak: 'break-all' }}
                    >
                      {setup.otpauthUrl}
                    </a>
                  </div>

                  <form onSubmit={handleEnable} style={{ display: 'grid', gap: '0.75rem' }}>
                    <label style={{ display: 'grid', gap: '0.4rem', color: '#0F172A', fontWeight: 600 }}>
                      6-digit authenticator code
                      <input
                        value={enableCode}
                        onChange={(event) => setEnableCode(event.target.value)}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="123456"
                        style={inputStyle}
                      />
                    </label>

                    <button
                      type="submit"
                      disabled={submitting}
                      style={{
                        border: 0,
                        borderRadius: 14,
                        background: submitting ? '#94A3B8' : '#0F172A',
                        color: '#FFFFFF',
                        padding: '0.85rem 1rem',
                        fontWeight: 700,
                        cursor: submitting ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {submitting ? 'Verifying...' : 'Enable MFA'}
                    </button>
                  </form>
                </div>
              )}
            </>
          )}
        </div>

        {status?.enabled && (
          <>
            <div style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div>
                  <h2 style={{ margin: 0, color: '#0F172A' }}>Backup codes</h2>
                  <p style={{ margin: '0.5rem 0 0', color: '#475569', lineHeight: 1.6 }}>
                    Keep a recovery set offline in case your authenticator app is unavailable.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={requestBackupCodeRegeneration}
                  style={{ border: '1px solid #CBD5E1', borderRadius: 14, background: '#FFFFFF', color: '#0F172A', padding: '0.85rem 1rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  Regenerate codes
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginTop: '1.25rem' }}>
                <div style={{ borderRadius: 16, background: '#F8FAFC', border: '1px solid #E2E8F0', padding: '1rem' }}>
                  <div style={{ color: '#64748B', fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Remaining</div>
                  <div style={{ marginTop: '0.5rem', fontSize: '2rem', fontWeight: 800, color: '#0F172A' }}>{backupSummary?.remainingCount ?? 0}</div>
                </div>

                <div style={{ borderRadius: 16, background: '#F8FAFC', border: '1px solid #E2E8F0', padding: '1rem' }}>
                  <div style={{ color: '#64748B', fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Total issued</div>
                  <div style={{ marginTop: '0.5rem', fontSize: '2rem', fontWeight: 800, color: '#0F172A' }}>{backupSummary?.totalCount ?? 0}</div>
                </div>

                <div style={{ borderRadius: 16, background: '#F8FAFC', border: '1px solid #E2E8F0', padding: '1rem' }}>
                  <div style={{ color: '#64748B', fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Last used</div>
                  <div style={{ marginTop: '0.5rem', fontSize: '1rem', fontWeight: 700, color: '#0F172A' }}>
                    {backupSummary?.lastUsedAt ? new Date(backupSummary.lastUsedAt).toLocaleString() : 'Never'}
                  </div>
                </div>
              </div>
            </div>

            <div style={cardStyle}>
              <h2 style={{ margin: 0, color: '#0F172A' }}>Trusted devices</h2>
              <p style={{ margin: '0.5rem 0 1rem', color: '#475569', lineHeight: 1.6 }}>
                Removing a trusted device revokes every active admin session so the account must be verified again on the next sign-in.
              </p>

              {devices.length === 0 ? (
                <div style={{ borderRadius: 16, background: '#F8FAFC', border: '1px dashed #CBD5E1', padding: '1rem', color: '#64748B' }}>
                  No trusted devices recorded yet.
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '0.85rem' }}>
                  {devices.map((device) => (
                    <div key={device.id} style={{ borderRadius: 16, border: '1px solid #E2E8F0', padding: '1rem', display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 260, flex: 1 }}>
                        <div style={{ fontWeight: 700, color: '#0F172A' }}>{device.label ?? 'Trusted browser session'}</div>
                        <div style={{ marginTop: '0.35rem', color: '#475569', fontSize: '0.92rem', lineHeight: 1.5 }}>{device.userAgent}</div>
                        <div style={{ marginTop: '0.5rem', color: '#64748B', fontSize: '0.88rem' }}>
                          First seen {new Date(device.firstSeenAt).toLocaleString()} · Last seen {new Date(device.lastSeenAt).toLocaleString()} · Country {device.lastIpCountry ?? 'Unknown'}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => requestDeviceRevocation(device.id, device.label)}
                        style={{ border: '1px solid #FCA5A5', borderRadius: 14, background: '#FFFFFF', color: '#B91C1C', padding: '0.8rem 0.95rem', fontWeight: 700, cursor: 'pointer' }}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={cardStyle}>
              <h2 style={{ margin: 0, color: '#0F172A' }}>Disable MFA</h2>
              <p style={{ margin: '0.5rem 0 1rem', color: '#475569' }}>
                Disabling MFA requires your current password and a live authenticator code. This signs you out immediately.
              </p>

              <form onSubmit={handleDisable} style={{ display: 'grid', gap: '0.75rem' }}>
                <label style={{ display: 'grid', gap: '0.4rem', color: '#0F172A', fontWeight: 600 }}>
                  Current password
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    style={inputStyle}
                  />
                </label>

                <label style={{ display: 'grid', gap: '0.4rem', color: '#0F172A', fontWeight: 600 }}>
                  6-digit authenticator code
                  <input
                    value={disableCode}
                    onChange={(event) => setDisableCode(event.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    style={inputStyle}
                  />
                </label>

                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    border: 0,
                    borderRadius: 14,
                    background: submitting ? '#94A3B8' : '#B91C1C',
                    color: '#FFFFFF',
                    padding: '0.85rem 1rem',
                    fontWeight: 700,
                    cursor: submitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  {submitting ? 'Disabling...' : 'Disable MFA'}
                </button>
              </form>
            </div>
          </>
        )}
      </div>

      <AdminStepUpModal
        open={Boolean(stepUpRequest)}
        title={stepUpRequest?.title ?? 'Confirm action'}
        description={stepUpRequest?.description ?? ''}
        actionLabel={stepUpRequest?.actionLabel ?? 'Continue'}
        onAuthorized={async (token) => {
          if (stepUpRequest) {
            await stepUpRequest.onAuthorized(token);
          }
        }}
        onClose={() => setStepUpRequest(null)}
      />
    </>
  );
};

export default Security;
