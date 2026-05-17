import React, { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { AdminMessageInput } from 'shared';
import { useTripLive, useTripStudents, useTripTimeline } from '../../hooks/useTripDetail';
import { Icon } from '../../components/design/Icon';
import { StateBadge } from '../../components/design/primitives';
import { format, formatDistanceToNow } from 'date-fns';
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
    () =>
      incidents.find(
        (incident) => incident.tripId === id && (incident.status === 'REPORTED' || incident.status === 'ASSIGNED'),
      ) ?? null,
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
    if (!composer.trim()) return;
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
    if (!activeIncident) return;
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
    if (!activeIncident) return;
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
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 4 }}>
        <div className="skel" style={{ height: 28, width: 240, borderRadius: 8 }} />
        <div className="skel" style={{ height: 80, borderRadius: 12 }} />
        <div className="skel" style={{ height: 180, borderRadius: 12 }} />
      </div>
    );
  }

  if (tripLiveError) {
    return (
      <div className="card" style={{ padding: '14px 16px', borderColor: 'var(--err)', background: 'var(--err-soft)', color: 'var(--err)' }}>
        {extractApiError(tripLiveError).message}
      </div>
    );
  }

  if (!tripLive) {
    return (
      <div style={{ color: 'var(--muted)', fontSize: 13 }}>Trip {id} is not currently active.</div>
    );
  }

  const secondaryError = studentsError || timelineError || incidentsError;
  const secondaryErrorMessage = secondaryError ? extractApiError(secondaryError).message : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, animation: 'fleetops-fade-in 280ms var(--ease-out) both' }}>

      {/* Back + header */}
      <div>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => navigate('/ops/trips')}
          style={{ gap: 6, marginBottom: 16, paddingLeft: 0 }}
        >
          <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}><Icon name="arrow" size={13} /></span>
          All trips
        </button>

        {secondaryErrorMessage && (
          <div className="card" style={{ marginBottom: 16, padding: '10px 14px', borderColor: 'var(--err)', background: 'var(--err-soft)', color: 'var(--err)', fontSize: 12 }}>
            {secondaryErrorMessage}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>
              Trip Command
            </div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 500, letterSpacing: '-0.02em', margin: '0 0 4px' }}>
              Bus {tripLive.busNumber} — {tripLive.routeName}
            </h1>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>
              {tripLive.driverName ? `Driver: ${tripLive.driverName}` : 'Driver unassigned'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            {activeIncident && <StateBadge state={activeIncident.status} />}
            <StateBadge state={tripLive.gpsStatus} />
            <StateBadge state={tripLive.status} />
          </div>
        </div>

        {/* KPI strip */}
        <div style={{ display: 'flex', gap: 20, marginTop: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="users" size={14} className="dim" />
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 500, letterSpacing: '-0.02em' }}>
              {tripLive.boardedCount}
            </span>
            <span className="dim" style={{ fontSize: 13 }}>/ {tripLive.expectedCount} boarded</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="clock" size={14} className="dim" />
            <span className="dim" style={{ fontSize: 13 }}>
              Started {formatDistanceToNow(new Date(tripLive.startedAt))} ago
            </span>
          </div>
          {activeIncident && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--err)', display: 'inline-flex' }}><Icon name="alert" size={14} /></span>
              <span style={{ fontSize: 13, color: 'var(--err)' }}>
                {activeIncident.type.replace(/_/g, ' ')} active
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Command panel + comms */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) 360px', gap: 16, alignItems: 'start' }}>

        {/* Command panel */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 500, letterSpacing: '-0.01em' }}>
                Command panel
              </h2>
              <div style={{ marginTop: 3, color: 'var(--muted)', fontSize: 12 }}>
                Act on this trip directly, with comms bound to the trip or current incident.
              </div>
            </div>
            <Icon name="radio" size={16} className="dim" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
            <button
              type="button"
              className="btn primary"
              style={{ minHeight: 44 }}
              onClick={() =>
                setComposer(
                  `Transport office check-in: confirm trip status, location, and ETA for Bus ${tripLive.busNumber}.`,
                )
              }
              disabled={!capabilities?.canMessageDrivers}
            >
              Contact driver
            </button>

            <button
              type="button"
              className="btn"
              style={{ minHeight: 44 }}
              onClick={() => void handleNotify()}
              disabled={!capabilities?.canMessageDrivers}
            >
              Notify riders
            </button>

            <button
              type="button"
              className="btn"
              style={{ minHeight: 44 }}
              onClick={() => void handleRequestDelegate()}
              disabled={!capabilities?.canAssignSubstitute}
            >
              Request delegate
            </button>

            <button
              type="button"
              className="btn warn"
              style={{ minHeight: 44 }}
              onClick={() => void handleCoordinatorOverride()}
              disabled={!capabilities?.canCoordinatorOverride || tripLive.gpsStatus !== 'OFFLINE'}
            >
              GPS override
            </button>

            <button
              type="button"
              className="btn danger"
              style={{ minHeight: 44 }}
              onClick={() => void handleEscalate()}
              disabled={!capabilities?.canEscalateIncidents || !activeIncident}
            >
              Escalate incident
            </button>

            <button
              type="button"
              className="btn ok"
              style={{ minHeight: 44 }}
              onClick={() => void handleResolve()}
              disabled={!capabilities?.canResolveIncidents || !activeIncident}
            >
              Resolve incident
            </button>
          </div>

          {activeIncident && (
            <div className="card" style={{ padding: 14, display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 500 }}>
                <Icon name="bus" size={14} />
                Substitute workflow
              </div>
              <select
                value={selectedAlternateBusId}
                onChange={(e) => setSelectedAlternateBusId(e.target.value)}
                disabled={!capabilities?.canAssignSubstitute}
                style={{
                  width: '100%',
                  borderRadius: 'var(--r-md)',
                  border: '1px solid var(--border-2)',
                  background: 'var(--surface-2)',
                  color: 'var(--ink)',
                  padding: '8px 10px',
                  fontSize: 12,
                }}
              >
                <option value="">Select alternate bus</option>
                {substituteCandidates.map((candidate) => (
                  <option key={candidate.busId} value={candidate.busId}>
                    Bus {candidate.busNumber} | {candidate.driverName || 'No driver'}{' '}
                    {candidate.isCurrentlyActive ? '| busy' : '| standby'}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn primary"
                onClick={() => void handleAssignSubstitute()}
                disabled={!capabilities?.canAssignSubstitute}
              >
                Assign substitute
              </button>
            </div>
          )}

          <div style={{ display: 'grid', gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              Operational note
            </label>
            <textarea
              value={resolutionNote}
              onChange={(e) => setResolutionNote(e.target.value)}
              rows={4}
              placeholder="Document the recovery path, escalation rationale, or incident resolution."
              style={{
                resize: 'vertical',
                borderRadius: 'var(--r-md)',
                border: '1px solid var(--border-2)',
                background: 'var(--surface-2)',
                color: 'var(--ink)',
                padding: '8px 10px',
                fontSize: 12,
                fontFamily: 'var(--font-text)',
              }}
            />
          </div>

          {actionError && (
            <div className="card" style={{ padding: '10px 14px', borderColor: 'var(--err)', background: 'var(--err-soft)', color: 'var(--err)', fontSize: 12 }}>
              {actionError}
            </div>
          )}
        </div>

        {/* Action comms */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 500, letterSpacing: '-0.01em' }}>
              Action comms
            </h2>
            <div style={{ marginTop: 3, color: 'var(--muted)', fontSize: 12 }}>
              {activeIncident ? 'INCIDENT thread attached to this trip' : 'TRIP thread'}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column-reverse', gap: 8, minHeight: 200 }}>
            {threadMessages.length === 0 ? (
              <p className="dim" style={{ fontSize: 12, margin: 0 }}>No contextual messages yet.</p>
            ) : (
              threadMessages.map((message) => (
                <div
                  key={message.id}
                  className="card"
                  style={{ padding: '8px 12px', background: 'var(--surface-2)' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4, fontSize: 11, color: 'var(--muted)' }}>
                    <span>
                      {message.sender.name}
                      <span style={{ marginLeft: 4 }}>({message.sender.role})</span>
                    </span>
                    <span>{formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>{message.body}</div>
                </div>
              ))
            )}
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            <textarea
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              rows={4}
              placeholder={
                capabilities?.canMessageDrivers
                  ? 'Send a trip-level operational update…'
                  : 'Read-only for your role'
              }
              disabled={!capabilities?.canMessageDrivers}
              style={{
                resize: 'vertical',
                borderRadius: 'var(--r-md)',
                border: '1px solid var(--border-2)',
                background: 'var(--surface-2)',
                color: 'var(--ink)',
                padding: '8px 10px',
                fontSize: 12,
                fontFamily: 'var(--font-text)',
              }}
            />
            <button
              type="button"
              className="btn primary"
              onClick={() => void handleSendMessage()}
              disabled={!capabilities?.canMessageDrivers || !composer.trim()}
            >
              <Icon name="send" size={12} />
              Send contextual update
            </button>
          </div>
        </div>
      </div>

      {/* Manifest + timeline */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, alignItems: 'start' }}>

        {/* Student manifest */}
        <div className="card">
          <div className="card-head">
            <h3>Student Manifest ({students.length})</h3>
            <Icon name="users" size={14} className="dim" />
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {isStudentsLoading ? (
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="skel" style={{ height: 36, borderRadius: 6 }} />
                ))}
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Roll No.</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => (
                    <tr key={student.id}>
                      <td style={{ color: 'var(--ink)', fontWeight: 500, fontSize: 12.5 }}>
                        {student.user.name}
                      </td>
                      <td className="mono dim">{student.user.rollNumber || '—'}</td>
                      <td>
                        <StateBadge state={student.status} />
                      </td>
                      <td style={{ textAlign: 'right', fontSize: 11.5, color: 'var(--muted)' }}>
                        {student.checkedInAt
                          ? format(new Date(student.checkedInAt), 'h:mm a')
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Event timeline */}
        <div className="card">
          <div className="card-head">
            <h3>Event Timeline</h3>
            <Icon name="clock" size={14} className="dim" />
          </div>
          <div className="card-body">
            {isTimelineLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="skel" style={{ height: 14, borderRadius: 4 }} />
                ))}
              </div>
            ) : timeline.length === 0 ? (
              <p className="dim" style={{ fontSize: 12, margin: 0 }}>No events recorded for this trip yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {timeline.map((event, index) => (
                  <div key={event.id} style={{ display: 'flex', gap: 12 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ink-2)', marginTop: 3 }} />
                      {index < timeline.length - 1 && (
                        <div style={{ width: 1, flex: 1, background: 'var(--divider)', minHeight: 14, marginTop: 4 }} />
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.45 }}>{event.message}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                        {format(new Date(event.timestamp), 'h:mm a')} · {event.actor}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TripDetail;
