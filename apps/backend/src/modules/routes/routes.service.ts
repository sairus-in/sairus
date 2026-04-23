/**
 * ROUTES SERVICE
 *
 * Business logic for bus routes and stops.
 *
 * ARCHITECTURE:
 *   Service → Repository → Prisma
 *   No Prisma imports here. All DB access goes through RoutesRepository.
 *   Service orchestrates, validates, and enforces business rules.
 *   Repository executes all DB operations.
 */

import { AppError } from '../../lib/errors';
import { routesRepository } from './routes.repository';
import { logger } from '../../lib/logger';
import type {
  CreateRouteInput,
  UpdateRouteInput,
  CreateStopInput,
  UpdateRouteStopsInput,
  RouteWithStops,
  Stop,
  AuditContext,
} from './routes.types';

class RoutesService {
  /**
   * Create a new bus route with metadata.
   * Prevents duplicate route names within the same area.
   *
   * @param data Route creation input (name, area, activeDays)
   * @param audit Audit context (who, what IP, actor type)
   * @returns Created route with stops (initially empty)
   * @throws DUPLICATE_REQUEST if route with same name+area exists
   */
  async createRoute(
    data: CreateRouteInput,
    audit: AuditContext,
  ): Promise<RouteWithStops> {
    // Prevent duplicate route names within the same area
    const existing = await routesRepository.findByNameAndArea(data.name, data.area);
    if (existing) {
      throw new AppError(
        409,
        'DUPLICATE_REQUEST',
        `A route named "${data.name}" already exists in area "${data.area}"`,
      );
    }

    const route = await routesRepository.create(data, audit);

    logger.info({
      event: 'route_created',
      userId: audit.actorId,
      meta: { routeId: route.id, name: route.name, area: route.area },
    });

    return route;
  }

  /**
   * List all active routes with their stops.
   * No pagination — route list is bounded by bus network size (typically < 200).
   * Coordinator scoping is applied at the route layer via adminRoute(scoped=true).
   *
   * @returns Array of all active routes with stops
   */
  async listRoutes(): Promise<RouteWithStops[]> {
    return routesRepository.findAll();
  }

  /**
   * Get a single route by ID with full stop details.
   * Throws ROUTE_NOT_FOUND if the route doesn't exist or is soft-deleted.
   *
   * @param routeId Target route ID
   * @returns Route with all stops included
   * @throws ROUTE_NOT_FOUND if not found or not active
   */
  async getRoute(routeId: string): Promise<RouteWithStops> {
    const route = await routesRepository.findById(routeId);
    if (!route) {
      throw new AppError(404, 'ROUTE_NOT_FOUND');
    }
    return route;
  }

  /**
   * Update route metadata (name, area, activeDays, isActive).
   * Does NOT update the stop list — that is handled by updateRouteStops().
   * Separation of concerns: metadata vs. stop ordering are different operations
   * with different concurrency models.
   *
   * @param routeId Target route ID
   * @param data Partial update (any fields can be omitted)
   * @param audit Audit context
   * @returns Updated route
   * @throws ROUTE_NOT_FOUND if not found
   */
  async updateRoute(
    routeId: string,
    data: UpdateRouteInput,
    audit: AuditContext,
  ): Promise<RouteWithStops> {
    const route = await routesRepository.findById(routeId);
    if (!route) {
      throw new AppError(404, 'ROUTE_NOT_FOUND');
    }

    const updated = await routesRepository.update(routeId, data, audit);

    logger.info({
      event: 'route_updated',
      userId: audit.actorId,
      meta: { routeId, updates: Object.keys(data) },
    });

    return updated;
  }

  /**
   * Get all stops in the system (the "catalog" of available stops).
   * Stops are shared across routes — a stop can appear on multiple routes
   * at different sequence positions.
   * Includes lat/lon for map display.
   *
   * @returns Array of all active stops
   */
  async getStopsCatalog(): Promise<Stop[]> {
    return routesRepository.findAllStops();
  }

