import React, { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
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

export const ForgotPassword: React.FC = () => {
  const { isAuthenticated } = useAuthStore();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (isAuthenticated) {
    return <Navigate to="/security" replace />;
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const response = await api.post<{ message: string }>('/v1/admin/auth/forgot-password', {
        email: email.trim(),
      });

      setMessage(response.message);
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem', background: 'linear-gradient(160deg, #FFF7ED 0%, #F8FAFC 50%, #DBEAFE 100%)' }}>
      <div style={{ width: '100%', maxWidth: 460, background: 'rgba(255,255,255,0.96)', border: '1px solid rgba(148,163,184,0.25)', borderRadius: 24, boxShadow: '0 24px 80px rgba(15,23,42,0.12)', padding: '2rem' }}>
        <p style={{ margin: 0, color: '#0F766E', fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Admin recovery
        </p>
        <h1 style={{ margin: '0.5rem 0 0', fontSize: '2rem', color: '#0F172A' }}>Reset your password</h1>
        <p style={{ margin: '0.75rem 0 1.5rem', color: '#475569', lineHeight: 1.6 }}>
          Enter the administrator email address. If it exists, a reset link will be issued.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1rem' }}>
          <label style={{ display: 'grid', gap: '0.4rem', color: '#0F172A', fontWeight: 600 }}>
            Email
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
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
            disabled={submitting}
            style={{ border: 0, borderRadius: 16, background: submitting ? '#94A3B8' : '#0F766E', color: '#FFFFFF', padding: '0.95rem 1rem', fontSize: '0.98rem', fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer' }}
          >
            {submitting ? 'Sending...' : 'Send reset link'}
          </button>
        </form>

        <div style={{ marginTop: '1rem', textAlign: 'center' }}>
          <Link to="/login" style={{ color: '#0F766E', fontWeight: 700, textDecoration: 'none' }}>
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
