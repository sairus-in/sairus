import React, { useState, useRef, useEffect } from 'react';
import { Bell, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { useAlerts } from '../../hooks/useAlerts';

export const AlertDropdown: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { data: alerts = [] } = useAlerts();
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const highPriorityCount = alerts.filter((alert) => alert.priority >= 2).length;

  return (
    <div style={{ position: 'relative' }} ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: 'transparent',
          border: 'none',
          color: '#9CA3AF',
          cursor: 'pointer',
          padding: '0.5rem',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%'
        }}
        className="hover:bg-gray-800 hover:text-white"
      >
        <Bell size={20} />
        {highPriorityCount > 0 && (
          <span style={{
            position: 'absolute',
            top: '0',
            right: '0',
            backgroundColor: '#EF4444',
            color: 'white',
            fontSize: '0.625rem',
            fontWeight: 'bold',
            padding: '2px 6px',
            borderRadius: '9999px',
            lineHeight: '1'
          }}>
            {highPriorityCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div style={{
          position: 'absolute',
          top: '100%',
          right: '0',
          marginTop: '0.5rem',
          width: '320px',
          backgroundColor: '#1F2937',
          border: '1px solid #374151',
          borderRadius: '0.75rem',
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
          zIndex: 50
        }}>
          <div style={{ padding: '1rem', borderBottom: '1px solid #374151', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: '600', color: 'white' }}>Live Alerts</h3>
            <span style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>{alerts.length} Total</span>
          </div>

          <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
            {alerts.length === 0 ? (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#9CA3AF', fontSize: '0.875rem' }}>
                No active system alerts.
              </div>
            ) : (
              alerts.map((alert, index) => (
                <div
                  key={`${alert.type}-${alert.tripId || alert.busId || alert.timestamp}-${index}`}
                  onClick={() => {
                    setIsOpen(false);
                    if (alert.tripId) {
                      navigate(`/ops/trips/${alert.tripId}`);
                    }
                  }}
                  style={{
                    padding: '1rem',
                    borderBottom: '1px solid #374151',
                    cursor: alert.tripId ? 'pointer' : 'default',
                    display: 'flex',
                    gap: '0.75rem',
                    alignItems: 'flex-start'
                  }}
                  className="hover:bg-gray-700"
                >
                  <div style={{ marginTop: '2px' }}>
                    {alert.priority >= 2 ? <AlertTriangle size={18} color="#EF4444" /> :
                     alert.priority === 1 ? <AlertCircle size={18} color="#F59E0B" /> :
                     <Info size={18} color="#3B82F6" />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: '500', color: 'white' }}>
                      {alert.type.replace(/_/g, ' ')}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#9CA3AF', marginTop: '0.25rem' }}>
                      {alert.summary}
                    </div>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#6B7280', whiteSpace: 'nowrap' }}>
                    {formatDistanceToNow(new Date(alert.timestamp), { addSuffix: true })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
