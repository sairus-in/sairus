import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminImportSessionDetail, AdminImportSessionSummary, AdminPendingAuthUser, AdminRouteSummary } from 'shared';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';
import { RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle, Loader2, RotateCcw, Save, Play } from 'lucide-react';
import { useAuthStore } from '../../store/auth.store';

interface ImportRowFormState {
  phone: string;
  name: string;
  rollNumber: string;
  email: string;
  department: string;
  year: string;
  assignedRouteId: string;
  assignedStopId: string;
}

const statusColors: Record<string, { bg: string; text: string }> = {
  DONE: { bg: '#ECFDF5', text: '#059669' },
  DONE_WITH_ERRORS: { bg: '#FEF2F2', text: '#DC2626' },
  IMPORTING: { bg: '#EFF6FF', text: '#2563EB' },
  READY_TO_IMPORT: { bg: '#F0FDF4', text: '#16A34A' },
  VALIDATED_WITH_ERRORS: { bg: '#FFF7ED', text: '#EA580C' },
  VALIDATING: { bg: '#F5F3FF', text: '#7C3AED' },
  FAILED: { bg: '#FEF2F2', text: '#DC2626' },
  CANCELLED: { bg: '#F3F4F6', text: '#6B7280' },
};

const emptyRowForm: ImportRowFormState = {
  phone: '',
  name: '',
  rollNumber: '',
  email: '',
  department: '',
  year: '',
  assignedRouteId: '',
  assignedStopId: '',
};

