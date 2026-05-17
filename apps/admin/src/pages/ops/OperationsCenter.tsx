import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminImportSessionDetail, AdminImportSessionSummary, AdminPendingAuthUser, AdminRouteSummary } from 'shared';
import { Icon } from '../../components/design/Icon';
import { KPIBlock, SectionCard, StateBadge } from '../../components/design/primitives';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';
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

const sessionTone = (status: string) => {
  if (status === 'DONE') return 'ok';
  if (status === 'DONE_WITH_ERRORS' || status === 'FAILED') return 'err';
  if (status === 'READY_TO_IMPORT') return 'info';
  if (status.includes('ERROR')) return 'warn';
  return 'idle';
};

const buttonBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  borderRadius: 999,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--ink)',
  padding: '8px 14px',
  fontSize: 12,
  fontWeight: 500,
};

const fieldStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 12,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  padding: '10px 12px',
  outline: 'none',
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

  const executionFailures = sessionDetail?.rows.filter((row) => row.status === 'FAILED' && row.errorField === 'EXECUTION') ?? [];
  const validationFailures = sessionDetail?.rows.filter((row) => row.status === 'FAILED' && row.errorField === 'VALIDATION') ?? [];
  const pendingRows = sessionDetail?.rows.filter((row) => row.status === 'PENDING') ?? [];
  const selectedRoute = routes.find((route) => route.id === rowForm.assignedRouteId);
  const stopOptions = selectedRoute?.stops ?? [];
  const pageError = sessionsError || sessionDetailError || routesError || pendingAuthError;
  const pageErrorMessage = pageError ? extractApiError(pageError).message : null;
  const sessionsList = sessions ?? [];
  const completedSessions = sessionsList.filter((session) => session.status === 'DONE').length;
  const blockedSessions = sessionsList.filter((session) => session.status === 'DONE_WITH_ERRORS' || session.status === 'FAILED').length;
  const rowsInFlight = sessionsList.reduce((sum, session) => sum + Math.max(session.totalRows - session.importedCount - session.failedCount, 0), 0);

  return (
    <div style={{ display: 'grid', gap: 16, minHeight: '100%' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 16,
          alignItems: 'flex-start',
          padding: 20,
          border: '1px solid var(--border)',
          borderRadius: 20,
          background: 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(245,245,242,0.9))',
        }}
      >
        <div>
          <div className="mono" style={{ color: 'var(--muted)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
            Data Console
          </div>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 500, letterSpacing: '-0.03em' }}>
            Operations Center
          </h1>
          <div style={{ marginTop: 6, color: 'var(--muted)', maxWidth: 760 }}>
            Import sessions, correction rows, and auth provisioning are all running against the existing backend queue and audit trail.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', padding: 3, borderRadius: 999, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <button
              type="button"
              onClick={() => setTab('imports')}
              style={{ ...buttonBase, border: 0, background: tab === 'imports' ? 'var(--ink)' : 'transparent', color: tab === 'imports' ? 'var(--accent-ink)' : 'var(--muted)' }}
            >
              Imports
            </button>
            {canViewPendingAuth ? (
              <button
                type="button"
                onClick={() => setTab('auth')}
                style={{ ...buttonBase, border: 0, background: tab === 'auth' ? 'var(--ink)' : 'transparent', color: tab === 'auth' ? 'var(--accent-ink)' : 'var(--muted)' }}
              >
                Auth Provisioning
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => {
              refetchSessions();
              if (canViewPendingAuth) {
                refetchAuth();
              }
            }}
            style={buttonBase}
          >
            <Icon name="refresh" size={14} />
            Refresh
          </button>
        </div>
      </div>

      {pageErrorMessage ? (
        <div style={{ padding: '12px 14px', borderRadius: 16, border: '1px solid var(--err)', background: 'var(--err-soft)', color: 'var(--err)' }}>
          {pageErrorMessage}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
        <KPIBlock label="Sessions" value={sessionsList.length} sub="Queued and historical imports" spark={[2, 4, 3, 5, Math.max(sessionsList.length, 1)]} />
        <KPIBlock label="Completed" value={completedSessions} sub="Clean executions" accent="var(--ok)" spark={[1, 1, 2, 3, Math.max(completedSessions, 1)]} />
        <KPIBlock label="Blocked" value={blockedSessions} sub="Need row intervention" accent="var(--warn)" spark={[0, 1, 1, 2, Math.max(blockedSessions, 1)]} />
        <KPIBlock label="Rows In Flight" value={rowsInFlight} sub={tab === 'imports' ? 'Pending execution or validation' : 'Imports tab only'} accent="var(--info)" spark={[8, 6, 9, 7, Math.max(rowsInFlight, 1)]} />
      </div>

      {tab === 'imports' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '320px minmax(0, 1.3fr) 360px', gap: 16, minHeight: 0 }}>
          <SectionCard
            title="Session Feed"
            subtitle={loadingSessions ? 'Loading queue' : `${sessionsList.length} sessions in scope`}
          >
            <div className="scroll" style={{ display: 'grid', gap: 10, maxHeight: 'calc(100vh - 330px)', paddingRight: 4 }}>
              {loadingSessions ? (
                <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--muted)' }}>Loading sessions…</div>
              ) : sessionsList.length === 0 ? (
                <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--muted)' }}>No import sessions yet.</div>
              ) : (
                sessionsList.map((session) => {
                  const progress = session.totalRows > 0 ? Math.round(((session.importedCount + session.failedCount) / session.totalRows) * 100) : 0;
                  const active = selectedSessionId === session.id;
                  return (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => setSelectedSessionId(session.id)}
                      style={{
                        borderRadius: 16,
                        border: `1px solid ${active ? 'var(--ink)' : 'var(--border)'}`,
                        background: active ? 'var(--surface-2)' : 'var(--surface)',
                        padding: 14,
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                        <div>
                          <div className="mono" style={{ fontSize: 12, fontWeight: 500 }}>{session.type}</div>
                          <div style={{ marginTop: 2, color: 'var(--muted)', fontSize: 11 }}>{session.id.slice(0, 8)}</div>
                        </div>
                        <StateBadge state={session.status} label={session.status.replace(/_/g, ' ')} />
                      </div>
                      <div style={{ height: 6, background: 'var(--surface-3)', borderRadius: 999, overflow: 'hidden', marginBottom: 10 }}>
                        <div
                          style={{
                            width: `${progress}%`,
                            height: '100%',
                            background: sessionTone(session.status) === 'err' ? 'var(--warn)' : 'var(--ok)',
                            borderRadius: 999,
                            transition: 'width var(--t)',
                          }}
                        />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, fontSize: 11 }}>
                        <div><span className="muted">Imported</span><div className="mono">{session.importedCount}</div></div>
                        <div><span className="muted">Failed</span><div className="mono">{session.failedCount}</div></div>
                        <div><span className="muted">Rows</span><div className="mono">{session.totalRows}</div></div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </SectionCard>

          <SectionCard
            title={selectedSessionId ? `Session ${selectedSessionId.slice(0, 8)}` : 'Row Detail'}
            subtitle={selectedSessionId ? 'Inspect row-level validation and execution state' : 'Pick a session from the feed'}
            actions={sessionDetail ? <StateBadge state={sessionDetail.status} label={sessionDetail.status.replace(/_/g, ' ')} /> : undefined}
          >
            {!selectedSessionId ? (
              <div style={{ padding: '32px 0', color: 'var(--muted)' }}>Select an import session to inspect row outcomes.</div>
            ) : loadingSessionDetail ? (
              <div style={{ padding: '32px 0', color: 'var(--muted)' }}>Loading session detail…</div>
            ) : sessionDetail ? (
              <div style={{ display: 'grid', gap: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
                  <div style={{ padding: 12, borderRadius: 14, background: 'var(--surface-2)' }}><div className="muted">Total</div><div className="mono" style={{ fontSize: 20, marginTop: 4 }}>{sessionDetail.totalRows}</div></div>
                  <div style={{ padding: 12, borderRadius: 14, background: 'var(--ok-soft)' }}><div className="muted">Imported</div><div className="mono" style={{ fontSize: 20, marginTop: 4, color: 'var(--ok)' }}>{sessionDetail.importedCount}</div></div>
                  <div style={{ padding: 12, borderRadius: 14, background: 'var(--warn-soft)' }}><div className="muted">Validation Fails</div><div className="mono" style={{ fontSize: 20, marginTop: 4, color: 'var(--warn)' }}>{validationFailures.length}</div></div>
                  <div style={{ padding: 12, borderRadius: 14, background: 'var(--info-soft)' }}><div className="muted">Pending</div><div className="mono" style={{ fontSize: 20, marginTop: 4, color: 'var(--info)' }}>{pendingRows.length}</div></div>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => executePendingRows.mutate(sessionDetail.id)}
                    disabled={executePendingRows.isPending || pendingRows.length === 0}
                    style={{ ...buttonBase, background: pendingRows.length > 0 ? 'var(--ink)' : 'var(--surface-2)', color: pendingRows.length > 0 ? 'var(--accent-ink)' : 'var(--muted)', borderColor: pendingRows.length > 0 ? 'var(--ink)' : 'var(--border)' }}
                  >
                    <Icon name="play" size={12} />
                    Execute Pending
                  </button>
                  <button
                    type="button"
                    onClick={() => retryFailedRows.mutate(sessionDetail.id)}
                    disabled={retryFailedRows.isPending || executionFailures.length === 0}
                    style={buttonBase}
                  >
                    <Icon name="refresh" size={12} />
                    Retry Failures
                  </button>
                </div>

                <div className="scroll" style={{ border: '1px solid var(--border)', borderRadius: 16, maxHeight: 'calc(100vh - 520px)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
                      <tr>
                        {['Row', 'Status', 'Phone', 'Reason'].map((label) => (
                          <th key={label} style={{ padding: '12px 14px', textAlign: 'left', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--divider)' }}>
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sessionDetail.rows.map((row) => {
                        const active = row.id === selectedRowId;
                        return (
                          <tr key={row.id} onClick={() => setSelectedRowId(row.id)} style={{ background: active ? 'var(--surface-2)' : 'transparent', cursor: 'pointer' }}>
                            <td className="mono" style={{ padding: '12px 14px', borderBottom: '1px solid var(--divider)' }}>{row.rowNumber}</td>
                            <td style={{ padding: '12px 14px', borderBottom: '1px solid var(--divider)' }}>
                              <StateBadge state={row.status} label={row.status} />
                            </td>
                            <td style={{ padding: '12px 14px', borderBottom: '1px solid var(--divider)' }}>{String(row.rowData.phone ?? '-')}</td>
                            <td style={{ padding: '12px 14px', borderBottom: '1px solid var(--divider)', color: row.errorReason ? 'var(--err)' : 'var(--muted)' }}>
                              {row.errorReason || 'No issues'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div style={{ padding: '32px 0', color: 'var(--err)' }}>Import session not found.</div>
            )}
          </SectionCard>

          <SectionCard
            title="Row Correction"
            subtitle={selectedRow ? `Row ${selectedRow.rowNumber} selected` : 'Select a row to patch and re-run'}
          >
            {!selectedRow ? (
              <div style={{ padding: '32px 0', color: 'var(--muted)' }}>Choose a row from the middle pane to edit its normalized values.</div>
            ) : (
              <div className="scroll" style={{ display: 'grid', gap: 12, maxHeight: 'calc(100vh - 320px)', paddingRight: 4 }}>
                <div style={{ padding: 12, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>STATUS</div>
                  <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <StateBadge state={selectedRow.status} label={selectedRow.status} />
                    <span style={{ color: selectedRow.errorReason ? 'var(--err)' : 'var(--muted)', fontSize: 12 }}>{selectedRow.errorReason || 'Ready to execute'}</span>
                  </div>
                </div>

                {[
                  ['Phone', 'phone'],
                  ['Name', 'name'],
                  ['Roll Number', 'rollNumber'],
                  ['Email', 'email'],
                  ['Department', 'department'],
                  ['Year', 'year'],
                ].map(([label, key]) => (
                  <label key={key} style={{ display: 'grid', gap: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
                    <input
                      value={rowForm[key as keyof ImportRowFormState]}
                      onChange={(event) => setRowForm((current) => ({ ...current, [key]: event.target.value }))}
                      style={fieldStyle}
                    />
                  </label>
                ))}

                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Assigned Route</span>
                  <select
                    value={rowForm.assignedRouteId}
                    onChange={(event) => setRowForm((current) => ({ ...current, assignedRouteId: event.target.value, assignedStopId: '' }))}
                    style={fieldStyle}
                  >
                    <option value="">No assignment</option>
                    {routes.map((route) => (
                      <option key={route.id} value={route.id}>{route.name}</option>
                    ))}
                  </select>
                </label>

                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Assigned Stop</span>
                  <select
                    value={rowForm.assignedStopId}
                    onChange={(event) => setRowForm((current) => ({ ...current, assignedStopId: event.target.value }))}
                    style={fieldStyle}
                    disabled={!rowForm.assignedRouteId}
                  >
                    <option value="">{rowForm.assignedRouteId ? 'Select stop' : 'Select route first'}</option>
                    {stopOptions.map((routeStop) => (
                      <option key={routeStop.stop.id} value={routeStop.stop.id}>{routeStop.stop.name}</option>
                    ))}
                  </select>
                </label>

                {rowError ? (
                  <div style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid var(--err)', background: 'var(--err-soft)', color: 'var(--err)' }}>
                    {rowError}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => selectedSessionId && selectedRowId && saveRowPatch.mutate({ sessionId: selectedSessionId, rowId: selectedRowId, payload: rowForm })}
                  disabled={saveRowPatch.isPending || !rowForm.phone.trim() || !rowForm.name.trim() || !rowForm.rollNumber.trim()}
                  style={{ ...buttonBase, width: '100%', background: 'var(--ink)', color: 'var(--accent-ink)', borderColor: 'var(--ink)', paddingBlock: 12 }}
                >
                  <Icon name="check" size={12} />
                  Save Row Correction
                </button>
              </div>
            )}
          </SectionCard>
        </div>
      ) : (
        <SectionCard title="Auth Provisioning Queue" subtitle={loadingAuth ? 'Loading pending users' : `${pendingUsers?.length ?? 0} users waiting on auth completion`}>
          {loadingAuth ? (
            <div style={{ padding: '24px 0', color: 'var(--muted)' }}>Loading provisioning queue…</div>
          ) : !(pendingUsers?.length) ? (
            <div style={{ padding: '24px 0', color: 'var(--muted)' }}>No pending auth provisioning users.</div>
          ) : (
            <div className="scroll" style={{ border: '1px solid var(--border)', borderRadius: 16, maxHeight: 'calc(100vh - 340px)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
                  <tr>
                    {['Name', 'Phone', 'Status', 'Error'].map((label) => (
                      <th key={label} style={{ padding: '12px 14px', textAlign: 'left', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--divider)' }}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pendingUsers.map((user) => (
                    <tr key={user.id}>
                      <td style={{ padding: '12px 14px', borderBottom: '1px solid var(--divider)' }}>{user.name}</td>
                      <td style={{ padding: '12px 14px', borderBottom: '1px solid var(--divider)' }}>{user.phone}</td>
                      <td style={{ padding: '12px 14px', borderBottom: '1px solid var(--divider)' }}>
                        <StateBadge state={user.authStatus} label={user.authStatus.replace(/_/g, ' ')} />
                      </td>
                      <td style={{ padding: '12px 14px', borderBottom: '1px solid var(--divider)', color: user.authProvisionError ? 'var(--err)' : 'var(--muted)' }}>
                        {user.authProvisionError || 'No error message'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
};

export default OperationsCenter;
