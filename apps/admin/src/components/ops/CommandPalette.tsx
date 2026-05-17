import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import Fuse from 'fuse.js';
import { AdminLiveTripState } from 'shared';
import { api } from '../../lib/api.client';
import { QK } from '../../lib/query-keys';
import { Capabilities } from '../../lib/capabilities';
import { useAuthStore } from '../../store/auth.store';
import { Icon, IconName } from '../design/Icon';

interface PaletteItem {
  id: string;
  title: string;
  subtitle: string;
  type: 'PAGE' | 'TRIP';
  path: string;
  icon: IconName;
  shortcut?: string;
}

type BooleanCapabilityKey = {
  [K in keyof Capabilities]: Capabilities[K] extends boolean ? K : never;
}[keyof Capabilities];

type CommandDefinition = {
  id: string;
  title: string;
  subtitle: string;
  path: string;
  icon: IconName;
  cap: BooleanCapabilityKey | null;
  shortcut?: string;
};

const ALL_COMMANDS: readonly CommandDefinition[] = [
  { id: 'goto-dashboard', title: 'Live Dashboard', subtitle: 'View system health and status', path: '/ops/dashboard', icon: 'dashboard', cap: 'canViewDashboard', shortcut: 'Ctrl 1' },
  { id: 'goto-fleet', title: 'Global Fleet Map', subtitle: 'Track all active buses globally', path: '/ops/fleet', icon: 'map', cap: 'canViewFleetMap', shortcut: 'Ctrl 2' },
  { id: 'goto-incidents', title: 'Critical Incidents', subtitle: 'Review and resolve active incidents', path: '/ops/incidents', icon: 'incidents', cap: 'canViewIncidents', shortcut: 'Ctrl 4' },
  { id: 'goto-messages', title: 'Messages', subtitle: 'Open contextual comm threads', path: '/ops/messages', icon: 'comms', cap: 'canViewMessages' },
  { id: 'goto-outages', title: 'GPS Outages', subtitle: 'Review outage queue and overrides', path: '/ops/outages', icon: 'gps', cap: 'canReviewGPSOutage' },
  { id: 'goto-audit-log', title: 'Audit Log', subtitle: 'Inspect privileged admin actions', path: '/ops/audit-log', icon: 'reports', cap: 'canViewAuditLog' },
  { id: 'goto-corrections', title: 'Correction Queue', subtitle: 'Approve manual attendance claims', path: '/corrections', icon: 'clock', cap: 'canReviewCorrections' },
  { id: 'goto-students', title: 'Students', subtitle: 'Manage riders and assignments', path: '/students', icon: 'users', cap: 'canManageStudents' },
  { id: 'goto-routes', title: 'Routes', subtitle: 'Manage routes and stop sequences', path: '/routes', icon: 'routes', cap: 'canManageRoutes' },
  { id: 'goto-buses', title: 'Buses', subtitle: 'Manage fleet inventory', path: '/buses', icon: 'fleet', cap: 'canManageBuses' },
  { id: 'goto-drivers', title: 'Drivers', subtitle: 'Manage driver records', path: '/drivers', icon: 'users', cap: 'canManageDrivers' },
  { id: 'goto-attendance', title: 'Attendance Analytics', subtitle: 'Generate and inspect attendance reports', path: '/attendance', icon: 'reports', cap: 'canViewAttendanceReports' },
  { id: 'goto-security', title: 'Security', subtitle: 'Manage account security settings', path: '/security', icon: 'ops', cap: 'canViewSecuritySettings' },
  { id: 'goto-admin-users', title: 'Admin Users', subtitle: 'Invite and manage admin accounts', path: '/admin-users', icon: 'users', cap: 'canInviteAdmin' },
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
    queryFn: async (): Promise<AdminLiveTripState[]> => {
      const response = await api.getList<AdminLiveTripState>('/v1/admin/live/trips/active');
      return response.data;
    },
    enabled: Boolean(capabilities?.canViewDashboard || capabilities?.canViewTripDetail),
  });

  const searchItems = useMemo<PaletteItem[]>(() => {
    const visibleCommands = ALL_COMMANDS
      .filter((command) => command.cap === null || capabilities?.[command.cap])
      .map<PaletteItem>((command) => ({
        id: command.id,
        title: command.title,
        subtitle: command.subtitle,
        type: 'PAGE',
        path: command.path,
        icon: command.icon,
        shortcut: command.shortcut,
      }));

    const tripItems = capabilities?.canViewTripDetail
      ? activeTrips.map<PaletteItem>((trip) => ({
          id: `trip-${trip.id}`,
          title: `Bus ${trip.busNumber}`,
          subtitle: `${trip.routeName} - ${Math.round((Date.now() - Number(trip.startedAt)) / 60000)}m enroute`,
          type: 'TRIP',
          path: `/ops/trips/${trip.id}`,
          icon: 'arrowRight',
        }))
      : [];

    return [...visibleCommands, ...tripItems];
  }, [activeTrips, capabilities]);

  const fuse = useMemo(
    () =>
      new Fuse(searchItems, {
        keys: ['title', 'subtitle', 'type'],
        threshold: 0.3,
      }),
    [searchItems],
  );

  const results = query ? fuse.search(query).map((result) => result.item) : searchItems;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsOpen((current) => !current);
      }

      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    const open = (_event: Event) => setIsOpen(true);
    const close = (_event: Event) => setIsOpen(false);
    const toggle = (_event: Event) => setIsOpen((current) => !current);

    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('admin-command-palette:open', open);
    window.addEventListener('admin-command-palette:close', close);
    window.addEventListener('admin-command-palette:toggle', toggle);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('admin-command-palette:open', open);
      window.removeEventListener('admin-command-palette:close', close);
      window.removeEventListener('admin-command-palette:toggle', toggle);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      return;
    }

    setSelectedIndex(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((current) => (current + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((current) => (current - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      navigate(results[selectedIndex].path);
      setIsOpen(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  const pageItems = results.filter((item) => item.type === 'PAGE');
  const tripItems = results.filter((item) => item.type === 'TRIP');
  const grouped = [
    { label: 'Navigate', items: pageItems },
    { label: 'Active Trips', items: tripItems },
  ].filter((group) => group.items.length > 0);

  let runningIndex = -1;

  return (
    <div className="cmd-backdrop" onClick={() => setIsOpen(false)}>
      <div className="cmd-palette" onClick={(event) => event.stopPropagation()}>
        <div className="cmd-palette__input">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            className="cmd-palette__field"
            type="text"
            placeholder="Search actions, trips, buses, drivers..."
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <span className="searchbar__kbd">ESC</span>
        </div>

        <div className="cmd-palette__list scroll">
          {results.length === 0 ? (
            <div className="cmd-palette__group">No results for "{query}"</div>
          ) : (
            grouped.map((group) => (
              <div key={group.label}>
                <div className="cmd-palette__group">{group.label}</div>
                {group.items.map((item) => {
                  runningIndex += 1;
                  const index = runningIndex;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`cmd-palette__item ${selectedIndex === index ? 'is-active' : ''}`}
                      onMouseEnter={() => setSelectedIndex(index)}
                      onClick={() => {
                        navigate(item.path);
                        setIsOpen(false);
                      }}
                    >
                      <Icon name={item.icon} size={16} />
                      <div>
                        <div>{item.title}</div>
                        <div className="cmd-palette__item-subtitle">{item.subtitle}</div>
                      </div>
                      <span className="cmd-palette__item-kbd">{item.shortcut ?? item.type}</span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
