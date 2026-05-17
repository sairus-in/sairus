import React, { useMemo, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { AdminGpsOutageCorrection, AdminGpsOutageItem } from 'shared';
import { useResolveCorrection } from '../../hooks/useCorrections';
import { useCoordinatorOverride, useGpsOutageCorrections, useGpsOutageQueue } from '../../hooks/useGpsOutages';
import { queryClient } from '../../lib/query-client';
import { Icon } from '../../components/design/Icon';
import { KPIBlock, SectionCard, StateBadge, toneClass } from '../../components/design/primitives';

const groupCorrectionsByBus = (corrections: AdminGpsOutageCorrection[]) =>
  corrections.reduce<Record<string, AdminGpsOutageCorrection[]>>((groups, correction) => {
    const busNumber = correction.attendance.trip.bus.number;
    if (!groups[busNumber]) {
      groups[busNumber] = [];
    }
    groups[busNumber].push(correction);
    return groups;
  }, {});

const OutageRow = ({
  item,
  onOpenTrip,
  onOverride,
  isMutating,
}: {
  item: AdminGpsOutageItem;
  onOpenTrip: (tripId: string) => void;
  onOverride: (tripId: string) => void;
  isMutating: boolean;
}) => (
  <tr>
    <td className="mono">{item.busNumber}</td>
    <td>{item.routeName}</td>
    <td><StateBadge state={item.queueStatus === 'ACTIVE_OUTAGE' ? 'OFFLINE' : 'STALE'} label={item.queueStatus === 'ACTIVE_OUTAGE' ? 'Active outage' : 'Review'} /></td>
    <td className="mono">{item.outageDurationMinutes ? `${item.outageDurationMinutes}m` : 'Pending'}</td>
    <td className="mono">{item.boardedCount}/{item.expectedCount}</td>
    <td className="mono">{item.pendingStudents}</td>
    <td>{item.delegateActive ? 'Delegate active' : item.escalationScheduled ? 'Escalated' : item.outageWindowOpen ? 'Review open' : 'Pending'}</td>
    <td>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn sm" type="button" onClick={() => onOpenTrip(item.tripId)}>Open Trip</button>
        <button className="btn sm primary" type="button" disabled={item.pendingStudents === 0 || isMutating} onClick={() => onOverride(item.tripId)}>
          {isMutating ? 'Applying...' : 'Override'}
        </button>
      </div>
    </td>
  </tr>
);

export const GPSOutageQueue: React.FC = () => {
  const navigate = useNavigate();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyTripId, setBusyTripId] = useState<string | null>(null);
  const { data: queue, isLoading: queueLoading, error: queueError } = useGpsOutageQueue();
  const { data: corrections = [], isLoading: correctionsLoading, error: correctionsError } = useGpsOutageCorrections();
  const { mutate: resolveCorrection, isPending: resolvingCorrection } = useResolveCorrection();
  const { mutate: applyOverride } = useCoordinatorOverride();

  const groupedCorrections = useMemo(() => groupCorrectionsByBus(corrections), [corrections]);
  const activeOutages = queue?.activeOutages ?? [];
  const reviewQueue = queue?.reviewQueue ?? [];

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
      },
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

  const errorMessage = queueError instanceof Error
    ? queueError.message
    : correctionsError instanceof Error
      ? correctionsError.message
      : null;

  if (queueLoading && correctionsLoading) {
    return <div className="muted">Loading outage operations...</div>;
  }

  if (errorMessage) {
    return <div className={toneClass('err')} style={{ width: 'fit-content', textTransform: 'none' }}>Failed to load GPS outage queue: {errorMessage}</div>;
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <div style={{ color: 'var(--err)', fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase' }}>GPS Outage Operations</div>
        <h1 style={{ margin: '6px 0 0', fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 500 }}>GPS Outage Queue</h1>
        <div style={{ marginTop: 4, color: 'var(--muted)', fontSize: 12 }}>
          Monitor active telemetry outages, review post-trip windows, and approve student self-reports.
        </div>
      </div>

      {actionError ? <span className={toneClass('err')} style={{ width: 'fit-content', textTransform: 'none' }}>{actionError}</span> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
        <KPIBlock label="Active Outages" value={activeOutages.length} />
        <KPIBlock label="Review Windows" value={reviewQueue.length} />
        <KPIBlock label="Pending Self Reports" value={corrections.length} />
        <KPIBlock label="Last Refresh" value={queue?.generatedAt ? formatDistanceToNow(new Date(queue.generatedAt), { addSuffix: true }) : 'Unknown'} />
      </div>

      <SectionCard title="Active Outages" subtitle={`${activeOutages.length} current`}>
        {activeOutages.length === 0 ? (
          <div className="muted">No buses are currently in GPS outage state.</div>
        ) : (
          <div className="scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Bus</th>
                  <th>Route</th>
                  <th>Queue</th>
                  <th>Outage</th>
                  <th>Load</th>
                  <th>Pending</th>
                  <th>Fallback</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {activeOutages.map((item) => (
                  <OutageRow key={item.tripId} item={item} onOpenTrip={(tripId) => navigate(`/ops/trips/${tripId}`)} onOverride={handleOverride} isMutating={busyTripId === item.tripId} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Post-Trip Review Queue" subtitle={`${reviewQueue.length} completed windows`}>
        {reviewQueue.length === 0 ? (
          <div className="muted">No completed outage windows currently need coordinator review.</div>
        ) : (
          <div className="scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Bus</th>
                  <th>Route</th>
                  <th>Queue</th>
                  <th>Outage</th>
                  <th>Load</th>
                  <th>Pending</th>
                  <th>Fallback</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reviewQueue.map((item) => (
                  <OutageRow key={item.tripId} item={item} onOpenTrip={(tripId) => navigate(`/ops/trips/${tripId}`)} onOverride={handleOverride} isMutating={busyTripId === item.tripId} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Pending Student Self-Reports" subtitle={`${corrections.length} corrections`}>
        {correctionsLoading ? (
          <div className="muted">Loading outage corrections...</div>
        ) : corrections.length === 0 ? (
          <div className="muted">No pending outage corrections to review.</div>
        ) : (
          <div style={{ display: 'grid', gap: 14 }}>
            {Object.entries(groupedCorrections).map(([busNumber, items]) => (
              <div key={busNumber} className="card" style={{ borderRadius: 'var(--r-md)' }}>
                <div className="card-head">
                  <div>
                    <h3>Bus {busNumber}</h3>
                    <span className="dim">{items.length} pending self-report{items.length === 1 ? '' : 's'}</span>
                  </div>
                </div>
                <div className="card-body" style={{ display: 'grid', gap: 10 }}>
                  {items.map((correction) => (
                    <div key={correction.id} style={{ display: 'grid', gap: 6, paddingBottom: 10, borderBottom: '1px solid var(--divider)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <div>
                          <div style={{ fontWeight: 500 }}>{correction.requestedBy.name}</div>
                          <div className="muted" style={{ fontSize: 11 }}>{correction.requestedBy.rollNumber || 'No roll'} · {correction.requestedBy.department || 'No department'}</div>
                        </div>
                        <div className="mono muted" style={{ fontSize: 11 }}>{format(new Date(correction.createdAt), 'MMM d, HH:mm')}</div>
                      </div>
                      <div style={{ color: 'var(--ink-2)', fontSize: 12 }}>{correction.reason}</div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn sm primary" type="button" disabled={resolvingCorrection} onClick={() => handleReview(correction.id, 'APPROVED')}>
                          <Icon name="check" size={11} />
                          Approve
                        </button>
                        <button className="btn sm" type="button" disabled={resolvingCorrection} onClick={() => handleReview(correction.id, 'REJECTED')}>
                          <Icon name="x" size={11} />
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
      </SectionCard>
    </div>
  );
};

export default GPSOutageQueue;
