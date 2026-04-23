import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AdminLoginMfaChallengeResponse,
  AdminLoginSuccessResponse,
  AdminSessionUser,
} from 'shared';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';
import { useAuthStore } from '../../store/auth.store';

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, login } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [mfaMode, setMfaMode] = useState<'totp' | 'backup'>('totp');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const logoutReason = useMemo(() => searchParams.get('reason')?.trim() ?? '', [searchParams]);

  useEffect(() => {
    setError(null);
  }, [email, password, mfaCode, backupCode, mfaMode]);

  if (isAuthenticated) {
    return <Navigate to="/ops/dashboard" replace />;
  }

  const finishLogin = async () => {
    try {
      console.log('[Login] Fetching admin session after auth...');
      const admin = await api.get<AdminSessionUser>('/v1/admin/auth/me');
      console.log('[Login] Session retrieved successfully:', admin);
      login(admin);
      console.log('[Login] User logged in, navigating to dashboard');
      navigate('/ops/dashboard', { replace: true });
    } catch (err) {
      console.error('[Login] Failed to fetch session after login:', err);
      throw err;
    }
  };

  const handleCredentialSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      console.log('[Login] Submitting credentials for:', email);
      const payload = await api.post<AdminLoginSuccessResponse | AdminLoginMfaChallengeResponse>('/v1/admin/auth/login', {
        email: email.trim(),
        password,
      });

      console.log('[Login] Login response received:', payload);
      
      if (payload && 'mfaRequired' in payload && payload.mfaRequired) {
        console.log('[Login] MFA required');
        setChallengeToken((payload as { challengeToken: string }).challengeToken);
        setPassword('');
        return;
      }

      if (!payload || !('user' in payload)) {
        throw new Error('Login response was missing the expected admin session payload.');
      }

      console.log('[Login] Finishing login process...');
      await finishLogin();
    } catch (err) {
      console.error('[Login] Login failed:', err);
      setError(extractApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleMfaSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!challengeToken) {
      console.warn('[Login] MFA submit without challenge token');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      console.log('[Login] Verifying MFA code...');
      await api.post('/v1/admin/auth/verify-mfa', {
        challengeToken,
        ...(mfaMode === 'totp'
          ? { code: mfaCode.trim() }
          : { backupCode: backupCode.trim() }),
      });

      console.log('[Login] MFA verified, finishing login...');
      await finishLogin();
    } catch (err) {
      console.error('[Login] MFA verification failed:', err);
      setError(extractApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  const isMfaStep = Boolean(challengeToken);
  const reasonMessage =
    logoutReason === 'forced-reauth'
      ? 'Your admin session was challenged by a security control. Sign in again to continue.'
      : logoutReason === 'session-expired'
        ? 'Your admin session expired. Sign in again to continue.'
        : logoutReason === 'account-suspended'
          ? 'This administrator account is suspended. Contact another administrator if you need access restored.'
        : null;

  return (
    <div style={{
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      padding: '2rem',
      background: 'linear-gradient(160deg, #E0F2FE 0%, #F8FAFC 45%, #DCFCE7 100%)',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 420,
        background: 'rgba(255,255,255,0.92)',
        border: '1px solid rgba(148,163,184,0.25)',
        borderRadius: 24,
        boxShadow: '0 24px 80px rgba(15,23,42,0.12)',
        padding: '2rem',
        backdropFilter: 'blur(12px)',
      }}>
        <div style={{ marginBottom: '1.5rem' }}>
          <p style={{ margin: 0, color: '#0F766E', fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            College Bus Admin
          </p>
          <h1 style={{ margin: '0.5rem 0 0', fontSize: '2rem', color: '#0F172A' }}>
            {isMfaStep ? 'Verify MFA' : 'Sign in'}
          </h1>
          <p style={{ margin: '0.75rem 0 0', color: '#475569', lineHeight: 1.5 }}>
            {isMfaStep
              ? 'Enter the 6-digit code from your authenticator app to finish signing in.'
              : 'Use your admin credentials to access live operations and transport data.'}
          </p>
        </div>

        {reasonMessage && !isMfaStep && (
          <div style={{
            borderRadius: 14,
            background: '#ECFDF5',
            color: '#065F46',
            padding: '0.85rem 1rem',
            fontSize: '0.92rem',
            marginBottom: '1rem',
          }}>
            {reasonMessage}
          </div>
        )}

        {!isMfaStep ? (
          <form onSubmit={handleCredentialSubmit} style={{ display: 'grid', gap: '1rem' }}>
            <label style={{ display: 'grid', gap: '0.4rem', color: '#0F172A', fontWeight: 600 }}>
              Email
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                style={{
                  width: '100%',
                  borderRadius: 14,
                  border: '1px solid #CBD5E1',
                  padding: '0.9rem 1rem',
                  fontSize: '0.95rem',
                  background: '#FFFFFF',
                }}
              />
            </label>

            <label style={{ display: 'grid', gap: '0.4rem', color: '#0F172A', fontWeight: 600 }}>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                style={{
                  width: '100%',
                  borderRadius: 14,
                  border: '1px solid #CBD5E1',
                  padding: '0.9rem 1rem',
                  fontSize: '0.95rem',
                  background: '#FFFFFF',
                }}
              />
            </label>

            {error && (
              <div style={{
                borderRadius: 14,
                background: '#FEF2F2',
                color: '#B91C1C',
                padding: '0.85rem 1rem',
                fontSize: '0.92rem',
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              style={{
                border: 0,
                borderRadius: 16,
                background: submitting ? '#94A3B8' : '#0F766E',
                color: '#FFFFFF',
                padding: '0.95rem 1rem',
                fontSize: '0.98rem',
                fontWeight: 700,
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting ? 'Signing in...' : 'Sign in'}
            </button>

            <Link
              to="/forgot-password"
              style={{ color: '#0F766E', fontWeight: 700, fontSize: '0.92rem', textAlign: 'center', textDecoration: 'none' }}
            >
              Forgot password?
            </Link>
          </form>
        ) : (
          <form onSubmit={handleMfaSubmit} style={{ display: 'grid', gap: '1rem' }}>
            <div style={{ display: 'inline-flex', borderRadius: 14, background: '#E2E8F0', padding: '0.25rem', gap: '0.25rem' }}>
              <button
                type="button"
                onClick={() => setMfaMode('totp')}
                style={{
                  border: 0,
                  borderRadius: 10,
                  background: mfaMode === 'totp' ? '#FFFFFF' : 'transparent',
                  color: '#0F172A',
                  padding: '0.65rem 0.9rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Authenticator code
              </button>
              <button
                type="button"
                onClick={() => setMfaMode('backup')}
                style={{
                  border: 0,
                  borderRadius: 10,
                  background: mfaMode === 'backup' ? '#FFFFFF' : 'transparent',
                  color: '#0F172A',
                  padding: '0.65rem 0.9rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Backup code
              </button>
            </div>

            {mfaMode === 'totp' ? (
              <label style={{ display: 'grid', gap: '0.4rem', color: '#0F172A', fontWeight: 600 }}>
                Authenticator code
                <input
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  required
                  style={{
                    width: '100%',
                    borderRadius: 14,
                    border: '1px solid #CBD5E1',
                    padding: '0.9rem 1rem',
                    fontSize: '0.95rem',
                    background: '#FFFFFF',
                  }}
                />
              </label>
            ) : (
              <label style={{ display: 'grid', gap: '0.4rem', color: '#0F172A', fontWeight: 600 }}>
                Backup code
                <input
                  value={backupCode}
                  onChange={(event) => setBackupCode(event.target.value.toUpperCase())}
                  autoComplete="one-time-code"
                  placeholder="ABCD1234"
                  required
                  style={{
                    width: '100%',
                    borderRadius: 14,
                    border: '1px solid #CBD5E1',
                    padding: '0.9rem 1rem',
                    fontSize: '0.95rem',
                    background: '#FFFFFF',
                    textTransform: 'uppercase',
                  }}
                />
              </label>
            )}

            {error && (
              <div style={{
                borderRadius: 14,
                background: '#FEF2F2',
                color: '#B91C1C',
                padding: '0.85rem 1rem',
                fontSize: '0.92rem',
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              style={{
                border: 0,
                borderRadius: 16,
                background: submitting ? '#94A3B8' : '#0F766E',
                color: '#FFFFFF',
                padding: '0.95rem 1rem',
                fontSize: '0.98rem',
                fontWeight: 700,
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting ? 'Verifying...' : 'Verify and continue'}
            </button>

            <button
              type="button"
              onClick={() => {
                setChallengeToken(null);
                setMfaCode('');
                setBackupCode('');
                setMfaMode('totp');
              }}
              disabled={submitting}
              style={{
                borderRadius: 16,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#0F172A',
                padding: '0.95rem 1rem',
                fontSize: '0.95rem',
                fontWeight: 600,
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              Back
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default Login;
