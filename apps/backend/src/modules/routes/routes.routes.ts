/**
 * ROUTES MODULE — Route Handlers
 *
 * Bus route and stop CRUD for the admin panel.
 *
 * ─── ENDPOINT CONTRACT ────────────────────────────────────────────────────────
 *
 * GET    /v1/routes/           TRANSPORT_OFFICER, COORDINATOR, MANAGEMENT
 * GET    /v1/routes/stops      TRANSPORT_OFFICER, COORDINATOR, MANAGEMENT
 * POST   /v1/routes/           TRANSPORT_OFFICER
 * POST   /v1/routes/stops      TRANSPORT_OFFICER
 * GET    /v1/routes/:id        TRANSPORT_OFFICER, COORDINATOR, MANAGEMENT
 * PATCH  /v1/routes/:id        TRANSPORT_OFFICER, MANAGEMENT
 * PUT    /v1/routes/:id/stops  TRANSPORT_OFFICER, MANAGEMENT
 *
 * ─── OPTIMISTIC LOCKING ───────────────────────────────────────────────────────
 *
 * PUT /routes/:id/stops reads the If-Unmodified-Since header.
 * If two admins are editing stops simultaneously, the second PUT returns 409.
 * Client must reload the route and reapply their changes.
 * This prevents silent overwrites on concurrent edits.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { cuidSchema, coordinatesSchema, ok } from 'shared';
import { AppError } from '../../lib/errors';
import { adminRoute } from '../../middleware/route-guards';
import { routesService } from './routes.service';
import type { AuditContext } from './routes.types';

// ─── Schemas ──────────────────────────────────────────────────────────────────

/**
 * Schema for creating a route.
 */
const createRouteSchema = z.object({
  name: z.string().min(2).max(100),
  area: z.string().min(2).max(100),
  activeDays: z
    .array(z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']))
    .min(1)
    .max(7),
});

/**
 * Schema for updating route metadata.
 */
const updateRouteSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  area: z.string().min(2).max(100).optional(),
  activeDays: z
    .array(z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']))
    .min(1)
    .max(7)
    .optional(),
  isActive: z.boolean().optional(),
});

/**
 * Schema for creating a stop.
 * Includes lat/lon validation with [0,0] and [-1,-1] rejection.
 */
const createStopSchema = z.object({
  name: z.string().min(2).max(100),
  area: z.string().max(100).optional(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
}).refine(
  ({ lat, lon }) => !(lat === 0 && lon === 0),
  { message: 'Coordinates [0,0] are invalid — GPS fix not yet acquired' }
).refine(
  ({ lat, lon }) => !(lat === -1 && lon === -1),
  { message: 'Coordinates [-1,-1] are test data — not valid in production' }
);

/**
 * Schema for updating route stops.
 * Array of stops, each with stopId, sequence, and optional times.
 */
const updateRouteStopsSchema = z
  .array(
    z.object({
      stopId: cuidSchema,
      sequence: z.number().int().min(1),
      morningTime: z
        .string()
        .regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM format')
        .optional(),
      returnTime: z
        .string()
        .regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM format')
        .optional(),
    }),
  )
  .min(1)
  .max(100); // A route with > 100 stops is unrealistic — likely a data error

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Build the AuditContext from the current request.
 * Centralised here so every route builds it the same way.
 * Ensures consistent audit trail across all mutations.
 */
function buildAuditContext(request: any): AuditContext {
  return {
    actorType: 'ADMIN_USER',
    actorId: request.user.sub,
    ip: request.ip,
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function routesRoutes(app: FastifyInstance) {
  /**
   * GET /v1/routes/
   * All active routes with their stops.
   */
  app.get(
    '/',
    { preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR', 'MANAGEMENT']) },
    async (request, reply) => {
      const routes = await routesService.listRoutes();
      return reply.send(ok(routes, request.id));
    },
  );

  /**
   * GET /v1/routes/stops
   * Full stop catalog — all stops available to assign to routes.
   *
   * IMPORTANT: This route must be registered BEFORE /v1/routes/:id
   * to prevent Fastify matching "stops" as a route ID parameter.
   */
  app.get(
    '/stops',
    { preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR', 'MANAGEMENT']) },
    async (request, reply) => {
      const stops = await routesService.getStopsCatalog();
      return reply.send(ok(stops, request.id));
    },
  );

  /**
   * POST /v1/routes/
   * Create a new bus route.
   */
  app.post(
    '/',
    { preHandler: adminRoute(['TRANSPORT_OFFICER']) },
    async (request, reply) => {
      const parsed = createRouteSchema.safeParse(request.body);
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

      const audit = buildAuditContext(request);
      const route = await routesService.createRoute(parsed.data, audit);
      return reply.code(201).send(ok(route, request.id));
    },
  );

  /**
   * POST /v1/routes/stops
   * Add a new stop to the catalog.
   *
   * IMPORTANT: Register before /:id/stops to avoid param collision.
   */
  app.post(
    '/stops',
    { preHandler: adminRoute(['TRANSPORT_OFFICER']) },
    async (request, reply) => {
      const parsed = createStopSchema.safeParse(request.body);
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

      const audit = buildAuditContext(request);
      const stop = await routesService.createStop(parsed.data, audit);
      return reply.code(201).send(ok(stop, request.id));
    },
  );

  /**
   * GET /v1/routes/:id
   * Single route with full stop detail.
   */
  app.get(
    '/:id',
    { preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR', 'MANAGEMENT']) },
    async (request, reply) => {
      const params = z.object({ id: cuidSchema }).safeParse(request.params);
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', params.error.issues);

      const route = await routesService.getRoute(params.data.id as string);
      return reply.send(ok(route, request.id));
    },
  );

  /**
   * PATCH /v1/routes/:id
   * Update route metadata (name, area, activeDays, isActive).
   * Does NOT update the stop list — use PUT /:id/stops for that.
   */
  app.patch(
    '/:id',
    { preHandler: adminRoute(['TRANSPORT_OFFICER', 'MANAGEMENT']) },
    async (request, reply) => {
      const params = z.object({ id: cuidSchema }).safeParse(request.params);
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', params.error.issues);

      const parsed = updateRouteSchema.safeParse(request.body);
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

      const audit = buildAuditContext(request);
      const route = await routesService.updateRoute(params.data.id as string, parsed.data, audit);
      return reply.send(ok(route, request.id));
    },
  );

  /**
   * PUT /v1/routes/:id/stops
   * Replace the full stop list for a route (PUT = full replacement).
   *
   * OPTIMISTIC LOCKING:
   * Pass If-Unmodified-Since header (value = route.updatedAt from your last GET).
   * If another admin saved changes after your GET, you get 409 with the server's
   * current updatedAt so you can reload and reapply.
   *
   * IMPORTANT: This is a full replacement.
   * Send the complete desired stop list, not just the changes.
   */
  app.put(
    '/:id/stops',
    { preHandler: adminRoute(['TRANSPORT_OFFICER', 'MANAGEMENT']) },
    async (request, reply) => {
      const params = z.object({ id: cuidSchema }).safeParse(request.params);
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', params.error.issues);

      const parsed = updateRouteStopsSchema.safeParse(request.body);
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

      const ifUnmodifiedSince = request.headers['if-unmodified-since'] as string | undefined;
      const audit = buildAuditContext(request);

      const route = await routesService.updateRouteStops(
        params.data.id as string,
        parsed.data,
        audit,
        ifUnmodifiedSince,
      );

      return reply.send(ok(route, request.id));
    },
  );
}
