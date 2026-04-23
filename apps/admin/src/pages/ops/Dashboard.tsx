import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  AdminCommandEntity,
  AdminFocusModeState,
  AdminMessageInput,
  AdminPriorityLevel,
  AdminSuggestedAction,
} from 'shared';
import { MessageSquare, Radio, ShieldAlert, Siren, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';
import { QueryError } from '../../components/shared/QueryError';
import { StatusBadge } from '../../lib/status';
import { useAuthStore } from '../../store/auth.store';
import { useActiveTrips } from '../../hooks/useActiveTrips';
import {
  useAssignSubstitute,
  useCommandCenter,
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

const priorityColor: Record<AdminPriorityLevel, string> = {
  CRITICAL: '#EF4444',
  HIGH: '#F97316',
  MEDIUM: '#F59E0B',
  LOW: '#22C55E',
};

const metricCardStyle: React.CSSProperties = {
  background: 'rgba(15, 23, 42, 0.85)',
  border: '1px solid rgba(51, 65, 85, 0.7)',
  borderRadius: 18,
  padding: '1rem 1.1rem',
};

const getActionAllowed = (action: AdminSuggestedAction, capabilities: ReturnType<typeof useAuthStore.getState>['capabilities']) => {
  if (!capabilities) {
    return false;
  }

  switch (action.type) {
    case 'CONTACT_DRIVER':
    case 'NOTIFY_AFFECTED_USERS':
      return capabilities.canMessageDrivers;
    case 'ASSIGN_SUBSTITUTE':
    case 'REQUEST_DELEGATE':
      return capabilities.canAssignSubstitute;
    case 'RESOLVE_INCIDENT':
      return capabilities.canResolveIncidents;
    case 'ESCALATE_INCIDENT':
      return capabilities.canEscalateIncidents;
    case 'COORDINATOR_OVERRIDE':
      return capabilities.canCoordinatorOverride;
    case 'OPEN_TRIP':
      return capabilities.canViewTripDetail;
    case 'WATCH_ONLY':
      return true;
    default:
      return false;
  }
};

const EntityCard = ({
  entity,
  active,
  onSelect,
}: {
  entity: AdminCommandEntity;
  active: boolean;
  onSelect: () => void;
}) => (
  <button
    type="button"
    onClick={onSelect}
    style={{
      textAlign: 'left',
      borderRadius: 18,
      border: `1px solid ${active ? priorityColor[entity.priority] : '#1F2937'}`,
      background: active ? 'rgba(30, 41, 59, 0.95)' : '#0F172A',
      padding: '0.95rem',
      color: '#F8FAFC',
      cursor: 'pointer',
      display: 'grid',
      gap: '0.55rem',
    }}
  >
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
      <div>
        <div style={{ fontSize: '0.72rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: priorityColor[entity.priority], fontWeight: 800 }}>
          {entity.priority}
        </div>
        <div style={{ marginTop: '0.28rem', fontWeight: 700 }}>{entity.title}</div>
      </div>
      <div style={{ color: '#94A3B8', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
        {entity.ageMinutes ? `${entity.ageMinutes} min` : 'now'}
      </div>
    </div>
    <div style={{ color: '#CBD5E1', fontSize: '0.88rem', lineHeight: 1.45 }}>{entity.summary}</div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
      {entity.badges.map((badge) => (
        <span
          key={badge}
          style={{
            padding: '0.2rem 0.55rem',
            borderRadius: 999,
            background: 'rgba(30, 41, 59, 0.95)',
            color: '#CBD5E1',
            fontSize: '0.72rem',
            border: '1px solid rgba(71, 85, 105, 0.7)',
          }}
        >
          {badge}
        </span>
      ))}
    </div>
  </button>
);

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { capabilities } = useAuthStore();
  const { data: commandCenter, isLoading, error: commandCenterError, refetch: refetchCommandCenter } = useCommandCenter();
  const { data: trips = [], error: activeTripsError, refetch: refetchActiveTrips } = useActiveTrips();
  const [focusMode, setFocusMode] = useState<AdminFocusModeState>('ALL');
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
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
        queryClient.invalidateQueries({ queryKey: ['live', 'command-center'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'incidents'] }),
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
      ]);
    },
  });

  const entities = commandCenter?.entities ?? [];
  const visibleEntities = useMemo(
    () => (focusMode === 'URGENT_ONLY' ? entities.filter((entity) => entity.priority !== 'LOW' && entity.priority !== 'MEDIUM') : entities),
    [entities, focusMode],
  );

  const selectedEntity = useMemo(
    () => visibleEntities.find((entity) => entity.id === selectedEntityId) ?? visibleEntities[0] ?? null,
    [selectedEntityId, visibleEntities],
  );

  useEffect(() => {
    if (!selectedEntityId && visibleEntities[0]) {
      setSelectedEntityId(visibleEntities[0].id);
    } else if (selectedEntityId && !visibleEntities.some((entity) => entity.id === selectedEntityId)) {
      setSelectedEntityId(visibleEntities[0]?.id ?? null);
    }
  }, [selectedEntityId, visibleEntities]);

  useEffect(() => {
    setSelectedAlternateBusId('');
    setActionError(null);
  }, [selectedEntity?.id]);

  const { data: threadMessages = [] } = useMessages(
    selectedEntity?.context.busId,
    50,
    selectedEntity ? { contextType: selectedEntity.context.contextType, contextId: selectedEntity.context.contextId } : undefined,
  );
  const { data: substituteCandidates = [] } = useSubstituteCandidates(selectedEntity?.context.tripId);

  const handleAction = async (action: AdminSuggestedAction) => {
    if (!selectedEntity) {
      return;
    }

    setActionError(null);

    try {
      switch (action.type) {
        case 'OPEN_TRIP':
          if (selectedEntity.context.tripId) {
            navigate(`/ops/trips/${selectedEntity.context.tripId}`);
          }
          break;
        case 'CONTACT_DRIVER':
          setComposer(`Transport office check-in: ${selectedEntity.title}. Please confirm current status and ETA.`);
          break;
        case 'NOTIFY_AFFECTED_USERS':
          if (selectedEntity.context.tripId) {
            await notifyAffected.mutateAsync({ tripId: selectedEntity.context.tripId, note: composer || undefined });
            setComposer('');
          }
          break;
        case 'REQUEST_DELEGATE':
          if (selectedEntity.context.tripId) {
            await requestDelegate.mutateAsync({ tripId: selectedEntity.context.tripId, note: composer || undefined });
            setComposer('');
          }
          break;
        case 'COORDINATOR_OVERRIDE':
          if (selectedEntity.context.tripId) {
            await coordinatorOverride.mutateAsync(selectedEntity.context.tripId);
          }
          break;
        case 'ESCALATE_INCIDENT':
          if (selectedEntity.context.incidentId) {
            await escalateIncident.mutateAsync({ incidentId: selectedEntity.context.incidentId, note: resolutionNote || composer || undefined });
            setResolutionNote('');
          }
          break;
        case 'RESOLVE_INCIDENT':
          if (selectedEntity.context.incidentId) {
            await resolveIncident.mutateAsync({
              incidentId: selectedEntity.context.incidentId,
              resolution: resolutionNote || 'Resolved from command center',
            });
          }
          break;
        case 'ASSIGN_SUBSTITUTE':
          if (!selectedEntity.context.incidentId || !selectedAlternateBusId) {
            setActionError('Select a substitute bus first.');
            return;
          }
          await assignSubstitute.mutateAsync({
            incidentId: selectedEntity.context.incidentId,
            alternateBusId: selectedAlternateBusId,
          });
          setSelectedAlternateBusId('');
          break;
        case 'WATCH_ONLY':
          break;
      }
    } catch (error) {
      setActionError(extractApiError(error).message);
    }
  };

  const sendThreadMessage = async () => {
    if (!composer.trim()) {
      return;
    }

    const payload: AdminMessageInput = selectedEntity
      ? {
          body: composer.trim(),
          priority: 'URGENT',
          context: selectedEntity.context,
        }
      : {
          body: composer.trim(),
          priority: 'URGENT',
          type: 'BROADCAST_ALL',
          context: { contextType: 'BROADCAST', contextId: 'GLOBAL' },
        };

    try {
      await sendContextMessage.mutateAsync(payload);
      setComposer('');
    } catch (error) {
      setActionError(extractApiError(error).message);
    }
  };

  if (isLoading) {
    return <div style={{ color: '#94A3B8' }}>Loading command center...</div>;
  }

  if (commandCenterError) {
    return <QueryError message={extractApiError(commandCenterError).message} onRetry={() => void refetchCommandCenter()} />;
  }

  if (activeTripsError) {
    return <QueryError message={extractApiError(activeTripsError).message} onRetry={() => void refetchActiveTrips()} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '0.78rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#38BDF8', fontWeight: 800 }}>
            Fleet Command
          </div>
          <h1 style={{ margin: '0.35rem 0 0', color: '#FFFFFF', fontSize: '2rem' }}>Operations Command Center</h1>
          <p style={{ margin: '0.55rem 0 0', color: '#94A3B8', maxWidth: 760 }}>
            Prioritize what matters, act inline, and keep comms anchored to the affected trip or incident.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setFocusMode((current) => (current === 'ALL' ? 'URGENT_ONLY' : 'ALL'))}
          style={{
            border: 0,
            borderRadius: 16,
            background: focusMode === 'URGENT_ONLY' ? '#EF4444' : '#1E293B',
            color: '#FFFFFF',
            padding: '0.9rem 1.1rem',
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          {focusMode === 'URGENT_ONLY' ? 'Exit Focus Mode' : 'Enter Focus Mode'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '1rem' }}>
        <div style={metricCardStyle}>
          <div style={{ color: '#94A3B8', fontSize: '0.8rem' }}>Active trips</div>
          <div style={{ color: '#FFFFFF', fontWeight: 800, fontSize: '1.8rem' }}>{commandCenter?.stats.activeTrips ?? 0}</div>
        </div>
        <div style={metricCardStyle}>
          <div style={{ color: '#94A3B8', fontSize: '0.8rem' }}>Critical</div>
          <div style={{ color: '#FCA5A5', fontWeight: 800, fontSize: '1.8rem' }}>{commandCenter?.stats.criticalCount ?? 0}</div>
        </div>
        <div style={metricCardStyle}>
          <div style={{ color: '#94A3B8', fontSize: '0.8rem' }}>High</div>
          <div style={{ color: '#FDBA74', fontWeight: 800, fontSize: '1.8rem' }}>{commandCenter?.stats.highCount ?? 0}</div>
        </div>
        <div style={metricCardStyle}>
          <div style={{ color: '#94A3B8', fontSize: '0.8rem' }}>Incidents</div>
          <div style={{ color: '#FFFFFF', fontWeight: 800, fontSize: '1.8rem' }}>{commandCenter?.stats.unresolvedIncidents ?? 0}</div>
        </div>
        <div style={metricCardStyle}>
          <div style={{ color: '#94A3B8', fontSize: '0.8rem' }}>GPS offline</div>
          <div style={{ color: '#FFFFFF', fontWeight: 800, fontSize: '1.8rem' }}>{commandCenter?.stats.gpsOffline ?? 0}</div>
        </div>
        <div style={metricCardStyle}>
          <div style={{ color: '#94A3B8', fontSize: '0.8rem' }}>Impacted riders</div>
          <div style={{ color: '#FFFFFF', fontWeight: 800, fontSize: '1.8rem' }}>{commandCenter?.stats.impactedUsers ?? 0}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 320px minmax(360px, 1fr) 360px', gap: '1rem', minHeight: 0, flex: 1 }}>
        <section style={{ ...panelStyle, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: '#F8FAFC', fontWeight: 700 }}>Priority Rail</div>
              <div style={{ color: '#64748B', fontSize: '0.8rem' }}>{visibleEntities.length} live decisions</div>
            </div>
            <Siren size={18} color="#F87171" />
          </div>
          <div style={{ display: 'grid', gap: '0.75rem', overflowY: 'auto', paddingRight: '0.1rem' }}>
            {visibleEntities.length === 0 ? (
              <div style={{ color: '#94A3B8', fontSize: '0.9rem' }}>No items in the current priority filter.</div>
            ) : (
              visibleEntities.map((entity) => (
                <EntityCard
                  key={entity.id}
                  entity={entity}
                  active={selectedEntity?.id === entity.id}
                  onSelect={() => setSelectedEntityId(entity.id)}
                />
              ))
            )}
          </div>
        </section>

        <section style={{ ...panelStyle, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: '#F8FAFC', fontWeight: 700 }}>Live Fleet</div>
              <div style={{ color: '#64748B', fontSize: '0.8rem' }}>{trips.length} active buses</div>
            </div>
            <Radio size={18} color="#60A5FA" />
          </div>
          <div style={{ display: 'grid', gap: '0.75rem', overflowY: 'auto' }}>
            {trips.map((trip) => {
              const linkedEntity = entities.find((entity) => entity.context.tripId === trip.id);
              return (
                <button
                  type="button"
                  key={trip.id}
                  onClick={() => linkedEntity ? setSelectedEntityId(linkedEntity.id) : navigate(`/ops/trips/${trip.id}`)}
                  style={{
                    textAlign: 'left',
                    borderRadius: 18,
                    border: `1px solid ${trip.gpsStatus === 'OFFLINE' ? '#EF4444' : trip.gpsStatus === 'STALE' ? '#F59E0B' : '#1F2937'}`,
                    background: '#0F172A',
                    padding: '0.95rem',
                    color: '#F8FAFC',
                    cursor: 'pointer',
                    display: 'grid',
                    gap: '0.55rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>Bus {trip.busNumber}</div>
                      <div style={{ color: '#94A3B8', fontSize: '0.82rem' }}>{trip.routeName}</div>
                    </div>
                    <StatusBadge status={trip.gpsStatus === 'OFFLINE' ? 'GPS_OFFLINE' : trip.gpsStatus === 'STALE' ? 'GPS_STALE' : 'GPS_LIVE'} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#CBD5E1', fontSize: '0.82rem' }}>
                    <span>{trip.boardedCount}/{trip.expectedCount} boarded</span>
                    <span>{formatDistanceToNow(new Date(trip.startedAt))} ago</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section style={{ ...panelStyle, overflowY: 'auto' }}>
          {selectedEntity ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                <div>
                  <div style={{ color: priorityColor[selectedEntity.priority], fontWeight: 800, letterSpacing: '0.08em', fontSize: '0.74rem' }}>
                    {selectedEntity.priority} PRIORITY
                  </div>
                  <h2 style={{ margin: '0.4rem 0 0', color: '#FFFFFF' }}>{selectedEntity.title}</h2>
                  <p style={{ margin: '0.5rem 0 0', color: '#CBD5E1', lineHeight: 1.5 }}>{selectedEntity.summary}</p>
                </div>
                <div style={{ color: '#64748B', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                  {selectedEntity.ageMinutes ? `${selectedEntity.ageMinutes} min active` : 'Fresh'}
                </div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {selectedEntity.badges.map((badge) => (
                  <span key={badge} style={{ padding: '0.3rem 0.6rem', borderRadius: 999, background: '#1E293B', color: '#CBD5E1', fontSize: '0.75rem' }}>
                    {badge}
                  </span>
                ))}
              </div>

              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {selectedEntity.actions.map((action) => {
                  const allowed = getActionAllowed(action, capabilities);
                  return (
                    <button
                      key={action.id}
                      type="button"
                      disabled={!allowed || action.disabled}
                      onClick={() => void handleAction(action)}
                      style={{
                        textAlign: 'left',
                        borderRadius: 16,
                        border: '1px solid #334155',
                        background: !allowed || action.disabled ? '#0F172A' : '#1E293B',
                        color: !allowed || action.disabled ? '#64748B' : '#F8FAFC',
                        padding: '0.9rem 1rem',
                        cursor: !allowed || action.disabled ? 'not-allowed' : 'pointer',
                        display: 'grid',
                        gap: '0.3rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                        <strong>{action.label}</strong>
                        <span style={{ color: priorityColor[action.priority], fontSize: '0.72rem', fontWeight: 800 }}>{action.priority}</span>
                      </div>
                      <span style={{ color: !allowed || action.disabled ? '#64748B' : '#94A3B8', fontSize: '0.82rem' }}>{action.reason}</span>
                    </button>
                  );
                })}
              </div>

              {selectedEntity.actions.some((action) => action.type === 'ASSIGN_SUBSTITUTE') && (
                <div style={{ borderRadius: 18, border: '1px solid #334155', padding: '0.95rem', background: '#0F172A' }}>
                  <div style={{ color: '#F8FAFC', fontWeight: 700, marginBottom: '0.65rem' }}>Substitute selection</div>
                  <select
                    value={selectedAlternateBusId}
                    onChange={(event) => setSelectedAlternateBusId(event.target.value)}
                    style={{ width: '100%', borderRadius: 12, border: '1px solid #334155', background: '#020617', color: '#F8FAFC', padding: '0.75rem 0.8rem' }}
                  >
                    <option value="">Select alternate bus</option>
                    {substituteCandidates.map((candidate) => (
                      <option key={candidate.busId} value={candidate.busId}>
                        Bus {candidate.busNumber} - {candidate.driverName || 'No driver'} {candidate.isCurrentlyActive ? '(busy)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ display: 'grid', gap: '0.6rem' }}>
                <label style={{ color: '#CBD5E1', fontSize: '0.84rem', fontWeight: 700 }}>Ops note / resolution</label>
                <textarea
                  value={resolutionNote}
                  onChange={(event) => setResolutionNote(event.target.value)}
                  rows={4}
                  placeholder="Add the recovery decision, escalation note, or incident resolution."
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
            <div style={{ color: '#94A3B8' }}>Select a live entity to view actions and contextual comms.</div>
          )}
        </section>

        <section style={{ ...panelStyle, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
            <div>
              <div style={{ color: '#F8FAFC', fontWeight: 700 }}>Action Comms</div>
              <div style={{ color: '#64748B', fontSize: '0.8rem' }}>
                {selectedEntity ? `${selectedEntity.context.contextType} thread` : 'Global broadcast'}
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
              placeholder={capabilities?.canMessageDrivers ? 'Send a contextual operations update...' : 'Read-only for your role'}
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

      {focusMode === 'URGENT_ONLY' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(2, 6, 23, 0.82)', backdropFilter: 'blur(8px)', zIndex: 60, padding: '2rem' }}>
          <div style={{ maxWidth: 1280, margin: '0 auto', height: '100%', display: 'grid', gridTemplateColumns: '420px 1fr', gap: '1rem' }}>
            <div style={{ ...panelStyle, overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ color: '#FCA5A5', fontWeight: 800, letterSpacing: '0.08em', fontSize: '0.75rem' }}>FOCUS MODE</div>
                  <h2 style={{ margin: '0.35rem 0 0', color: '#FFFFFF' }}>Urgent decisions only</h2>
                </div>
                <button type="button" onClick={() => setFocusMode('ALL')} style={{ border: 0, background: 'transparent', color: '#CBD5E1', cursor: 'pointer' }}>
                  <X size={22} />
                </button>
              </div>
              {visibleEntities.map((entity) => (
                <EntityCard key={entity.id} entity={entity} active={selectedEntity?.id === entity.id} onSelect={() => setSelectedEntityId(entity.id)} />
              ))}
            </div>

            <div style={{ ...panelStyle }}>
              {selectedEntity ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: priorityColor[selectedEntity.priority], fontWeight: 800 }}>
                    <ShieldAlert size={20} />
                    {selectedEntity.title}
                  </div>
                  <div style={{ color: '#CBD5E1', lineHeight: 1.6 }}>{selectedEntity.summary}</div>
                  <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                    {selectedEntity.actions
                      .filter((action) => action.confidence === 'HIGH' && !action.disabled)
                      .map((action) => (
                        <button
                          key={action.id}
                          type="button"
                          onClick={() => void handleAction(action)}
                          disabled={!getActionAllowed(action, capabilities)}
                          style={{
                            border: 0,
                            borderRadius: 18,
                            background: '#EF4444',
                            color: '#FFFFFF',
                            padding: '1rem 1.1rem',
                            fontWeight: 800,
                            cursor: getActionAllowed(action, capabilities) ? 'pointer' : 'not-allowed',
                            opacity: getActionAllowed(action, capabilities) ? 1 : 0.45,
                          }}
                        >
                          {action.label}
                        </button>
                      ))}
                  </div>
                </>
              ) : (
                <div style={{ color: '#94A3B8' }}>No urgent items selected.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
