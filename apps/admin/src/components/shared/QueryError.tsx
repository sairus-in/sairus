import React from 'react';

interface QueryErrorProps {
  message: string;
  onRetry?: () => void;
}

export const QueryError: React.FC<QueryErrorProps> = ({ message, onRetry }) => (
  <div
    style={{
      padding: '1rem 1.1rem',
      borderRadius: 14,
      background: '#FEF2F2',
      border: '1px solid #FECACA',
      color: '#B91C1C',
      display: 'grid',
      gap: '0.8rem',
    }}
  >
    <div>{message}</div>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        style={{
          width: 'fit-content',
          border: '1px solid #FCA5A5',
          borderRadius: 10,
          background: '#FFFFFF',
          color: '#991B1B',
          padding: '0.55rem 0.85rem',
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        Retry
      </button>
    )}
  </div>
);
