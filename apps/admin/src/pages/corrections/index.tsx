import React, { useState } from 'react';
import { useCorrections } from '../../hooks/useCorrections';
import { CorrectionCard } from '../../components/ops/CorrectionCard';
import { formatDistanceToNow } from 'date-fns';
import { User } from 'lucide-react';

export const Corrections: React.FC = () => {
  const { data: corrections = [], isLoading } = useCorrections();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedCorrection = corrections.find(c => c.id === selectedId);

  if (isLoading) {
    return <div style={{ color: '#9CA3AF' }}>Loading correction queue...</div>;
  }

  return (
    <div style={{ display: 'flex', gap: '2rem', height: 'calc(100vh - 8rem)' }}>
      
      {/* LEFT PANEL: Queue Table */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#1F2937', borderRadius: '0.75rem', border: '1px solid #374151', overflow: 'hidden' }}>
        <div style={{ padding: '1.5rem', borderBottom: '1px solid #374151' }}>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 'bold', color: 'white' }}>Correction Queue</h1>
          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.875rem', color: '#9CA3AF' }}>{corrections.length} pending requests</p>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {corrections.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#9CA3AF' }}>
              No pending corrections. Queue is clear!
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {corrections.map(correction => (
                <div 
                  key={correction.id}
                  onClick={() => setSelectedId(correction.id)}
                  style={{
                    padding: '1rem 1.5rem',
                    borderBottom: '1px solid #374151',
                    cursor: 'pointer',
                    backgroundColor: selectedId === correction.id ? '#374151' : 'transparent',
                    transition: 'background-color 0.2s'
                  }}
                  className="hover:bg-gray-700"
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'white', fontWeight: '500' }}>
                      <User size={16} />
                      {correction.attendance.user.name}
                    </div>
                    <span style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>
                      {formatDistanceToNow(new Date(correction.createdAt))} ago
                    </span>
                  </div>
                  <div style={{ fontSize: '0.875rem', color: '#9CA3AF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {correction.reason}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT PANEL: Details & Mutation */}
      <div style={{ flex: 1 }}>
        {selectedCorrection ? (
          <CorrectionCard 
            correction={selectedCorrection} 
            onClose={() => setSelectedId(null)} 
          />
        ) : (
          <div style={{ 
            height: '100%', 
            border: '2px dashed #374151', 
            borderRadius: '0.75rem', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            color: '#6B7280'
          }}>
            Select a correction from the queue to review
          </div>
        )}
      </div>

    </div>
  );
};
