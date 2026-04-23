/**
 * Routing Debug Utilities
 * Use these to diagnose routing and navigation issues
 */

import { Capabilities } from '../lib/capabilities';
import { DATA_CONSOLE_ROUTES, LIVE_OPS_ROUTES } from '../config/routing.config';

/**
 * Log user capabilities and accessible routes
 * Call this in useEffect to see what the user can access
 */
export const debugRoutingAccess = (
  userId: string,
  capabilities: Capabilities | null,
  section: 'data-console' | 'live-ops' = 'data-console'
) => {
  const routes = section === 'data-console' ? DATA_CONSOLE_ROUTES : LIVE_OPS_ROUTES;

  console.group(`🛣️ Routing Access for User "${userId}" - ${section}`);
  console.log('Capabilities:', capabilities);

  console.group('Accessible Routes:');
  const accessible = routes.filter((route) => capabilities?.[route.capability] === true);
  if (accessible.length === 0) {
    console.warn('⚠️ No accessible routes! User has no capabilities.');
  } else {
    accessible.forEach((route) => {
      console.log(
        `✅ ${route.label}`,
        `(${route.path})`,
        `[${route.capability}]`
      );
    });
  }
  console.groupEnd();

  console.group('Inaccessible Routes:');
  const inaccessible = routes.filter((route) => capabilities?.[route.capability] !== true);
  if (inaccessible.length > 0) {
    inaccessible.forEach((route) => {
      console.log(
        `❌ ${route.label}`,
        `(${route.path})`,
        `[${route.capability}]`
      );
    });
  }
  console.groupEnd();

  console.groupEnd();
};

/**
 * Log current location and expected route resolution
 * Call this on location change to verify routing is working
 */
export const debugRouteMatch = (pathname: string, capabilities: Capabilities | null) => {
  const allRoutes = [...DATA_CONSOLE_ROUTES, ...LIVE_OPS_ROUTES];
  const route = allRoutes.find((r) => r.path === pathname);

  if (!route) {
    console.warn(`⚠️ Route not found: ${pathname}`);
    return;
  }

  const hasCapability = capabilities?.[route.capability] === true;
  console.log(
    hasCapability
      ? `✅ Allowed: ${route.label} (${route.capability})`
      : `❌ Blocked: ${route.label} (Missing ${route.capability})`
  );
};

/**
 * List all available routes in the system
 * Useful for understanding the full routing structure
 */
export const listAllRoutes = () => {
  console.group('📋 All Available Routes');

  console.group('Data Console Routes:');
  DATA_CONSOLE_ROUTES.forEach((route) => {
    console.log(`${route.label}: ${route.path} [requires: ${route.capability}]`);
  });
  console.groupEnd();

  console.group('Live Ops Routes:');
  LIVE_OPS_ROUTES.forEach((route) => {
    console.log(`${route.label}: ${route.path} [requires: ${route.capability}]`);
  });
  console.groupEnd();

  console.groupEnd();
};

/**
 * Check if a capability is properly set up for a route
 */
export const validateRoute = (path: string): boolean => {
  const allRoutes = [...DATA_CONSOLE_ROUTES, ...LIVE_OPS_ROUTES];
  const route = allRoutes.find((r) => r.path === path);

  if (!route) {
    console.error(`❌ Route not found: ${path}`);
    return false;
  }

  console.log(`✅ Route validated: ${route.label}`);
  return true;
};
