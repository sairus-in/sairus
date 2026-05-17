import React, { useEffect, useMemo, useState } from 'react';

export type DesignState = 'ok' | 'warn' | 'err' | 'info' | 'idle';

const TRIP_STATE_MAP: Record<string, { tone: DesignState; label: string }> = {
  on_route: { tone: 'ok', label: 'On Route' },
  delayed: { tone: 'warn', label: 'Delayed' },
  gps_out: { tone: 'err', label: 'GPS Out' },
  idle: { tone: 'idle', label: 'Idle' },
  in_transit: { tone: 'ok', label: 'In Transit' },
  boarding: { tone: 'info', label: 'Boarding' },
  scheduled: { tone: 'idle', label: 'Scheduled' },
  completed: { tone: 'ok', label: 'Completed' },
  open: { tone: 'err', label: 'Open' },
  acknowledged: { tone: 'warn', label: 'Acknowledged' },
  escalated: { tone: 'err', label: 'Escalated' },
  resolved: { tone: 'idle', label: 'Resolved' },
  LIVE: { tone: 'ok', label: 'Live' },
  STALE: { tone: 'warn', label: 'Stale' },
  OFFLINE: { tone: 'err', label: 'Offline' },
  REPORTED: { tone: 'err', label: 'Reported' },
  ASSIGNED: { tone: 'warn', label: 'Assigned' },
  RESOLVED: { tone: 'ok', label: 'Resolved' },
  CANCELLED: { tone: 'idle', label: 'Cancelled' },
};

export const toneClass = (tone: DesignState) => `pill pill--${tone}`;

export const StateBadge = ({ state, label }: { state: string; label?: string }) => {
  const config = TRIP_STATE_MAP[state] ?? { tone: 'idle' as const, label: label ?? state };
  return <span className={toneClass(config.tone)}>{label ?? config.label}</span>;
};

export const PriorityChip = ({ level }: { level: 'p1' | 'p2' | 'p3' }) => (
  <span className={`pri-chip ${level}`}>{level.toUpperCase()}</span>
);

export const Countdown = ({ seconds }: { seconds: number }) => {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    setRemaining(seconds);
  }, [seconds]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setRemaining((current) => current - 1);
    }, 1000);

    return () => window.clearInterval(id);
  }, []);

  const negative = remaining < 0;
  const absolute = Math.abs(remaining);
  const minutes = Math.floor(absolute / 60);
  const secs = absolute % 60;

  return (
    <span className="mono" style={{ fontWeight: 500 }}>
      {`T${negative ? '+' : '-'}${minutes}m ${String(secs).padStart(2, '0')}s`}
    </span>
  );
};

