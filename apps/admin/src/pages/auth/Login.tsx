import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle } from 'lucide-react';
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
    const admin = await api.get<AdminSessionUser>('/v1/admin/auth/me');
    login(admin);
    navigate('/ops/dashboard', { replace: true });
  };

  const handleCredentialSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const payload = await api.post<AdminLoginSuccessResponse | AdminLoginMfaChallengeResponse>('/v1/admin/auth/login', {
        email: email.trim(),
        password,
      });

      if (payload && 'mfaRequired' in payload && payload.mfaRequired) {
        setChallengeToken((payload as { challengeToken: string }).challengeToken);
        setPassword('');
        return;
      }

      if (!payload || !('user' in payload)) {
        throw new Error('Login response was missing the expected admin session payload.');
      }

      await finishLogin();
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleMfaSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!challengeToken) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await api.post('/v1/admin/auth/verify-mfa', {
        challengeToken,
        ...(mfaMode === 'totp'
          ? { code: mfaCode.trim() }
          : { backupCode: backupCode.trim() }),
      });

      await finishLogin();
    } catch (err) {
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
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <p className="login-badge">College Bus Admin</p>
          <h1>{isMfaStep ? 'Verify MFA' : 'Sign in'}</h1>
          <p className="login-subtitle">
            {isMfaStep
              ? 'Enter the 6-digit code from your authenticator app to finish signing in.'
              : 'Use your admin credentials to access live operations and transport data.'}
          </p>
        </div>

        {reasonMessage && !isMfaStep && (
          <div className="login-message login-message--success" role="status">
            <CheckCircle size={16} aria-hidden="true" />
            <span>{reasonMessage}</span>
          </div>
        )}

        {!isMfaStep ? (
          <form onSubmit={handleCredentialSubmit} className="login-form">
            <div className="form-field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                aria-describedby="email-hint"
              />
              <span id="email-hint" className="visually-hidden">Enter your registered email address</span>
            </div>

            <div className="form-field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                aria-describedby="password-hint"
              />
              <span id="password-hint" className="visually-hidden">Enter your password</span>
            </div>

            {error && (
              <div className="login-message login-message--error" role="alert" aria-live="polite">
                <AlertCircle size={16} aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="btn btn--primary"
            >
              {submitting ? 'Signing in...' : 'Sign in'}
            </button>

            <Link to="/forgot-password" className="login-forgot">
              Forgot password?
            </Link>
          </form>
        ) : (
          <form onSubmit={handleMfaSubmit} className="login-form">
            <div className="mfa-toggle" role="tablist" aria-label="MFA verification method">
              <button
                type="button"
                role="tab"
                aria-selected={mfaMode === 'totp'}
                aria-controls="mfa-totp-panel"
                onClick={() => setMfaMode('totp')}
                className={mfaMode === 'totp' ? 'active' : ''}
              >
                Authenticator code
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mfaMode === 'backup'}
                aria-controls="mfa-backup-panel"
                onClick={() => setMfaMode('backup')}
                className={mfaMode === 'backup' ? 'active' : ''}
              >
                Backup code
              </button>
            </div>

            {mfaMode === 'totp' ? (
              <div className="form-field" role="tabpanel" id="mfa-totp-panel">
                <label htmlFor="mfa-code">Authenticator code</label>
                <input
                  id="mfa-code"
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  required
                  aria-describedby="mfa-code-hint"
                />
                <span id="mfa-code-hint" className="visually-hidden">Enter the 6-digit code from your authenticator app</span>
              </div>
            ) : (
              <div className="form-field" role="tabpanel" id="mfa-backup-panel">
                <label htmlFor="backup-code">Backup code</label>
                <input
                  id="backup-code"
                  value={backupCode}
                  onChange={(event) => setBackupCode(event.target.value.toUpperCase())}
                  autoComplete="one-time-code"
                  placeholder="ABCD1234"
                  required
                  aria-describedby="backup-code-hint"
                />
                <span id="backup-code-hint" className="visually-hidden">Enter your backup code</span>
              </div>
            )}

            {error && (
              <div className="login-message login-message--error" role="alert" aria-live="polite">
                <AlertCircle size={16} aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="btn btn--primary"
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
              className="btn btn--secondary"
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