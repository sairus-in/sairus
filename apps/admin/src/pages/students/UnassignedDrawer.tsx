import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminListResponse, AdminRouteSummary, AdminStudentListItem } from 'shared';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';

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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '1.5rem', borderBottom: '1px solid #E5E7EB', backgroundColor: '#FEF2F2' }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 'bold', margin: 0, color: '#991B1B' }}>
          Unassigned Sync Queue
        </h2>
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem', color: '#B91C1C' }}>
          {unassigned.length} students require routing
        </p>
      </div>

      <div style={{ padding: '1rem', borderBottom: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column', gap: '0.5rem', backgroundColor: '#F9FAFB' }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <select
            value={targetRouteId}
            onChange={(event) => {
              setTargetRouteId(event.target.value);
              setTargetStopId('');
              setFeedback(null);
              setErrorMessage(null);
            }}
            style={{ flex: 1, padding: '0.5rem', border: '1px solid #D1D5DB', borderRadius: '4px' }}
          >
            <option value="">-- Select Route --</option>
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
            style={{ flex: 1, padding: '0.5rem', border: '1px solid #D1D5DB', borderRadius: '4px' }}
          >
            <option value="">-- Select Stop --</option>
            {stops.map((routeStop) => (
              <option key={routeStop.stop.id} value={routeStop.stop.id}>{routeStop.stop.name}</option>
            ))}
          </select>
        </div>
        <button
          onClick={handleAssign}
          disabled={assignMutation.isPending || selectedIds.size === 0}
          style={{ width: '100%', padding: '0.75rem', backgroundColor: selectedIds.size > 0 ? '#2563EB' : '#9CA3AF', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: selectedIds.size > 0 ? 'pointer' : 'not-allowed' }}
        >
          {assignMutation.isPending ? 'Assigning...' : `Assign ${selectedIds.size} Students`}
        </button>
        {feedback && (
          <div style={{ padding: '0.7rem 0.8rem', borderRadius: '6px', background: '#ECFDF5', color: '#047857', fontSize: '0.85rem', border: '1px solid #A7F3D0' }}>
            {feedback}
          </div>
        )}
        {errorMessage && (
          <div style={{ padding: '0.7rem 0.8rem', borderRadius: '6px', background: '#FEF2F2', color: '#B91C1C', fontSize: '0.85rem', border: '1px solid #FECACA' }}>
            {errorMessage}
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '1rem' }}>
        {isLoading ? (
          <div style={{ color: '#6B7280', textAlign: 'center', marginTop: '2rem' }}>Loading unassigned...</div>
        ) : unassigned.length === 0 ? (
          <div style={{ color: '#10B981', textAlign: 'center', marginTop: '2rem', fontWeight: 500 }}>All students are assigned.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {unassigned.map((student) => (
              <div
                key={student.id}
                onClick={() => toggleSelect(student.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1rem',
                  padding: '1rem',
                  border: `2px solid ${selectedIds.has(student.id) ? '#3B82F6' : '#E5E7EB'}`,
                  borderRadius: '6px',
                  cursor: 'pointer',
                  backgroundColor: selectedIds.has(student.id) ? '#EFF6FF' : 'white',
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(student.id)}
                  readOnly
                  style={{ width: '1.25rem', height: '1.25rem' }}
                />
                <div>
                  <div style={{ fontWeight: 600 }}>{student.name}</div>
                  <div style={{ fontSize: '0.875rem', color: '#6B7280' }}>
                    {student.rollNumber || 'No roll'} | {student.department || 'No department'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default UnassignedDrawer;
