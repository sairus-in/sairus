import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { AdminTokenVerificationResponse } from 'shared';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';
import { useAuthStore } from '../../store/auth.store';

const inputStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 14,
  border: '1px solid #CBD5E1',
  padding: '0.9rem 1rem',
  fontSize: '0.95rem',
  background: '#FFFFFF',
};

export const AcceptInvite: React.FC = () => {
  const { isAuthenticated } = useAuthStore();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get('token')?.trim() ?? '', [searchParams]);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [verified, setVerified] = useState<AdminTokenVerificationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError('This invite link is missing its token.');
      return;
    }

    let cancelled = false;

    const verifyToken = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await api.post<AdminTokenVerificationResponse>('/v1/admin/auth/invite/verify-token', {
          token,
        });

        if (!cancelled) {
          setVerified(response);
        }
      } catch (err) {
        if (!cancelled) {
          setError(extractApiError(err).message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void verifyToken();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (isAuthenticated) {
    return <Navigate to="/security" replace />;
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (password !== confirmPassword) {
      setError('The password confirmation does not match.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const response = await api.post<{ message: string }>('/v1/admin/auth/set-password', {
        token,
        password,
      });

      setMessage(response.message);
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem', background: 'linear-gradient(160deg, #DCFCE7 0%, #F8FAFC 45%, #DBEAFE 100%)' }}>
      <div style={{ width: '100%', maxWidth: 480, background: 'rgba(255,255,255,0.96)', border: '1px solid rgba(148,163,184,0.25)', borderRadius: 24, boxShadow: '0 24px 80px rgba(15,23,42,0.12)', padding: '2rem' }}>
        <p style={{ margin: 0, color: '#0F766E', fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Admin invite
        </p>
        <h1 style={{ margin: '0.5rem 0 0', fontSize: '2rem', color: '#0F172A' }}>Activate your admin account</h1>
        <p style={{ margin: '0.75rem 0 1.5rem', color: '#475569', lineHeight: 1.6 }}>
          {verified ? `Set the first password for ${verified.name}.` : 'We are validating the invitation before allowing account activation.'}
        </p>

        {loading ? (
          <div style={{ color: '#475569' }}>Validating invitation...</div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1rem' }}>
            <label style={{ display: 'grid', gap: '0.4rem', color: '#0F172A', fontWeight: 600 }}>
              Password
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={!verified || Boolean(message)}
                style={inputStyle}
              />
            </label>

            <label style={{ display: 'grid', gap: '0.4rem', color: '#0F172A', fontWeight: 600 }}>
              Confirm password
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                disabled={!verified || Boolean(message)}
                style={inputStyle}
              />
            </label>

            {error && (
              <div style={{ borderRadius: 14, background: '#FEF2F2', color: '#B91C1C', padding: '0.85rem 1rem', fontSize: '0.92rem' }}>
                {error}
              </div>
            )}

            {message && (
              <div style={{ borderRadius: 14, background: '#ECFDF5', color: '#047857', padding: '0.85rem 1rem', fontSize: '0.92rem' }}>
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !verified || Boolean(message)}
              style={{ border: 0, borderRadius: 16, background: submitting || !verified || Boolean(message) ? '#94A3B8' : '#0F766E', color: '#FFFFFF', padding: '0.95rem 1rem', fontSize: '0.98rem', fontWeight: 700, cursor: submitting || !verified || Boolean(message) ? 'not-allowed' : 'pointer' }}
            >
              {submitting ? 'Activating...' : 'Activate account'}
            </button>
          </form>
        )}

        <div style={{ marginTop: '1rem', textAlign: 'center' }}>
          <Link to="/login" style={{ color: '#0F766E', fontWeight: 700, textDecoration: 'none' }}>
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
};

export default AcceptInvite;
