/**
 * ROUTES REPOSITORY
 *
 * All Prisma access for the routes module lives here.
 * Service layer orchestrates; repository executes.
 *
 * No business logic in this file. No AppError throws (except for
 * unexpected DB errors re-thrown as INTERNAL_ERROR by the caller).
 * Return raw Prisma types; service transforms them.
 */
import { prisma } from '../../lib/prisma';
import { getTodayDateKey, getDistanceMetres } from 'shared';
import type {
  CreateRouteInput,
  UpdateRouteInput,
  CreateStopInput,
  UpdateRouteStopsInput,
  RouteWithStops,
  Stop,
  AuditContext,
} from './routes.types';

// ─── Shared Prisma include for route with stops ───────────────────────────────

const ROUTE_WITH_STOPS_INCLUDE = {
  stops: {
    include: {
      stop: true,
    },
    orderBy: { sequence: 'asc' as const },
  },
} as const;

// ─── Repository ───────────────────────────────────────────────────────────────

class RoutesRepository {
  /**
   * Create a new route with initial metadata.
   */
  async create(data: CreateRouteInput, audit: AuditContext): Promise<RouteWithStops> {
    const route = await prisma.route.create({
      data: {
        name: data.name,
        area: data.area,
        activeDays: data.activeDays,
        isActive: true,
      },
      include: ROUTE_WITH_STOPS_INCLUDE,
    });
    return this.serialize(route);
  }

