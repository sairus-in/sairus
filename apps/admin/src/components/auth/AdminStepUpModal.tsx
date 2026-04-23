import React, { useEffect, useState } from 'react';
import { ShieldAlert, X } from 'lucide-react';
import { AdminStepUpResponse } from 'shared';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';

interface AdminStepUpModalProps {
  open: boolean;
  title: string;
  description: string;
  actionLabel?: string;
  onAuthorized: (stepUpToken: string) => Promise<void>;
  onClose: () => void;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.45)',
  display: 'grid',
  placeItems: 'center',
  padding: '1.5rem',
  zIndex: 60,
};

const modalStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 440,
  background: '#FFFFFF',
  borderRadius: 24,
  border: '1px solid #E2E8F0',
  boxShadow: '0 30px 80px rgba(15, 23, 42, 0.24)',
  overflow: 'hidden',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 14,
  border: '1px solid #CBD5E1',
  padding: '0.9rem 1rem',
  fontSize: '0.95rem',
  background: '#FFFFFF',
};

export const AdminStepUpModal: React.FC<AdminStepUpModalProps> = ({
  open,
  title,
  description,
  actionLabel = 'Confirm action',
  onAuthorized,
  onClose,
}) => {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPassword('');
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await api.post<AdminStepUpResponse>('/v1/admin/auth/step-up', {
        password,
      });

      await onAuthorized(response.stepUpToken);
      onClose();
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <div style={{ width: 42, height: 42, borderRadius: 14, background: '#DCFCE7', color: '#166534', display: 'grid', placeItems: 'center' }}>
              <ShieldAlert size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, color: '#0F172A', fontSize: '1.05rem' }}>{title}</h3>
              <p style={{ margin: '0.2rem 0 0', color: '#64748B', fontSize: '0.88rem' }}>Recent password confirmation required</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{ border: 0, background: 'transparent', color: '#64748B', cursor: submitting ? 'not-allowed' : 'pointer' }}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '1.5rem', display: 'grid', gap: '1rem' }}>
          <p style={{ margin: 0, color: '#475569', lineHeight: 1.6 }}>
            {description}
          </p>

          <label style={{ display: 'grid', gap: '0.45rem', color: '#0F172A', fontWeight: 600 }}>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              style={inputStyle}
              required
            />
          </label>

          {error && (
            <div style={{ borderRadius: 14, background: '#FEF2F2', color: '#B91C1C', padding: '0.85rem 1rem', fontSize: '0.92rem' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{ borderRadius: 14, border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', padding: '0.85rem 1rem', fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{ border: 0, borderRadius: 14, background: submitting ? '#94A3B8' : '#0F172A', color: '#FFFFFF', padding: '0.85rem 1rem', fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer' }}
            >
              {submitting ? 'Authorizing...' : actionLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AdminStepUpModal;
