import React from 'react';
import { LiveTripState } from '../../hooks/useActiveTrips';
import { StatusBadge, StatusKey } from '../../lib/status';
import { Users, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface TripCardProps {
  trip: LiveTripState;
}

export const TripCard: React.FC<TripCardProps> = ({ trip }) => {
  const isDelayed = trip.status === 'ACTIVE' && trip.gpsStatus === 'STALE';
  const isOffline = trip.gpsStatus === 'OFFLINE';

  const cardStyle = {
    backgroundColor: '#1F2937',
    border: `1px solid ${isOffline ? '#EF4444' : isDelayed ? '#F59E0B' : '#374151'}`,
    borderRadius: '0.75rem',
    padding: '1.25rem',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '1rem',
    cursor: 'pointer',
    transition: 'border-color 0.2s',
  };

  const statusKey: StatusKey = isOffline ? 'GPS_OFFLINE' : isDelayed ? 'GPS_STALE' : 'GPS_LIVE';

  return (
    <a href={`/ops/trips/${trip.id}`} style={{ ...cardStyle, textDecoration: 'none' }} className="hover:border-gray-400">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 'bold', color: 'white' }}>
            Bus {trip.busNumber}
          </h3>
          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.875rem', color: '#9CA3AF' }}>
            {trip.routeName} • {trip.driverName || 'Unknown driver'}
          </p>
        </div>
        <StatusBadge status={statusKey} />
      </div>

      <div style={{ display: 'flex', gap: '1.5rem', marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid #374151' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#9CA3AF', fontSize: '0.875rem' }}>
          <Users size={16} />
          <span><strong style={{ color: 'white' }}>{trip.boardedCount}</strong> / {trip.expectedCount}</span>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#9CA3AF', fontSize: '0.875rem' }}>
          <Clock size={16} />
          <span>{formatDistanceToNow(new Date(trip.startedAt))} ago</span>
        </div>
      </div>
    </a>
  );
};
