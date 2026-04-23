import React, { useMemo, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock3, RadioTower, ShieldAlert, XCircle } from 'lucide-react';
import { AdminGpsOutageCorrection, AdminGpsOutageItem } from 'shared';
import { useResolveCorrection } from '../../hooks/useCorrections';
import { useCoordinatorOverride, useGpsOutageCorrections, useGpsOutageQueue } from '../../hooks/useGpsOutages';
import { queryClient } from '../../lib/query-client';

const panelStyle: React.CSSProperties = {
  backgroundColor: '#1F2937',
  border: '1px solid #374151',
  borderRadius: '0.75rem',
};

const statCardStyle: React.CSSProperties = {
  ...panelStyle,
  padding: '1rem 1.25rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
};

const formatTimestamp = (value: string | null) => (value ? format(new Date(value), 'MMM d, h:mm a') : 'Not available');

const groupCorrectionsByBus = (corrections: AdminGpsOutageCorrection[]) => {
  return corrections.reduce<Record<string, AdminGpsOutageCorrection[]>>((groups, correction) => {
    const busNumber = correction.attendance.trip.bus.number;
    if (!groups[busNumber]) {
      groups[busNumber] = [];
    }
    groups[busNumber].push(correction);
    return groups;
  }, {});
};

const OutageCard = ({
  item,
  onOpenTrip,
  onOverride,
  isMutating,
}: {
  item: AdminGpsOutageItem;
  onOpenTrip: (tripId: string) => void;
  onOverride: (tripId: string) => void;
  isMutating: boolean;
}) => {
  return (
    <div style={{ ...panelStyle, padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#FCA5A5', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <RadioTower size={14} />
            {item.queueStatus === 'ACTIVE_OUTAGE' ? 'Active outage' : 'Review window'}
          </div>
          <h2 style={{ margin: '0.4rem 0 0 0', fontSize: '1.05rem', color: '#FFFFFF' }}>
            Bus {item.busNumber} • {item.routeName}
          </h2>
          <div style={{ marginTop: '0.3rem', color: '#94A3B8', fontSize: '0.85rem' }}>
            Trip {item.tripId.slice(0, 8)} • {item.tripStatus === 'ACTIVE' ? 'In progress' : 'Completed'}
          </div>
        </div>

        <span style={{
          padding: '0.3rem 0.65rem',
          borderRadius: '999px',
          backgroundColor: item.queueStatus === 'ACTIVE_OUTAGE' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.12)',
          color: item.queueStatus === 'ACTIVE_OUTAGE' ? '#FCA5A5' : '#FCD34D',
          border: item.queueStatus === 'ACTIVE_OUTAGE' ? '1px solid rgba(252, 165, 165, 0.2)' : '1px solid rgba(252, 211, 77, 0.2)',
          fontSize: '0.75rem',
          fontWeight: 700,
        }}>
          {item.outageDurationMinutes ? `${item.outageDurationMinutes} min` : 'Investigate'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '0.75rem' }}>
        <div style={statCardStyle}>
          <span style={{ color: '#94A3B8', fontSize: '0.75rem', textTransform: 'uppercase' }}>Pending Students</span>
          <strong style={{ color: '#FFFFFF', fontSize: '1.2rem' }}>{item.pendingStudents}</strong>
        </div>
        <div style={statCardStyle}>
          <span style={{ color: '#94A3B8', fontSize: '0.75rem', textTransform: 'uppercase' }}>Outage Corrections</span>
          <strong style={{ color: '#FFFFFF', fontSize: '1.2rem' }}>{item.pendingOutageCorrections}</strong>
        </div>
        <div style={statCardStyle}>
          <span style={{ color: '#94A3B8', fontSize: '0.75rem', textTransform: 'uppercase' }}>Boarded</span>
          <strong style={{ color: '#FFFFFF', fontSize: '1.2rem' }}>{item.boardedCount} / {item.expectedCount}</strong>
        </div>
        <div style={statCardStyle}>
          <span style={{ color: '#94A3B8', fontSize: '0.75rem', textTransform: 'uppercase' }}>Fallback State</span>
          <strong style={{ color: '#FFFFFF', fontSize: '0.95rem' }}>
            {item.delegateActive ? 'Delegate active' : item.outageWindowOpen ? 'Review open' : item.escalationScheduled ? 'Escalated' : 'Pending'}
          </strong>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', color: '#CBD5E1', fontSize: '0.85rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <span><Clock3 size={14} style={{ marginRight: '0.35rem', verticalAlign: 'text-bottom' }} /> Started {formatTimestamp(item.startedAt)}</span>
          <span><AlertTriangle size={14} style={{ marginRight: '0.35rem', verticalAlign: 'text-bottom' }} /> Outage since {formatTimestamp(item.outageSince)}</span>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            type="button"
            onClick={() => onOpenTrip(item.tripId)}
            style={{
              padding: '0.65rem 0.95rem',
              borderRadius: '0.5rem',
              border: '1px solid #475569',
              background: 'transparent',
              color: '#E2E8F0',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Open Trip
          </button>
          <button
            type="button"
            disabled={item.pendingStudents === 0 || isMutating}
            onClick={() => onOverride(item.tripId)}
            style={{
              padding: '0.65rem 0.95rem',
              borderRadius: '0.5rem',
              border: 'none',
              background: item.pendingStudents === 0 || isMutating ? '#475569' : '#DC2626',
              color: '#FFFFFF',
              cursor: item.pendingStudents === 0 || isMutating ? 'not-allowed' : 'pointer',
              fontWeight: 700,
            }}
          >
            {isMutating ? 'Applying...' : 'Coordinator Override'}
          </button>
        </div>
      </div>
    </div>
  );
};

export const GPSOutageQueue: React.FC = () => {
  const navigate = useNavigate();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyTripId, setBusyTripId] = useState<string | null>(null);
  const { data: queue, isLoading: queueLoading, error: queueError } = useGpsOutageQueue();
  const { data: corrections = [], isLoading: correctionsLoading, error: correctionsError } = useGpsOutageCorrections();
  const { mutate: resolveCorrection, isPending: resolvingCorrection } = useResolveCorrection();
  const { mutate: applyOverride } = useCoordinatorOverride();

  const groupedCorrections = useMemo(() => groupCorrectionsByBus(corrections), [corrections]);

  const handleReview = (id: string, status: 'APPROVED' | 'REJECTED') => {
    setActionError(null);
    resolveCorrection(
      { id, status },
      {
        onSuccess: async () => {
          await queryClient.invalidateQueries({ queryKey: ['ops', 'gps-outage-corrections'] });
          await queryClient.invalidateQueries({ queryKey: ['ops', 'gps-outages'] });
        },
        onError: () => {
          setActionError(`Failed to ${status === 'APPROVED' ? 'approve' : 'reject'} outage correction.`);
        },
      }
    );
  };

  const handleOverride = (tripId: string) => {
    setActionError(null);
    setBusyTripId(tripId);
    applyOverride(tripId, {
      onSuccess: () => {
        setBusyTripId(null);
      },
      onError: () => {
        setBusyTripId(null);
        setActionError('Coordinator override failed. Refresh the queue and retry.');
      },
    });
  };

  if (queueLoading && correctionsLoading) {
    return <div style={{ color: '#94A3B8' }}>Loading outage operations...</div>;
  }

  const errorMessage = queueError instanceof Error
    ? queueError.message
    : correctionsError instanceof Error
      ? correctionsError.message
      : null;

  if (errorMessage) {
    return <div style={{ color: '#FCA5A5' }}>Failed to load GPS outage queue: {errorMessage}</div>;
  }

  const activeOutages = queue?.activeOutages ?? [];
  const reviewQueue = queue?.reviewQueue ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', color: '#FCA5A5', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem' }}>
          <ShieldAlert size={15} />
          GPS outage operations
        </div>
        <h1 style={{ margin: '0.5rem 0 0 0', color: '#FFFFFF', fontSize: '1.8rem' }}>GPS Outage Escalation Queue</h1>
        <p style={{ margin: '0.45rem 0 0 0', color: '#94A3B8', maxWidth: '70ch' }}>
          Monitor active telemetry outages, review post-trip outage windows, and approve student self-reports without leaving the admin panel.
        </p>
      </div>

      {actionError && (
        <div style={{ ...panelStyle, padding: '0.9rem 1rem', color: '#FCA5A5', borderColor: 'rgba(252, 165, 165, 0.3)' }}>
          {actionError}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '1rem' }}>
        <div style={statCardStyle}>
          <span style={{ color: '#94A3B8', fontSize: '0.75rem', textTransform: 'uppercase' }}>Active outages</span>
          <strong style={{ color: '#FFFFFF', fontSize: '1.8rem' }}>{activeOutages.length}</strong>
        </div>
        <div style={statCardStyle}>
          <span style={{ color: '#94A3B8', fontSize: '0.75rem', textTransform: 'uppercase' }}>Review windows</span>
          <strong style={{ color: '#FFFFFF', fontSize: '1.8rem' }}>{reviewQueue.length}</strong>
        </div>
        <div style={statCardStyle}>
          <span style={{ color: '#94A3B8', fontSize: '0.75rem', textTransform: 'uppercase' }}>Pending self-reports</span>
          <strong style={{ color: '#FFFFFF', fontSize: '1.8rem' }}>{corrections.length}</strong>
        </div>
        <div style={statCardStyle}>
          <span style={{ color: '#94A3B8', fontSize: '0.75rem', textTransform: 'uppercase' }}>Last refresh</span>
          <strong style={{ color: '#FFFFFF', fontSize: '1rem' }}>
            {queue?.generatedAt ? formatDistanceToNow(new Date(queue.generatedAt), { addSuffix: true }) : 'Unknown'}
          </strong>
        </div>
      </div>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h2 style={{ margin: 0, color: '#FFFFFF', fontSize: '1.15rem' }}>Active Outages</h2>
        {activeOutages.length === 0 ? (
          <div style={{ ...panelStyle, padding: '1.5rem', color: '#94A3B8' }}>
            No buses are currently in GPS outage state.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {activeOutages.map((item) => (
              <OutageCard
                key={item.tripId}
                item={item}
                onOpenTrip={(tripId) => navigate(`/ops/trips/${tripId}`)}
                onOverride={handleOverride}
                isMutating={busyTripId === item.tripId}
              />
            ))}
          </div>
        )}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h2 style={{ margin: 0, color: '#FFFFFF', fontSize: '1.15rem' }}>Post-Trip Review Queue</h2>
        {reviewQueue.length === 0 ? (
          <div style={{ ...panelStyle, padding: '1.5rem', color: '#94A3B8' }}>
            No completed outage windows currently need coordinator review.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {reviewQueue.map((item) => (
              <OutageCard
                key={item.tripId}
                item={item}
                onOpenTrip={(tripId) => navigate(`/ops/trips/${tripId}`)}
                onOverride={handleOverride}
                isMutating={busyTripId === item.tripId}
              />
            ))}
          </div>
        )}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h2 style={{ margin: 0, color: '#FFFFFF', fontSize: '1.15rem' }}>Pending Student Self-Reports</h2>
        {correctionsLoading ? (
          <div style={{ ...panelStyle, padding: '1.5rem', color: '#94A3B8' }}>Loading outage corrections...</div>
        ) : corrections.length === 0 ? (
          <div style={{ ...panelStyle, padding: '1.5rem', color: '#94A3B8' }}>
            No pending outage corrections to review.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {Object.entries(groupedCorrections).map(([busNumber, items]) => (
              <div key={busNumber} style={panelStyle}>
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #374151', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ margin: 0, color: '#FFFFFF', fontSize: '1rem' }}>Bus {busNumber}</h3>
                    <p style={{ margin: '0.25rem 0 0 0', color: '#94A3B8', fontSize: '0.85rem' }}>
                      {items.length} pending self-report{items.length === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>

                <div style={{ padding: '0 1.25rem' }}>
                  {items.map((correction, index) => (
                    <div
                      key={correction.id}
                      style={{
                        padding: '1rem 0',
                        borderBottom: index < items.length - 1 ? '1px solid #334155' : 'none',
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '1rem',
                        alignItems: 'center',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                        <div style={{ color: '#FFFFFF', fontWeight: 600 }}>{correction.requestedBy.name}</div>
                        <div style={{ color: '#94A3B8', fontSize: '0.85rem' }}>
                          {correction.requestedBy.rollNumber || 'No roll number'} • {correction.requestedBy.department || 'No department'}
                        </div>
                        <div style={{ color: '#64748B', fontSize: '0.8rem' }}>
                          Requested {format(new Date(correction.createdAt), 'MMM d, h:mm a')} • Trip {correction.attendance.trip.id.slice(0, 8)}
                        </div>
                        <div style={{ color: '#CBD5E1', fontSize: '0.85rem', maxWidth: '60ch' }}>
                          {correction.reason}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '0.65rem' }}>
                        <button
                          type="button"
                          disabled={resolvingCorrection}
                          onClick={() => handleReview(correction.id, 'APPROVED')}
                          style={{
                            padding: '0.65rem 0.95rem',
                            borderRadius: '0.5rem',
                            border: 'none',
                            background: '#16A34A',
                            color: '#FFFFFF',
                            cursor: resolvingCorrection ? 'not-allowed' : 'pointer',
                            opacity: resolvingCorrection ? 0.6 : 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.35rem',
                            fontWeight: 700,
                          }}
                        >
                          <CheckCircle2 size={15} />
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={resolvingCorrection}
                          onClick={() => handleReview(correction.id, 'REJECTED')}
                          style={{
                            padding: '0.65rem 0.95rem',
                            borderRadius: '0.5rem',
                            border: '1px solid #475569',
                            background: 'transparent',
                            color: '#E2E8F0',
                            cursor: resolvingCorrection ? 'not-allowed' : 'pointer',
                            opacity: resolvingCorrection ? 0.6 : 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.35rem',
                            fontWeight: 700,
                          }}
                        >
                          <XCircle size={15} />
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
