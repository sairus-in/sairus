import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AdminMessageInput } from 'shared';
import { AlertCircle, AlertTriangle, ArrowRight, Bus, MessageSquare, Siren } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';
import { QueryError } from '../../components/shared/QueryError';
import { StatusBadge, type StatusKey } from '../../lib/status';
import { useAuthStore } from '../../store/auth.store';
import { useIncidents } from '../../hooks/useIncidents';
import {
  useAssignSubstitute,
  useEscalateIncident,
  useNotifyAffectedUsers,
  useRequestDelegate,
  useSendContextMessage,
  useSubstituteCandidates,
} from '../../hooks/useCommandCenter';
import { useMessages } from '../../hooks/useMessages';

const panelStyle: React.CSSProperties = {
  background: '#111827',
  border: '1px solid #1F2937',
  borderRadius: 20,
  padding: '1rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
  minHeight: 0,
};

const severityColor = (status: string) => {
  if (status === 'ASSIGNED') {
    return '#F59E0B';
  }

  return '#EF4444';
};

const incidentStatusToBadge = (status: 'REPORTED' | 'ASSIGNED' | 'RESOLVED' | 'CANCELLED'): StatusKey => {
  switch (status) {
    case 'REPORTED':
      return 'INCIDENT_ACTIVE';
    case 'ASSIGNED':
      return 'INCIDENT_ASSIGNED';
    case 'RESOLVED':
      return 'INCIDENT_RESOLVED';
    case 'CANCELLED':
      return 'OFFLINE';
    default:
      return 'INCIDENT_ACTIVE';
  }
};

