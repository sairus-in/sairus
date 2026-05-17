import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';
import { QueryError } from '../../components/shared/QueryError';
import { Icon } from '../../components/design/Icon';
import { Countdown, PriorityChip } from '../../components/design/primitives';
import { useAuthStore } from '../../store/auth.store';
import { useIncidents } from '../../hooks/useIncidents';
import {
  useEscalateIncident,
  useNotifyAffectedUsers,
  useRequestDelegate,
} from '../../hooks/useCommandCenter';
import { QK } from '../../lib/query-keys';



type IncidentStatusFilter = 'ALL' | 'REPORTED' | 'ASSIGNED' | 'ESCALATED' | 'RESOLVED';

const FILTER_LABELS: Record<IncidentStatusFilter, string> = {
  ALL: 'All',
  REPORTED: 'Open',
  ASSIGNED: 'Ack',
  ESCALATED: 'Escalated',
  RESOLVED: 'Resolved',
};

export const Incidents: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { capabilities } = useAuthStore();
  const { data: incidents = [], isLoading, error: incidentsError, refetch } = useIncidents();
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<IncidentStatusFilter>('ALL');

  const notifyAffected = useNotifyAffectedUsers();
  const requestDelegate = useRequestDelegate();
  const escalateIncident = useEscalateIncident();

  const resolveIncident = useMutation({
    mutationFn: ({ incidentId, resolution }: { incidentId: string; resolution: string }) =>
      api.patch(`/v1/admin/incidents/${incidentId}/resolve`, { resolution }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QK.incidents() }),
        queryClient.invalidateQueries({ queryKey: QK.commandCenter() }),
        queryClient.invalidateQueries({ queryKey: QK.messages() }),
      ]);
      setResolutionNote('');
    },
  });

  const activeIncidents = useMemo(
    () => incidents.filter((incident) => incident.status === 'REPORTED' || incident.status === 'ASSIGNED'),
    [incidents],
  );

  const visibleIncidents = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return incidents.filter((incident) => {
      if (statusFilter === 'ESCALATED') {
        if (incident.escalationLevel === 'COORDINATOR') {
          return false;
        }
      } else if (statusFilter !== 'ALL' && incident.status !== statusFilter) {
        return false;
      }

      if (!q) {
        return true;
      }

      return incident.id.toLowerCase().includes(q)
        || incident.tripId.toLowerCase().includes(q)
        || incident.bus.number.toLowerCase().includes(q)
        || incident.type.toLowerCase().includes(q)
        || incident.description.toLowerCase().includes(q);
    });
  }, [incidents, searchQuery, statusFilter]);

  const selectedIncident = useMemo(
    () => visibleIncidents.find((incident) => incident.id === selectedIncidentId)
      ?? activeIncidents.find((incident) => incident.id === selectedIncidentId)
      ?? visibleIncidents[0]
      ?? activeIncidents[0]
      ?? null,
    [activeIncidents, selectedIncidentId, visibleIncidents],
  );

  useEffect(() => {
    if (!selectedIncidentId && activeIncidents[0]) {
      setSelectedIncidentId(activeIncidents[0].id);
    } else if (selectedIncidentId && !activeIncidents.some((incident) => incident.id === selectedIncidentId)) {
      setSelectedIncidentId(activeIncidents[0]?.id ?? null);
    }
  }, [activeIncidents, selectedIncidentId]);

  useEffect(() => {
    setActionError(null);
  }, [selectedIncident?.id]);





  const handleContactDriver = () => {
    if (!selectedIncident) {
      return;
    }
    navigate('/ops/messages', {
      state: {
        contextType: 'INCIDENT',
        contextId: selectedIncident.id,
        composerPrefill: `Transport office incident check: ${selectedIncident.description}. Confirm driver status, passenger safety, and recovery ETA.`,
      },
    });
  };

  const handleResolve = async () => {
    if (!selectedIncident) {
      return;
    }

    try {
      await resolveIncident.mutateAsync({
        incidentId: selectedIncident.id,
        resolution: resolutionNote || 'Resolved from incident console',
      });
    } catch (error) {
      setActionError(extractApiError(error).message);
    }
  };

  const handleEscalate = async () => {
    if (!selectedIncident) {
      return;
    }

    try {
      await escalateIncident.mutateAsync({
        incidentId: selectedIncident.id,
        note: resolutionNote || undefined,
      });
    } catch (error) {
      setActionError(extractApiError(error).message);
    }
  };

  const handleNotify = async () => {
    if (!selectedIncident) {
      return;
    }

    try {
      await notifyAffected.mutateAsync({
        tripId: selectedIncident.tripId,
        note: resolutionNote || undefined,
      });
    } catch (error) {
      setActionError(extractApiError(error).message);
    }
  };

  const handleDelegate = async () => {
    if (!selectedIncident) {
      return;
    }

    try {
      await requestDelegate.mutateAsync({
        tripId: selectedIncident.tripId,
        note: resolutionNote || undefined,
      });
    } catch (error) {
      setActionError(extractApiError(error).message);
    }
  };



  if (isLoading) {
    return <div className="muted">Scanning fleet incidents...</div>;
  }

  if (incidentsError) {
    return <QueryError message={extractApiError(incidentsError).message} onRetry={() => void refetch()} />;
  }

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      {/* Left sidebar — incident list */}
      <div style={{ width: 340, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--divider)' }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 500 }}>Incidents</h2>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{incidents.length} total</span>
          </div>
          <div className="searchbar" style={{ marginBottom: 10 }}>
            <Icon name="search" size={12} />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="ID, trip, route…"
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 13, color: 'var(--ink)' }}
            />
          </div>
          <div className="row gap-4" style={{ flexWrap: 'wrap' }}>
            {(Object.keys(FILTER_LABELS) as IncidentStatusFilter[]).map((key) => (
              <button
                key={key}
                type="button"
                className={`btn sm ${statusFilter === key ? 'primary' : ''}`}
                style={{ borderRadius: 'var(--r-pill)' }}
                onClick={() => setStatusFilter(key)}
              >
                {FILTER_LABELS[key]}
              </button>
            ))}
          </div>
        </div>
        <div className="scroll stagger" style={{ flex: 1 }}>
          {visibleIncidents.length === 0 ? (
            <div style={{ padding: 16 }} className="muted">
              {incidents.length === 0 ? 'No incidents found.' : 'No incidents match the current filters.'}
            </div>
          ) : (
            visibleIncidents.map((incident) => (
              <button
                key={incident.id}
                type="button"
                onClick={() => setSelectedIncidentId(incident.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--divider)',
                  background: selectedIncident?.id === incident.id ? 'var(--surface-2)' : 'transparent',
                  borderLeft: selectedIncident?.id === incident.id ? '2px solid var(--ink)' : '2px solid transparent',
                  transition: 'all var(--t-fast)',
                }}
              >
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                  <div className="row gap-8">
                    <PriorityChip level={incident.escalationLevel === 'PRINCIPAL' ? 'p1' : incident.escalationLevel === 'TRANSPORT_OFFICER' ? 'p2' : 'p3'} />
                    <span className="mono" style={{ fontSize: 12, fontWeight: 500 }}>{incident.id.slice(0, 12)}</span>
                  </div>
                  <Countdown seconds={Math.floor((Date.now() - new Date(incident.reportedAt).getTime()) / 1000) * -1} />
                </div>
                <div style={{ fontSize: 12.5, marginBottom: 4 }}>{incident.type.replace(/_/g, ' ')}</div>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>Bus {incident.bus.number}</span>
                  <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{incident.status}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right detail panel */}
      <div className="scroll fade-in" style={{ flex: 1, padding: 20 }} key={selectedIncident?.id ?? 'none'}>
        {selectedIncident ? (
          <>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>Incidents / {selectedIncident.id.slice(0, 12)}</div>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <div className="row gap-12">
                <PriorityChip level={selectedIncident.escalationLevel === 'PRINCIPAL' ? 'p1' : selectedIncident.escalationLevel === 'TRANSPORT_OFFICER' ? 'p2' : 'p3'} />
                <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 500 }}>{selectedIncident.type.replace(/_/g, ' ')}</h2>
              </div>
              <div className="row gap-8">
                <button className="btn" type="button" onClick={handleContactDriver} disabled={!capabilities?.canMessageDrivers}>
                  <Icon name="phone" size={12} /> Call Driver
                </button>
                <button className="btn" type="button" onClick={() => void handleDelegate()} disabled={!capabilities?.canAssignSubstitute}>Reassign</button>
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => void handleResolve()}
                  disabled={!capabilities?.canResolveIncidents || resolveIncident.isPending}
                >
                  {resolveIncident.isPending ? 'Resolving…' : 'Resolve'}
                </button>
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 18 }}>
              {selectedIncident.description} · Bus {selectedIncident.bus.number} · trip {selectedIncident.tripId.slice(0, 8)}
            </div>

            {/* KPI cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 14 }}>
              <div className="card" style={{ padding: '14px 16px' }}>
                <div className="eyebrow" style={{ marginBottom: 8 }}>Time to Critical</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 500 }}>
                  <Countdown seconds={Math.floor((Date.now() - new Date(selectedIncident.reportedAt).getTime()) / 1000) * -1} />
                </div>
              </div>
              <div className="card" style={{ padding: '14px 16px' }}>
                <div className="eyebrow" style={{ marginBottom: 8 }}>Reported By</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 500 }}>
                  {selectedIncident.reportedBy?.name ?? 'Unknown'}
                </div>
              </div>
            </div>

            {/* Lifecycle + Quick actions */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div className="card">
                <div className="card-head"><h3>Lifecycle</h3></div>
                <div style={{ padding: '12px 16px' }}>
                  {[
                    { title: 'Detected — auto-routed to dispatcher', by: 'System', t: format(new Date(selectedIncident.reportedAt), 'HH:mm:ss'), done: true },
                    { title: 'Acknowledged', by: selectedIncident.reportedBy?.name ?? 'Pending', t: format(new Date(selectedIncident.reportedAt), 'HH:mm:ss'), done: selectedIncident.status !== 'REPORTED' },
                    {
                      title: selectedIncident.escalationLevel === 'COORDINATOR' ? 'Owned by coordinator' : `Escalated to ${selectedIncident.escalationLevel.replace(/_/g, ' ').toLowerCase()}`,
                      by: '—',
                      t: '—',
                      done: selectedIncident.escalationLevel !== 'COORDINATOR' || selectedIncident.status === 'RESOLVED',
                    },
                    { title: 'Resolved', by: '—', t: '—', done: selectedIncident.status === 'RESOLVED' },
                  ].map((step, i, arr) => (
                    <div key={step.title} style={{ display: 'flex', gap: 12, paddingBottom: i < arr.length - 1 ? 14 : 0 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div style={{
                          width: 10, height: 10, borderRadius: 2, transform: 'rotate(45deg)',
                          background: step.done ? 'var(--ink)' : 'transparent',
                          border: step.done ? 'none' : '1.5px solid var(--border-3)',
                          marginTop: 4,
                        }} />
                        {i < arr.length - 1 && <div style={{ width: 1, flex: 1, background: 'var(--divider)', marginTop: 2 }} />}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12.5 }}>{step.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{step.by}</div>
                      </div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{step.t}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <div className="card-head"><h3>Quick actions</h3></div>
                <div style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                    <button className="btn" type="button" onClick={handleContactDriver} disabled={!capabilities?.canMessageDrivers}><Icon name="phone" size={12} /> Call driver</button>
                    <button className="btn" type="button" onClick={() => void handleDelegate()} disabled={!capabilities?.canAssignSubstitute}><Icon name="radio" size={12} /> Radio dispatch</button>
                    <button className="btn" type="button" onClick={() => void handleNotify()} disabled={!capabilities?.canMessageDrivers}><Icon name="comms" size={12} /> Notify riders</button>
                    <button className="btn" type="button" onClick={() => void handleEscalate()} disabled={!capabilities?.canEscalateIncidents}><Icon name="alert" size={12} /> Escalate to L2</button>
                  </div>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>Notes</div>
                  <textarea
                    value={resolutionNote}
                    onChange={(event) => setResolutionNote(event.target.value)}
                    placeholder="Add an internal note…"
                    style={{
                      width: '100%', minHeight: 70, padding: 10,
                      border: '1px solid var(--border-2)', borderRadius: 'var(--r-md)',
                      background: 'var(--surface-2)', resize: 'vertical', outline: 'none',
                      fontFamily: 'inherit', fontSize: 12,
                    }}
                  />
                  {actionError ? <div className="pill pill--err" style={{ marginTop: 8, width: 'fit-content', textTransform: 'none', fontSize: 12 }}>{actionError}</div> : null}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="muted" style={{ padding: 20 }}>No active incidents to triage.</div>
        )}
      </div>
    </div>
  );
};

export default Incidents;
