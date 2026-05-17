import React, { useEffect, useMemo, useState } from 'react';
import { AdminActionContext, AdminMessage, AdminMessageInput } from 'shared';
import { format, isToday, isYesterday } from 'date-fns';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useMessages } from '../../hooks/useMessages';
import { useActiveTrips } from '../../hooks/useActiveTrips';
import { useCommandCenter, useSendContextMessage } from '../../hooks/useCommandCenter';
import { extractApiError } from '../../lib/api-error';
import { useAuthStore } from '../../store/auth.store';
import { Icon } from '../../components/design/Icon';

type InboxThread = {
  key: string;
  title: string;
  subtitle: string;
  scope: string;
  context?: AdminActionContext;
  busId?: string;
  tripId?: string;
  routeId?: string;
  tone: 'ok' | 'warn' | 'err' | 'info' | 'idle';
};

const dateGroupLabel = (date: Date) => {
  if (isToday(date)) {
    return 'TODAY';
  }
  if (isYesterday(date)) {
    return 'YESTERDAY';
  }
  return format(date, 'EEE, MMM d').toUpperCase();
};

export const Messages: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { capabilities } = useAuthStore();
  const { data: commandCenter } = useCommandCenter();
  const { data: activeTrips = [] } = useActiveTrips();
  const sendContextMessage = useSendContextMessage();
  const [selectedThreadKey, setSelectedThreadKey] = useState('broadcast-global');
  const [inputText, setInputText] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [threadSearch, setThreadSearch] = useState('');

  const navState = location.state as {
    contextType?: string;
    contextId?: string;
    composerPrefill?: string;
  } | null;

  // Pre-select thread from incident navigation — reads commandCenter directly so
  // it can set selectedThreadKey before the threads useMemo finishes computing.
  useEffect(() => {
    const incidentId = navState?.contextId ?? searchParams.get('incidentId');
    const contextType = navState?.contextType ?? searchParams.get('contextType');
    if (incidentId && contextType === 'INCIDENT') {
      const entity = commandCenter?.entities?.find(
        (e) => e.context.contextType === 'INCIDENT' && e.context.contextId === incidentId,
      );
      if (entity) {
        setSelectedThreadKey(`INCIDENT-${incidentId}`);
      }
    }

    if (navState?.composerPrefill) {
      setInputText(navState.composerPrefill);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [commandCenter, location.pathname, navState, navigate, searchParams]);

  const threads = useMemo<InboxThread[]>(() => {
    const items = new Map<string, InboxThread>();

    items.set('broadcast-global', {
      key: 'broadcast-global',
      title: 'Global Broadcast',
      subtitle: 'All drivers and coordinators',
      scope: 'BROADCAST',
      context: {
        contextType: 'BROADCAST',
        contextId: 'GLOBAL',
        title: 'Global Broadcast',
        subtitle: 'All drivers and coordinators',
      },
      tone: 'info',
    });

    for (const entity of commandCenter?.entities ?? []) {
      const key = `${entity.context.contextType}-${entity.context.contextId}`;
      if (!items.has(key)) {
        items.set(key, {
          key,
          title: entity.title,
          subtitle: entity.summary,
          scope: entity.context.contextType,
          context: entity.context,
          busId: entity.context.busId,
          tripId: entity.context.tripId,
          routeId: entity.context.routeId,
          tone: entity.priority === 'CRITICAL' ? 'err' : entity.priority === 'HIGH' ? 'warn' : 'info',
        });
      }
    }

    for (const trip of activeTrips) {
      const key = `TRIP-${trip.id}`;
      if (!items.has(key)) {
        items.set(key, {
          key,
          title: `Bus ${trip.busNumber}`,
          subtitle: `${trip.routeName} - ${trip.boardedCount}/${trip.expectedCount} boarded`,
          scope: 'TRIP',
          context: {
            contextType: 'TRIP',
            contextId: trip.id,
            tripId: trip.id,
            busId: trip.busId,
            title: `Trip ${trip.routeName}`,
            subtitle: `Bus ${trip.busNumber}`,
          },
          busId: trip.busId,
          tripId: trip.id,
          tone: trip.gpsStatus === 'OFFLINE' ? 'err' : trip.gpsStatus === 'STALE' ? 'warn' : 'ok',
        });
      }
    }

    return Array.from(items.values());
  }, [activeTrips, commandCenter?.entities]);

  const visibleThreads = useMemo(() => {
    const q = threadSearch.toLowerCase().trim();
    if (!q) {
      return threads;
    }
    return threads.filter((thread) =>
      thread.title.toLowerCase().includes(q)
        || thread.subtitle.toLowerCase().includes(q)
        || thread.scope.toLowerCase().includes(q),
    );
  }, [threadSearch, threads]);

  useEffect(() => {
    if (!threads.some((thread) => thread.key === selectedThreadKey)) {
      setSelectedThreadKey(threads[0]?.key ?? 'broadcast-global');
    }
  }, [selectedThreadKey, threads]);

  const selectedThread = threads.find((thread) => thread.key === selectedThreadKey) ?? threads[0];
  const { data: messages = [], isLoading } = useMessages(selectedThread?.busId, 100, selectedThread?.context);

  const selectedTripState = useMemo(
    () => activeTrips.find((trip) => trip.id === selectedThread?.tripId) ?? null,
    [activeTrips, selectedThread?.tripId],
  );

  const messageGroups = useMemo(() => {
    const groups = new Map<string, AdminMessage[]>();
    for (const message of messages) {
      const date = new Date(message.createdAt);
      const key = format(date, 'yyyy-MM-dd');
      const group = groups.get(key);
      if (group) {
        group.push(message);
      } else {
        groups.set(key, [message]);
      }
    }
    return Array.from(groups.entries()).map(([key, items]) => ({
      key,
      label: dateGroupLabel(new Date(key)),
      items,
    }));
  }, [messages]);

  const lastMessageByThread = useMemo(() => {
    if (selectedThread && messages.length > 0) {
      return messages[messages.length - 1];
    }
    return null;
  }, [messages, selectedThread]);

  const handleOpenTrip = () => {
    if (selectedThread?.tripId) {
      navigate(`/ops/trips/${selectedThread.tripId}`);
    }
  };

  const sendMessage = async () => {
    if (!inputText.trim() || !selectedThread) {
      return;
    }

    setSendError(null);

    try {
      const payload: AdminMessageInput = selectedThread.context?.contextType === 'BROADCAST'
        ? {
            body: inputText.trim(),
            priority: 'NORMAL',
            type: 'BROADCAST_ALL',
            context: selectedThread.context,
          }
        : {
            body: inputText.trim(),
            priority: selectedThread.scope === 'INCIDENT' || selectedThread.scope === 'GPS_OUTAGE' ? 'URGENT' : 'NORMAL',
            busId: selectedThread.busId,
            routeId: selectedThread.context?.routeId,
            context: selectedThread.context,
          };

      await sendContextMessage.mutateAsync(payload);
      setInputText('');
    } catch (error) {
      setSendError(extractApiError(error).message);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      {/* Left sidebar — Inbox */}
      <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--divider)' }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 500 }}>Inbox</h2>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{visibleThreads.length} thread{visibleThreads.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="searchbar">
            <Icon name="search" size={12} />
            <input
              value={threadSearch}
              onChange={(event) => setThreadSearch(event.target.value)}
              placeholder="Search threads"
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 12, color: 'var(--ink)' }}
            />
          </div>
        </div>
        <div className="scroll" style={{ flex: 1 }}>
          {visibleThreads.length === 0 ? (
            <div className="muted" style={{ padding: 16, textAlign: 'center', fontSize: 12 }}>
              {threadSearch ? 'No threads match your search.' : 'No threads yet.'}
            </div>
          ) : null}
          {visibleThreads.map((thread) => {
            const initials = thread.title.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase()).join('');
            const isSelected = selectedThread?.key === thread.key;
            return (
              <button
                key={thread.key}
                type="button"
                onClick={() => setSelectedThreadKey(thread.key)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 16px',
                  borderBottom: '1px solid var(--divider)',
                  background: isSelected ? 'var(--surface-2)' : 'transparent',
                  borderLeft: isSelected ? '2px solid var(--ink)' : '2px solid transparent',
                  display: 'flex',
                  gap: 10,
                  transition: 'all var(--t-fast)',
                }}
              >
                <div style={{
                  width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--surface-3)', border: '1px solid var(--border-2)',
                  fontSize: 11, fontWeight: 500, color: 'var(--ink-2)',
                }}>
                  {initials}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{thread.title}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>
                    {thread.scope === 'BROADCAST' ? 'Broadcast' : thread.scope === 'TRIP' ? `Driver · ${thread.context?.tripId?.slice(0, 8) ?? ''}` : thread.scope}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {thread.subtitle}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Center — Chat area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Chat header */}
        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--divider)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="row gap-8">
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 500 }}>
                {selectedThread?.title ?? 'Conversation'}
              </span>
              {selectedThread?.scope !== 'BROADCAST' && (
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {selectedThread?.scope === 'TRIP' ? 'Driver' : selectedThread?.scope} · trip {selectedThread?.context?.tripId?.slice(0, 8) ?? ''}
                </span>
              )}
            </div>
            {lastMessageByThread ? (
              <div className="row gap-6" style={{ marginTop: 2 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  Last message {format(new Date(lastMessageByThread.createdAt), 'HH:mm')}
                </span>
              </div>
            ) : null}
          </div>
          <div className="row gap-8">
            {selectedThread?.tripId ? (
              <button className="btn sm" type="button" onClick={handleOpenTrip}>Open trip</button>
            ) : null}
          </div>
        </div>

        {/* Messages */}
        <div className="scroll" style={{ flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {isLoading ? (
            <div className="muted" style={{ textAlign: 'center', paddingTop: 40 }}>Loading messages…</div>
          ) : messages.length === 0 ? (
            <div className="muted" style={{ textAlign: 'center', paddingTop: 40 }}>No messages in this thread yet.</div>
          ) : (
            messageGroups.map((group) => (
              <React.Fragment key={group.key}>
                <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 11, padding: '8px 0' }}>{group.label}</div>
                {group.items.map((message) => {
                  const isAdmin = ['TRANSPORT_OFFICER', 'COORDINATOR'].includes(message.sender.role);
                  return (
                    <div key={message.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isAdmin ? 'flex-end' : 'flex-start', gap: 2 }}>
                      <div
                        style={{
                          maxWidth: '65%',
                          padding: '10px 14px',
                          borderRadius: isAdmin ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                          background: isAdmin ? 'var(--ink)' : 'var(--surface-2)',
                          color: isAdmin ? '#fff' : 'var(--ink)',
                          border: isAdmin ? 'none' : '1px solid var(--border)',
                          fontSize: 13,
                          lineHeight: 1.45,
                        }}
                      >
                        {message.body}
                      </div>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
                        {format(new Date(message.createdAt), 'HH:mm')}
                      </span>
                    </div>
                  );
                })}
              </React.Fragment>
            ))
          )}
        </div>

        {/* Quick replies + compose */}
        <div style={{ borderTop: '1px solid var(--divider)', padding: '10px 20px' }}>
          <div className="row gap-6" style={{ marginBottom: 10 }}>
            {['Acknowledge', 'ETA holds', 'Need ETA', 'Pull over safely'].map(chip => (
              <button key={chip} type="button" className="btn sm" onClick={() => setInputText(chip)}>{chip}</button>
            ))}
          </div>
          <div className="row gap-10">
            <input
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder="Reply to driver…"
              disabled={!capabilities?.canMessageDrivers}
              style={{
                flex: 1, padding: '10px 14px',
                border: '1px solid var(--border-2)', borderRadius: 'var(--r-pill)',
                background: 'var(--surface-2)', outline: 'none', fontSize: 13,
              }}
            />
            <button className="btn primary sm" type="button" disabled={sendContextMessage.isPending || !capabilities?.canMessageDrivers || !inputText.trim()} onClick={() => void sendMessage()}>
              <Icon name="send" size={11} /> Send
            </button>
          </div>
          {sendError ? <div className="pill pill--err" style={{ marginTop: 6, width: 'fit-content', textTransform: 'none', fontSize: 11 }}>{sendError}</div> : null}
        </div>
      </div>

      {/* Right sidebar — Context */}
      <div style={{ width: 220, flexShrink: 0, borderLeft: '1px solid var(--border)', background: 'var(--surface)', padding: '16px 14px' }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Context</div>
        <div style={{ display: 'grid', gap: 10, fontSize: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="muted">Trip</span>
            <span className="mono" style={{ fontSize: 11 }}>{selectedThread?.tripId?.slice(0, 8) ?? '—'}</span>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="muted">Route</span>
            <span style={{ fontSize: 11, textAlign: 'right', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {selectedTripState?.routeName ?? selectedThread?.routeId?.slice(0, 8) ?? '—'}
            </span>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="muted">Bus</span>
            <span className="mono" style={{ fontSize: 11 }}>{selectedTripState?.busNumber ?? selectedThread?.busId?.slice(0, 8) ?? '—'}</span>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="muted">Onboard</span>
            <span className="mono" style={{ fontSize: 11 }}>
              {selectedTripState ? `${selectedTripState.boardedCount}/${selectedTripState.expectedCount}` : '—'}
            </span>
          </div>
          {selectedTripState?.gpsStatus ? (
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted">GPS</span>
              <span className="mono" style={{ fontSize: 11 }}>{selectedTripState.gpsStatus}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default Messages;
