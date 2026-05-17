import React from 'react';
import { format } from 'date-fns';
import { Correction, useResolveCorrection } from '../../hooks/useCorrections';
import { StateBadge } from '../design/primitives';

interface CorrectionCardProps {
  correction: Correction;
  onClose: () => void;
}

const statCard: React.CSSProperties = {
  padding: 14,
  borderRadius: 16,
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
};

export const CorrectionCard: React.FC<CorrectionCardProps> = ({ correction, onClose }) => {
  const { mutate: resolve, isPending } = useResolveCorrection();

  const handleApprove = () => resolve({ id: correction.id, status: 'APPROVED' }, { onSuccess: onClose });
  const handleReject = () => resolve({ id: correction.id, status: 'REJECTED' }, { onSuccess: onClose });

  const att = correction.attendance;
  const isGpsOutage = correction.reason.toLowerCase().includes('gps outage') || correction.reason.toLowerCase().includes('offline');

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 500 }}>Correction Request</h2>
          <div style={{ marginTop: 6, color: 'var(--muted)' }}>
            Requested by {correction.requestedBy.name} ({correction.requestedBy.role}) on {format(new Date(correction.createdAt), 'MMM d, h:mm a')}
          </div>
        </div>
        <StateBadge state={isGpsOutage ? 'REPORTED' : 'ASSIGNED'} label={isGpsOutage ? 'GPS Related' : 'Standard'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={statCard}>
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>STUDENT</div>
          <div style={{ marginTop: 8, fontWeight: 500 }}>{att.user.name}</div>
          <div style={{ marginTop: 4, color: 'var(--muted)' }}>{att.user.rollNumber || 'No roll number'} · {att.user.department || 'No department'}</div>
        </div>
        <div style={statCard}>
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>TRIP CONTEXT</div>
          <div style={{ marginTop: 8, fontWeight: 500 }}>Route {att.trip.routeId.substring(0, 8)}</div>
          <div style={{ marginTop: 4, color: 'var(--muted)' }}>{att.trip.date} · Failed: {att.failReason || 'No scan attempts'}</div>
        </div>
      </div>

      <div style={statCard}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>GPS EVIDENCE</div>
        {att.lat && att.lon ? (
          <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
            <div>Lat/Lon: <span className="mono">{att.lat.toFixed(6)}, {att.lon.toFixed(6)}</span></div>
            <div>Distance to Bus: <span className="mono" style={{ color: att.distanceToBus && att.distanceToBus < 200 ? 'var(--ok)' : 'var(--err)' }}>{att.distanceToBus}m</span></div>
            <div>Distance to Stop: <span className="mono">{att.distanceToStop}m</span></div>
          </div>
        ) : (
          <div style={{ marginTop: 8, color: 'var(--warn)' }}>No GPS evidence was provided at the time of failure.</div>
        )}
      </div>

      <div style={{ ...statCard, background: 'var(--surface)' }}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>JUSTIFICATION</div>
        <div style={{ marginTop: 8, lineHeight: 1.6 }}>{correction.reason}</div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button
          type="button"
          disabled={isPending}
          onClick={handleReject}
          style={{ flex: 1, borderRadius: 999, border: '1px solid var(--err)', background: 'var(--err-soft)', color: 'var(--err)', padding: '11px 16px', fontWeight: 500 }}
        >
          Reject
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={handleApprove}
          style={{ flex: 1.4, borderRadius: 999, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--accent-ink)', padding: '11px 16px', fontWeight: 500 }}
        >
          Approve Correction
        </button>
      </div>
    </div>
  );
};
