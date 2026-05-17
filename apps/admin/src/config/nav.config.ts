import { matchPath } from 'react-router-dom';
import { Capabilities } from '../lib/capabilities';
import { IconName } from '../components/design/Icon';

type BooleanCapabilityKey = {
  [K in keyof Capabilities]: Capabilities[K] extends boolean ? K : never;
}[keyof Capabilities];

export type ShellMode = 'live' | 'admin';

export interface NavItemConfig {
  id: string;
  label: string;
  icon: IconName;
  mode: ShellMode;
  to?: string;
  capability?: BooleanCapabilityKey;
  anyCapability?: BooleanCapabilityKey[];
  separatorBefore?: boolean;
  action?: 'focus';
  activePatterns?: string[];
}

export const NAV_ITEMS: readonly NavItemConfig[] = [
  { id: 'dashboard', label: 'Command', icon: 'dashboard', mode: 'live', to: '/ops/dashboard', capability: 'canViewDashboard' },
  { id: 'map', label: 'Live Map', icon: 'map', mode: 'live', to: '/ops/fleet', capability: 'canViewFleetMap' },
  { id: 'trips', label: 'Trips', icon: 'trips', mode: 'live', to: '/ops/trips', capability: 'canViewTripDetail', activePatterns: ['/ops/trips', '/ops/trips/:id'] },
  { id: 'incidents', label: 'Incidents', icon: 'incidents', mode: 'live', to: '/ops/incidents', capability: 'canViewIncidents' },
  { id: 'gps', label: 'GPS Outage', icon: 'gps', mode: 'live', to: '/ops/outages', capability: 'canReviewGPSOutage' },
  { id: 'comms', label: 'Comms', icon: 'comms', mode: 'live', to: '/ops/messages', capability: 'canViewMessages' },
  { id: 'audit', label: 'Audit Log', icon: 'reports', mode: 'live', to: '/ops/audit-log', capability: 'canViewAuditLog' },
  { id: 'focus', label: 'Focus Mode', icon: 'focusFrame', mode: 'live', separatorBefore: true, action: 'focus' },
  { id: 'routes', label: 'Routes', icon: 'routes', mode: 'admin', to: '/routes', capability: 'canManageRoutes' },
  { id: 'fleet', label: 'Buses & Drivers', icon: 'fleet', mode: 'admin', to: '/buses', anyCapability: ['canManageBuses', 'canManageDrivers'], activePatterns: ['/buses', '/drivers'] },
  { id: 'students', label: 'Students', icon: 'users', mode: 'admin', to: '/students', capability: 'canManageStudents' },
  { id: 'corrections', label: 'Corrections', icon: 'check', mode: 'admin', to: '/corrections', capability: 'canReviewCorrections' },
  { id: 'attendance', label: 'Attendance', icon: 'reports', mode: 'admin', to: '/attendance', capability: 'canViewAttendanceReports' },
  { id: 'ops-center', label: 'Ops Center', icon: 'ops', mode: 'admin', to: '/ops/operations', capability: 'canViewImportSessions' },
  { id: 'security', label: 'Security', icon: 'ops', mode: 'admin', separatorBefore: true, to: '/security', capability: 'canViewSecuritySettings' },
  { id: 'admins', label: 'Admins', icon: 'users', mode: 'admin', to: '/admin-users', capability: 'canInviteAdmin' },
];

export const getVisibleNavItems = (mode: ShellMode, capabilities: Capabilities | null) =>
  NAV_ITEMS.filter((item) => {
    if (item.mode !== mode) {
      return false;
    }

    if (!item.capability) {
      return item.anyCapability ? item.anyCapability.some((capability) => Boolean(capabilities?.[capability])) : true;
    }

    return Boolean(capabilities?.[item.capability]);
  });

export const isNavItemActive = (item: NavItemConfig, pathname: string) => {
  const patterns = item.activePatterns?.length ? item.activePatterns : item.to ? [item.to] : [];
  return patterns.some((pattern) => Boolean(matchPath({ path: pattern, end: pattern === pathname || !pattern.includes(':') }, pathname)));
};

export const getModeForPath = (pathname: string): ShellMode => {
  const matched = NAV_ITEMS.find((item) => isNavItemActive(item, pathname));
  if (matched) {
    return matched.mode;
  }

  return pathname.startsWith('/ops/') ? 'live' : 'admin';
};

export const getNavItemForPath = (pathname: string) => NAV_ITEMS.find((item) => isNavItemActive(item, pathname));

const FALLBACK_ROUTE: Record<ShellMode, string> = {
  live: '/ops/dashboard',
  admin: '/login',
};

/**
 * First route in the given mode that the user has the capability to view.
 * Falls back to /login (or the dashboard for live mode) when no nav item is accessible.
 */
export const getDefaultRoute = (
  capabilities: Capabilities | null,
  section: 'live-ops' | 'data-console' = 'data-console',
): string => {
  const mode: ShellMode = section === 'live-ops' ? 'live' : 'admin';
  const accessible = getVisibleNavItems(mode, capabilities).find((item) => Boolean(item.to));
  return accessible?.to ?? FALLBACK_ROUTE[mode];
};
