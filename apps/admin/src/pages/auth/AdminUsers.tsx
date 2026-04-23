import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AdminRole, AdminUserManagementItem } from 'shared';
import { AdminStepUpModal } from '../../components/auth/AdminStepUpModal';
import { ConfirmWithImpactModal } from '../../components/shared/ConfirmWithImpactModal';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';
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

type FormMode = 'create' | 'edit';

type AdminFormState = {
  name: string;
  email: string;
  role: AdminRole;
  routeIdsText: string;
  department: string;
};

type StepUpRequest =
  | {
      title: string;
      description: string;
      actionLabel: string;
      onAuthorized: (token: string) => Promise<void>;
    }
  | null;

type ConfirmRequest =
  | {
      title: string;
      description: string;
      impacts: string[];
      confirmLabel: string;
      isDestructive?: boolean;
      requiresReason?: boolean;
      promptLabel?: string;
      promptPlaceholder?: string;
      onConfirm: () => void;
    }
  | null;

const ADMIN_ROLES: AdminRole[] = ['COORDINATOR', 'TRANSPORT_OFFICER', 'FACULTY', 'MANAGEMENT'];

const createInitialFormState = (): AdminFormState => ({
  name: '',
  email: '',
  role: 'COORDINATOR',
  routeIdsText: '',
  department: '',
});

const parseRouteIds = (value: string): string[] =>
  value
    .split(/[\s,]+/)
    .map((routeId) => routeId.trim())
    .filter(Boolean);

const formatRole = (role: AdminRole): string =>
  role
    .toLowerCase()
    .split('_')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');

const getLifecycleLabel = (admin: AdminUserManagementItem): string => {
  if (admin.isActive) {
    return 'Operational';
  }

  if (admin.isSuspended) {
    return 'Suspended';
  }

  return 'Invite pending';
};