export const OperationsCenter: React.FC = () => {
  const queryClient = useQueryClient();
  const capabilities = useAuthStore((state) => state.capabilities);
  const canViewPendingAuth = capabilities?.canViewPendingAuth === true;
  const [tab, setTab] = useState<'imports' | 'auth'>('imports');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [rowForm, setRowForm] = useState<ImportRowFormState>(emptyRowForm);
  const [rowError, setRowError] = useState<string | null>(null);

  const { data: sessions, isLoading: loadingSessions, error: sessionsError, refetch: refetchSessions } = useQuery<AdminImportSessionSummary[]>({
    queryKey: ['ops-import-sessions'],
    queryFn: () => api.get<AdminImportSessionSummary[]>('/v1/admin/ops/import-sessions'),
    refetchInterval: 10000,
  });

  const { data: sessionDetail, isLoading: loadingSessionDetail, error: sessionDetailError } = useQuery<AdminImportSessionDetail>({
    queryKey: ['ops-import-session', selectedSessionId],
    queryFn: () => api.get<AdminImportSessionDetail>(`/v1/admin/ops/import-sessions/${selectedSessionId}`),
    enabled: Boolean(selectedSessionId) && tab === 'imports',
  });

  const { data: routes = [], error: routesError } = useQuery<AdminRouteSummary[]>({
    queryKey: ['ops-import-route-options'],
    queryFn: () => api.get<AdminRouteSummary[]>('/v1/routes'),
    enabled: tab === 'imports',
  });

  const retryFailedRows = useMutation({
    mutationFn: (sessionId: string) => api.post(`/v1/admin/ops/import-sessions/${sessionId}/retry-failed`),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ops-import-sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['ops-import-session', selectedSessionId] }),
      ]);
    },
  });

  const executePendingRows = useMutation({
    mutationFn: (sessionId: string) => api.post(`/v1/import/${sessionId}/execute`),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ops-import-sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['ops-import-session', selectedSessionId] }),
      ]);
    },
  });

  const saveRowPatch = useMutation({
    mutationFn: ({ sessionId, rowId, payload }: { sessionId: string; rowId: string; payload: ImportRowFormState }) =>
      api.patch(`/v1/import/${sessionId}/rows/${rowId}`, {
        phone: payload.phone.trim(),
        name: payload.name.trim(),
        rollNumber: payload.rollNumber.trim(),
        email: payload.email.trim() || null,
        department: payload.department.trim() || null,
        year: payload.year ? Number(payload.year) : null,
        assignedRouteId: payload.assignedRouteId || null,
        assignedStopId: payload.assignedStopId || null,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ops-import-sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['ops-import-session', selectedSessionId] }),
      ]);
      setRowError(null);
    },
    onError: (error) => {
      setRowError(extractApiError(error).message);
    },
  });

  const { data: pendingUsers, isLoading: loadingAuth, error: pendingAuthError, refetch: refetchAuth } = useQuery<AdminPendingAuthUser[]>({
    queryKey: ['ops-pending-auth'],
    queryFn: () => api.get<AdminPendingAuthUser[]>('/v1/admin/ops/pending-auth'),
    refetchInterval: 10000,
    enabled: canViewPendingAuth && tab === 'auth',
  });

  useEffect(() => {
    if (tab === 'auth' && !canViewPendingAuth) {
      setTab('imports');
    }
  }, [canViewPendingAuth, tab]);

  const selectedRow = useMemo(
    () => sessionDetail?.rows.find((row) => row.id === selectedRowId) ?? null,
    [selectedRowId, sessionDetail?.rows],
  );

  useEffect(() => {
    if (!selectedSessionId || !sessionDetail) {
      setSelectedRowId(null);
      return;
    }

    if (!selectedRowId || !sessionDetail.rows.some((row) => row.id === selectedRowId)) {
      const next = sessionDetail.rows.find((row) => row.status === 'FAILED') ?? sessionDetail.rows[0] ?? null;
      setSelectedRowId(next?.id ?? null);
    }
  }, [selectedRowId, selectedSessionId, sessionDetail]);

  useEffect(() => {
    if (!selectedRow) {
      setRowForm(emptyRowForm);
      setRowError(null);
      return;
    }

    const rowData = selectedRow.rowData;
    setRowForm({
      phone: String(rowData.phone ?? ''),
      name: String(rowData.name ?? ''),
      rollNumber: String(rowData.rollNumber ?? ''),
      email: String(rowData.email ?? ''),
      department: String(rowData.department ?? ''),
      year: rowData.year ? String(rowData.year) : '',
      assignedRouteId: String(rowData.assignedRouteId ?? ''),
      assignedStopId: String(rowData.assignedStopId ?? ''),
    });
    setRowError(null);
  }, [selectedRow]);

  const getStatusIcon = (status: string) => {
    if (status === 'DONE') return <CheckCircle size={16} color="#059669" />;
    if (status.includes('ERROR') || status === 'FAILED') return <XCircle size={16} color="#DC2626" />;
    if (status === 'IMPORTING' || status === 'VALIDATING') return <Loader2 size={16} color="#2563EB" className="animate-spin" />;
    return <Clock size={16} color="#6B7280" />;
  };

  const executionFailures = sessionDetail?.rows.filter((row) => row.status === 'FAILED' && row.errorField === 'EXECUTION') ?? [];
  const validationFailures = sessionDetail?.rows.filter((row) => row.status === 'FAILED' && row.errorField === 'VALIDATION') ?? [];
  const pendingRows = sessionDetail?.rows.filter((row) => row.status === 'PENDING') ?? [];
  const selectedRoute = routes.find((route) => route.id === rowForm.assignedRouteId);
  const stopOptions = selectedRoute?.stops ?? [];
  const pageError = sessionsError || sessionDetailError || routesError || pendingAuthError;
  const pageErrorMessage = pageError ? extractApiError(pageError).message : null;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '1.5rem', borderBottom: '1px solid #E5E7EB' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 'bold' }}>Operations Center</h1>
        <p style={{ margin: '0.25rem 0 0', color: '#6B7280', fontSize: '0.875rem' }}>Monitor background tasks, CSV imports, and auth provisioning</p>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid #E5E7EB' }}>
        {(['imports', ...(canViewPendingAuth ? (['auth'] as const) : [])] as const).map((value) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            style={{
              padding: '0.75rem 1.5rem',
              border: 'none',
              background: 'none',
              borderBottom: tab === value ? '2px solid #2563EB' : '2px solid transparent',
              fontWeight: tab === value ? 600 : 400,
              color: tab === value ? '#2563EB' : '#6B7280',
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            {value === 'imports' ? 'CSV Import Sessions' : 'Auth Provisioning'}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => {
            refetchSessions();
            if (canViewPendingAuth) {
              refetchAuth();
            }
          }}
          style={{ padding: '0.5rem 1rem', margin: '0.5rem', border: '1px solid #D1D5DB', borderRadius: '6px', background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', padding: '1rem 1.5rem' }}>
        {pageErrorMessage && (
          <div style={{ marginBottom: '1rem', padding: '0.9rem 1rem', borderRadius: 12, background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}>
            {pageErrorMessage}
          </div>
        )}

        {tab === 'imports' && (
          <div style={{ display: 'grid', gridTemplateColumns: '360px minmax(0, 1fr) 360px', gap: '1rem', height: '100%' }}>
            <div style={{ overflow: 'auto', display: 'grid', gap: '0.75rem', alignContent: 'start' }}>
              {loadingSessions ? (
                <p style={{ textAlign: 'center', color: '#9CA3AF', padding: '2rem' }}>Loading sessions...</p>
              ) : (sessions || []).length === 0 ? (
                <p style={{ textAlign: 'center', color: '#9CA3AF', padding: '2rem' }}>No import sessions found</p>
              ) : (
                (sessions ?? []).map((session) => {
                  const colors = statusColors[session.status] || { bg: '#F3F4F6', text: '#6B7280' };
                  const progress = session.totalRows > 0 ? Math.round(((session.importedCount + session.failedCount) / session.totalRows) * 100) : 0;
                  return (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => setSelectedSessionId(session.id)}
                      style={{ border: `1px solid ${selectedSessionId === session.id ? '#2563EB' : '#E5E7EB'}`, borderRadius: '8px', padding: '1rem 1.25rem', background: 'white', textAlign: 'left', cursor: 'pointer' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {getStatusIcon(session.status)}
                          <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{session.type}</span>
                          <span style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>{session.id.slice(0, 8)}</span>
                        </div>
                        <span style={{ padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.7rem', fontWeight: 600, background: colors.bg, color: colors.text }}>
                          {session.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div style={{ height: '6px', background: '#F3F4F6', borderRadius: '3px', overflow: 'hidden', marginBottom: '0.5rem' }}>
                        <div style={{ height: '100%', width: `${progress}%`, background: session.failedCount > 0 ? '#F59E0B' : '#10B981', borderRadius: '3px', transition: 'width 0.3s' }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#6B7280' }}>
                        <span>{session.importedCount} imported | {session.failedCount} failed | {session.totalRows} total</span>
                        <span>{new Date(session.startedAt).toLocaleString()}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <div style={{ border: '1px solid #E5E7EB', borderRadius: '8px', background: 'white', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {!selectedSessionId ? (
                <div style={{ padding: '2rem', color: '#6B7280' }}>Select an import session to inspect row-level outcomes.</div>
              ) : loadingSessionDetail ? (
                <div style={{ padding: '2rem', color: '#6B7280' }}>Loading session detail...</div>
              ) : sessionDetail ? (
                <>
                  <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '1rem' }}>Session {sessionDetail.id.slice(0, 8)}</div>
                      <div style={{ color: '#6B7280', fontSize: '0.82rem' }}>{sessionDetail.type} | {sessionDetail.status.replace(/_/g, ' ')}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => executePendingRows.mutate(sessionDetail.id)}
                        disabled={executePendingRows.isPending || pendingRows.length === 0}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', border: 'none', borderRadius: '6px', background: pendingRows.length > 0 ? '#16A34A' : '#CBD5E1', color: 'white', padding: '0.65rem 0.9rem', cursor: pendingRows.length > 0 ? 'pointer' : 'not-allowed', fontWeight: 700 }}
                      >
                        <Play size={14} /> Execute pending rows
                      </button>
                      <button
                        type="button"
                        onClick={() => retryFailedRows.mutate(sessionDetail.id)}
                        disabled={retryFailedRows.isPending || executionFailures.length === 0}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', border: 'none', borderRadius: '6px', background: executionFailures.length > 0 ? '#2563EB' : '#CBD5E1', color: 'white', padding: '0.65rem 0.9rem', cursor: executionFailures.length > 0 ? 'pointer' : 'not-allowed', fontWeight: 700 }}
                      >
                        <RotateCcw size={14} /> Retry execution failures
                      </button>
                    </div>
                  </div>

                  <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #E5E7EB', display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '0.75rem' }}>
                    <div>
                      <div style={{ color: '#6B7280', fontSize: '0.78rem' }}>Total rows</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{sessionDetail.totalRows}</div>
                    </div>
                    <div>
                      <div style={{ color: '#6B7280', fontSize: '0.78rem' }}>Imported</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#059669' }}>{sessionDetail.importedCount}</div>
                    </div>
                    <div>
                      <div style={{ color: '#6B7280', fontSize: '0.78rem' }}>Validation fails</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#EA580C' }}>{validationFailures.length}</div>
                    </div>
                    <div>
                      <div style={{ color: '#6B7280', fontSize: '0.78rem' }}>Pending</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#2563EB' }}>{pendingRows.length}</div>
                    </div>
                  </div>

                  <div style={{ flex: 1, overflow: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead style={{ position: 'sticky', top: 0, backgroundColor: '#F9FAFB', zIndex: 1 }}>
                        <tr>
                          <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E5E7EB', fontWeight: 600, fontSize: '0.82rem' }}>Row</th>
                          <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E5E7EB', fontWeight: 600, fontSize: '0.82rem' }}>Status</th>
                          <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E5E7EB', fontWeight: 600, fontSize: '0.82rem' }}>Phone</th>
                          <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E5E7EB', fontWeight: 600, fontSize: '0.82rem' }}>Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sessionDetail.rows.map((row) => (
                          <tr key={row.id} onClick={() => setSelectedRowId(row.id)} style={{ borderBottom: '1px solid #E5E7EB', cursor: 'pointer', background: selectedRowId === row.id ? '#EFF6FF' : 'white' }}>
                            <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace' }}>{row.rowNumber}</td>
                            <td style={{ padding: '0.75rem 1rem' }}>
                              <span style={{ padding: '0.2rem 0.55rem', borderRadius: '9999px', fontSize: '0.72rem', fontWeight: 700, background: row.status === 'IMPORTED' ? '#ECFDF5' : row.status === 'FAILED' ? '#FEF2F2' : '#EFF6FF', color: row.status === 'IMPORTED' ? '#047857' : row.status === 'FAILED' ? '#B91C1C' : '#1D4ED8' }}>
                                {row.status}
                              </span>
                            </td>
                            <td style={{ padding: '0.75rem 1rem', color: '#475569' }}>{String(row.rowData.phone ?? '-')}</td>
                            <td style={{ padding: '0.75rem 1rem', color: '#B91C1C', fontSize: '0.84rem' }}>{row.errorReason || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div style={{ padding: '2rem', color: '#B91C1C' }}>Import session not found.</div>
              )}
            </div>

            <div style={{ border: '1px solid #E5E7EB', borderRadius: '8px', background: 'white', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #E5E7EB' }}>
                <div style={{ fontWeight: 700, fontSize: '1rem' }}>Row Correction</div>
                <div style={{ color: '#6B7280', fontSize: '0.82rem', marginTop: '0.25rem' }}>
                  Correct failed rows, save them back into the session, then execute pending rows.
                </div>
              </div>

              <div style={{ padding: '1rem 1.25rem', display: 'grid', gap: '0.75rem', overflow: 'auto' }}>
                {!selectedRow ? (
                  <div style={{ color: '#6B7280', fontSize: '0.9rem' }}>Select a row from the session to review or correct it.</div>
                ) : (
                  <>
                    <div style={{ padding: '0.75rem 0.85rem', borderRadius: '8px', background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                      <div style={{ fontSize: '0.78rem', color: '#64748B' }}>Selected Row</div>
                      <div style={{ marginTop: '0.25rem', fontWeight: 700 }}>Row {selectedRow.rowNumber}</div>
                      <div style={{ marginTop: '0.2rem', color: selectedRow.status === 'FAILED' ? '#B91C1C' : '#1D4ED8', fontSize: '0.82rem' }}>
                        {selectedRow.status} {selectedRow.errorReason ? `| ${selectedRow.errorReason}` : ''}
                      </div>
                    </div>

                    <label style={{ display: 'grid', gap: '0.35rem' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Phone</span>
                      <input value={rowForm.phone} onChange={(event) => setRowForm((current) => ({ ...current, phone: event.target.value }))} style={{ padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB' }} />
                    </label>
                    <label style={{ display: 'grid', gap: '0.35rem' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Name</span>
                      <input value={rowForm.name} onChange={(event) => setRowForm((current) => ({ ...current, name: event.target.value }))} style={{ padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB' }} />
                    </label>
                    <label style={{ display: 'grid', gap: '0.35rem' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Roll Number</span>
                      <input value={rowForm.rollNumber} onChange={(event) => setRowForm((current) => ({ ...current, rollNumber: event.target.value }))} style={{ padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB' }} />
                    </label>
                    <label style={{ display: 'grid', gap: '0.35rem' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Email</span>
                      <input value={rowForm.email} onChange={(event) => setRowForm((current) => ({ ...current, email: event.target.value }))} style={{ padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB' }} />
                    </label>
                    <label style={{ display: 'grid', gap: '0.35rem' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Department</span>
                      <input value={rowForm.department} onChange={(event) => setRowForm((current) => ({ ...current, department: event.target.value }))} style={{ padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB' }} />
                    </label>
                    <label style={{ display: 'grid', gap: '0.35rem' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Year</span>
                      <input type="number" min={1} max={6} value={rowForm.year} onChange={(event) => setRowForm((current) => ({ ...current, year: event.target.value }))} style={{ padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB' }} />
                    </label>
                    <label style={{ display: 'grid', gap: '0.35rem' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Assigned Route</span>
                      <select value={rowForm.assignedRouteId} onChange={(event) => setRowForm((current) => ({ ...current, assignedRouteId: event.target.value, assignedStopId: '' }))} style={{ padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB' }}>
                        <option value="">No assignment</option>
                        {routes.map((route) => (
                          <option key={route.id} value={route.id}>{route.name}</option>
                        ))}
                      </select>
                    </label>
                    <label style={{ display: 'grid', gap: '0.35rem' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Assigned Stop</span>
                      <select value={rowForm.assignedStopId} onChange={(event) => setRowForm((current) => ({ ...current, assignedStopId: event.target.value }))} style={{ padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB' }} disabled={!rowForm.assignedRouteId}>
                        <option value="">{rowForm.assignedRouteId ? 'Select stop' : 'Select route first'}</option>
                        {stopOptions.map((routeStop) => (
                          <option key={routeStop.stop.id} value={routeStop.stop.id}>{routeStop.stop.name}</option>
                        ))}
                      </select>
                    </label>

                    {rowError && (
                      <div style={{ padding: '0.8rem', borderRadius: '6px', background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', fontSize: '0.85rem' }}>
                        {rowError}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => selectedSessionId && selectedRowId && saveRowPatch.mutate({ sessionId: selectedSessionId, rowId: selectedRowId, payload: rowForm })}
                      disabled={saveRowPatch.isPending || !rowForm.phone.trim() || !rowForm.name.trim() || !rowForm.rollNumber.trim()}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem', border: 'none', borderRadius: '8px', background: '#111827', color: 'white', padding: '0.85rem 1rem', fontWeight: 700, cursor: 'pointer' }}
                    >
                      <Save size={16} /> Save row correction
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'auth' && (
          <div>
            {loadingAuth ? (
              <p style={{ textAlign: 'center', color: '#9CA3AF', padding: '2rem' }}>Loading...</p>
            ) : (pendingUsers || []).length === 0 ? (
              <p style={{ textAlign: 'center', color: '#9CA3AF', padding: '2rem' }}>No pending auth provisioning users</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ backgroundColor: '#F9FAFB' }}>
                  <tr>
                    <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E5E7EB', fontWeight: 600, fontSize: '0.85rem' }}>Name</th>
                    <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E5E7EB', fontWeight: 600, fontSize: '0.85rem' }}>Phone</th>
                    <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E5E7EB', fontWeight: 600, fontSize: '0.85rem' }}>Status</th>
                    <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E5E7EB', fontWeight: 600, fontSize: '0.85rem' }}>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {(pendingUsers || []).map((user) => (
                    <tr key={user.id} style={{ borderBottom: '1px solid #E5E7EB' }}>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 500 }}>{user.name}</td>
                      <td style={{ padding: '0.75rem 1rem', color: '#4B5563' }}>{user.phone}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.7rem', fontWeight: 600, background: user.authStatus === 'AUTH_PROVISION_FAILED' ? '#FEF2F2' : '#FFF7ED', color: user.authStatus === 'AUTH_PROVISION_FAILED' ? '#DC2626' : '#EA580C' }}>
                          {user.authStatus === 'AUTH_PROVISION_FAILED' ? <XCircle size={12} /> : <AlertTriangle size={12} />}
                          {user.authStatus.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem', color: '#EF4444', fontSize: '0.85rem', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {user.authProvisionError || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default OperationsCenter;
