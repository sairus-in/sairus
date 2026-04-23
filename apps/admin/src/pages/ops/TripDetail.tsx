import React, { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { AdminIncident, AdminMessageInput } from 'shared';
import { useTripLive, useTripStudents, useTripTimeline } from '../../hooks/useTripDetail';
import { StatusBadge, type StatusKey } from '../../lib/status';
import { AlertTriangle, ArrowLeft, Bus, Clock, MessageSquare, Radio, Users } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';
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
  borderRadius: '0.75rem',
  border: '1px solid #374151',
  padding: '1rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
};

const incidentStatusToBadge = (status: AdminIncident['status']): StatusKey => {
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

export const TripDetail: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { capabilities } = useAuthStore();

  const { data: tripLive, isLoading: isLiveLoading, error: tripLiveError } = useTripLive(id);
  const { data: students = [], isLoading: isStudentsLoading, error: studentsError } = useTripStudents(id);
  const { data: timeline = [], isLoading: isTimelineLoading, error: timelineError } = useTripTimeline(id);
  const { data: incidents = [], isLoading: isIncidentsLoading, error: incidentsError } = useIncidents();

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

  const coordinatorOverride = useMutation({
    mutationFn: (tripId: string) => api.post(`/v1/admin/ops/gps-outages/${tripId}/coordinator-override`),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['live', 'command-center'] }),
        queryClient.invalidateQueries({ queryKey: ['ops', 'gps-outages'] }),
        queryClient.invalidateQueries({ queryKey: ['trip-students', id] }),
      ]);
    },
  });

  const activeIncident = useMemo(
    () => incidents.find((incident) => incident.tripId === id && (incident.status === 'REPORTED' || incident.status === 'ASSIGNED')) ?? null,
    [id, incidents],
  );

  const threadContext = activeIncident
    ? {
        contextType: 'INCIDENT' as const,
        contextId: activeIncident.id,
        incidentId: activeIncident.id,
        tripId: id,
        busId: activeIncident.busId,
        routeId: activeIncident.trip.routeId,
        title: `Incident - Bus ${activeIncident.bus.number}`,
        subtitle: activeIncident.description,
      }
    : {
        contextType: 'TRIP' as const,
        contextId: id,
        tripId: id,
        busId: tripLive?.busId,
        title: tripLive ? `Trip ${tripLive.routeName}` : 'Trip thread',
        subtitle: tripLive ? `Bus ${tripLive.busNumber}` : undefined,
      };

  const { data: threadMessages = [] } = useMessages(tripLive?.busId, 50, threadContext);
  const { data: substituteCandidates = [] } = useSubstituteCandidates(id);

  const handleSendMessage = async () => {
    if (!composer.trim()) {
      return;
    }

    try {
      const payload: AdminMessageInput = {
        body: composer.trim(),
        priority: activeIncident ? 'URGENT' : 'NORMAL',
        context: threadContext,
      };

      await sendContextMessage.mutateAsync(payload);
      setComposer('');
    } catch (error) {
      setActionError(extractApiError(error).message);
    }
  };

  const handleNotify = async () => {
    try {
      await notifyAffected.mutateAsync({ tripId: id, note: composer || undefined });
      setComposer('');
    } catch (error) {
      setActionError(extractApiError(error).message);
    }
  };

  const handleRequestDelegate = async () => {
    try {
      await requestDelegate.mutateAsync({ tripId: id, note: composer || resolutionNote || undefined });
    } catch (error) {
      setActionError(extractApiError(error).message);
    }
  };

  const handleResolve = async () => {
    if (!activeIncident) {
      return;
    }

    try {
      await resolveIncident.mutateAsync({
        incidentId: activeIncident.id,
        resolution: resolutionNote || 'Resolved from trip command panel',
      });
    } catch (error) {
      setActionError(extractApiError(error).message);
    }
  };

  const handleEscalate = async () => {
    if (!activeIncident) {
      return;
    }

    try {
      await escalateIncident.mutateAsync({
        incidentId: activeIncident.id,
        note: resolutionNote || composer || undefined,
      });
    } catch (error) {
      setActionError(extractApiError(error).message);
    }
  };

  const handleAssignSubstitute = async () => {
    if (!activeIncident || !selectedAlternateBusId) {
      setActionError('Select a substitute bus before assigning.');
      return;
    }

    try {
      await assignSubstitute.mutateAsync({
        incidentId: activeIncident.id,
        alternateBusId: selectedAlternateBusId,
      });
      setSelectedAlternateBusId('');
    } catch (error) {
      setActionError(extractApiError(error).message);
    }
  };

  const handleCoordinatorOverride = async () => {
    try {
      await coordinatorOverride.mutateAsync(id);
    } catch (error) {
      setActionError(extractApiError(error).message);
    }
  };

  if (isLiveLoading || isStudentsLoading || isTimelineLoading || isIncidentsLoading) {
    return <div style={{ color: '#9CA3AF' }}>Loading live trip data...</div>;
  }

  if (tripLiveError) {
    return (
      <div style={{ padding: '1rem', borderRadius: '0.75rem', background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}>
        {extractApiError(tripLiveError).message}
      </div>
    );
  }

  if (!tripLive) {
    return <div style={{ color: '#EF4444' }}>Trip {id} is not currently active.</div>;
  }

  const secondaryError = studentsError || timelineError || incidentsError;
  const secondaryErrorMessage = secondaryError ? extractApiError(secondaryError).message : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <button
          onClick={() => navigate('/ops/dashboard')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'transparent', border: 'none', color: '#9CA3AF', cursor: 'pointer', padding: 0, marginBottom: '1rem' }}
          className="hover:text-white"
        >
          <ArrowLeft size={16} /> Back to Dashboard
        </button>

      {secondaryErrorMessage && (
        <div style={{ padding: '0.9rem 1rem', borderRadius: 14, background: 'rgba(127, 29, 29, 0.45)', border: '1px solid rgba(248, 113, 113, 0.35)', color: '#FCA5A5' }}>
          {secondaryErrorMessage}
        </div>
      )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
          <div>
            <div style={{ fontSize: '0.78rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#38BDF8', fontWeight: 800 }}>
              Trip Command
            </div>
            <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold', margin: '0.35rem 0 0.5rem 0' }}>
              Bus {tripLive.busNumber} - {tripLive.routeName}
            </h1>
            <p style={{ margin: 0, color: '#9CA3AF' }}>
              Driver: {tripLive.driverName || 'Unknown'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            {activeIncident && <StatusBadge status={incidentStatusToBadge(activeIncident.status)} />}
            <StatusBadge status={tripLive.gpsStatus === 'OFFLINE' ? 'GPS_OFFLINE' : tripLive.gpsStatus === 'STALE' ? 'GPS_STALE' : 'GPS_LIVE'} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '2rem', marginTop: '1.5rem', color: '#E5E7EB', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Users size={18} color="#9CA3AF" />
            <span style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>{tripLive.boardedCount}</span>
            <span style={{ color: '#9CA3AF' }}>/ {tripLive.expectedCount} boarded</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Clock size={18} color="#9CA3AF" />
            <span>Started {formatDistanceToNow(new Date(tripLive.startedAt))} ago</span>
          </div>
          {activeIncident && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertTriangle size={18} color="#EF4444" />
              <span>{activeIncident.type.replace(/_/g, ' ')} active</span>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) 360px', gap: '1rem', alignItems: 'start' }}>
        <div style={{ ...panelStyle, gap: '0.85rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>Command panel</h2>
              <div style={{ marginTop: '0.25rem', color: '#94A3B8', fontSize: '0.82rem' }}>
                Act on this trip directly, with comms bound to the trip or current incident.
              </div>
            </div>
            <Radio size={18} color="#60A5FA" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={() => setComposer(`Transport office check-in: confirm trip status, location, and ETA for Bus ${tripLive.busNumber}.`)}
              disabled={!capabilities?.canMessageDrivers}
              style={{ border: 0, borderRadius: 14, background: capabilities?.canMessageDrivers ? '#0EA5E9' : '#334155', color: '#FFFFFF', padding: '0.9rem', fontWeight: 700, cursor: capabilities?.canMessageDrivers ? 'pointer' : 'not-allowed' }}
            >
              Contact driver
            </button>
            <button
              type="button"
              onClick={() => void handleNotify()}
              disabled={!capabilities?.canMessageDrivers}
              style={{ border: '1px solid #334155', borderRadius: 14, background: capabilities?.canMessageDrivers ? '#1E293B' : '#0F172A', color: capabilities?.canMessageDrivers ? '#F8FAFC' : '#64748B', padding: '0.9rem', fontWeight: 700, cursor: capabilities?.canMessageDrivers ? 'pointer' : 'not-allowed' }}
            >
              Notify riders
            </button>
            <button
              type="button"
              onClick={() => void handleRequestDelegate()}
              disabled={!capabilities?.canAssignSubstitute}
              style={{ border: '1px solid #334155', borderRadius: 14, background: capabilities?.canAssignSubstitute ? '#1E293B' : '#0F172A', color: capabilities?.canAssignSubstitute ? '#F8FAFC' : '#64748B', padding: '0.9rem', fontWeight: 700, cursor: capabilities?.canAssignSubstitute ? 'pointer' : 'not-allowed' }}
            >
              Request delegate
            </button>
            <button
              type="button"
              onClick={() => void handleCoordinatorOverride()}
              disabled={!capabilities?.canCoordinatorOverride || tripLive.gpsStatus !== 'OFFLINE'}
              style={{ border: 0, borderRadius: 14, background: capabilities?.canCoordinatorOverride && tripLive.gpsStatus === 'OFFLINE' ? '#F97316' : '#334155', color: '#FFFFFF', padding: '0.9rem', fontWeight: 700, cursor: capabilities?.canCoordinatorOverride && tripLive.gpsStatus === 'OFFLINE' ? 'pointer' : 'not-allowed' }}
            >
              GPS override
            </button>
            <button
              type="button"
              onClick={() => void handleEscalate()}
              disabled={!capabilities?.canEscalateIncidents || !activeIncident}
              style={{ border: 0, borderRadius: 14, background: capabilities?.canEscalateIncidents && activeIncident ? '#E11D48' : '#334155', color: '#FFFFFF', padding: '0.9rem', fontWeight: 700, cursor: capabilities?.canEscalateIncidents && activeIncident ? 'pointer' : 'not-allowed' }}
            >
              Escalate incident
            </button>
            <button
              type="button"
              onClick={() => void handleResolve()}
              disabled={!capabilities?.canResolveIncidents || !activeIncident}
              style={{ border: 0, borderRadius: 14, background: capabilities?.canResolveIncidents && activeIncident ? '#22C55E' : '#334155', color: '#FFFFFF', padding: '0.9rem', fontWeight: 700, cursor: capabilities?.canResolveIncidents && activeIncident ? 'pointer' : 'not-allowed' }}
            >
              Resolve incident
            </button>
          </div>

          {activeIncident && (
            <div style={{ borderRadius: 16, background: '#0F172A', border: '1px solid #334155', padding: '0.95rem', display: 'grid', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#F8FAFC', fontWeight: 700 }}>
                <Bus size={18} />
                Substitute workflow
              </div>
              <select
                value={selectedAlternateBusId}
                onChange={(event) => setSelectedAlternateBusId(event.target.value)}
                disabled={!capabilities?.canAssignSubstitute}
                style={{ width: '100%', borderRadius: 12, border: '1px solid #334155', background: '#020617', color: '#F8FAFC', padding: '0.75rem 0.8rem' }}
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
                style={{ border: 0, borderRadius: 14, background: capabilities?.canAssignSubstitute ? '#7C3AED' : '#334155', color: '#FFFFFF', padding: '0.85rem 1rem', fontWeight: 700, cursor: capabilities?.canAssignSubstitute ? 'pointer' : 'not-allowed' }}
              >
                Assign substitute
              </button>
            </div>
          )}

          <div style={{ display: 'grid', gap: '0.6rem' }}>
            <label style={{ color: '#CBD5E1', fontSize: '0.84rem', fontWeight: 700 }}>Operational note</label>
            <textarea
              value={resolutionNote}
              onChange={(event) => setResolutionNote(event.target.value)}
              rows={4}
              placeholder="Document the recovery path, escalation rationale, or incident resolution."
              style={{ resize: 'vertical', borderRadius: 16, border: '1px solid #334155', background: '#020617', color: '#F8FAFC', padding: '0.85rem 0.9rem' }}
            />
          </div>

          {actionError && (
            <div style={{ borderRadius: 14, background: 'rgba(127, 29, 29, 0.45)', border: '1px solid rgba(248, 113, 113, 0.35)', color: '#FCA5A5', padding: '0.85rem 0.95rem' }}>
              {actionError}
            </div>
          )}
        </div>

        <div style={{ ...panelStyle }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>Action comms</h2>
            <div style={{ marginTop: '0.25rem', color: '#94A3B8', fontSize: '0.82rem' }}>
              {activeIncident ? 'INCIDENT thread attached to this trip' : 'TRIP thread'}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column-reverse', gap: '0.75rem', minHeight: 220 }}>
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
              placeholder={capabilities?.canMessageDrivers ? 'Send a trip-level operational update...' : 'Read-only for your role'}
              disabled={!capabilities?.canMessageDrivers}
              style={{ resize: 'vertical', borderRadius: 16, border: '1px solid #334155', background: '#020617', color: '#F8FAFC', padding: '0.85rem 0.9rem' }}
            />
            <button
              type="button"
              onClick={() => void handleSendMessage()}
              disabled={!capabilities?.canMessageDrivers || !composer.trim()}
              style={{ border: 0, borderRadius: 14, background: !capabilities?.canMessageDrivers || !composer.trim() ? '#334155' : '#0EA5E9', color: '#FFFFFF', padding: '0.9rem 1rem', fontWeight: 800, cursor: !capabilities?.canMessageDrivers || !composer.trim() ? 'not-allowed' : 'pointer' }}
            >
              Send contextual update
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem', alignItems: 'start' }}>
        <div style={panelStyle}>
          <div style={{ paddingBottom: '0.25rem', borderBottom: '1px solid #374151' }}>
            <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: '600' }}>Student Manifest ({students.length})</h2>
          </div>

          <div>
            {isStudentsLoading ? (
              <div style={{ padding: '2rem 0', color: '#9CA3AF' }}>Loading manifest...</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ color: '#9CA3AF', borderBottom: '1px solid #374151' }}>
                    <th style={{ padding: '1rem 0', fontWeight: '500' }}>Student</th>
                    <th style={{ padding: '1rem 0', fontWeight: '500' }}>Roll No.</th>
                    <th style={{ padding: '1rem 0', fontWeight: '500' }}>Status</th>
                    <th style={{ padding: '1rem 0', fontWeight: '500', textAlign: 'right' }}>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => (
                    <tr key={student.id} style={{ borderBottom: '1px solid #374151' }}>
                      <td style={{ padding: '1rem 0', color: 'white', fontWeight: '500' }}>{student.user.name}</td>
                      <td style={{ padding: '1rem 0', color: '#9CA3AF' }}>{student.user.rollNumber || '--'}</td>
                      <td style={{ padding: '1rem 0' }}>
                        <StatusBadge status={student.status} />
                      </td>
                      <td style={{ padding: '1rem 0', textAlign: 'right', color: '#9CA3AF' }}>
                        {student.checkedInAt ? format(new Date(student.checkedInAt), 'h:mm a') : '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div style={panelStyle}>
          <div style={{ paddingBottom: '0.25rem', borderBottom: '1px solid #374151', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: '600' }}>Event Timeline</h2>
            <MessageSquare size={18} color="#60A5FA" />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {isTimelineLoading ? (
              <div style={{ color: '#9CA3AF' }}>Loading events...</div>
            ) : timeline.length === 0 ? (
              <div style={{ color: '#9CA3AF', fontSize: '0.875rem' }}>No events recorded for this trip yet.</div>
            ) : (
              timeline.map((event, index) => (
                <div key={event.id} style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#60A5FA', marginTop: '4px' }}></div>
                    {index < timeline.length - 1 && <div style={{ width: '2px', flex: 1, backgroundColor: '#374151', marginTop: '4px' }}></div>}
                  </div>
                  <div>
                    <div style={{ fontSize: '0.875rem', fontWeight: '500', color: 'white' }}>{event.message}</div>
                    <div style={{ fontSize: '0.75rem', color: '#9CA3AF', marginTop: '0.25rem' }}>
                      {format(new Date(event.timestamp), 'h:mm a')} - {event.actor}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TripDetail;
