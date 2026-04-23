/**
 * Routing Configuration for Admin Panel
 * Centralizes all route definitions and capability requirements
 * Makes it easy to add/modify routes without touching App.tsx
 */

import { Capabilities } from '../lib/capabilities';

type CapabilityKey = keyof Capabilities;

export interface RouteConfig {
  path: string;
  label: string;
  capability: CapabilityKey;
  section: 'live-ops' | 'data-console';
}

export interface RoutingConfig {
  liveOpsRoutes: RouteConfig[];
  dataConsoleRoutes: RouteConfig[];
  defaultLiveOpsRoute: string;
}

/**
 * Data Console Routes
 * Used for administrative data management, CRUD operations, and settings
 */
export const DATA_CONSOLE_ROUTES: RouteConfig[] = [
  {
    path: '/corrections',
    label: 'Corrections',
    capability: 'canReviewCorrections',
    section: 'data-console',
  },
  {
    path: '/students',
    label: 'Students',
    capability: 'canManageStudents',
    section: 'data-console',
  },
  {
    path: '/routes',
    label: 'Routes',
    capability: 'canManageRoutes',
    section: 'data-console',
  },
  {
    path: '/buses',
    label: 'Buses',
    capability: 'canManageBuses',
    section: 'data-console',
  },
  {
    path: '/drivers',
    label: 'Drivers',
    capability: 'canManageDrivers',
    section: 'data-console',
  },
  {
    path: '/attendance',
    label: 'Attendance',
    capability: 'canViewAttendanceReports',
    section: 'data-console',
  },
  {
    path: '/security',
    label: 'Security',
    capability: 'canViewSecuritySettings',
    section: 'data-console',
  },
  {
    path: '/admin-users',
    label: 'Admins',
    capability: 'canInviteAdmin',
    section: 'data-console',
  },
];

/**
 * Live Operations Routes
 * Used for real-time monitoring, GPS tracking, and incident management
 */
export const LIVE_OPS_ROUTES: RouteConfig[] = [
  {
    path: '/ops/dashboard',
    label: 'Dashboard',
    capability: 'canViewDashboard',
    section: 'live-ops',
  },
  {
    path: '/ops/fleet',
    label: 'Fleet Map',
    capability: 'canViewFleetMap',
    section: 'live-ops',
  },
  {
    path: '/ops/incidents',
    label: 'Incidents',
    capability: 'canViewIncidents',
    section: 'live-ops',
  },
  {
    path: '/ops/messages',
    label: 'Messages',
    capability: 'canViewMessages',
    section: 'live-ops',
  },
  {
    path: '/ops/operations',
    label: 'Operations Center',
    capability: 'canViewImportSessions',
    section: 'live-ops',
  },
  {
    path: '/ops/outages',
    label: 'GPS Outages',
    capability: 'canReviewGPSOutage',
    section: 'live-ops',
  },
  {
    path: '/ops/audit-log',
    label: 'Audit Log',
    capability: 'canViewAuditLog',
    section: 'live-ops',
  },
];

/**
 * Helper function to get the first accessible route for a section
 * @param capabilities User's capabilities
 * @param section 'live-ops' or 'data-console'
 * @returns First accessible route path or fallback
 */
export const getDefaultRoute = (
  capabilities: Capabilities | null,
  section: 'live-ops' | 'data-console' = 'data-console'
): string => {
  const routes = section === 'live-ops' ? LIVE_OPS_ROUTES : DATA_CONSOLE_ROUTES;

  if (!capabilities) {
    return section === 'live-ops' ? '/ops/dashboard' : '/security';
  }

  for (const route of routes) {
    if (capabilities[route.capability] === true) {
      return route.path;
    }
  }

  // Fallback
  return section === 'live-ops' ? '/ops/dashboard' : '/security';
};

/**
 * Filter routes by user capabilities
 * @param routes Routes to filter
 * @param capabilities User's capabilities
 * @returns Filtered routes the user has access to
 */
export const getAccessibleRoutes = (
  routes: RouteConfig[],
  capabilities: Capabilities | null
): RouteConfig[] => {
  if (!capabilities) {
    return [];
  }

  return routes.filter((route) => capabilities[route.capability] === true);
};

/**
 * Get navigation items for a specific section
 * @param section 'live-ops' or 'data-console'
 * @param capabilities User's capabilities
 * @returns Navigation items with capability filtering
 */
export const getNavigationItems = (
  section: 'live-ops' | 'data-console',
  capabilities: Capabilities | null
) => {
  const routes = section === 'live-ops' ? LIVE_OPS_ROUTES : DATA_CONSOLE_ROUTES;
  return getAccessibleRoutes(routes, capabilities).map((route) => ({
    to: route.path,
    label: route.label,
  }));
};

// Complete routing configuration
export const routingConfig: RoutingConfig = {
  liveOpsRoutes: LIVE_OPS_ROUTES,
  dataConsoleRoutes: DATA_CONSOLE_ROUTES,
  defaultLiveOpsRoute: '/ops/dashboard',
};
