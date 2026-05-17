import { FastifyInstance } from 'fastify';
import { incidentsService } from './incidents.service';
import { mobileRoute, adminRoute } from '../../middleware/route-guards';
import { ROLES, IncidentType, cuidSchema, ok, okList } from 'shared';
import { AppError } from '../../lib/errors';
import * as z from 'zod';
import { cacheIdempotentResponse, IDEMPOTENCY_TTL } from '../../plugins/idempotency';
import { checkRateLimit, RateLimits } from '../../lib/rate-limit';

const reportSchema = z.object({
  tripId: cuidSchema, // ✅ FIXED: was z.string().uuid() ← breaks on every CUID
  type: z.enum([
    'MECHANICAL_FAILURE',
    'FLAT_TYRE',
    'ACCIDENT',
    'DRIVER_UNWELL',
    'ROUTE_BLOCKED',
    'OTHER',
  ]),
  description: z.string().min(5).max(500),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
});

export async function incidentsRoutes(app: FastifyInstance) {
  /**
   * POST /v1/incidents/report
   * Driver reports an incident during a trip.
   *
   * ✅ FIXED:
   *  - tripId: CUID validation (was UUID)
   *  - Response: standard ok() envelope
   *  - Status: 201 Created (was 200)
   *  - Idempotency: prevents duplicate reports on retry
   *  - Rate limiting: 10/hour per driver
   */
  app.post(
    '/report',
    {
      preHandler: mobileRoute([ROLES.DRIVER]),
    },
    async (request, reply) => {
      const parsed = reportSchema.safeParse(request.body);
      if (!parsed.success)
        throw new AppError(400, 'VALIDATION_ERROR' as any, parsed.error.issues);

      const driverId = request.user!.sub;

      // Rate limiting: drivers cannot spam incident reports
      await checkRateLimit((app as any).redis, {
        ...RateLimits.incidentReport(driverId),
        reply,
      });

      try {
        const incident = await incidentsService.reportIncident(
          parsed.data.tripId,
          driverId,
          parsed.data.type as IncidentType,
          parsed.data.description,
        );

        const body = ok(incident, request.id);

        // Cache for idempotent retries
        await cacheIdempotentResponse(request, 201, body, IDEMPOTENCY_TTL.SIX_HOURS);

        return reply.code(201).send(body);
      } catch (err: any) {
        throw new AppError(422, 'INCIDENT_REPORT_FAILED' as any, err.message);
      }
    },
  );

  /**
   * GET /v1/incidents
   * Admin: list all incidents (paginated)
   */
  app.get('/', {
    preHandler: adminRoute(['COORDINATOR', 'TRANSPORT_OFFICER', 'MANAGEMENT']),
  }, async (request, reply) => {
    const filterSchema = z.object({
      status: z.enum(['REPORTED', 'ASSIGNED', 'RESOLVED', 'CANCELLED']).optional(),
      escalationLevel: z.enum(['COORDINATOR', 'TRANSPORT_OFFICER', 'PRINCIPAL']).optional(),
      routeId: cuidSchema.optional(),
      fromDate: z.coerce.date().optional(),
      toDate: z.coerce.date().optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    });

    const parsed = filterSchema.safeParse(request.query);
    if (!parsed.success)
      throw new AppError(400, 'VALIDATION_ERROR' as any, parsed.error.issues);

    const { limit, cursor, status, escalationLevel, routeId, fromDate, toDate } = parsed.data;

    try {
      const result = await incidentsService.listIncidents({
        status: status as any,
        escalationLevel: escalationLevel as any,
        routeId,
        from: fromDate,
        to: toDate,
        cursor,
        limit,
      });

      return reply.send(okList(result.incidents, {
        page: 1,
        limit: result.incidents.length,
        total: result.incidents.length,
        hasMore: !!result.nextCursor,
      }, request.id));
    } catch (err: any) {
      throw new AppError(500, 'LIST_INCIDENTS_FAILED' as any, err.message);
    }
  });

  /**
   * GET /v1/incidents/:id
   * Admin: get incident details
   */
  app.get('/:id', {
    preHandler: adminRoute(['COORDINATOR', 'TRANSPORT_OFFICER', 'MANAGEMENT']),
  }, async (request, reply) => {
    const params = z.object({ id: cuidSchema }).safeParse(request.params);
    if (!params.success)
      throw new AppError(400, 'VALIDATION_ERROR' as any, params.error.issues);

    try {
      const incident = await incidentsService.getIncident(params.data.id);
      return reply.send(ok(incident, request.id));
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(404, 'INCIDENT_NOT_FOUND' as any, err.message);
    }
  });
}