export const Incidents: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { capabilities } = useAuthStore();
  const { data: incidents = [], isLoading, error: incidentsError, refetch } = useIncidents();
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [composer, setComposer] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [selectedAlternateBusId, setSelectedAlternateBusId] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const notifyAffected = useNotifyAffectedUsers();
  const requestDelegate = useRequestDelegate();
  const escalateIncident = useEscalateIncident();
  const assignSubstitute = useAssignSubstitute();
  const sendContextMessage = useSendContextMessage();

  const resolveIncident = useMutation({
    mutationFn: ({ incidentId, resolution }: { incidentId: string; resolution: string }) =>
      api.patch(`/v1/admin/incidents/${incidentId}/resolve`, { resolution }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'incidents'] }),
        queryClient.invalidateQueries({ queryKey: ['live', 'command-center'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'messages'] }),
      ]);
      setResolutionNote('');
    },
  });

  const activeIncidents = useMemo(
    () => incidents.filter((incident) => incident.status === 'REPORTED' || incident.status === 'ASSIGNED'),
    [incidents],
  );

  const selectedIncident = useMemo(
    () => activeIncidents.find((incident) => incident.id === selectedIncidentId) ?? activeIncidents[0] ?? null,
    [activeIncidents, selectedIncidentId],
  );

  useEffect(() => {
    if (!selectedIncidentId && activeIncidents[0]) {
      setSelectedIncidentId(activeIncidents[0].id);
    } else if (selectedIncidentId && !activeIncidents.some((incident) => incident.id === selectedIncidentId)) {
      setSelectedIncidentId(activeIncidents[0]?.id ?? null);
    }
  }, [activeIncidents, selectedIncidentId]);

  useEffect(() => {
    setSelectedAlternateBusId('');
    setActionError(null);
  }, [selectedIncident?.id]);

  const { data: threadMessages = [] } = useMessages(
    selectedIncident?.busId,
    50,
    selectedIncident ? { contextType: 'INCIDENT', contextId: selectedIncident.id } : undefined,
  );
  const { data: substituteCandidates = [] } = useSubstituteCandidates(selectedIncident?.tripId);

  const threadContext = selectedIncident
    ? {
        contextType: 'INCIDENT' as const,
        contextId: selectedIncident.id,
        incidentId: selectedIncident.id,
        tripId: selectedIncident.tripId,
        busId: selectedIncident.busId,
        routeId: selectedIncident.trip.routeId,
        title: `${selectedIncident.type.replace(/_/g, ' ')} - Bus ${selectedIncident.bus.number}`,
        subtitle: selectedIncident.description,
      }
    : undefined;

  const sendThreadMessage = async () => {
    if (!selectedIncident || !composer.trim()) {
      return;
    }

    try {
      const payload: AdminMessageInput = {
        body: composer.trim(),
        priority: 'URGENT',
        context: threadContext,
      };

      await sendContextMessage.mutateAsync(payload);
      setComposer('');
    } catch (error) {
      setActionError(extractApiError(error).message);
    }
  };

  const handleContactDriver = () => {
    if (!selectedIncident) {
      return;
    }

    setComposer(`Transport office incident check: ${selectedIncident.description}. Confirm driver status, passenger safety, and recovery ETA.`);
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
        note: resolutionNote || composer || undefined,
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
        note: composer || undefined,
      });
      setComposer('');
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
        note: composer || resolutionNote || undefined,
      });
    } catch (error) {
      setActionError(extractApiError(error).message);
    }
  };

  const handleAssignSubstitute = async () => {
    if (!selectedIncident || !selectedAlternateBusId) {
      setActionError('Select a substitute bus before assigning.');
      return;
    }

    try {
      await assignSubstitute.mutateAsync({
        incidentId: selectedIncident.id,
        alternateBusId: selectedAlternateBusId,
      });
      setSelectedAlternateBusId('');
    } catch (error) {
      setActionError(extractApiError(error).message);
    }
  };

  if (isLoading) {
    return <div style={{ color: '#9CA3AF' }}>Scanning fleet incidents...</div>;
  }

  if (incidentsError) {
    return <QueryError message={extractApiError(incidentsError).message} onRetry={() => void refetch()} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
        <div>
          <div style={{ fontSize: '0.78rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#FCA5A5', fontWeight: 800 }}>
            Incident Control
          </div>
          <h1 style={{ fontSize: '1.9rem', fontWeight: 800, margin: '0.35rem 0 0' }}>Live incident response</h1>
          <p style={{ margin: '0.55rem 0 0', color: '#9CA3AF', maxWidth: 760 }}>
            Resolve, escalate, substitute, and communicate without leaving the incident surface.
          </p>
        </div>

        <div style={{ ...panelStyle, padding: '0.95rem 1rem', minWidth: 220 }}>
          <div style={{ fontSize: '0.8rem', color: '#9CA3AF' }}>Active incidents</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#FFFFFF' }}>{activeIncidents.length}</div>
          <div style={{ color: '#CBD5E1', fontSize: '0.82rem' }}>
            {activeIncidents.filter((incident) => incident.status === 'ASSIGNED').length} assigned for recovery
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px minmax(420px, 1fr) 360px', gap: '1rem', minHeight: 0, flex: 1 }}>
        <section style={{ ...panelStyle, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: '#F8FAFC', fontWeight: 700 }}>Priority queue</div>
              <div style={{ color: '#64748B', fontSize: '0.8rem' }}>Newest active incidents first</div>
            </div>
            <Siren size={18} color="#F87171" />
          </div>

          <div style={{ display: 'grid', gap: '0.75rem', overflowY: 'auto' }}>
            {activeIncidents.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#9CA3AF' }}>
                <AlertCircle size={28} style={{ margin: '0 auto 0.75rem' }} />
                No active incidents. Fleet status is nominal.
              </div>
            ) : (
              activeIncidents.map((incident) => (
                <button
                  key={incident.id}
                  type="button"
                  onClick={() => setSelectedIncidentId(incident.id)}
                  style={{
                    textAlign: 'left',
                    borderRadius: 18,
                    border: `1px solid ${selectedIncident?.id === incident.id ? severityColor(incident.status) : '#1F2937'}`,
                    background: selectedIncident?.id === incident.id ? 'rgba(30, 41, 59, 0.95)' : '#0F172A',
                    padding: '0.95rem',
                    color: '#F8FAFC',
                    cursor: 'pointer',
                    display: 'grid',
                    gap: '0.6rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <div>
                      <div style={{ color: severityColor(incident.status), fontWeight: 800, fontSize: '0.74rem', letterSpacing: '0.08em' }}>
                        {incident.status}
                      </div>
                      <div style={{ marginTop: '0.3rem', fontWeight: 700 }}>
                        {incident.type.replace(/_/g, ' ')}
                      </div>
                    </div>
                    <StatusBadge status={incidentStatusToBadge(incident.status)} />
                  </div>

                  <div style={{ color: '#CBD5E1', fontSize: '0.88rem', lineHeight: 1.45 }}>{incident.description}</div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', color: '#94A3B8', fontSize: '0.76rem' }}>
                    <span>Bus {incident.bus.number}</span>
                    <span>{formatDistanceToNow(new Date(incident.reportedAt))} ago</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        <section style={{ ...panelStyle, overflowY: 'auto' }}>
          {selectedIncident ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ color: severityColor(selectedIncident.status), fontSize: '0.74rem', fontWeight: 800, letterSpacing: '0.08em' }}>
                    {selectedIncident.type.replace(/_/g, ' ')}
                  </div>
                  <h2 style={{ margin: '0.35rem 0 0', color: '#FFFFFF' }}>
                    Bus {selectedIncident.bus.number} incident
                  </h2>
                  <p style={{ margin: '0.55rem 0 0', color: '#CBD5E1', lineHeight: 1.6 }}>{selectedIncident.description}</p>
                </div>
                <StatusBadge status={incidentStatusToBadge(selectedIncident.status)} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
                <div style={{ borderRadius: 16, background: '#0F172A', border: '1px solid #1E293B', padding: '0.9rem' }}>
                  <div style={{ color: '#64748B', fontSize: '0.76rem', textTransform: 'uppercase' }}>Trip</div>
                  <div style={{ marginTop: '0.3rem', color: '#F8FAFC', fontWeight: 700 }}>{selectedIncident.tripId}</div>
                  <div style={{ marginTop: '0.25rem', color: '#94A3B8', fontSize: '0.82rem' }}>Route {selectedIncident.trip.routeId}</div>
                </div>
                <div style={{ borderRadius: 16, background: '#0F172A', border: '1px solid #1E293B', padding: '0.9rem' }}>
                  <div style={{ color: '#64748B', fontSize: '0.76rem', textTransform: 'uppercase' }}>Reported by</div>
                  <div style={{ marginTop: '0.3rem', color: '#F8FAFC', fontWeight: 700 }}>{selectedIncident.reportedBy.name}</div>
                  <div style={{ marginTop: '0.25rem', color: '#94A3B8', fontSize: '0.82rem' }}>{selectedIncident.reportedBy.role}</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => navigate(`/ops/trips/${selectedIncident.tripId}`)}
                  style={{ border: '1px solid #334155', borderRadius: 16, background: '#1E293B', color: '#F8FAFC', padding: '0.9rem 1rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  Open trip
                </button>
                <button
                  type="button"
                  onClick={handleContactDriver}
                  disabled={!capabilities?.canMessageDrivers}
                  style={{
                    border: 0,
                    borderRadius: 16,
                    background: capabilities?.canMessageDrivers ? '#0EA5E9' : '#334155',
                    color: '#FFFFFF',
                    padding: '0.9rem 1rem',
                    fontWeight: 700,
                    cursor: capabilities?.canMessageDrivers ? 'pointer' : 'not-allowed',
                  }}
                >
                  Contact driver
                </button>
                <button
                  type="button"
                  onClick={() => void handleNotify()}
                  disabled={!capabilities?.canMessageDrivers}
                  style={{
                    border: '1px solid #334155',
                    borderRadius: 16,
                    background: capabilities?.canMessageDrivers ? '#1E293B' : '#0F172A',
                    color: capabilities?.canMessageDrivers ? '#F8FAFC' : '#64748B',
                    padding: '0.9rem 1rem',
                    fontWeight: 700,
                    cursor: capabilities?.canMessageDrivers ? 'pointer' : 'not-allowed',
                  }}
                >
                  Notify affected users
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelegate()}
                  disabled={!capabilities?.canAssignSubstitute}
                  style={{
                    border: '1px solid #334155',
                    borderRadius: 16,
                    background: capabilities?.canAssignSubstitute ? '#1E293B' : '#0F172A',
                    color: capabilities?.canAssignSubstitute ? '#F8FAFC' : '#64748B',
                    padding: '0.9rem 1rem',
                    fontWeight: 700,
                    cursor: capabilities?.canAssignSubstitute ? 'pointer' : 'not-allowed',
                  }}
                >
                  Request delegate
                </button>
                <button
                  type="button"
                  onClick={() => void handleEscalate()}
                  disabled={!capabilities?.canEscalateIncidents}
                  style={{
                    border: 0,
                    borderRadius: 16,
                    background: capabilities?.canEscalateIncidents ? '#F97316' : '#334155',
                    color: '#FFFFFF',
                    padding: '0.9rem 1rem',
                    fontWeight: 700,
                    cursor: capabilities?.canEscalateIncidents ? 'pointer' : 'not-allowed',
                  }}
                >
                  Escalate
                </button>
                <button
                  type="button"
                  onClick={() => void handleResolve()}
                  disabled={!capabilities?.canResolveIncidents}
                  style={{
                    border: 0,
                    borderRadius: 16,
                    background: capabilities?.canResolveIncidents ? '#22C55E' : '#334155',
                    color: '#FFFFFF',
                    padding: '0.9rem 1rem',
                    fontWeight: 700,
                    cursor: capabilities?.canResolveIncidents ? 'pointer' : 'not-allowed',
                  }}
                >
                  Resolve incident
                </button>
              </div>

              <div style={{ borderRadius: 18, border: '1px solid #334155', padding: '0.95rem', background: '#0F172A', display: 'grid', gap: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#F8FAFC', fontWeight: 700 }}>
                  <Bus size={18} />
                  Substitute assignment
                </div>
                <select
                  value={selectedAlternateBusId}
                  onChange={(event) => setSelectedAlternateBusId(event.target.value)}
                  disabled={!capabilities?.canAssignSubstitute}
                  style={{ width: '100%', borderRadius: 14, border: '1px solid #334155', background: '#020617', color: '#F8FAFC', padding: '0.75rem 0.8rem' }}
                >
                  <option value="">Select alternate bus</option>
                  {substituteCandidates.map((candidate) => (
                    <option key={candidate.busId} value={candidate.busId}>
                      Bus {candidate.busNumber} | {candidate.driverName || 'No driver'} {candidate.isCurrentlyActive ? '| busy' : '| standby'}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void handleAssignSubstitute()}
                  disabled={!capabilities?.canAssignSubstitute}
                  style={{
                    border: 0,
                    borderRadius: 14,
                    background: capabilities?.canAssignSubstitute ? '#E11D48' : '#334155',
                    color: '#FFFFFF',
                    padding: '0.85rem 1rem',
                    fontWeight: 700,
                    cursor: capabilities?.canAssignSubstitute ? 'pointer' : 'not-allowed',
                  }}
                >
                  Assign substitute
                </button>
              </div>

              <div style={{ display: 'grid', gap: '0.6rem' }}>
                <label style={{ color: '#CBD5E1', fontSize: '0.84rem', fontWeight: 700 }}>Resolution or escalation note</label>
                <textarea
                  value={resolutionNote}
                  onChange={(event) => setResolutionNote(event.target.value)}
                  rows={4}
                  placeholder="Document the operational decision, recovery path, or escalation context."
                  style={{ resize: 'vertical', borderRadius: 16, border: '1px solid #334155', background: '#020617', color: '#F8FAFC', padding: '0.85rem 0.9rem' }}
                />
              </div>

              {actionError && (
                <div style={{ borderRadius: 14, background: 'rgba(127, 29, 29, 0.45)', border: '1px solid rgba(248, 113, 113, 0.35)', color: '#FCA5A5', padding: '0.85rem 0.95rem' }}>
                  {actionError}
                </div>
              )}
            </>
          ) : (
            <div style={{ color: '#9CA3AF' }}>No active incidents to triage.</div>
          )}
        </section>

        <section style={{ ...panelStyle, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: '#F8FAFC', fontWeight: 700 }}>Incident comms</div>
              <div style={{ color: '#64748B', fontSize: '0.8rem' }}>
                {selectedIncident ? `INCIDENT thread for Bus ${selectedIncident.bus.number}` : 'No incident selected'}
              </div>
            </div>
            <MessageSquare size={18} color="#38BDF8" />
          </div>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column-reverse', gap: '0.75rem' }}>
            {threadMessages.length === 0 ? (
              <div style={{ color: '#94A3B8', fontSize: '0.86rem' }}>No contextual messages yet.</div>
            ) : (
              threadMessages.map((message) => (
                <div key={message.id} style={{ borderRadius: 16, background: '#0F172A', border: '1px solid #1E293B', padding: '0.85rem 0.9rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', color: '#94A3B8', fontSize: '0.74rem' }}>
                    <span>{message.sender.name} ({message.sender.role})</span>
                    <span>{formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}</span>
                  </div>
                  <div style={{ marginTop: '0.45rem', color: '#F8FAFC', lineHeight: 1.5 }}>{message.body}</div>
                </div>
              ))
            )}
          </div>

          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <textarea
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              rows={4}
              placeholder={capabilities?.canMessageDrivers ? 'Send a contextual update for this incident...' : 'Read-only for your role'}
              disabled={!capabilities?.canMessageDrivers}
              style={{ resize: 'vertical', borderRadius: 16, border: '1px solid #334155', background: '#020617', color: '#F8FAFC', padding: '0.85rem 0.9rem' }}
            />
            <button
              type="button"
              onClick={() => void sendThreadMessage()}
              disabled={!capabilities?.canMessageDrivers || !composer.trim()}
              style={{
                border: 0,
                borderRadius: 14,
                background: !capabilities?.canMessageDrivers || !composer.trim() ? '#334155' : '#0EA5E9',
                color: '#FFFFFF',
                padding: '0.9rem 1rem',
                fontWeight: 800,
                cursor: !capabilities?.canMessageDrivers || !composer.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              Send contextual update
            </button>
          </div>
        </section>
      </div>

      {selectedIncident && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', borderRadius: 18, background: '#0F172A', border: '1px solid #1F2937', padding: '0.95rem 1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#CBD5E1' }}>
            <AlertTriangle size={18} color={severityColor(selectedIncident.status)} />
            <span>
              Incident on Bus {selectedIncident.bus.number} has been active for {formatDistanceToNow(new Date(selectedIncident.reportedAt))}.
            </span>
          </div>
          <button
            type="button"
            onClick={() => navigate(`/ops/trips/${selectedIncident.tripId}`)}
            style={{ border: 0, borderRadius: 14, background: '#1E40AF', color: '#FFFFFF', padding: '0.8rem 0.95rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer' }}
          >
            Jump to trip <ArrowRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
};

export default Incidents;
