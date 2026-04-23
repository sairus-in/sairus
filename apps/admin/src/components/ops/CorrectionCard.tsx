import React from 'react';
import { Correction, useResolveCorrection } from '../../hooks/useCorrections';
import { MapPin, User, Bus, Clock, Calendar, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';

interface CorrectionCardProps {
  correction: Correction;
  onClose: () => void;
}

export const CorrectionCard: React.FC<CorrectionCardProps> = ({ correction, onClose }) => {
  const { mutate: resolve, isPending } = useResolveCorrection();

  const handleApprove = () => resolve({ id: correction.id, status: 'APPROVED' }, { onSuccess: onClose });
  const handleReject = () => resolve({ id: correction.id, status: 'REJECTED' }, { onSuccess: onClose });

  const att = correction.attendance;
  const isGpsOutage = correction.reason.toLowerCase().includes('gps outage') || correction.reason.toLowerCase().includes('offline');

  return (
    <div style={{
      backgroundColor: '#1F2937',
      border: '1px solid #374151',
      borderRadius: '0.75rem',
      padding: '1.5rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '1.5rem',
      height: '100%'
    }}>
      
      {/* Header */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 'bold', color: 'white' }}>
            Correction Request
          </h2>
          <span style={{
            fontSize: '0.75rem',
            padding: '0.25rem 0.625rem',
            backgroundColor: isGpsOutage ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.1)',
            color: isGpsOutage ? '#EF4444' : '#60A5FA',
            borderRadius: '9999px',
            border: `1px solid ${isGpsOutage ? 'rgba(239, 68, 68, 0.2)' : 'rgba(59, 130, 246, 0.2)'}`
          }}>
            {isGpsOutage ? 'GPS Outage Correction' : 'Standard Correction'}
          </span>
        </div>
        <p style={{ color: '#9CA3AF', fontSize: '0.875rem', marginTop: '0.5rem' }}>
          Requested by {correction.requestedBy.name} ({correction.requestedBy.role}) on {format(new Date(correction.createdAt), 'MMM d, h:mm a')}
        </p>
      </div>

      {/* Target Data */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div style={{ backgroundColor: '#111827', padding: '1rem', borderRadius: '0.5rem' }}>
          <h3 style={{ fontSize: '0.75rem', color: '#6B7280', textTransform: 'uppercase', marginBottom: '0.75rem', marginTop: 0 }}>Student</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', color: 'white', fontSize: '0.875rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><User size={16} color="#9CA3AF"/> {att.user.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><span style={{ color: '#9CA3AF', width: '16px', textAlign: 'center' }}>#</span> {att.user.rollNumber || 'N/A'}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><span style={{ color: '#9CA3AF', width: '16px', textAlign: 'center' }}>dept</span> {att.user.department || 'N/A'}</div>
          </div>
        </div>

        <div style={{ backgroundColor: '#111827', padding: '1rem', borderRadius: '0.5rem' }}>
          <h3 style={{ fontSize: '0.75rem', color: '#6B7280', textTransform: 'uppercase', marginBottom: '0.75rem', marginTop: 0 }}>Trip Context</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', color: 'white', fontSize: '0.875rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Bus size={16} color="#9CA3AF"/> Route {att.trip.routeId.substring(0,8)}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Calendar size={16} color="#9CA3AF"/> {att.trip.date}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Clock size={16} color="#9CA3AF"/> Failed: {att.failReason || 'No scan attempts'}</div>
          </div>
        </div>
      </div>

      {/* Geofence Data */}
      <div style={{ backgroundColor: '#111827', padding: '1rem', borderRadius: '0.5rem' }}>
        <h3 style={{ fontSize: '0.75rem', color: '#6B7280', textTransform: 'uppercase', marginBottom: '0.75rem', marginTop: 0 }}>GPS Evidence</h3>
        {att.lat && att.lon ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.875rem', color: 'white' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <MapPin size={16} color="#10B981" /> 
              Lat/Lon: {att.lat.toFixed(6)}, {att.lon.toFixed(6)}
            </div>
            <div>Distance to Bus: <strong style={{ color: att.distanceToBus && att.distanceToBus < 200 ? '#10B981' : '#EF4444' }}>{att.distanceToBus}m</strong></div>
            <div>Distance to Stop: <strong>{att.distanceToStop}m</strong></div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#F59E0B', fontSize: '0.875rem' }}>
            <AlertTriangle size={16} /> No GPS evidence provided at time of failure.
          </div>
        )}
      </div>

      {/* Justification */}
      <div style={{ backgroundColor: '#111827', padding: '1rem', borderRadius: '0.5rem' }}>
        <h3 style={{ fontSize: '0.75rem', color: '#6B7280', textTransform: 'uppercase', marginBottom: '0.5rem', marginTop: 0 }}>Driver / Student Justification</h3>
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'white', fontStyle: 'italic' }}>"{correction.reason}"</p>
      </div>

      {/* Actions */}
      <div style={{ marginTop: 'auto', display: 'flex', gap: '1rem', paddingTop: '1rem', borderTop: '1px solid #374151' }}>
        <button
          disabled={isPending}
          onClick={handleReject}
          style={{
            flex: 1,
            padding: '0.75rem',
            backgroundColor: 'transparent',
            border: '1px solid #EF4444',
            color: '#EF4444',
            borderRadius: '0.5rem',
            fontWeight: '600',
            cursor: isPending ? 'not-allowed' : 'pointer',
            opacity: isPending ? 0.5 : 1
          }}
        >
          Reject
        </button>
        <button
          disabled={isPending}
          onClick={handleApprove}
          style={{
            flex: 2,
            padding: '0.75rem',
            backgroundColor: '#10B981',
            border: 'none',
            color: 'white',
            borderRadius: '0.5rem',
            fontWeight: '600',
            cursor: isPending ? 'not-allowed' : 'pointer',
            opacity: isPending ? 0.5 : 1
          }}
        >
          Approve Correction
        </button>
      </div>

    </div>
  );
};
