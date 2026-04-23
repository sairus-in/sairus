/**
 * FLEET MODULE — Route Handlers
 *
 * Bus and driver CRUD for the admin panel.
 *
 * ─── ENDPOINT CONTRACT ────────────────────────────────────────────────────────
 *
 * GET    /v1/buses            TRANSPORT_OFFICER, COORDINATOR, MANAGEMENT (paginated)
 * GET    /v1/buses/:id        TRANSPORT_OFFICER, COORDINATOR, MANAGEMENT
 * POST   /v1/buses            TRANSPORT_OFFICER
 * PUT    /v1/buses/:id        TRANSPORT_OFFICER
 * DELETE /v1/buses/:id        TRANSPORT_OFFICER (cascading soft-delete)
 *
 * GET    /v1/drivers          TRANSPORT_OFFICER, COORDINATOR, MANAGEMENT (paginated)
 * GET    /v1/drivers/:id      TRANSPORT_OFFICER, COORDINATOR, MANAGEMENT
 * POST   /v1/drivers          TRANSPORT_OFFICER
 * PUT    /v1/drivers/:id      TRANSPORT_OFFICER
 * DELETE /v1/drivers/:id      TRANSPORT_OFFICER (cascading soft-delete)
 *
 * POST   /v1/buses/:id/assign-driver  TRANSPORT_OFFICER (assign driver to bus)
 *
 * ─── 4-LAYER ARCHITECTURE ─────────────────────────────────────────────────────
 *
 * Layer 1 (This file): HTTP validation, request parsing, response formatting.
 *                      Calls service layer exclusively.
 *
 * Layer 2: fleet.service.ts — Business logic (bus/driver CRUD, cascading mutations).
 *                              No Prisma imports. Calls repository layer.
 *
 * Layer 3: fleet.repository.ts — All Prisma queries. Error mapping (P2025→404, etc).
 *                                 Returns raw data; service interprets.
 *
 * Layer 4: PostgreSQL — Persistence.
 *
 * ─── ERROR HANDLING ────────────────────────────────────────────────────────────
 *
 * Repository catches Prisma errors:
 * - P2025 (not found) → AppError(404, NOT_FOUND)
 * - P2003 (foreign key) → AppError(400, INVALID_REFERENCE)
 * - P2002 (unique) → AppError(409, DUPLICATE_ENTRY)
 *
 * Service catches business logic errors:
 * - Driver already assigned → AppError(409, CONFLICT)
 * - Active trip → prevent deactivation
 *
 * Routes catch HTTP validation errors → AppError(400, VALIDATION_ERROR)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { cuidSchema, ok, okList, buildPagination } from 'shared';
import { AppError } from '../../lib/errors';
import { adminRoute } from '../../middleware/route-guards';
import { cacheIdempotentResponse, IDEMPOTENCY_TTL } from '../../plugins/idempotency';
import { fleetService } from './fleet.service';
import { serializeBus, serializeDriver } from './fleet.serializers';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const busSchema = z.object({
  number: z.string().min(1).max(50),
  plateNumber: z.string().min(1).max(50),
  capacity: z.number().int().min(1).default(50),
});

const driverSchema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().min(6).max(20),
  licenseNumber: z.string().max(50).optional().nullable(),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const assignDriverSchema = z.object({
  driverId: cuidSchema,
  routeId: cuidSchema,
});

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Build the audit context from the current request.
 */
