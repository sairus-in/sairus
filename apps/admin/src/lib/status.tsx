import React from 'react';

export const STATUS_CONFIG = {
  // Attendance status
  PRESENT: { label: 'Present', color: '#10B981', dot: '●' }, // green-500
  ABSENT: { label: 'Absent', color: '#EF4444', dot: '●' }, // red-500
  LATE_BOARD: { label: 'Late board', color: '#F59E0B', dot: '●' }, // amber-500
  PENDING: { label: 'Pending', color: '#EAB308', dot: '○' }, // yellow-500
  EXCUSED: { label: 'Excused', color: '#3B82F6', dot: '●' }, // blue-500
  MANUAL: { label: 'Manual', color: '#A855F7', dot: '●' }, // purple-500

  // GPS status
  GPS_LIVE: { label: 'Live', color: '#10B981', dot: '●' },
  GPS_STALE: { label: 'Weak signal', color: '#F59E0B', dot: '◐' },
  GPS_OFFLINE: { label: 'Offline', color: '#EF4444', dot: '○' },

  // Trip status
  TRIP_ACTIVE: { label: 'Active', color: '#10B981', dot: '●' },
  TRIP_SCHEDULED: { label: 'Scheduled', color: '#6B7280', dot: '○' }, // gray-500
  TRIP_LATE: { label: 'Late start', color: '#F59E0B', dot: '!' },
  TRIP_BREAKDOWN: { label: 'Breakdown', color: '#EF4444', dot: '!' },

  // Correction status
  CORRECTION_PENDING: { label: 'Pending', color: '#F59E0B' },
  CORRECTION_APPROVED: { label: 'Approved', color: '#10B981' },
  CORRECTION_REJECTED: { label: 'Rejected', color: '#EF4444' },
  GPS_OUTAGE_CORRECTION: { label: 'GPS outage', color: '#F97316' }, // orange-500

  // Incident severity
  INCIDENT_ACTIVE: { label: 'Active', color: '#EF4444', urgent: true },
  INCIDENT_ASSIGNED: { label: 'Assigned', color: '#F59E0B', urgent: false },
  INCIDENT_RESOLVED: { label: 'Resolved', color: '#10B981', urgent: false },

  // General-purpose
  RESOLVED: { label: 'Resolved', color: '#10B981', dot: '●' },
  OFFLINE: { label: 'Deactivated', color: '#6B7280', dot: '○' },
} as const;

export type StatusKey = keyof typeof STATUS_CONFIG;

interface StatusBadgeProps {
  status: StatusKey;
  label?: string;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label, className = '' }) => {
  const config = STATUS_CONFIG[status];

  return (
    <span
      className={`status-badge ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.375rem',
        padding: '0.25rem 0.625rem',
        borderRadius: '9999px',
        fontSize: '0.75rem',
        fontWeight: '500',
        backgroundColor: `${config.color}20`,
        color: config.color,
        border: `1px solid ${config.color}40`,
      }}
    >
      {'dot' in config && <span>{config.dot}</span>}
      {label || config.label}
    </span>
  );
};
