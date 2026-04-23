import React from 'react';

interface StatCardProps {
  title: string;
  value: number | string;
  subtitle?: string;
  icon?: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  color?: string;
}

export const StatCard: React.FC<StatCardProps> = ({ title, value, subtitle, icon, color = '#3B82F6' }) => {
  return (
    <div style={{
      backgroundColor: '#1F2937', 
      borderRadius: '0.75rem', 
      padding: '1.5rem', 
      border: '1px solid #374151',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ color: '#9CA3AF', fontSize: '0.875rem', fontWeight: '500', margin: 0 }}>{title}</h3>
        {icon && <div style={{ color }}>{icon}</div>}
      </div>
      
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
        <span style={{ fontSize: '2.25rem', fontWeight: 'bold', color: 'white', lineHeight: 1 }}>{value}</span>
      </div>

      {subtitle && (
        <p style={{ color: '#6B7280', fontSize: '0.75rem', margin: 0 }}>
          {subtitle}
        </p>
      )}
    </div>
  );
};
