import React from 'react';
import { Activity, AlertTriangle, Bus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { useAlerts } from '../../hooks/useAlerts';

export const OpsEventRail: React.FC = () => {
  const { data: alerts = [] } = useAlerts();

  return (
    <div style={{
      width: '320px',
      backgroundColor: '#111827',
      borderLeft: '1px solid #374151',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      color: 'white'
    }}>
      <div style={{ padding: '1.25rem', borderBottom: '1px solid #374151', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Activity size={20} color="#10B981" />
        <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 'bold' }}>Live Ops Rail</h3>
      </div>

      <div style={{ padding: '1.25rem', flex: 1, overflowY: 'auto' }}>
        <h4 style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#9CA3AF', letterSpacing: '0.05em', marginBottom: '1rem', fontWeight: '600' }}>
          Active Critical Events ({alerts.length})
        </h4>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {alerts.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem 0', color: '#6B7280', textAlign: 'center' }}>
              <Bus size={32} style={{ marginBottom: '1rem', opacity: 0.5 }} />
              <div style={{ fontSize: '0.875rem' }}>No active live alerts affecting operations.</div>
            </div>
          ) : (
            alerts.map((alert) => (
              <div key={`${alert.type}-${alert.tripId || alert.busId || alert.timestamp}`} style={{
                backgroundColor: '#1F2937',
                border: '1px solid #374151',
                borderRadius: '0.5rem',
                padding: '1rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                position: 'relative',
                overflow: 'hidden'
              }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '4px', backgroundColor: alert.priority >= 2 ? '#EF4444' : '#F59E0B' }} />

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: '0.5rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#EF4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '0.125rem 0.5rem', borderRadius: '9999px' }}>
                    {alert.type.replace(/_/g, ' ')}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>
                    {formatDistanceToNow(new Date(alert.timestamp), { addSuffix: true })}
                  </span>
                </div>

                <div style={{ paddingLeft: '0.5rem', marginTop: '0.25rem' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '0.875rem' }}>
                    {alert.busNumber ? `Bus ${alert.busNumber}` : alert.type.replace(/_/g, ' ')}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#9CA3AF', marginTop: '0.25rem' }}>
                    {alert.summary}
                  </div>
                </div>

                {alert.tripId && (
                  <Link to={`/ops/trips/${alert.tripId}`} style={{
                    marginTop: '0.5rem', marginLeft: '0.5rem', padding: '0.5rem',
                    backgroundColor: '#374151', color: 'white', textAlign: 'center',
                    borderRadius: '0.375rem', textDecoration: 'none', fontSize: '0.75rem', fontWeight: '500',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem'
                  }}>
                    <AlertTriangle size={14} /> Open Context
                  </Link>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
