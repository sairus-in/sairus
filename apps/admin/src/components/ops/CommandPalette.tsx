import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import Fuse from 'fuse.js';
import { AdminLiveTripState } from 'shared';
import { Search, Map, Activity, Clock, Users, ArrowRight, AlertCircle, Shield, Bus, FileText, MessageSquare } from 'lucide-react';
import { api } from '../../lib/api.client';
import { QK } from '../../lib/query-keys';
import { Capabilities } from '../../lib/capabilities';
import { useAuthStore } from '../../store/auth.store';

interface PaletteItem {
  id: string;
  title: string;
  subtitle: string;
  type: 'ROUTE' | 'TRIP' | 'PAGE';
  path: string;
  icon: React.ReactNode;
}

type BooleanCapabilityKey = {
  [K in keyof Capabilities]: Capabilities[K] extends boolean ? K : never
}[keyof Capabilities];

type CommandDefinition = {
  id: string;
  title: string;
  subtitle: string;
  path: string;
  icon: React.ReactNode;
  cap: BooleanCapabilityKey | null;
};

const ALL_COMMANDS: readonly CommandDefinition[] = [
  {
    id: 'goto-dashboard',
    title: 'Live Dashboard',
    subtitle: 'View system health & stats',
    path: '/ops/dashboard',
    icon: <Activity size={18} color="#9CA3AF" />,
    cap: 'canViewDashboard',
  },
  {
    id: 'goto-fleet',
    title: 'Global Fleet Map',
    subtitle: 'Track all active buses globally',
    path: '/ops/fleet',
    icon: <Map size={18} color="#9CA3AF" />,
    cap: 'canViewFleetMap',
  },
  {
    id: 'goto-incidents',
    title: 'Critical Incidents',
    subtitle: 'Review and resolve active incidents',
    path: '/ops/incidents',
    icon: <AlertCircle size={18} color="#9CA3AF" />,
    cap: 'canViewIncidents',
  },
  {
    id: 'goto-corrections',
    title: 'Correction Queue',
    subtitle: 'Approve manual attendance claims',
    path: '/corrections',
    icon: <Clock size={18} color="#9CA3AF" />,
    cap: 'canReviewCorrections',
  },
  {
    id: 'goto-students',
    title: 'Students',
    subtitle: 'Manage riders and assignments',
    path: '/students',
    icon: <Users size={18} color="#9CA3AF" />,
    cap: 'canManageStudents',
  },
  {
    id: 'goto-routes',
    title: 'Routes',
    subtitle: 'Manage routes and stop sequences',
    path: '/routes',
    icon: <Map size={18} color="#9CA3AF" />,
    cap: 'canManageRoutes',
  },
  {
    id: 'goto-buses',
    title: 'Buses',
    subtitle: 'Manage fleet inventory',
    path: '/buses',
    icon: <Bus size={18} color="#9CA3AF" />,
    cap: 'canManageBuses',
  },
  {
    id: 'goto-drivers',
    title: 'Drivers',
    subtitle: 'Manage driver records',
    path: '/drivers',
    icon: <Users size={18} color="#9CA3AF" />,
    cap: 'canManageDrivers',
  },
  {
    id: 'goto-attendance',
    title: 'Attendance Analytics',
    subtitle: 'Generate CSV reports',
    path: '/attendance',
    icon: <FileText size={18} color="#9CA3AF" />,
    cap: 'canViewAttendanceReports',
  },
  {
    id: 'goto-outages',
    title: 'GPS Outages',
    subtitle: 'Review outage queue and overrides',
    path: '/ops/outages',
    icon: <AlertCircle size={18} color="#9CA3AF" />,
    cap: 'canReviewGPSOutage',
  },
  {
    id: 'goto-messages',
    title: 'Messages',
    subtitle: 'Open contextual comm threads',
    path: '/ops/messages',
    icon: <MessageSquare size={18} color="#9CA3AF" />,
    cap: 'canViewMessages',
  },
  {
    id: 'goto-audit-log',
    title: 'Audit Log',
    subtitle: 'Inspect privileged admin actions',
    path: '/ops/audit-log',
    icon: <Shield size={18} color="#9CA3AF" />,
    cap: 'canViewAuditLog',
  },
  {
    id: 'goto-security',
    title: 'Security',
    subtitle: 'Manage account security settings',
    path: '/security',
    icon: <Shield size={18} color="#9CA3AF" />,
    cap: null,
  },
];