export const Spark = ({
  data,
  color = '#3a3a3d',
  width = 80,
  height = 24,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) => {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = Math.max(max - min, 1);
  const points = data
    .map((value, index) => {
      const x = (index / Math.max(data.length - 1, 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(' ');
  const last = data[data.length - 1] ?? 0;
  const lastY = height - ((last - min) / range) * height;

  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={width} cy={lastY} r="2" fill={color} />
    </svg>
  );
};

export const KPIBlock = ({
  label,
  value,
  sub,
  spark,
  trend,
  accent,
  delay = 0,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  spark?: number[];
  trend?: { label: string; color: string };
  accent?: string;
  delay?: number;
}) => (
  <div className="card hover" style={{ padding: '14px 16px', animation: `fleetops-fade-in 320ms var(--ease-out) ${delay}ms both`, minWidth: 0 }}>
    <div style={{ marginBottom: 8, color: 'var(--muted)', fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</div>
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
      <div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1 }}>{value}</div>
        {sub ? <div style={{ marginTop: 6, color: 'var(--muted)', fontSize: 11 }}>{sub}</div> : null}
      </div>
      {spark ? <Spark data={spark} color={accent} /> : null}
      {trend ? <div style={{ color: trend.color, fontSize: 11, fontWeight: 500 }}>{trend.label}</div> : null}
    </div>
  </div>
);

export const SectionCard = ({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div className="card">
    <div className="card-head">
      <div>
        <h3>{title}</h3>
        {subtitle ? <span className="dim">{subtitle}</span> : null}
      </div>
      {actions}
    </div>
    <div className="card-body">{children}</div>
  </div>
);

export const Donut = ({
  segments,
  size = 120,
  thickness = 14,
  centerLabel,
  centerSub,
}: {
  segments: Array<{ value: number; color: string }>;
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerSub?: string;
}) => {
  const radius = size / 2 - thickness / 2;
  const circumference = 2 * Math.PI * radius;
  const total = Math.max(segments.reduce((sum, segment) => sum + segment.value, 0), 1);
  let offset = 0;

  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#f0efea" strokeWidth={thickness} />
      {segments.map((segment, index) => {
        const length = (segment.value / total) * circumference;
        const circle = (
          <circle
            key={`${segment.color}-${index}`}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={segment.color}
            strokeWidth={thickness}
            strokeDasharray={`${length} ${circumference - length}`}
            strokeDashoffset={-offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 600ms var(--ease-out)' }}
          />
        );
        offset += length + 2;
        return circle;
      })}
      {centerLabel ? (
        <g style={{ transform: 'rotate(90deg)', transformOrigin: 'center' }}>
          <text x={size / 2} y={size / 2 - 2} textAnchor="middle" fontSize="22" fontWeight="500" fill="#1a1a1c" fontFamily="var(--font-display)">
            {centerLabel}
          </text>
          {centerSub ? (
            <text x={size / 2} y={size / 2 + 14} textAnchor="middle" fontSize="9" fontWeight="500" fill="#8a8a8f" letterSpacing="0.1em">
              {centerSub}
            </text>
          ) : null}
        </g>
      ) : null}
    </svg>
  );
};

export const Gauge = ({
  value,
  max = 100,
  size = 200,
  label,
  sub,
  color = '#a87437',
  thickness = 14,
  target,
}: {
  value: number;
  max?: number;
  size?: number;
  label: string;
  sub?: string;
  color?: string;
  thickness?: number;
  target?: number;
}) => {
  const pct = Math.max(0, Math.min(1, value / max));
  const pad = thickness / 2 + 2;
  const cx = size / 2;
  const cy = size - pad;
  const r = size / 2 - pad;
  const circumference = Math.PI * r;
  const dash = circumference * pct;
  const vbH = size / 2 + pad;
  const targetPct = target != null ? Math.max(0, Math.min(1, target / max)) : null;
  const targetAngle = targetPct != null ? Math.PI * (1 - targetPct) : null;

  return (
    <svg width={size} height={vbH} viewBox={`0 0 ${size} ${vbH}`} style={{ display: 'block' }}>
      <path d={`M ${pad} ${cy} A ${r} ${r} 0 0 1 ${size - pad} ${cy}`} fill="none" stroke="#f0efea" strokeWidth={thickness} strokeLinecap="round" />
      <path
        d={`M ${pad} ${cy} A ${r} ${r} 0 0 1 ${size - pad} ${cy}`}
        fill="none"
        stroke={color}
        strokeWidth={thickness}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference}`}
        style={{ transition: 'stroke-dasharray 800ms var(--ease-out), stroke 240ms var(--ease-out)' }}
      />
      {targetPct != null && targetAngle != null ? (
        <line
          x1={cx + (r - thickness / 2 - 2) * Math.cos(targetAngle)}
          y1={cy - (r - thickness / 2 - 2) * Math.sin(targetAngle)}
          x2={cx + (r + thickness / 2 + 2) * Math.cos(targetAngle)}
          y2={cy - (r + thickness / 2 + 2) * Math.sin(targetAngle)}
          stroke="#1a1a1c"
          strokeWidth="1.25"
          strokeLinecap="round"
          opacity="0.55"
        />
      ) : null}
      <text x={cx} y={cy - 16} textAnchor="middle" fontSize="34" fontWeight="500" fill="#1a1a1c" fontFamily="var(--font-display)" style={{ letterSpacing: '-0.02em' }}>
        {label}
      </text>
      {sub ? <text x={cx} y={cy - 2} textAnchor="middle" fontSize="10" fontWeight="500" fill="#8a8a8f" letterSpacing="0.04em">{sub}</text> : null}
      <text x={pad} y={cy + 12} textAnchor="middle" fontSize="9" fill="#b5b3ad" fontFamily="var(--font-mono)">0</text>
      <text x={size - pad} y={cy + 12} textAnchor="middle" fontSize="9" fill="#b5b3ad" fontFamily="var(--font-mono)">{max}</text>
    </svg>
  );
};

export const formatPriorityTone = (priority: string): DesignState => {
  if (priority === 'CRITICAL' || priority === 'HIGH') {
    return 'err';
  }
  if (priority === 'MEDIUM') {
    return 'warn';
  }
  return 'info';
};

export const useGreeting = () =>
  useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) {
      return 'Good morning';
    }
    if (hour < 18) {
      return 'Good afternoon';
    }
    return 'Good evening';
  }, []);