function buildAuditContext(request: any) {
  return {
    actorType: 'ADMIN_USER',
    actorId: request.user.sub,
    ip: request.ip,
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function fleetRoutes(app: FastifyInstance) {
  /**
   * ──────────────────────────────────────────────────────────────────────────
   * BUS ENDPOINTS
   * ──────────────────────────────────────────────────────────────────────────
   */

  /**
   * GET /v1/fleet/buses
   * List all buses with pagination (default: 20 per page).
   * Includes active route assignments and driver information.
   */
  app.get(
    '/buses',
    { preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR', 'MANAGEMENT']) },
    async (request, reply) => {
      const query = paginationSchema.safeParse(request.query);
      if (!query.success) throw new AppError(400, 'VALIDATION_ERROR', query.error.issues);

      const result = await fleetService.getBusesPaginated(query.data.page, query.data.limit);

      return reply.send(
        okList(
          result.buses.map(serializeBus),
          buildPagination(
            result.pagination.page,
            result.pagination.limit,
            result.pagination.total,
          ),
          request.id,
        ),
      );
    },
  );

  /**
   * GET /v1/fleet/buses/:id
   * Get a single bus by ID.
   */
  app.get(
    '/buses/:id',
    { preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR', 'MANAGEMENT']) },
    async (request, reply) => {
      const params = z.object({ id: cuidSchema }).safeParse(request.params);
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', params.error.issues);

      const bus = await fleetService.getBusById(params.data.id);
      return reply.send(ok(serializeBus(bus), request.id));
    },
  );

  /**
   * POST /v1/fleet/buses
   * Create a new bus.
   */
  app.post(
    '/buses',
    { preHandler: adminRoute(['TRANSPORT_OFFICER']) },
    async (request, reply) => {
      const parsed = busSchema.safeParse(request.body);
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

      const bus = await fleetService.createBus(parsed.data);
      const body = ok(serializeBus({ ...bus, assignments: [] }), request.id);
      await cacheIdempotentResponse(request, 201, body, IDEMPOTENCY_TTL.ONE_DAY);
      return reply.code(201).send(body);
    },
  );

  /**
   * PUT /v1/fleet/buses/:id
   * Update a bus.
   */
  app.put(
    '/buses/:id',
    { preHandler: adminRoute(['TRANSPORT_OFFICER']) },
    async (request, reply) => {
      const params = z.object({ id: cuidSchema }).safeParse(request.params);
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', params.error.issues);

      const parsed = busSchema.partial().safeParse(request.body);
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

      const bus = await fleetService.updateBus(params.data.id, parsed.data);
      return reply.send(ok(serializeBus({ ...bus, assignments: [] }), request.id));
    },
  );

  /**
   * DELETE /v1/fleet/buses/:id
   * Deactivate (soft-delete) a bus.
   * Wraps in transaction to deactivate all assignments.
   */
  app.delete(
    '/buses/:id',
    { preHandler: adminRoute(['TRANSPORT_OFFICER']) },
    async (request, reply) => {
      const params = z.object({ id: cuidSchema }).safeParse(request.params);
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', params.error.issues);

      const userId = request.user!.sub;
      await fleetService.deleteBus(params.data.id, userId);
      return reply.code(204).send();
    },
  );

  /**
   * POST /v1/fleet/buses/:busId/assign-driver
   * Assign a driver to a bus.
   * Prevents driver from being assigned to multiple buses.
   */
  app.post(
    '/buses/:busId/assign-driver',
    { preHandler: adminRoute(['TRANSPORT_OFFICER']) },
    async (request, reply) => {
      const params = z.object({ busId: cuidSchema }).safeParse(request.params);
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', params.error.issues);

      const body = assignDriverSchema.safeParse(request.body);
      if (!body.success) throw new AppError(400, 'VALIDATION_ERROR', body.error.issues);

      const assignment = await fleetService.assignDriver(
        params.data.busId,
        body.data.driverId,
        body.data.routeId,
      );

      return reply.code(201).send(ok(assignment, request.id));
    },
  );

  /**
   * ──────────────────────────────────────────────────────────────────────────
   * DRIVER ENDPOINTS
   * ──────────────────────────────────────────────────────────────────────────
   */

  /**
   * GET /v1/fleet/drivers
   * List all drivers with pagination (default: 20 per page).
   */
  app.get(
    '/drivers',
    { preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR', 'MANAGEMENT']) },
    async (request, reply) => {
      const query = paginationSchema.safeParse(request.query);
      if (!query.success) throw new AppError(400, 'VALIDATION_ERROR', query.error.issues);

      const result = await fleetService.getDriversPaginated({
        page: query.data.page,
        limit: query.data.limit,
        isActive: true, // Only show active drivers by default
      });

      return reply.send(
        okList(
          result.drivers.map(serializeDriver),
          buildPagination(
            result.pagination.page,
            result.pagination.limit,
            result.pagination.total,
          ),
          request.id,
        ),
      );
    },
  );

  /**
   * GET /v1/fleet/drivers/:id
   * Get a single driver by ID.
   */
  app.get(
    '/drivers/:id',
    { preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR', 'MANAGEMENT']) },
    async (request, reply) => {
      const params = z.object({ id: cuidSchema }).safeParse(request.params);
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', params.error.issues);

      const driver = await fleetService.getDriverById(params.data.id);
      return reply.send(ok(serializeDriver(driver), request.id));
    },
  );

  /**
   * POST /v1/fleet/drivers
   * Create a new driver.
   */
  app.post(
    '/drivers',
    { preHandler: adminRoute(['TRANSPORT_OFFICER']) },
    async (request, reply) => {
      const parsed = driverSchema.safeParse(request.body);
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

      const driver = await fleetService.createDriver(parsed.data);
      const body = ok(serializeDriver(driver), request.id);
      await cacheIdempotentResponse(request, 201, body, IDEMPOTENCY_TTL.ONE_DAY);
      return reply.code(201).send(body);
    },
  );

  /**
   * PUT /v1/fleet/drivers/:id
   * Update a driver.
   */
  app.put(
    '/drivers/:id',
    { preHandler: adminRoute(['TRANSPORT_OFFICER']) },
    async (request, reply) => {
      const params = z.object({ id: cuidSchema }).safeParse(request.params);
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', params.error.issues);

      const parsed = driverSchema.partial().safeParse(request.body);
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

      const driver = await fleetService.updateDriver(params.data.id, parsed.data);
      return reply.send(ok(serializeDriver(driver), request.id));
    },
  );

  /**
   * DELETE /v1/fleet/drivers/:id
   * Deactivate (soft-delete) a driver.
   * Wraps in transaction to:
   * 1. End any active trip
   * 2. Deactivate all assignments
   * 3. Revoke JWT sessions
   * 4. Revoke FCM tokens
   */
  app.delete(
    '/drivers/:id',
    { preHandler: adminRoute(['TRANSPORT_OFFICER']) },
    async (request, reply) => {
      const params = z.object({ id: cuidSchema }).safeParse(request.params);
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', params.error.issues);

      const userId = request.user!.sub;
      await fleetService.deactivateDriver(params.data.id, userId);
      return reply.code(204).send();
    },
  );
}
