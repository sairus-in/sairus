import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminListResponse, AdminRouteSummary, AdminStudentListItem } from 'shared';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';

const fieldStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 12,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  padding: '10px 12px',
  outline: 'none',
};

export const UnassignedDrawer: React.FC = () => {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [targetRouteId, setTargetRouteId] = useState('');
  const [targetStopId, setTargetStopId] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { data, isLoading } = useQuery<AdminListResponse<AdminStudentListItem>>({
    queryKey: ['students-unassigned'],
    queryFn: () => api.getList<AdminStudentListItem>('/v1/users', { params: { routeId: 'unassigned', limit: 500 } }),
  });

  const { data: routesData } = useQuery<AdminRouteSummary[]>({
    queryKey: ['routes-all'],
    queryFn: () => api.get<AdminRouteSummary[]>('/v1/routes'),
  });

  const unassigned = data?.data || [];
  const routes = routesData || [];
  const selectedRoute = routes.find((route) => route.id === targetRouteId);
  const stops = selectedRoute?.stops || [];

  const assignMutation = useMutation({
    mutationFn: (payload: { studentIds: string[]; routeId: string; stopId: string }) =>
      api.post('/v1/users/assign-bulk', payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['students-unassigned'] });
      await queryClient.invalidateQueries({ queryKey: ['students'] });
      setSelectedIds(new Set());
      setTargetRouteId('');
      setTargetStopId('');
      setErrorMessage(null);
      setFeedback('Students successfully assigned.');
    },
    onError: (error) => {
      setFeedback(null);
      setErrorMessage(extractApiError(error).message);
    },
  });

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleAssign = () => {
    if (!targetRouteId || !targetStopId) {
      setErrorMessage('Select a route and stop before assigning.');
      return;
    }

    if (selectedIds.size === 0) {
      setErrorMessage('Select at least one student.');
      return;
    }

    assignMutation.mutate({
      studentIds: Array.from(selectedIds),
      routeId: targetRouteId,
      stopId: targetStopId,
    });
  };

  return (
    <div style={{ display: 'grid', gap: 12, height: '100%', padding: 16, border: '1px solid var(--border)', borderRadius: 20, background: 'var(--surface)' }}>
      <div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Routing Queue</div>
        <h3 style={{ margin: '8px 0 0', fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 500 }}>Unassigned Students</h3>
        <div style={{ marginTop: 4, color: 'var(--muted)' }}>{unassigned.length} students require route placement</div>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <select
          value={targetRouteId}
          onChange={(event) => {
            setTargetRouteId(event.target.value);
            setTargetStopId('');
            setFeedback(null);
            setErrorMessage(null);
          }}
          style={fieldStyle}
        >
          <option value="">Select Route</option>
          {routes.map((route) => (
            <option key={route.id} value={route.id}>{route.name}</option>
          ))}
        </select>
        <select
          value={targetStopId}
          onChange={(event) => {
            setTargetStopId(event.target.value);
            setFeedback(null);
            setErrorMessage(null);
          }}
          style={fieldStyle}
        >
          <option value="">Select Stop</option>
          {stops.map((routeStop) => (
            <option key={routeStop.stop.id} value={routeStop.stop.id}>{routeStop.stop.name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleAssign}
          disabled={assignMutation.isPending || selectedIds.size === 0}
          style={{ borderRadius: 999, border: '1px solid var(--ink)', background: selectedIds.size > 0 ? 'var(--ink)' : 'var(--surface-2)', color: selectedIds.size > 0 ? 'var(--accent-ink)' : 'var(--muted)', padding: '11px 16px', fontWeight: 500 }}
        >
          {assignMutation.isPending ? 'Assigning…' : `Assign ${selectedIds.size} Students`}
        </button>
        {feedback ? (
          <div style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid var(--ok)', background: 'var(--ok-soft)', color: 'var(--ok)' }}>
            {feedback}
          </div>
        ) : null}
        {errorMessage ? (
          <div style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid var(--err)', background: 'var(--err-soft)', color: 'var(--err)' }}>
            {errorMessage}
          </div>
        ) : null}
      </div>

      <div className="scroll" style={{ display: 'grid', gap: 8, minHeight: 0, paddingRight: 4 }}>
        {isLoading ? (
          <div style={{ padding: '24px 0', color: 'var(--muted)', textAlign: 'center' }}>Loading unassigned students…</div>
        ) : unassigned.length === 0 ? (
          <div style={{ padding: '24px 0', color: 'var(--ok)', textAlign: 'center' }}>All students are assigned.</div>
        ) : (
          unassigned.map((student) => (
            <button
              key={student.id}
              type="button"
              onClick={() => toggleSelect(student.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: 12,
                borderRadius: 16,
                border: `1px solid ${selectedIds.has(student.id) ? 'var(--ink)' : 'var(--border)'}`,
                background: selectedIds.has(student.id) ? 'var(--surface-2)' : 'var(--surface)',
                textAlign: 'left',
              }}
            >
              <input type="checkbox" checked={selectedIds.has(student.id)} readOnly />
              <div>
                <div style={{ fontWeight: 500 }}>{student.name}</div>
                <div style={{ marginTop: 2, color: 'var(--muted)', fontSize: 12 }}>
                  {student.rollNumber || 'No roll'} · {student.department || 'No department'}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
};

export default UnassignedDrawer;