  /**
   * Create a new physical bus stop in the stop catalog.
   * Stop coordinates are required (enforced by Zod schema in route handler).
   * Stop is not assigned to any route at creation — use updateRouteStops() for that.
   * Prevents duplicate stops at the same coordinates (within ~10 meters).
   *
   * @param data Stop creation input (name, area?, lat, lon)
   * @param audit Audit context
   * @returns Created stop
   * @throws DUPLICATE_REQUEST if stop exists within 10m of coordinates
   */
  async createStop(
    data: CreateStopInput,
    audit: AuditContext,
  ): Promise<Stop> {
    // Prevent duplicate stops at the same coordinates (within ~10 meters)
    const nearbyStop = await routesRepository.findStopNearCoordinates(
      data.lat,
      data.lon,
      10, // 10 meter radius
    );
    if (nearbyStop) {
      throw new AppError(
        409,
        'DUPLICATE_REQUEST',
        `Stop "${nearbyStop.name}" already exists within 10 meters of these coordinates`,
      );
    }

    const stop = await routesRepository.createStop(data, audit);

    logger.info({
      event: 'stop_created',
      userId: audit.actorId,
      meta: { stopId: stop.id, name: stop.name, coords: `${stop.lat},${stop.lon}` },
    });

    return stop;
  }

  /**
   * Replace the entire stop list for a route atomically.
   * Uses optimistic locking via the route's updatedAt timestamp.
   * If the route was modified since the client last loaded it (if-unmodified-since),
   * throws ROUTE_MODIFIED_CONCURRENTLY (409) rather than silently overwriting.
   *
   * Blocks modifications if any active trip occupies this route today.
   *
   * @param routeId Target route
   * @param stops New stop list (full replacement — not a patch)
   * @param audit Audit context for the change log
   * @param ifUnmodifiedSince ISO timestamp from If-Unmodified-Since header
   * @returns Updated route with new stops
   * @throws ROUTE_NOT_FOUND if route doesn't exist
   * @throws ROUTE_MODIFIED_CONCURRENTLY if updatedAt mismatch (409)
   * @throws OPERATION_FAILED if route has live trips today
   * @throws VALIDATION_ERROR if stopIds don't exist or sequences invalid
   */
  async updateRouteStops(
    routeId: string,
    stops: UpdateRouteStopsInput[],
    audit: AuditContext,
    ifUnmodifiedSince?: string,
  ): Promise<RouteWithStops> {
    const route = await routesRepository.findById(routeId);
    if (!route) {
      throw new AppError(404, 'ROUTE_NOT_FOUND');
    }

    // Optimistic locking: reject if route was modified after the client loaded it
    if (ifUnmodifiedSince) {
      const clientTimestamp = new Date(ifUnmodifiedSince).getTime();
      const serverTimestamp = new Date(route.updatedAt).getTime();

      if (serverTimestamp > clientTimestamp) {
        throw new AppError(409, 'ROUTE_MODIFIED_CONCURRENTLY', {
          serverUpdatedAt: route.updatedAt,
          message: 'Route was modified by another user. Please refresh and reapply your changes.',
        });
      }
    }

    // Temporal protection: Block modifications if any active trip occupies this route today
    const hasActiveTrip = await routesRepository.hasActiveTripToday(routeId);
    if (hasActiveTrip) {
      throw new AppError(
        422,
        'OPERATION_FAILED',
        `Cannot modify stops. Route is actively engaged in a live trip.`,
      );
    }

    // Validate all stopIds exist before committing
    const stopIds = stops.map((s) => s.stopId);
    const missingStops = await routesRepository.findMissingStopIds(stopIds);
    if (missingStops.length > 0) {
      throw new AppError(400, 'VALIDATION_ERROR', {
        message: 'Some stopIds do not exist in the stop catalog',
        missingStopIds: missingStops,
      });
    }

    // Validate sequence numbers are unique and contiguous (1, 2, 3...)
    const sequences = stops.map((s) => s.sequence).sort((a, b) => a - b);
    const expectedSequences = Array.from({ length: stops.length }, (_, i) => i + 1);
    const sequenceValid = sequences.every((seq, i) => seq === expectedSequences[i]);
    if (!sequenceValid) {
      throw new AppError(400, 'VALIDATION_ERROR', {
        message: 'Stop sequences must be unique integers starting from 1',
        provided: sequences,
        expected: expectedSequences,
      });
    }

    const updated = await routesRepository.replaceStops(routeId, stops, audit);

    logger.info({
      event: 'route_stops_updated',
      userId: audit.actorId,
      meta: { routeId, stopCount: stops.length },
    });

    return updated;
  }
}

export const routesService = new RoutesService();