  /**
   * Find all active routes with pagination.
   * @param page 1-indexed page number
   * @param limit Stops per page (default 20)
   * @returns Paginated routes with metadata
   */
  async findAllPaginated(
    page: number = 1,
    limit: number = 20,
  ): Promise<{ routes: RouteWithStops[]; total: number; hasMore: boolean }> {
    const skip = (page - 1) * limit;

    const [routes, total] = await Promise.all([
      prisma.route.findMany({
        where: { isActive: true },
        include: ROUTE_WITH_STOPS_INCLUDE,
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      prisma.route.count({ where: { isActive: true } }),
    ]);

    return {
      routes: routes.map((r) => this.serialize(r)),
      total,
      hasMore: skip + limit < total,
    };
  }

  /**
   * Find all active routes with their stops.
   */
  async findAll(): Promise<RouteWithStops[]> {
    const routes = await prisma.route.findMany({
      where: { isActive: true },
      include: ROUTE_WITH_STOPS_INCLUDE,
      orderBy: { name: 'asc' },
    });
    return routes.map((r) => this.serialize(r));
  }

  /**
   * Find a single route by ID.
   */
  async findById(routeId: string): Promise<RouteWithStops | null> {
    const route = await prisma.route.findFirst({
      where: { id: routeId, isActive: true },
      include: ROUTE_WITH_STOPS_INCLUDE,
    });
    return route ? this.serialize(route) : null;
  }

  /**
   * Find a route by name and area (for duplicate checking).
   */
  async findByNameAndArea(name: string, area: string): Promise<RouteWithStops | null> {
    const route = await prisma.route.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        area: { equals: area, mode: 'insensitive' },
        isActive: true,
      },
      include: ROUTE_WITH_STOPS_INCLUDE,
    });
    return route ? this.serialize(route) : null;
  }

  /**
   * Update route metadata (name, area, activeDays, isActive).
   */
  async update(
    routeId: string,
    data: UpdateRouteInput,
    audit: AuditContext,
  ): Promise<RouteWithStops> {
    const route = await prisma.route.update({
      where: { id: routeId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.area !== undefined && { area: data.area }),
        ...(data.activeDays !== undefined && { activeDays: data.activeDays }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        updatedAt: new Date(),
      },
      include: ROUTE_WITH_STOPS_INCLUDE,
    });
    return this.serialize(route);
  }

  /**
   * Find all active stops in the system.
   */
  async findAllStops(): Promise<Stop[]> {
    const stops = await prisma.stop.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    return stops.map((s) => this.serializeStop(s));
  }

  /**
   * Find a single stop by ID.
   */
  async findStopById(stopId: string): Promise<Stop | null> {
    const stop = await prisma.stop.findFirst({
      where: { id: stopId, isActive: true },
    });
    return stop ? this.serializeStop(stop) : null;
  }

  /**
   * Get all stops within exact distance from coordinates.
   * Uses Haversine formula with bounding box pre-filter.
   * Useful for "find nearby stops" features in the admin panel.
   * 
   * @param lat Target latitude
   * @param lon Target longitude
   * @param radiusMeters Search radius in meters
   * @returns Array of stops within radius, ordered by distance
   */
  async getStopsWithinRadius(
    lat: number,
    lon: number,
    radiusMeters: number,
  ): Promise<(Stop & { distanceMeters: number })[]> {
    // Approximate bounding box for DB filter
    const latDelta = radiusMeters / 111000 + 0.001;
    const lonDelta = radiusMeters / (111000 * Math.cos((lat * Math.PI) / 180)) + 0.001;

    const candidates = await prisma.stop.findMany({
      where: {
        isActive: true,
        lat: { gte: lat - latDelta, lte: lat + latDelta },
        lon: { gte: lon - lonDelta, lte: lon + lonDelta },
      },
    });

    // Calculate exact distance and filter
    const nearby = candidates
      .map((stop) => ({
        ...this.serializeStop(stop),
        distanceMeters: getDistanceMetres(lat, lon, stop.lat, stop.lon),
      }))
      .filter((s) => s.distanceMeters <= radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);

    return nearby;
  }

  /**
   * Find stops within `radiusMeters` of (lat, lon).
   * Uses exact Haversine distance formula via getDistanceMetres.
   * Returns the first stop found within radius, or null.
   * 
   * PERFORMANCE: Loads all stops and filters in-memory.
   * For production with > 10k stops, add PostGIS index: GiST(lat, lon).
   * 
   * @param lat Target latitude
   * @param lon Target longitude
   * @param radiusMeters Search radius in meters (e.g. 25m for bus stop proximity)
   * @returns First stop within radius or null
   */
  async findStopNearCoordinates(
    lat: number,
    lon: number,
    radiusMeters: number,
  ): Promise<Stop | null> {
    // Fetch all nearby stops using approximate bounding box first (DB filter)
    // to avoid returning thousands of stops from the database.
    // 1 degree latitude ≈ 111,000 meters; 1 degree longitude varies by latitude.
    const latDelta = radiusMeters / 111000 + 0.001; // +0.001 buffer for filtering
    const lonDelta = radiusMeters / (111000 * Math.cos((lat * Math.PI) / 180)) + 0.001;

    const candidates = await prisma.stop.findMany({
      where: {
        isActive: true,
        lat: { gte: lat - latDelta, lte: lat + latDelta },
        lon: { gte: lon - lonDelta, lte: lon + lonDelta },
      },
    });

    // Filter by exact Haversine distance
    for (const stop of candidates) {
      const distance = getDistanceMetres(lat, lon, stop.lat, stop.lon);
      if (distance <= radiusMeters) {
        return this.serializeStop(stop);
      }
    }

    return null;
  }

  /**
   * Create a new physical stop.
   */
  async createStop(data: CreateStopInput, audit: AuditContext): Promise<Stop> {
    const stop = await prisma.stop.create({
      data: {
        name: data.name,
        area: data.area,
        lat: data.lat,
        lon: data.lon,
        isActive: true,
      },
    });
    return this.serializeStop(stop);
  }

  /**
   * Validate that all provided stopIds exist in the stop catalog.
   * Returns the subset of IDs that were NOT found.
   * Empty array means all IDs are valid.
   */
  async findMissingStopIds(stopIds: string[]): Promise<string[]> {
    const found = await prisma.stop.findMany({
      where: { id: { in: stopIds }, isActive: true },
      select: { id: true },
    });
    const foundIds = new Set(found.map((s) => s.id));
    return stopIds.filter((id) => !foundIds.has(id));
  }

  /**
   * Check if a route has any active trips today.
   * Returns true if route cannot be modified (live trip exists).
   */
  async hasActiveTripToday(routeId: string): Promise<boolean> {
    const today = getTodayDateKey();
    const liveTrip = await prisma.trip.findFirst({
      where: {
        routeId,
        date: today,
        status: { in: ['SCHEDULED', 'ACTIVE'] },
      },
    });
    return !!liveTrip;
  }

  /**
   * Atomically replace all stops on a route.
   * Runs in a transaction: delete existing RouteStop rows, insert new ones,
   * touch route.updatedAt to invalidate any concurrent if-unmodified-since checks.
   *
   * This is a full replacement (PUT semantics), not a patch (PATCH semantics).
   */
  async replaceStops(
    routeId: string,
    stops: UpdateRouteStopsInput[],
    audit: AuditContext,
  ): Promise<RouteWithStops> {
    const route = await prisma.$transaction(async (tx) => {
      // Remove all existing stop assignments for this route
      await tx.routeStop.deleteMany({ where: { routeId } });

      // Insert new stop assignments
      await tx.routeStop.createMany({
        data: stops.map((stop) => ({
          routeId,
          stopId: stop.stopId,
          sequence: stop.sequence,
          scheduledTimeMorning: stop.morningTime ? this.timeStringToMinutes(stop.morningTime) : 0,
          scheduledTimeReturn: stop.returnTime ? this.timeStringToMinutes(stop.returnTime) : 0,
          isActive: true,
        })),
      });

      // Touch updatedAt so concurrent sessions fail their optimistic lock check
      return tx.route.update({
        where: { id: routeId },
        data: {
          updatedAt: new Date(),
        },
        include: ROUTE_WITH_STOPS_INCLUDE,
      });
    });

    return this.serialize(route);
  }

  // ─── Serializers ───────────────────────────────────────────────────────────

  /**
   * Convert Prisma route record to RouteWithStops.
   */
  private serialize(route: any): RouteWithStops {
    return {
      id: route.id,
      name: route.name,
      area: route.area,
      activeDays: route.activeDays,
      isActive: route.isActive,
      updatedAt: route.updatedAt?.toISOString() ?? new Date().toISOString(),
      createdAt: route.createdAt?.toISOString() ?? new Date().toISOString(),
      stops: (route.stops ?? []).map((rs: any) => ({
        id: rs.id,
        stopId: rs.stopId,
        sequence: rs.sequence,
        morningTime: rs.scheduledTimeMorning ? this.minutesToTimeString(rs.scheduledTimeMorning) : undefined,
        returnTime: rs.scheduledTimeReturn ? this.minutesToTimeString(rs.scheduledTimeReturn) : undefined,
        stop: this.serializeStop(rs.stop),
      })),
    };
  }

  /**
   * Convert Prisma stop record to Stop.
   */
  private serializeStop(stop: any): Stop {
    return {
      id: stop.id,
      name: stop.name,
      area: stop.area ?? undefined,
      lat: stop.lat,
      lon: stop.lon,
      isActive: stop.isActive,
      createdAt: stop.createdAt?.toISOString() ?? new Date().toISOString(),
    };
  }

  /**
   * Convert HH:MM string to minutes since midnight.
   */
  private timeStringToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  /**
   * Convert minutes since midnight to HH:MM string.
   */
  private minutesToTimeString(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  }
}

export const routesRepository = new RoutesRepository();
