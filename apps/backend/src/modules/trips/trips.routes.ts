import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { cuidSchema, ok, okList, serializeTrip, serializeUser } from 'shared';
import { AppError } from '../../lib/errors';
import { mobileRoute, adminRoute } from '../../middleware/route-guards';
import { checkRateLimit, RateLimits } from '../../lib/rate-limit';
import { cacheIdempotentResponse, IDEMPOTENCY_TTL } from '../../plugins/idempotency';
import { assertActor } from '../../spine/auth';
import { tripsService } from './trips.service';
import { delegateService } from './delegate.service';

const manualMarkSchema = z.object({
  studentId: z.string().cuid(),
  note: z.string().optional(),
});

const delegateCheckSchema = z.object({
  lat: z.number(),
  lon: z.number(),
});

const delegateActivateSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  delegateType: z.enum(['GPS', 'KIOSK', 'BOTH']),
});

const delegateWarningSchema = z.object({
  warningType: z.enum([
    'BACKGROUND_ENTERED',
    'PRECISION_LOCATION_DISABLED',
    'GPS_ACCURACY_DEGRADED',
    'LOCATION_PERMISSION_REVOKED',
    'BATTERY_SAVER_ENABLED',
    'PING_FAILURES_REPEATED'
  ]),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  meta: z.record(z.any()).optional(),
});

export async function tripsRoutes(app: FastifyInstance) {

  // DRIVER: Start a pre-created trip (the full-screen button)
  app.patch('/:tripId/start', {
    preHandler: mobileRoute(['DRIVER']),
  }, async (request, reply) => {
    const params = z.object({ tripId: cuidSchema }).safeParse(request.params);
    if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', params.error.issues);

    // Rate limit: 100 operations per hour per driver
    await checkRateLimit((app as any).redis, {
      key: `rl:trip:${request.user!.sub}`,
      max: 100,
      windowSeconds: 3600,
      reply,
    });

    const actor = assertActor(request);
    const trip = await tripsService.startTrip(params.data.tripId, request.user!.sub);
    const serializedTrip = serializeTrip(actor, trip, { driverName: '' });
    const body = ok(serializedTrip, request.id);
    await cacheIdempotentResponse(request, 200, body, IDEMPOTENCY_TTL.ONE_DAY);
    return reply.send(body);
  });

  // DRIVER: End a trip
  app.post('/:tripId/end', {
    preHandler: mobileRoute(['DRIVER']),
  }, async (request, reply) => {
    const params = z.object({ tripId: cuidSchema }).safeParse(request.params);
    if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', params.error.issues);

    const actor = assertActor(request);
    const trip = await tripsService.endTrip(params.data.tripId, request.user!.sub, {
      actorType: 'MOBILE_USER',
      actorId: request.user!.sub,
      ip: request.ip,
    });
    const serializedTrip = serializeTrip(actor, trip, { driverName: '' });
    return reply.send(ok(serializedTrip, request.id));
  });

  // DRIVER: Get the student attendance list for a given trip
  app.get('/:tripId/students', {
    preHandler: mobileRoute(['DRIVER']),
  }, async (request, reply) => {
    const params = z.object({ tripId: cuidSchema }).safeParse(request.params);
    if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', params.error.issues);

    const actor = assertActor(request);
    const attendanceRows = await tripsService.getTripStudents(params.data.tripId);
    const data = attendanceRows
      .map((row) => ({
        ...row,
        user: serializeUser(actor, row.user),
      }))
      .filter((row) => row.user);
    return reply.send(okList(data, { page: 1, limit: data.length, total: data.length, hasMore: false }, request.id));
  });

  // DRIVER: Manually mark a student as present
  app.post('/:tripId/manual-mark', {
    preHandler: mobileRoute(['DRIVER']),
  }, async (request, reply) => {
    const params = z.object({ tripId: cuidSchema }).safeParse(request.params);
    if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', params.error.issues);

    const parsed = manualMarkSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

    const log = await tripsService.manualMark(params.data.tripId, parsed.data.studentId, request.user!.sub, parsed.data.note);
    const body = ok(log, request.id);
    await cacheIdempotentResponse(request, 201, body, IDEMPOTENCY_TTL.THIRTY_MINUTES);
    return reply.code(201).send(body);
  });

  // ADMIN: Get trips that haven't started on time
  app.get('/late-starts', {
    preHandler: adminRoute(['COORDINATOR', 'TRANSPORT_OFFICER', 'MANAGEMENT']),
  }, async (request, reply) => {
    const actor = assertActor(request);
    const lateStartRows = await tripsService.getLateStartTrips();
    const data = lateStartRows.map((row) => ({
      ...serializeTrip(actor, row, { driverName: '' }),
      bus: row.bus ? { id: row.bus.id, number: row.bus.number } : null,
      route: row.route ? { id: row.route.id, name: row.route.name } : null,
    }));
    return reply.send(okList(data, { page: 1, limit: data.length, total: data.length, hasMore: false }, request.id));
  });

  // DRIVER: Get the driver's scheduled trip for today (shown on app open)
  app.get('/my-trip', {
    preHandler: mobileRoute(['DRIVER']),
  }, async (request, reply) => {
    const actor = assertActor(request);
    const scheduledTrip = await tripsService.getScheduledTripForDriver(request.user!.sub);
    const data = scheduledTrip
      ? {
          ...serializeTrip(actor, scheduledTrip, { driverName: '' }),
          bus: scheduledTrip.bus ? { id: scheduledTrip.bus.id, number: scheduledTrip.bus.number } : null,
          route: scheduledTrip.route ? { id: scheduledTrip.route.id, name: scheduledTrip.route.name } : null,
        }
      : null;
    return reply.send(ok(data, request.id));
  });

  // ==========================================
  // DELEGATION FLOW (Section 17 - Hardened)
  // ==========================================

  app.post('/:tripId/delegate/check', {
    preHandler: adminRoute(['COORDINATOR', 'TRANSPORT_OFFICER', 'FACULTY', 'MANAGEMENT']),
  }, async (request, reply) => {
    const { tripId } = request.params as { tripId: string };
    const parsed = delegateCheckSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

    const result = await delegateService.checkEligibility(tripId, request.user!.sub, parsed.data.lat, parsed.data.lon);
    return reply.send({ ...result, success: true });
  });

  // DELEGATE: Submit degradation warning (Phase 3 Hardening)
  app.post('/:tripId/delegate/warning', {
    preHandler: adminRoute(['COORDINATOR', 'TRANSPORT_OFFICER', 'FACULTY', 'MANAGEMENT']),
  }, async (request, reply) => {
    const { tripId } = request.params as { tripId: string };
    const parsed = delegateWarningSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

    await delegateService.handleWarning(tripId, request.user!.sub, parsed.data);
    return reply.send({ success: true, message: 'Warning recorded' });
  });

  app.post('/:tripId/delegate/activate', {
    preHandler: adminRoute(['COORDINATOR', 'TRANSPORT_OFFICER', 'FACULTY', 'MANAGEMENT']),
  }, async (request, reply) => {
    const { tripId } = request.params as { tripId: string };
    const parsed = delegateActivateSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

    const result = await delegateService.activateDelegation(
      tripId, request.user!.sub, parsed.data.lat, parsed.data.lon, parsed.data.delegateType
    );
    return reply.send(result);
  });

  app.post('/:tripId/delegate/end', {
    preHandler: mobileRoute(['DRIVER']),
  }, async (request, reply) => {
    const { tripId } = request.params as { tripId: string };
    await delegateService.endDelegation(tripId, 'MANUAL_END', request.user!.sub);
    return reply.send({ success: true });
  });
}