export const AdminUsers: React.FC = () => {
  const { isAuthenticated, user } = useAuthStore();
  const [admins, setAdmins] = useState<AdminUserManagementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<FormMode>('create');
  const [editingAdminId, setEditingAdminId] = useState<string | null>(null);
  const [formState, setFormState] = useState<AdminFormState>(createInitialFormState());
  const [stepUpRequest, setStepUpRequest] = useState<StepUpRequest>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest>(null);
  const [lifecycleReason, setLifecycleReason] = useState('');

  const activeAdmins = useMemo(() => admins.filter((admin) => admin.isActive), [admins]);
  const suspendedAdmins = useMemo(() => admins.filter((admin) => admin.isSuspended), [admins]);
  const pendingInviteAdmins = useMemo(
    () => admins.filter((admin) => !admin.isActive && !admin.isSuspended),
    [admins],
  );
  const isSuspensionManager = user?.role === 'MANAGEMENT';

  const loadAdmins = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.get<AdminUserManagementItem[]>('/v1/admin/admin-users');
      setAdmins(response);
    } catch (loadError) {
      setError(extractApiError(loadError).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      void loadAdmins();
    }
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const resetForm = () => {
    setFormMode('create');
    setEditingAdminId(null);
    setFormState(createInitialFormState());
  };

  const startEdit = (admin: AdminUserManagementItem) => {
    setFormMode('edit');
    setEditingAdminId(admin.id);
    setFormState({
      name: admin.name,
      email: admin.email,
      role: admin.role,
      routeIdsText: admin.routeIds.join(', '),
      department: admin.department ?? '',
    });
    setError(null);
    setMessage(null);
  };

  const requestSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const routeIds = parseRouteIds(formState.routeIdsText);
    const payload = {
      name: formState.name.trim(),
      role: formState.role,
      routeIds,
      department: formState.department.trim() || null,
      ...(formMode === 'create' ? { email: formState.email.trim() } : {}),
    };

    setStepUpRequest({
      title: formMode === 'create' ? 'Create administrator' : 'Update administrator',
      description:
        formMode === 'create'
          ? 'Confirm with your password before sending a new admin invitation.'
          : 'Confirm with your password before changing this administrator account.',
      actionLabel: formMode === 'create' ? 'Create admin' : 'Save changes',
      onAuthorized: async (stepUpToken) => {
        setSaving(true);

        try {
          if (formMode === 'create') {
            await api.post('/v1/admin/admin-users', payload, {
              headers: {
                'x-admin-step-up': stepUpToken,
              },
            });
            setMessage('Administrator invited successfully.');
            resetForm();
          } else if (editingAdminId) {
            await api.patch(`/v1/admin/admin-users/${editingAdminId}`, payload, {
              headers: {
                'x-admin-step-up': stepUpToken,
              },
            });
            setMessage('Administrator updated successfully.');
          }

          await loadAdmins();
        } catch (saveError) {
          setError(extractApiError(saveError).message);
          throw saveError;
        } finally {
          setSaving(false);
        }
      },
    });
  };

  const requestSuspend = (admin: AdminUserManagementItem) => {
    setLifecycleReason('');
    setConfirmRequest({
      title: 'Suspend administrator',
      description: `Suspend ${admin.name}? This immediately invalidates all of their admin sessions and blocks new sign-ins.`,
      impacts: [
        'Current admin cookies stop working on the next request.',
        'The account stays in the system and can be unsuspended later.',
      ],
      confirmLabel: 'Suspend admin',
      isDestructive: true,
      requiresReason: true,
      promptLabel: 'Suspension reason',
      promptPlaceholder: 'Explain why this administrator is being suspended',
      onConfirm: () => {
        setConfirmRequest(null);
        setStepUpRequest({
          title: 'Suspend administrator',
          description: `Confirm with your password before suspending ${admin.name}.`,
          actionLabel: 'Suspend admin',
          onAuthorized: async (stepUpToken) => {
            setSaving(true);

            try {
              await api.post(
                `/v1/admin/admin-users/${admin.id}/suspend`,
                { reason: lifecycleReason.trim() },
                {
                  headers: {
                    'x-admin-step-up': stepUpToken,
                  },
                },
              );
              setMessage(`${admin.name} was suspended.`);
              setLifecycleReason('');
              await loadAdmins();
            } catch (actionError) {
              setError(extractApiError(actionError).message);
              throw actionError;
            } finally {
              setSaving(false);
            }
          },
        });
      },
    });
  };

  const requestUnsuspend = (admin: AdminUserManagementItem) => {
    setLifecycleReason('');
    setConfirmRequest({
      title: 'Unsuspend administrator',
      description: `Restore ${admin.name}'s access? The account will be allowed to sign in again.`,
      impacts: [
        'Previous sessions remain invalid because the session version is bumped again.',
        'The admin must sign in fresh after access is restored.',
      ],
      confirmLabel: 'Unsuspend admin',
      promptLabel: 'Unsuspension note',
      promptPlaceholder: 'Optional note about why access is being restored',
      onConfirm: () => {
        setConfirmRequest(null);
        setStepUpRequest({
          title: 'Unsuspend administrator',
          description: `Confirm with your password before restoring ${admin.name}.`,
          actionLabel: 'Unsuspend admin',
          onAuthorized: async (stepUpToken) => {
            setSaving(true);

            try {
              await api.post(
                `/v1/admin/admin-users/${admin.id}/unsuspend`,
                { reason: lifecycleReason.trim() || null },
                {
                  headers: {
                    'x-admin-step-up': stepUpToken,
                  },
                },
              );
              setMessage(`${admin.name} was unsuspended.`);
              setLifecycleReason('');
              await loadAdmins();
            } catch (actionError) {
              setError(extractApiError(actionError).message);
              throw actionError;
            } finally {
              setSaving(false);
            }
          },
        });
      },
    });
  };

  return (
    <>
      <div style={{ display: 'grid', gap: '1.5rem' }}>
        <div>
          <p
            style={{
              margin: 0,
              color: '#0F766E',
              fontSize: '0.85rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            Admin management
          </p>
          <h1 style={{ margin: '0.5rem 0 0', fontSize: '2rem', color: '#0F172A' }}>
            Administrator accounts
          </h1>
          <p style={{ margin: '0.75rem 0 0', color: '#475569', lineHeight: 1.6 }}>
            Invite, update, suspend, and unsuspend admin users. Every write action requires step-up authentication.
          </p>
        </div>

        {error && (
          <div
            style={{
              ...cardStyle,
              background: '#FEF2F2',
              color: '#B91C1C',
              borderColor: '#FECACA',
            }}
          >
            {error}
          </div>
        )}

        {message && (
          <div
            style={{
              ...cardStyle,
              background: '#ECFDF5',
              color: '#047857',
              borderColor: '#A7F3D0',
            }}
          >
            {message}
          </div>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(320px, 420px) 1fr',
            gap: '1.5rem',
            alignItems: 'start',
          }}
        >
          <div style={cardStyle}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '1rem',
                alignItems: 'center',
              }}
            >
              <div>
                <h2 style={{ margin: 0, color: '#0F172A' }}>
                  {formMode === 'create' ? 'Invite admin' : 'Edit admin'}
                </h2>
                <p style={{ margin: '0.5rem 0 0', color: '#475569', lineHeight: 1.5 }}>
                  {formMode === 'create'
                    ? 'Create a pending admin account and send its invite flow.'
                    : 'Update scope or role assignments for an existing admin.'}
                </p>
              </div>

              {formMode === 'edit' && (
                <button
                  type="button"
                  onClick={resetForm}
                  style={{
                    border: '1px solid #CBD5E1',
                    borderRadius: 14,
                    background: '#FFFFFF',
                    color: '#0F172A',
                    padding: '0.7rem 0.9rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  New invite
                </button>
              )}
            </div>

            <form
              onSubmit={requestSave}
              style={{ display: 'grid', gap: '0.85rem', marginTop: '1.25rem' }}
            >
              <label
                style={{ display: 'grid', gap: '0.4rem', color: '#0F172A', fontWeight: 600 }}
              >
                Name
                <input
                  value={formState.name}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, name: event.target.value }))
                  }
                  required
                  style={inputStyle}
                />
              </label>

              <label
                style={{ display: 'grid', gap: '0.4rem', color: '#0F172A', fontWeight: 600 }}
              >
                Email
                <input
                  type="email"
                  value={formState.email}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, email: event.target.value }))
                  }
                  required={formMode === 'create'}
                  disabled={formMode === 'edit'}
                  style={{
                    ...inputStyle,
                    background: formMode === 'edit' ? '#F8FAFC' : '#FFFFFF',
                  }}
                />
              </label>

              <label
                style={{ display: 'grid', gap: '0.4rem', color: '#0F172A', fontWeight: 600 }}
              >
                Role
                <select
                  value={formState.role}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      role: event.target.value as AdminRole,
                    }))
                  }
                  style={inputStyle}
                >
                  {ADMIN_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {formatRole(role)}
                    </option>
                  ))}
                </select>
              </label>

              <label
                style={{ display: 'grid', gap: '0.4rem', color: '#0F172A', fontWeight: 600 }}
              >
                Route scope
                <textarea
                  value={formState.routeIdsText}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      routeIdsText: event.target.value,
                    }))
                  }
                  rows={4}
                  placeholder="Comma or whitespace separated route CUIDs"
                  style={{ ...inputStyle, resize: 'vertical', minHeight: 110 }}
                />
              </label>

              <label
                style={{ display: 'grid', gap: '0.4rem', color: '#0F172A', fontWeight: 600 }}
              >
                Department scope
                <input
                  value={formState.department}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, department: event.target.value }))
                  }
                  placeholder="Optional department"
                  style={inputStyle}
                />
              </label>

              <button
                type="submit"
                disabled={saving}
                style={{
                  border: 0,
                  borderRadius: 14,
                  background: saving ? '#94A3B8' : '#0F172A',
                  color: '#FFFFFF',
                  padding: '0.9rem 1rem',
                  fontWeight: 700,
                  cursor: saving ? 'not-allowed' : 'pointer',
                }}
              >
                {saving ? 'Saving...' : formMode === 'create' ? 'Send invite' : 'Save changes'}
              </button>
            </form>
          </div>

          <div style={cardStyle}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '1rem',
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <div>
                <h2 style={{ margin: 0, color: '#0F172A' }}>Current admins</h2>
                <p style={{ margin: '0.5rem 0 0', color: '#475569' }}>
                  {admins.length} total | {activeAdmins.length} active |{' '}
                  {suspendedAdmins.length} suspended | {pendingInviteAdmins.length} pending invite
                </p>
              </div>

              <button
                type="button"
                onClick={() => void loadAdmins()}
                style={{
                  border: '1px solid #CBD5E1',
                  borderRadius: 14,
                  background: '#FFFFFF',
                  color: '#0F172A',
                  padding: '0.75rem 0.95rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Refresh list
              </button>
            </div>

            {loading ? (
              <div style={{ marginTop: '1rem', color: '#475569' }}>
                Loading administrator accounts...
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '0.85rem', marginTop: '1.25rem' }}>
                {admins.map((admin) => (
                  <div
                    key={admin.id}
                    style={{
                      borderRadius: 16,
                      border: '1px solid #E2E8F0',
                      padding: '1rem',
                      display: 'grid',
                      gap: '0.85rem',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '1rem',
                        alignItems: 'flex-start',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div>
                        <div
                          style={{
                            display: 'flex',
                            gap: '0.65rem',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                          }}
                        >
                          <h3 style={{ margin: 0, color: '#0F172A', fontSize: '1rem' }}>
                            {admin.name}
                          </h3>
                          <span
                            style={{
                              borderRadius: 999,
                              padding: '0.2rem 0.6rem',
                              fontSize: '0.78rem',
                              fontWeight: 700,
                              background: admin.isActive
                                ? '#DCFCE7'
                                : admin.isSuspended
                                  ? '#FEE2E2'
                                  : '#E2E8F0',
                              color: admin.isActive
                                ? '#166534'
                                : admin.isSuspended
                                  ? '#B91C1C'
                                  : '#334155',
                            }}
                          >
                            {admin.isActive
                              ? 'Active'
                              : admin.isSuspended
                                ? 'Suspended'
                                : 'Pending invite'}
                          </span>
                          <span
                            style={{
                              borderRadius: 999,
                              padding: '0.2rem 0.6rem',
                              fontSize: '0.78rem',
                              fontWeight: 700,
                              background: '#E0F2FE',
                              color: '#0C4A6E',
                            }}
                          >
                            {formatRole(admin.role)}
                          </span>
                        </div>
                        <div style={{ marginTop: '0.35rem', color: '#475569', fontSize: '0.92rem' }}>
                          {admin.email}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => startEdit(admin)}
                          style={{
                            border: '1px solid #CBD5E1',
                            borderRadius: 12,
                            background: '#FFFFFF',
                            color: '#0F172A',
                            padding: '0.7rem 0.9rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Edit
                        </button>

                        {isSuspensionManager && admin.isActive ? (
                          <button
                            type="button"
                            onClick={() => requestSuspend(admin)}
                            style={{
                              border: '1px solid #FCA5A5',
                              borderRadius: 12,
                              background: '#FFFFFF',
                              color: '#B91C1C',
                              padding: '0.7rem 0.9rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            Suspend
                          </button>
                        ) : null}

                        {isSuspensionManager && admin.isSuspended ? (
                          <button
                            type="button"
                            onClick={() => requestUnsuspend(admin)}
                            style={{
                              border: '1px solid #86EFAC',
                              borderRadius: 12,
                              background: '#FFFFFF',
                              color: '#166534',
                              padding: '0.7rem 0.9rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            Unsuspend
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                        gap: '0.75rem',
                      }}
                    >
                      <div
                        style={{
                          borderRadius: 14,
                          background: '#F8FAFC',
                          border: '1px solid #E2E8F0',
                          padding: '0.85rem 1rem',
                        }}
                      >
                        <div
                          style={{
                            color: '#64748B',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.08em',
                          }}
                        >
                          Lifecycle
                        </div>
                        <div style={{ marginTop: '0.45rem', color: '#0F172A', fontWeight: 700 }}>
                          {getLifecycleLabel(admin)}
                        </div>
                        {admin.isSuspended && admin.suspendReason ? (
                          <div
                            style={{
                              marginTop: '0.4rem',
                              color: '#64748B',
                              fontSize: '0.84rem',
                              lineHeight: 1.5,
                            }}
                          >
                            {admin.suspendReason}
                          </div>
                        ) : null}
                      </div>

                      <div
                        style={{
                          borderRadius: 14,
                          background: '#F8FAFC',
                          border: '1px solid #E2E8F0',
                          padding: '0.85rem 1rem',
                        }}
                      >
                        <div
                          style={{
                            color: '#64748B',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.08em',
                          }}
                        >
                          Route scope
                        </div>
                        <div style={{ marginTop: '0.45rem', color: '#0F172A', fontWeight: 700 }}>
                          {admin.routeIds.length > 0 ? admin.routeIds.length : 'None'}
                        </div>
                      </div>

                      <div
                        style={{
                          borderRadius: 14,
                          background: '#F8FAFC',
                          border: '1px solid #E2E8F0',
                          padding: '0.85rem 1rem',
                        }}
                      >
                        <div
                          style={{
                            color: '#64748B',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.08em',
                          }}
                        >
                          Department
                        </div>
                        <div style={{ marginTop: '0.45rem', color: '#0F172A', fontWeight: 700 }}>
                          {admin.department ?? 'None'}
                        </div>
                      </div>

                      <div
                        style={{
                          borderRadius: 14,
                          background: '#F8FAFC',
                          border: '1px solid #E2E8F0',
                          padding: '0.85rem 1rem',
                        }}
                      >
                        <div
                          style={{
                            color: '#64748B',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.08em',
                          }}
                        >
                          Trusted devices
                        </div>
                        <div style={{ marginTop: '0.45rem', color: '#0F172A', fontWeight: 700 }}>
                          {admin.trustedDeviceCount}
                        </div>
                      </div>

                      <div
                        style={{
                          borderRadius: 14,
                          background: '#F8FAFC',
                          border: '1px solid #E2E8F0',
                          padding: '0.85rem 1rem',
                        }}
                      >
                        <div
                          style={{
                            color: '#64748B',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.08em',
                          }}
                        >
                          MFA
                        </div>
                        <div style={{ marginTop: '0.45rem', color: '#0F172A', fontWeight: 700 }}>
                          {admin.mfaEnabled ? 'Enabled' : 'Not enabled'}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
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

      {confirmRequest && (
        <ConfirmWithImpactModal
          title={confirmRequest.title}
          description={confirmRequest.description}
          impacts={confirmRequest.impacts}
          confirmLabel={confirmRequest.confirmLabel}
          isDestructive={confirmRequest.isDestructive}
          promptLabel={confirmRequest.promptLabel}
          promptPlaceholder={confirmRequest.promptPlaceholder}
          promptValue={lifecycleReason}
          promptRequired={confirmRequest.requiresReason}
          onPromptChange={setLifecycleReason}
          isLoading={saving}
          onCancel={() => {
            setConfirmRequest(null);
            setLifecycleReason('');
          }}
          onConfirm={confirmRequest.onConfirm}
        />
      )}
    </>
  );
};

export default AdminUsers;
