import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  AdminFocusModeState,
  AdminMessageInput,
  AdminSuggestedAction,
} from 'shared';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';
import { QueryError } from '../../components/shared/QueryError';
import { Icon } from '../../components/design/Icon';
import {
  Donut,
  Gauge,
  KPIBlock,
  PriorityChip,
  SectionCard,
  StateBadge,
  formatPriorityTone,
  toneClass,
  useGreeting,
} from '../../components/design/primitives';
import { useAlerts } from '../../hooks/useAlerts';
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
import { useReports } from '../../hooks/useReports';
import { QK } from '../../lib/query-keys';
import { useAuthStore } from '../../store/auth.store';

const formatActionLabel = (action: AdminSuggestedAction['type']) =>
  action
    .toLowerCase()
    .split('_')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');

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

export const Dashboard: React.FC = () => {
  const greeting = useGreeting();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { capabilities, user } = useAuthStore();
  const { data: alerts = [] } = useAlerts();
  const { data: commandCenter, isLoading, error: commandCenterError, refetch: refetchCommandCenter } = useCommandCenter();
  const { data: trips = [], error: tripsError, refetch: refetchTrips } = useActiveTrips();
  const [focusMode, setFocusMode] = useState<AdminFocusModeState>('ALL');
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [composer, setComposer] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [selectedAlternateBusId, setSelectedAlternateBusId] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const reportWindow = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 6);
    return {
      startDate: format(start, 'yyyy-MM-dd'),
      endDate: format(end, 'yyyy-MM-dd'),
    };
  }, []);

  const { overview } = useReports(reportWindow);
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
        queryClient.invalidateQueries({ queryKey: QK.commandCenter() }),
        queryClient.invalidateQueries({ queryKey: QK.incidents() }),
        queryClient.invalidateQueries({ queryKey: QK.messages() }),
      ]);
      setResolutionNote('');
    },
  });

  const coordinatorOverride = useMutation({
    mutationFn: (tripId: string) => api.post(`/v1/admin/ops/gps-outages/${tripId}/coordinator-override`),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QK.commandCenter() }),
        queryClient.invalidateQueries({ queryKey: QK.gpsOutages() }),
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

  const prioritizedTrips = useMemo(
    () => trips
      .slice()
      .sort((left, right) => {
        const weight = (status: string) => (status === 'OFFLINE' ? 2 : status === 'STALE' ? 1 : 0);
        return weight(right.gpsStatus) - weight(left.gpsStatus);
      })
      .slice(0, 5),
    [trips],
  );

  const fleetSegments = useMemo(() => {
    const live = trips.filter((trip) => trip.gpsStatus === 'LIVE').length;
    const stale = trips.filter((trip) => trip.gpsStatus === 'STALE').length;
    const offline = trips.filter((trip) => trip.gpsStatus === 'OFFLINE').length;
    const idle = Math.max((commandCenter?.stats.activeTrips ?? trips.length) - live - stale - offline, 0);
    return [
      { value: live, color: 'var(--ok)' },
      { value: stale, color: 'var(--warn)' },
      { value: offline, color: 'var(--err)' },
      { value: idle, color: 'var(--idle)' },
    ];
  }, [commandCenter?.stats.activeTrips, trips]);

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
    return <div className="muted">Loading command center...</div>;
  }

  if (commandCenterError) {
    return <QueryError message={extractApiError(commandCenterError).message} onRetry={() => void refetchCommandCenter()} />;
  }

  if (tripsError) {
    return <QueryError message={extractApiError(tripsError).message} onRetry={() => void refetchTrips()} />;
  }

  const otpValue = Math.round(overview.data?.attendanceRate ?? 0);

  return (
    <div style={{ display: 'grid', gap: 18, minHeight: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 500, letterSpacing: '-0.02em' }}>
            {greeting}, {user?.name?.split(' ')[0] ?? 'Admin'}
          </h1>
          <div style={{ marginTop: 4, color: 'var(--muted)', fontSize: 12 }}>
            {format(new Date(), 'EEE dd MMM')} - <span style={{ color: 'var(--ink-2)' }}>{commandCenter?.stats.activeTrips ?? 0} trips</span> in flight - <span style={{ color: 'var(--ink-2)' }}>{trips.length} buses</span> reporting
          </div>
        </div>
        <button className="btn" type="button" onClick={() => setFocusMode((current) => (current === 'ALL' ? 'URGENT_ONLY' : 'ALL'))}>
          <Icon name="focusFrame" size={13} />
          {focusMode === 'URGENT_ONLY' ? 'Exit Focus Mode' : 'Enter Focus Mode'}
          <span className="searchbar__kbd">Ctrl F</span>
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10 }}>
        <KPIBlock label="Buses on Route" value={`${trips.filter((trip) => trip.gpsStatus === 'LIVE').length}/${Math.max(trips.length, 1)}`} sub="live telemetry" spark={[18, 19, 21, 20, 22, 23, 24, 24]} delay={0} />
        <KPIBlock label="Active Trips" value={commandCenter?.stats.activeTrips ?? 0} sub={<span>{otpValue}% attendance rate</span>} trend={{ label: 'tracked', color: 'var(--ok)' }} delay={40} />
        <KPIBlock label="Open Incidents" value={commandCenter?.stats.unresolvedIncidents ?? 0} sub={<span>{commandCenter?.stats.criticalCount ?? 0} critical - {commandCenter?.stats.highCount ?? 0} high</span>} delay={80} />
        <KPIBlock label="GPS Health" value={`${Math.max(0, 100 - Math.round(((commandCenter?.stats.gpsOffline ?? 0) / Math.max(commandCenter?.stats.activeTrips ?? 1, 1)) * 100))}%`} sub={`${commandCenter?.stats.gpsOffline ?? 0} offline`} delay={120} />
        <KPIBlock label="Unread Comms" value={alerts.filter((alert) => alert.type === 'NEW_MESSAGE').length} sub={`${alerts.length} live alerts`} delay={160} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 14 }}>
        <SectionCard title="Priority Rail" subtitle={`${visibleEntities.length} ranked decisions`}>
          <div style={{ display: 'grid', gap: 12 }}>
            {visibleEntities.length === 0 ? (
              <div className="muted">No items in the current priority filter.</div>
            ) : (
              visibleEntities.slice(0, 4).map((entity) => (
                <button
                  key={entity.id}
                  type="button"
                  onClick={() => setSelectedEntityId(entity.id)}
                  style={{
                    padding: 14,
                    textAlign: 'left',
                    border: `1px solid ${selectedEntity?.id === entity.id ? 'var(--border-3)' : 'var(--divider)'}`,
                    borderRadius: 'var(--r-md)',
                    background: selectedEntity?.id === entity.id ? 'var(--surface-2)' : 'transparent',
                    transition: 'background var(--t-fast), border-color var(--t-fast)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <PriorityChip level={entity.priority === 'CRITICAL' ? 'p1' : entity.priority === 'HIGH' ? 'p2' : 'p3'} />
                      <span style={{ fontWeight: 500, fontSize: 13 }}>{entity.title}</span>
                    </div>
                    <span className="mono muted">{entity.ageMinutes ? `${entity.ageMinutes}m` : 'now'}</span>
                  </div>
                  <div style={{ color: 'var(--ink-2)', fontSize: 12, marginBottom: 10 }}>{entity.summary}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {entity.badges.slice(0, 3).map((badge) => (
                        <span key={badge} className="pill pill--idle">{badge}</span>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {entity.actions.slice(0, 3).map((action) => (
                        <button
                          key={action.id}
                          type="button"
                          className={`btn sm ${action.priority === 'CRITICAL' ? 'primary' : ''}`}
                          disabled={!getActionAllowed(action, capabilities) || action.disabled}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleAction(action);
                          }}
                        >
                          {formatActionLabel(action.type)}
                        </button>
                      ))}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </SectionCard>

        <div style={{ display: 'grid', gap: 14 }}>
          <SectionCard title="Fleet Health" subtitle={`${trips.length} active buses`}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', gap: 16 }}>
              <Donut
                segments={fleetSegments}
                centerLabel={String(trips.length)}
                centerSub="ACTIVE"
              />
              <div style={{ display: 'grid', gap: 8, minWidth: 140, fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Live</span><span className="mono">{trips.filter((trip) => trip.gpsStatus === 'LIVE').length}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Stale</span><span className="mono">{trips.filter((trip) => trip.gpsStatus === 'STALE').length}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Offline</span><span className="mono">{trips.filter((trip) => trip.gpsStatus === 'OFFLINE').length}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Impacted Users</span><span className="mono">{commandCenter?.stats.impactedUsers ?? 0}</span></div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="On-Time Performance" subtitle="Target >= 95%">
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <Gauge
                value={otpValue}
                max={100}
                size={220}
                thickness={14}
                color="var(--warn)"
                target={95}
                label={`${otpValue}%`}
                sub="ATTENDANCE WINDOW"
              />
            </div>
          </SectionCard>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <SectionCard title="Action Detail" subtitle={selectedEntity ? selectedEntity.context.contextType : 'No selection'}>
          {selectedEntity ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <div className={toneClass(formatPriorityTone(selectedEntity.priority))} style={{ marginBottom: 8, width: 'fit-content' }}>
                  {selectedEntity.priority}
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 500 }}>{selectedEntity.title}</div>
                <div style={{ marginTop: 6, color: 'var(--ink-2)', lineHeight: 1.55 }}>{selectedEntity.summary}</div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {selectedEntity.badges.map((badge) => (
                  <span key={badge} className="pill pill--idle">{badge}</span>
                ))}
              </div>

              {selectedEntity.actions.some((action) => action.type === 'ASSIGN_SUBSTITUTE') ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <label style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    Substitute Bus
                  </label>
                  <select
                    value={selectedAlternateBusId}
                    onChange={(event) => setSelectedAlternateBusId(event.target.value)}
                    style={{ padding: '10px 12px', border: '1px solid var(--border-2)', borderRadius: 'var(--r-md)', background: 'var(--surface-2)' }}
                  >
                    <option value="">Select alternate bus</option>
                    {substituteCandidates.map((candidate) => (
                      <option key={candidate.busId} value={candidate.busId}>
                        Bus {candidate.busNumber} - {candidate.driverName || 'No driver'} {candidate.isCurrentlyActive ? '(busy)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <textarea
                value={resolutionNote}
                onChange={(event) => setResolutionNote(event.target.value)}
                rows={4}
                placeholder="Add the recovery decision, escalation note, or incident resolution."
                style={{ resize: 'vertical', padding: '10px 12px', border: '1px solid var(--border-2)', borderRadius: 'var(--r-md)', background: 'var(--surface-2)' }}
              />

              {actionError ? <div className="pill pill--err" style={{ width: 'fit-content', textTransform: 'none', fontSize: 12 }}>{actionError}</div> : null}
            </div>
          ) : (
            <div className="muted">Select a live entity to view actions and contextual comms.</div>
          )}
        </SectionCard>

        <SectionCard title="Active Fleet" subtitle={`${prioritizedTrips.length} surfaced buses`}>
          <div style={{ display: 'grid', gap: 10 }}>
            {prioritizedTrips.map((trip) => (
              <button
                key={trip.id}
                type="button"
                onClick={() => navigate(`/ops/trips/${trip.id}`)}
                style={{
                  display: 'grid',
                  gap: 4,
                  padding: 12,
                  border: '1px solid var(--divider)',
                  borderRadius: 'var(--r-md)',
                  background: 'transparent',
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>Bus {trip.busNumber}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{trip.routeName}</div>
                  </div>
                  <StateBadge state={trip.gpsStatus} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: 'var(--ink-2)', fontSize: 12 }}>
                  <span>{trip.boardedCount}/{trip.expectedCount} boarded</span>
                  <span className="mono">{format(new Date(trip.startedAt), 'HH:mm')}</span>
                </div>
              </button>
            ))}
          </div>
        </SectionCard>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <SectionCard title="Action Comms" subtitle={selectedEntity ? `${selectedEntity.context.contextType} thread` : 'Global broadcast'}>
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="scroll" style={{ maxHeight: 240, display: 'grid', gap: 10 }}>
              {threadMessages.length === 0 ? (
                <div className="muted">No contextual messages yet.</div>
              ) : (
                threadMessages.map((message) => (
                  <div key={message.id} style={{ padding: 12, border: '1px solid var(--divider)', borderRadius: 'var(--r-md)', background: 'var(--surface-2)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4, color: 'var(--muted)', fontSize: 11 }}>
                      <span>{message.sender.name} ({message.sender.role})</span>
                      <span className="mono">{format(new Date(message.createdAt), 'HH:mm')}</span>
                    </div>
                    <div style={{ color: 'var(--ink-2)', lineHeight: 1.45 }}>{message.body}</div>
                  </div>
                ))
              )}
            </div>
            <textarea
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              rows={4}
              placeholder={capabilities?.canMessageDrivers ? 'Send a contextual operations update...' : 'Read-only for your role'}
              disabled={!capabilities?.canMessageDrivers}
              style={{ resize: 'vertical', padding: '10px 12px', border: '1px solid var(--border-2)', borderRadius: 'var(--r-md)', background: 'var(--surface-2)' }}
            />
            <button className="btn primary" type="button" disabled={!capabilities?.canMessageDrivers || !composer.trim()} onClick={() => void sendThreadMessage()}>
              <Icon name="send" size={12} />
              Send contextual update
            </button>
          </div>
        </SectionCard>

        <SectionCard title="Live Alert Feed" subtitle={`${alerts.length} recent alerts`}>
          <div style={{ display: 'grid', gap: 10 }}>
            {alerts.slice(0, 5).map((alert, index) => (
              <div key={`${alert.timestamp}-${index}`} style={{ paddingBottom: 10, borderBottom: index < Math.min(alerts.length, 5) - 1 ? '1px solid var(--divider)' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                  <span className={toneClass(alert.priority >= 3 ? 'err' : alert.priority === 2 ? 'warn' : 'info')}>P{Math.max(1, Math.min(alert.priority, 3))}</span>
                  <span className="mono muted">{format(new Date(alert.timestamp), 'HH:mm:ss')}</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginBottom: 4 }}>{alert.summary}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {alert.busNumber ? `Bus ${alert.busNumber}` : alert.routeName ?? alert.type}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {focusMode === 'URGENT_ONLY' ? (
        <div style={{ position: 'fixed', inset: 0, zIndex: 70, padding: 32, background: 'rgba(15, 15, 17, 0.62)', backdropFilter: 'blur(6px)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '420px minmax(0, 1fr)', gap: 16, height: '100%' }}>
            <div className="card" style={{ background: '#1a1a1d', color: '#eee', borderColor: '#2a2a2d', overflow: 'auto' }}>
              <div className="card-head" style={{ borderBottomColor: '#2a2a2d' }}>
                <div>
                  <div style={{ color: '#777', fontSize: 10, fontWeight: 500, letterSpacing: '0.12em' }}>FOCUS MODE</div>
                  <h3 style={{ color: '#fff' }}>Urgent decisions only</h3>
                </div>
                <button className="focus-overlay__exit" type="button" onClick={() => setFocusMode('ALL')}>Exit</button>
              </div>
              <div className="card-body" style={{ display: 'grid', gap: 10 }}>
                {visibleEntities.map((entity) => (
                  <button
                    key={entity.id}
                    type="button"
                    onClick={() => setSelectedEntityId(entity.id)}
                    style={{ padding: 12, borderRadius: 'var(--r-md)', border: '1px solid #2a2a2d', background: selectedEntity?.id === entity.id ? '#232327' : 'transparent', color: '#eee', textAlign: 'left' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                      <PriorityChip level={entity.priority === 'CRITICAL' ? 'p1' : 'p2'} />
                      <span className="mono" style={{ color: '#999' }}>{entity.ageMinutes ? `${entity.ageMinutes}m` : 'now'}</span>
                    </div>
                    <div style={{ fontWeight: 500, marginBottom: 4 }}>{entity.title}</div>
                    <div style={{ color: '#bbb', fontSize: 12 }}>{entity.summary}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="card" style={{ background: '#1a1a1d', color: '#eee', borderColor: '#2a2a2d' }}>
              <div className="card-head" style={{ borderBottomColor: '#2a2a2d' }}>
                <div>
                  <div style={{ color: '#777', fontSize: 10, fontWeight: 500, letterSpacing: '0.12em' }}>COMMAND ONLY</div>
                  <h3 style={{ color: '#fff' }}>{selectedEntity?.title ?? 'No urgent entity selected'}</h3>
                </div>
              </div>
              <div className="card-body" style={{ display: 'grid', gap: 12 }}>
                <div style={{ color: '#ccc' }}>{selectedEntity?.summary}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                  {selectedEntity?.actions.filter((action) => action.confidence === 'HIGH' && !action.disabled).slice(0, 4).map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => void handleAction(action)}
                      disabled={!getActionAllowed(action, capabilities)}
                      style={{
                        padding: '14px 16px',
                        border: 0,
                        borderRadius: 'var(--r-lg)',
                        background: '#ef4444',
                        color: '#fff',
                        fontWeight: 700,
                        opacity: getActionAllowed(action, capabilities) ? 1 : 0.45,
                      }}
                    >
                      {formatActionLabel(action.type)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Dashboard;
