import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { cuidSchema, ok, okList, buildPagination } from 'shared';
import { AppError } from '../../lib/errors';
import { mobileRoute, adminRoute } from '../../middleware/route-guards';
import { checkRateLimit, RateLimits } from '../../lib/rate-limit';
import { cacheIdempotentResponse, IDEMPOTENCY_TTL } from '../../plugins/idempotency';
import { attendanceService } from './attendance.service';

const checkInSchema = z.object({
  qrToken: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),   // lon not lng
  clientTimestamp: z.number().int().positive(),
  isReplay: z.boolean().optional(),
});

const verifyArrivalSchema = z.object({
  tripId: z.string().cuid(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  method: z.enum(['SOCKET', 'PUSH_NOTIFICATION']).default('PUSH_NOTIFICATION'),
});

const skipTodaySchema = z.union([
  z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    type: z.enum(['MORNING', 'RETURN']),
    reason: z.string().optional(),
  }),
  z.object({
    tripId: z.string().cuid(),
    reason: z.string().optional(),
  }),
]);

const waitForMeSchema = z.object({
  tripId: z.string().cuid(),
  etaMinutes: z.number().int().min(1).max(30),
});

const correctionRequestSchema = z.object({
  attendanceId: z.string().cuid(),
  reason: z.string().min(10).max(500),
});

const attendanceHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  filter: z.enum(['ABSENT', 'CORRECTIONS']).optional(),
});

const reviewCorrectionSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  reviewNote: z.string().optional(),
});