export const CommandPalette: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { capabilities } = useAuthStore();

  const { data: activeTrips = [] } = useQuery({
    queryKey: QK.activeTrips(),
    queryFn: (): Promise<AdminLiveTripState[]> => api.get<AdminLiveTripState[]>('/v1/admin/live/trips/active'),
    enabled: !!capabilities?.canViewDashboard,
  });

  const searchItems = useMemo<PaletteItem[]>(() => {
    const visibleCommands: PaletteItem[] = ALL_COMMANDS
      .filter((command) => command.cap === null || capabilities?.[command.cap])
      .map((command) => ({
        id: command.id,
        title: command.title,
        subtitle: command.subtitle,
        type: 'PAGE',
        path: command.path,
        icon: command.icon,
      }));

    const tripItems: PaletteItem[] = activeTrips.map((trip) => ({
      id: `t_${trip.id}`,
      title: `Bus ${trip.busNumber}`,
      subtitle: `${trip.routeName} - ${Math.round((Date.now() - Number(trip.startedAt)) / 60000)}m enroute`,
      type: 'TRIP',
      path: `/ops/trips/${trip.id}`,
      icon: <ArrowRight size={18} color="#3B82F6" />,
    }));

    return [...visibleCommands, ...tripItems];
  }, [activeTrips, capabilities]);

  const fuse = new Fuse(searchItems, {
    keys: ['title', 'subtitle', 'type'],
    threshold: 0.3,
  });

  const results = query ? fuse.search(query).map(r => r.item) : searchItems;

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsOpen((open) => !open);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 10);
      setSelectedIndex(0);
    } else {
      setQuery('');
    }
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      e.preventDefault();
      navigate(results[selectedIndex].path);
      setIsOpen(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0,
      backgroundColor: 'rgba(17, 24, 39, 0.7)',
      backdropFilter: 'blur(4px)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      paddingTop: '10vh'
    }} onClick={() => setIsOpen(false)}>
      
      <div 
        style={{
          width: '100%',
          maxWidth: '600px',
          backgroundColor: '#1F2937',
          borderRadius: '1rem',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
          border: '1px solid #374151'
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', padding: '1rem 1.5rem', borderBottom: '1px solid #374151' }}>
          <Search size={22} color="#9CA3AF" />
          <input 
            ref={inputRef}
            type="text"
            placeholder="Search trips, features, or drivers... (Cmd+K)"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1, backgroundColor: 'transparent', border: 'none',
              outline: 'none', color: 'white', fontSize: '1.125rem',
              marginLeft: '1rem', padding: 0
            }}
          />
          <kbd style={{ backgroundColor: '#374151', color: '#D1D5DB', padding: '0.25rem 0.5rem', borderRadius: '0.375rem', fontSize: '0.75rem', fontFamily: 'monospace' }}>
            ESC
          </kbd>
        </div>

        <div style={{ padding: '0.5rem', maxHeight: '400px', overflowY: 'auto' }}>
          {results.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#9CA3AF' }}>
              No results found for "{query}"
            </div>
          ) : (
            results.map((item, idx) => (
              <div 
                key={item.id}
                onMouseEnter={() => setSelectedIndex(idx)}
                onClick={() => { navigate(item.path); setIsOpen(false); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '1rem',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                  backgroundColor: selectedIndex === idx ? '#374151' : 'transparent',
                  transition: 'background-color 0.1s'
                }}
              >
                <div style={{ 
                  marginRight: '1rem', padding: '0.5rem', 
                  backgroundColor: selectedIndex === idx ? '#4B5563' : '#374151',
                  borderRadius: '0.375rem' 
                }}>
                  {item.icon}
                </div>
                <div>
                  <div style={{ color: 'white', fontWeight: '500', fontSize: '1rem' }}>{item.title}</div>
                  <div style={{ color: '#9CA3AF', fontSize: '0.875rem' }}>{item.subtitle}</div>
                </div>
                <div style={{ marginLeft: 'auto' }}>
                  <span style={{ 
                    fontSize: '0.65rem', fontWeight: 'bold', letterSpacing: '0.05em',
                    backgroundColor: item.type === 'PAGE' ? '#1E3A8A' : (item.type === 'TRIP' ? '#064E3B' : '#4B5563'),
                    color: item.type === 'PAGE' ? '#60A5FA' : (item.type === 'TRIP' ? '#34D399' : '#D1D5DB'),
                    padding: '0.25rem 0.5rem', borderRadius: '9999px'
                  }}>
                    {item.type}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

    </div>
  );
};
