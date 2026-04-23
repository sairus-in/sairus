import React, { useEffect, useMemo, useState } from 'react';
import { AdminActionContext, AdminMessageInput } from 'shared';
import { useMessages } from '../../hooks/useMessages';
import { useActiveTrips } from '../../hooks/useActiveTrips';
import { useCommandCenter, useSendContextMessage } from '../../hooks/useCommandCenter';
import { extractApiError } from '../../lib/api-error';
import { useAuthStore } from '../../store/auth.store';
import { AlertCircle, Bus, MessageSquare, Send, Siren, Users } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';

type InboxThread = {
  key: string;
  title: string;
  subtitle: string;
  scope: string;
  context?: AdminActionContext;
  busId?: string;
  accent: string;
};

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

export const Messages: React.FC = () => {
  const { capabilities } = useAuthStore();
  const { data: commandCenter } = useCommandCenter();
  const { data: activeTrips = [] } = useActiveTrips();
  const sendContextMessage = useSendContextMessage();

  const [selectedThreadKey, setSelectedThreadKey] = useState('broadcast-global');
  const [inputText, setInputText] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);

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
      accent: '#38BDF8',
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
          accent: entity.priority === 'CRITICAL' ? '#EF4444' : entity.priority === 'HIGH' ? '#F97316' : '#F59E0B',
        });
      }
    }

    for (const trip of activeTrips) {
      const key = `TRIP-${trip.id}`;
      if (!items.has(key)) {
        items.set(key, {
          key,
          title: `Bus ${trip.busNumber} - ${trip.routeName}`,
          subtitle: `${trip.boardedCount}/${trip.expectedCount} boarded`,
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
          accent: trip.gpsStatus === 'OFFLINE' ? '#EF4444' : trip.gpsStatus === 'STALE' ? '#F59E0B' : '#22C55E',
        });
      }
    }

    return Array.from(items.values());
  }, [activeTrips, commandCenter?.entities]);

  useEffect(() => {
    if (!threads.some((thread) => thread.key === selectedThreadKey)) {
      setSelectedThreadKey(threads[0]?.key ?? 'broadcast-global');
    }
  }, [selectedThreadKey, threads]);

  const selectedThread = threads.find((thread) => thread.key === selectedThreadKey) ?? threads[0];
  const { data: messages = [], isLoading } = useMessages(selectedThread?.busId, 100, selectedThread?.context);

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

  const incidentThreads = threads.filter((thread) => thread.scope === 'INCIDENT' || thread.scope === 'GPS_OUTAGE');
  const tripThreads = threads.filter((thread) => thread.scope === 'TRIP');

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr)', gap: '1rem', height: '100%' }}>
      <section style={{ ...panelStyle, overflow: 'hidden' }}>
        <div>
          <div style={{ fontSize: '0.78rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#38BDF8', fontWeight: 800 }}>
            Ops Inbox
          </div>
          <h2 style={{ margin: '0.35rem 0 0', fontSize: '1.4rem', fontWeight: 800 }}>Contextual communications</h2>
          <p style={{ margin: '0.45rem 0 0', color: '#9CA3AF', fontSize: '0.9rem' }}>
            Threads are bound to operations context, not just a bus number.
          </p>
        </div>

        <div style={{ display: 'grid', gap: '0.75rem', overflowY: 'auto' }}>
          <div>
            <div style={{ color: '#64748B', fontSize: '0.74rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
              Broadcast
            </div>
            {threads
              .filter((thread) => thread.scope === 'BROADCAST')
              .map((thread) => (
                <button
                  key={thread.key}
                  type="button"
                  onClick={() => setSelectedThreadKey(thread.key)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '0.95rem 1rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    backgroundColor: selectedThread?.key === thread.key ? '#1E293B' : '#0F172A',
                    border: `1px solid ${selectedThread?.key === thread.key ? thread.accent : '#1F2937'}`,
                    borderRadius: '1rem',
                    cursor: 'pointer',
                    color: 'white',
                  }}
                >
                  <Users size={18} color={thread.accent} />
                  <div>
                    <div style={{ fontWeight: 700 }}>{thread.title}</div>
                    <div style={{ fontSize: '0.78rem', color: '#9CA3AF' }}>{thread.subtitle}</div>
                  </div>
                </button>
              ))}
          </div>

          <div>
            <div style={{ color: '#64748B', fontSize: '0.74rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
              Active response threads
            </div>
            {incidentThreads.length === 0 ? (
              <div style={{ color: '#9CA3AF', fontSize: '0.84rem' }}>No critical contextual threads.</div>
            ) : (
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                {incidentThreads.map((thread) => (
                  <button
                    key={thread.key}
                    type="button"
                    onClick={() => setSelectedThreadKey(thread.key)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '0.95rem 1rem',
                      display: 'grid',
                      gap: '0.3rem',
                      backgroundColor: selectedThread?.key === thread.key ? '#1E293B' : '#0F172A',
                      border: `1px solid ${selectedThread?.key === thread.key ? thread.accent : '#1F2937'}`,
                      borderRadius: '1rem',
                      cursor: 'pointer',
                      color: 'white',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                      <div style={{ fontWeight: 700 }}>{thread.title}</div>
                      <Siren size={16} color={thread.accent} />
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#CBD5E1', lineHeight: 1.4 }}>{thread.subtitle}</div>
                    <div style={{ fontSize: '0.72rem', color: thread.accent, fontWeight: 700 }}>{thread.scope}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <div style={{ color: '#64748B', fontSize: '0.74rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
              Trip threads
            </div>
            {tripThreads.length === 0 ? (
              <div style={{ color: '#9CA3AF', fontSize: '0.84rem' }}>No active trip threads.</div>
            ) : (
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                {tripThreads.map((thread) => (
                  <button
                    key={thread.key}
                    type="button"
                    onClick={() => setSelectedThreadKey(thread.key)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '0.95rem 1rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      backgroundColor: selectedThread?.key === thread.key ? '#1E293B' : '#0F172A',
                      border: `1px solid ${selectedThread?.key === thread.key ? thread.accent : '#1F2937'}`,
                      borderRadius: '1rem',
                      cursor: 'pointer',
                      color: 'white',
                    }}
                  >
                    <Bus size={18} color={thread.accent} />
                    <div>
                      <div style={{ fontWeight: 700 }}>{thread.title}</div>
                      <div style={{ fontSize: '0.78rem', color: '#9CA3AF' }}>{thread.subtitle}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section style={{ ...panelStyle, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <MessageSquare size={18} color={selectedThread?.accent || '#38BDF8'} />
              <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>{selectedThread?.title}</h2>
            </div>
            <div style={{ marginTop: '0.35rem', color: '#9CA3AF', fontSize: '0.9rem' }}>{selectedThread?.subtitle}</div>
          </div>
          <div style={{ padding: '0.35rem 0.65rem', borderRadius: 999, background: '#0F172A', border: '1px solid #1F2937', color: selectedThread?.accent || '#38BDF8', fontSize: '0.75rem', fontWeight: 800 }}>
            {selectedThread?.scope}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.75rem' }}>
          <div style={{ borderRadius: 16, background: '#0F172A', border: '1px solid #1E293B', padding: '0.9rem' }}>
            <div style={{ color: '#64748B', fontSize: '0.76rem', textTransform: 'uppercase' }}>Scope</div>
            <div style={{ marginTop: '0.3rem', color: '#F8FAFC', fontWeight: 700 }}>{selectedThread?.scope}</div>
          </div>
          <div style={{ borderRadius: 16, background: '#0F172A', border: '1px solid #1E293B', padding: '0.9rem' }}>
            <div style={{ color: '#64748B', fontSize: '0.76rem', textTransform: 'uppercase' }}>Route / bus</div>
            <div style={{ marginTop: '0.3rem', color: '#F8FAFC', fontWeight: 700 }}>{selectedThread?.context?.routeId || selectedThread?.busId || 'Fleet wide'}</div>
          </div>
          <div style={{ borderRadius: 16, background: '#0F172A', border: '1px solid #1E293B', padding: '0.9rem' }}>
            <div style={{ color: '#64748B', fontSize: '0.76rem', textTransform: 'uppercase' }}>Access</div>
            <div style={{ marginTop: '0.3rem', color: '#F8FAFC', fontWeight: 700 }}>{capabilities?.canMessageDrivers ? 'Actionable' : 'Read only'}</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.2rem', display: 'flex', flexDirection: 'column-reverse', gap: '1rem' }}>
          {isLoading ? (
            <div style={{ color: '#9CA3AF', textAlign: 'center' }}>Loading messages...</div>
          ) : messages.length === 0 ? (
            <div style={{ color: '#9CA3AF', textAlign: 'center', padding: '2rem' }}>No messages found in this scope.</div>
          ) : (
            messages.map((message) => {
              const isAdmin = ['TRANSPORT_OFFICER', 'COORDINATOR'].includes(message.sender.role);
              return (
                <div
                  key={message.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: isAdmin ? 'flex-end' : 'flex-start',
                    gap: '0.25rem',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: '#9CA3AF', display: 'flex', gap: '0.5rem' }}>
                    <span>{message.sender.name} ({message.sender.role})</span>
                    <span>|</span>
                    <span>{format(new Date(message.createdAt), 'HH:mm')}</span>
                  </div>
                  <div
                    style={{
                      padding: '0.8rem 1rem',
                      backgroundColor: isAdmin ? '#2563EB' : '#374151',
                      color: 'white',
                      borderRadius: '0.8rem',
                      borderTopRightRadius: isAdmin ? 0 : '0.8rem',
                      borderTopLeftRadius: isAdmin ? '0.8rem' : 0,
                      maxWidth: '78%',
                      wordBreak: 'break-word',
                      border: message.priority === 'URGENT' ? '1px solid #EF4444' : '1px solid transparent',
                    }}
                  >
                    {message.priority === 'URGENT' && <AlertCircle size={14} color="#FCA5A5" style={{ display: 'inline', marginRight: '6px' }} />}
                    {message.body}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#64748B' }}>
                    {formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div style={{ borderTop: '1px solid #1F2937', paddingTop: '1rem', display: 'grid', gap: '0.75rem' }}>
          <textarea
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                void sendMessage();
              }
            }}
            placeholder={capabilities?.canMessageDrivers ? 'Type a contextual operations update...' : 'Read-only for your role'}
            disabled={!capabilities?.canMessageDrivers}
            rows={4}
            style={{
              resize: 'vertical',
              padding: '0.85rem 1rem',
              backgroundColor: '#020617',
              color: 'white',
              border: '1px solid #334155',
              borderRadius: '1rem',
              outline: 'none',
            }}
          />

          {sendError && (
            <div style={{ borderRadius: 14, background: 'rgba(127, 29, 29, 0.45)', border: '1px solid rgba(248, 113, 113, 0.35)', color: '#FCA5A5', padding: '0.85rem 0.95rem' }}>
              {sendError}
            </div>
          )}

          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={sendContextMessage.isPending || !capabilities?.canMessageDrivers || !inputText.trim()}
            style={{
              padding: '0.9rem 1rem',
              backgroundColor: !capabilities?.canMessageDrivers || !inputText.trim() ? '#334155' : '#3B82F6',
              color: 'white',
              border: 'none',
              borderRadius: '1rem',
              cursor: !capabilities?.canMessageDrivers || !inputText.trim() ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              fontWeight: 800,
            }}
          >
            <span>Send contextual update</span>
            <Send size={16} />
          </button>
        </div>
      </section>
    </div>
  );
};

export default Messages;