export async function attendanceRoutes(app: FastifyInstance) {

  // STUDENT: QR check-in (the hot path)
  app.post('/checkin', {
    preHandler: mobileRoute(['STUDENT']),
  }, async (request, reply) => {
    const parsed = checkInSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

    // Pass deviceId header for device binding check
    const deviceId = request.headers['x-device-id'] as string | undefined;

    // Rate limit: 5 check-ins per minute per student
    await checkRateLimit((app as any).redis, {
      ...RateLimits.checkIn(request.user!.sub),
      reply,
    });

    const result = await attendanceService.checkIn(
      request.user!.sub,
      deviceId,
      parsed.data,
      (request.headers['idempotency-key'] as string | undefined),
    );

    const statusCode = result.status === 'ALREADY_CHECKED_IN' ? 200 : 201;
    const body = ok(result, request.id);

    // Cache for 24 hours (one per day pattern)
    await cacheIdempotentResponse(request, statusCode, body, IDEMPOTENCY_TTL.ONE_DAY);

    return reply.code(statusCode).send(body);
  });

  // STUDENT: Arrival verification (called silently by mobile after gate:reached)
  app.post('/verify-arrival', {
    preHandler: mobileRoute(['STUDENT']),
  }, async (request, reply) => {
    const parsed = verifyArrivalSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

    const result = await attendanceService.verifyArrival(
      request.user!.sub,
      parsed.data.tripId,
      parsed.data.lat,
      parsed.data.lon,
      parsed.data.method,
    );
    return reply.send(ok(result, request.id));
  });

  // STUDENT: TripSkip — "not coming today"
  app.post('/skip-today', {
    preHandler: mobileRoute(['STUDENT']),
  }, async (request, reply) => {
    const parsed = skipTodaySchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

    let date: string;
    let type: 'MORNING' | 'RETURN';
    const reason = parsed.data.reason;

    if ('tripId' in parsed.data) {
      try {
        const resolved = await attendanceService.resolveTripForSkip(parsed.data.tripId, request.user!.sub);
        date = resolved.date;
        type = resolved.type;
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg === 'TRIP_NOT_FOUND') throw new AppError(404, 'TRIP_NOT_FOUND');
        if (msg === 'TRIP_ACCESS_DENIED') throw new AppError(403, 'TRIP_ACCESS_DENIED');
        throw err;
      }
    } else {
      date = parsed.data.date;
      type = parsed.data.type;
    }

    const skip = await attendanceService.skipToday(
      request.user!.sub,
      date,
      type,
      reason,
    );
    return reply.code(201).send(ok(skip, request.id));
  });

  // STUDENT: WaitForMe — ping driver to wait
  app.post('/wait-for-me', {
    preHandler: mobileRoute(['STUDENT']),
  }, async (request, reply) => {
    const parsed = waitForMeSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

    const req = await attendanceService.requestWait(
      request.user!.sub,
      parsed.data.tripId,
      parsed.data.etaMinutes,
    );
    return reply.code(201).send(ok(req, request.id));
  });

  // STUDENT: Submit a correction request [DEPRECATED]
  app.post('/correction-request', {
    preHandler: mobileRoute(['STUDENT']),
  }, async (request, reply) => {
    return reply.code(410).send(ok({
      error: 'ENDPOINT_DEPRECATED',
      message: 'Use POST /v1/attendance/corrections instead.',
      canonical: '/v1/attendance/corrections',
    }, request.id));
  });

  app.post('/corrections', {
    preHandler: mobileRoute(['STUDENT']),
  }, async (request, reply) => {
    const parsed = correctionRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

    const result = await attendanceService.requestCorrection(
      request.user!.sub,
      parsed.data.attendanceId,
      parsed.data.reason,
    );

    const body = ok({
      correctionId: result.id,
      status: result.status,
    }, request.id);

    await cacheIdempotentResponse(request, 201, body, IDEMPOTENCY_TTL.ONE_HOUR);
    return reply.code(201).send(body);
  });

  // STUDENT: Attendance history for the mobile history screen
  app.get('/history', {
    preHandler: mobileRoute(['STUDENT']),
  }, async (request, reply) => {
    const parsed = attendanceHistoryQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

    const { page, limit, filter } = parsed.data;
    const { logs, total } = await attendanceService.getAttendanceHistory(request.user!.sub, filter, page, limit);

    const data = logs.map((log) => ({
      id: log.id,
      date: log.date,
      status: log.status,
      busNumber: log.trip.bus.number,
      tripType: log.trip.type,
      checkedInAt: log.checkedInAt?.toISOString() ?? null,
      hasCorrection: log.corrections.length > 0,
      correctionStatus: log.corrections[0]?.status ?? null,
    }));

    return reply.send(okList(data, buildPagination(page, limit, total), request.id));
  });

  // STUDENT: Single attendance log details for the correction form
  app.get('/logs/:logId', {
    preHandler: mobileRoute(['STUDENT']),
  }, async (request, reply) => {
    const params = z.object({ logId: cuidSchema }).safeParse(request.params);
    if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', params.error.issues);

    const log = await attendanceService.getAttendanceLogDetails(params.data.logId, request.user!.sub);

    if (!log) {
      throw new AppError(404, 'ATTENDANCE_NOT_FOUND');
    }

    return reply.send(ok({
      id: log.id,
      date: log.date,
      status: log.status,
      busNumber: log.trip.bus.number,
      tripType: log.trip.type,
      checkedInAt: log.checkedInAt?.toISOString() ?? null,
      distanceToBus: log.distanceToBus,
      distanceToStop: log.distanceToStop,
    }, request.id));
  });

  // COORDINATOR/ADMIN: List pending corrections
  app.get('/corrections', {
    preHandler: adminRoute(['COORDINATOR', 'TRANSPORT_OFFICER', 'MANAGEMENT']),
  }, async (request, reply) => {
    const corrections = await attendanceService.getPendingCorrections();
    return reply.send(okList(corrections, buildPagination(1, 100, corrections.length), request.id));
  });

  // COORDINATOR: Review a correction request — legacy compatibility shim.
  app.post('/corrections/:correctionId/review', {
    preHandler: adminRoute(['COORDINATOR', 'TRANSPORT_OFFICER']),
  }, async (request, reply) => {
    const params = z.object({ correctionId: cuidSchema }).safeParse(request.params);
    if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', params.error.issues);

    const parsed = reviewCorrectionSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

    const result = await attendanceService.reviewCorrection(
      params.data.correctionId,
      request.user!.sub,
      parsed.data.status,
      parsed.data.reviewNote,
    );

    reply.header('Deprecation', 'true');
    reply.header('Link', `</v1/admin/corrections/${params.data.correctionId}>; rel="successor-version"`);
    return reply.send(ok(result, request.id));
  });

  // [HARDENED] Phase 2: GPS Outage Self-Report
  app.post('/self-report', {
    preHandler: mobileRoute(['STUDENT']),
  }, async (request, reply) => {
    const schema = z.object({
      tripId: cuidSchema,
      wasOnBus: z.boolean(),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

    const result = await attendanceService.selfReport(
      request.user!.sub,
      parsed.data.tripId,
      parsed.data.wasOnBus,
    );
    return reply.code(201).send(ok(result, request.id));
  });

  // [HARDENED] Phase 2: Coordinator review of GPS Outage self-reports
  app.get('/admin/gps-outage-corrections', {
    preHandler: adminRoute(['COORDINATOR', 'TRANSPORT_OFFICER']),
  }, async (request, reply) => {
    const results = await attendanceService.getPendingOutageCorrections();
    return reply.send(okList(results, buildPagination(1, 100, results.length), request.id));
  });

  // ==========================================
  // OUTAGE FALLBACK (Section 17 - Hardened)
  // ==========================================

  // COORDINATOR: Mark all expected students PRESENT during severe GPS outage
  app.post('/:tripId/coordinator-override', {
    preHandler: adminRoute(['COORDINATOR', 'TRANSPORT_OFFICER', 'MANAGEMENT']),
  }, async (request, reply) => {
    const params = z.object({ tripId: cuidSchema }).safeParse(request.params);
    if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', params.error.issues);

    const result = await attendanceService.coordinatorMarkAllPresent(params.data.tripId, request.user!.sub, {
      actorType: 'MOBILE_USER',
      actorId: request.user!.sub,
      ip: request.ip,
    });
    return reply.send(ok(result, request.id));
  });
}
