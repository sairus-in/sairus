import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import { useActiveTrips } from '../../hooks/useActiveTrips';
import { useTripLive, useTripStudents, useTripTimeline } from '../../hooks/useTripDetail';
import { useMessages } from '../../hooks/useMessages';
import { StateBadge } from '../../components/design/primitives';
import { Icon } from '../../components/design/Icon';
import { extractApiError } from '../../lib/api-error';

const TripDetailPanel = ({ tripId, onClose }: { tripId: string; onClose: () => void }) => {
  const navigate = useNavigate();
  const { data: tripLive, isLoading: liveLoading } = useTripLive(tripId);
  const { data: students = [], isLoading: studentsLoading } = useTripStudents(tripId);
  const { data: timeline = [], isLoading: timelineLoading } = useTripTimeline(tripId);
  const { data: messages = [] } = useMessages(tripLive?.busId, 20, {
    contextType: 'TRIP',
    contextId: tripId,
  });

  if (liveLoading) {
    return (
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="skel" style={{ height: 20, width: '60%', borderRadius: 6 }} />
        <div className="skel" style={{ height: 14, width: '40%', borderRadius: 6 }} />
        <div className="skel" style={{ height: 80, borderRadius: 10 }} />
        <div className="skel" style={{ height: 120, borderRadius: 10 }} />
      </div>
    );
  }

  if (!tripLive) {
    return (
      <div style={{ padding: 24 }}>
        <p className="dim" style={{ fontSize: 13 }}>Trip not found or no longer active.</p>
      </div>
    );
  }

  const boardingPct = tripLive.expectedCount > 0 ? Math.round((tripLive.boardedCount / tripLive.expectedCount) * 100) : 0;

  return (
    <div
      key={tripId}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        height: '100%',
        overflowY: 'auto',
        animation: 'fleetops-fade-in 220ms var(--ease-out) both',
      }}
    >
      {/* Header */}
      <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                Bus {tripLive.busNumber}
              </span>
              <StateBadge state={tripLive.status} />
              <StateBadge state={tripLive.gpsStatus} />
            </div>
            <div style={{ marginTop: 4, color: 'var(--muted)', fontSize: 12 }}>
              {tripLive.routeName}
              {tripLive.driverName ? ` · ${tripLive.driverName}` : ''}
            </div>
          </div>
          <button className="btn ghost icon-only btn sm" onClick={onClose} aria-label="Close panel">
            <Icon name="x" size={14} />
          </button>
        </div>

        <button
          className="btn primary sm"
          onClick={() => navigate(`/ops/trips/${tripId}`)}
          style={{ marginTop: 8 }}
        >
          <Icon name="radio" size={12} />
          Open command center
        </button>
      </div>

      {/* Summary grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, borderBottom: '1px solid var(--border)', background: 'var(--border)' }}>
        {[
          { label: 'Boarded', value: `${tripLive.boardedCount}/${tripLive.expectedCount}` },
          { label: 'Load', value: `${boardingPct}%` },
          { label: 'Started', value: format(new Date(tripLive.startedAt), 'HH:mm') },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: 'var(--surface)', padding: '10px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>
              {label}
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Timeline */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 10 }}>
          Timeline
        </div>
        {timelineLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="skel" style={{ height: 12, width: '70%', borderRadius: 4 }} />
            <div className="skel" style={{ height: 12, width: '50%', borderRadius: 4 }} />
          </div>
        ) : timeline.length === 0 ? (
          <p className="dim" style={{ fontSize: 12, margin: 0 }}>No events yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {timeline.slice(0, 6).map((event, index) => (
              <div key={event.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ink-2)', marginTop: 3 }} />
                  {index < Math.min(timeline.length, 6) - 1 && (
                    <div style={{ width: 1, flex: 1, background: 'var(--divider)', minHeight: 14, marginTop: 4 }} />
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.4 }}>{event.message}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                    {format(new Date(event.timestamp), 'HH:mm')}
                    {event.actor ? ` · ${event.actor}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Student manifest */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 10 }}>
          Manifest ({students.length})
        </div>
        {studentsLoading ? (
          <div className="skel" style={{ height: 60, borderRadius: 8 }} />
        ) : students.length === 0 ? (
          <p className="dim" style={{ fontSize: 12, margin: 0 }}>No students on manifest.</p>
        ) : (
          <table className="table" style={{ fontSize: 11.5 }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Roll</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}>
                  <td style={{ color: 'var(--ink)', fontSize: 12 }}>{s.user.name}</td>
                  <td className="mono dim">{s.user.rollNumber || '—'}</td>
                  <td><StateBadge state={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Recent comms */}
      <div style={{ padding: '14px 20px' }}>
        <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 10 }}>
          Recent Comms
        </div>
        {messages.length === 0 ? (
          <p className="dim" style={{ fontSize: 12, margin: 0 }}>No messages yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.slice(0, 5).map((msg) => (
              <div key={msg.id} style={{ padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink-2)' }}>{msg.sender.name}</span>
                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                    {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.45 }}>{msg.body}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export const TripsList: React.FC = () => {
  const { data: trips = [], isLoading, error } = useActiveTrips();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return trips;
    return trips.filter(
      (t) =>
        t.busNumber.toLowerCase().includes(q) ||
        t.routeName.toLowerCase().includes(q) ||
        (t.driverName ?? '').toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q),
    );
  }, [trips, search]);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: selectedId ? '520px minmax(0,1fr)' : '1fr',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        animation: 'fleetops-fade-in 280ms var(--ease-out) both',
      }}
    >
      {/* Left panel — trip list */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          borderRight: selectedId ? '1px solid var(--border)' : 'none',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* Toolbar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface)',
          }}
        >
          <div
            className="searchbar is-interactive"
            style={{ flex: 1 }}
          >
            <Icon name="search" size={13} />
            <input
              className="searchbar__input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search trips, routes, buses…"
              style={{ flex: 1, border: 0, background: 'transparent', outline: 'none', fontSize: 12, color: 'var(--ink)' }}
            />
          </div>
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {error ? (
            <div style={{ padding: 20, color: 'var(--err)', fontSize: 13 }}>
              {extractApiError(error).message}
            </div>
          ) : isLoading ? (
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skel" style={{ height: 40, borderRadius: 8 }} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              {search ? 'No trips match your search.' : 'No active trips right now.'}
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th className="sortable">Trip</th>
                  <th className="sortable">Route</th>
                  <th className="sortable">Status</th>
                  <th className="sortable">GPS</th>
                  <th className="sortable">Dep</th>
                  <th className="sortable">Load</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((trip) => (
                  <tr
                    key={trip.id}
                    className={selectedId === trip.id ? 'selected' : ''}
                    onClick={() => setSelectedId(selectedId === trip.id ? null : trip.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>
                      <span className="mono" style={{ fontSize: 12, color: 'var(--ink)' }}>
                        {trip.busNumber}
                      </span>
                    </td>
                    <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {trip.routeName}
                    </td>
                    <td>
                      <StateBadge state={trip.status} />
                    </td>
                    <td>
                      <StateBadge state={trip.gpsStatus} />
                    </td>
                    <td className="mono dim" style={{ fontSize: 11.5 }}>
                      {format(new Date(trip.startedAt), 'HH:mm')}
                    </td>
                    <td className="mono" style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>
                      {trip.boardedCount}/{trip.expectedCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer count */}
        {!isLoading && !error && (
          <div
            style={{
              padding: '8px 16px',
              borderTop: '1px solid var(--border)',
              fontSize: 11,
              color: 'var(--muted)',
              background: 'var(--surface)',
            }}
          >
            {filtered.length} active trip{filtered.length !== 1 ? 's' : ''}
            {search && trips.length !== filtered.length ? ` (${trips.length} total)` : ''}
          </div>
        )}
      </div>

      {/* Right panel — detail */}
      {selectedId && (
        <div
          key={selectedId}
          style={{
            background: 'var(--surface)',
            minHeight: 0,
            overflow: 'hidden',
            animation: 'fleetops-fade-in 220ms var(--ease-out) both',
          }}
        >
          <TripDetailPanel tripId={selectedId} onClose={() => setSelectedId(null)} />
        </div>
      )}
    </div>
  );
};
