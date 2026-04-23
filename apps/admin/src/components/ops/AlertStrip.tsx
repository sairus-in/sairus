import React from 'react';
import { WifiOff, FileWarning } from 'lucide-react';

interface AlertStripProps {
  gpsOffline: number;
  openCorrections: number;
}

export const AlertStrip: React.FC<AlertStripProps> = ({ gpsOffline, openCorrections }) => {
  if (gpsOffline === 0 && openCorrections === 0) return null;

  return (
    <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
      
      {gpsOffline > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.75rem',
          backgroundColor: 'rgba(239, 68, 68, 0.1)', // red-500 fading
          border: '1px solid rgba(239, 68, 68, 0.2)',
          color: '#F87171',
          padding: '0.75rem 1rem',
          borderRadius: '0.5rem',
          flex: 1,
          minWidth: '250px'
        }}>
          <WifiOff size={20} />
          <div style={{ flex: 1 }}>
            <h4 style={{ margin: 0, fontSize: '0.875rem', fontWeight: '600' }}>GPS Offline Alert</h4>
            <p style={{ margin: 0, fontSize: '0.75rem', opacity: 0.9 }}>{gpsOffline} bus{gpsOffline !== 1 ? 'es' : ''} currently offline or stale.</p>
          </div>
          <button style={{ backgroundColor: '#EF4444', color: 'white', border: 'none', padding: '0.375rem 0.75rem', borderRadius: '0.375rem', fontSize: '0.75rem', cursor: 'pointer', fontWeight: '500' }}>
            Action
          </button>
        </div>
      )}

      {openCorrections > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.75rem',
          backgroundColor: 'rgba(245, 158, 11, 0.1)', // amber-500 fading
          border: '1px solid rgba(245, 158, 11, 0.2)',
          color: '#FBBF24',
          padding: '0.75rem 1rem',
          borderRadius: '0.5rem',
          flex: 1,
          minWidth: '250px'
        }}>
          <FileWarning size={20} />
          <div style={{ flex: 1 }}>
            <h4 style={{ margin: 0, fontSize: '0.875rem', fontWeight: '600' }}>Pending Corrections</h4>
            <p style={{ margin: 0, fontSize: '0.75rem', opacity: 0.9 }}>{openCorrections} attendance overrides require review.</p>
          </div>
          <button style={{ backgroundColor: '#F59E0B', color: 'black', border: 'none', padding: '0.375rem 0.75rem', borderRadius: '0.375rem', fontSize: '0.75rem', cursor: 'pointer', fontWeight: '500' }}>
            Review Queue
          </button>
        </div>
      )}

    </div>
  );
};
