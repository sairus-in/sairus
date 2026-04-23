import { FastifyInstance } from 'fastify';
import { mobileRoute } from '../../middleware/route-guards';
import { AppError } from '../../lib/errors';
import { ok } from 'shared';
import { serializeDriverAssignment } from './driver.serializers';
import { driverService } from './driver.service';
import * as z from 'zod';

const startTripSchema = z.object({
  tripId: z.string().cuid(),
});

export async function driverRoutes(app: FastifyInstance) {
  // GET /today-assignment — driver's scheduled trip for today
  app.get('/today-assignment', {
    preHandler: mobileRoute(['DRIVER']),
  }, async (request, reply) => {
    const driverId = request.user!.sub;
    const assignment = await driverService.getTodayAssignment(driverId);

    if (!assignment.trip) {
      return reply.send(ok({ trip: null, bus: null, route: null, expectedStudents: 0 }, request.id));
    }

    return reply.send(
      ok(
        serializeDriverAssignment(assignment.trip, assignment.scheduledDeparture, assignment.expectedStudents),
        request.id,
      ),
    );
  });

  // POST /start-trip — DEPRECATED endpoint (returns 410)
  app.post('/start-trip', {
    preHandler: mobileRoute(['DRIVER']),
  }, async (request, reply) => {
    const parsed = startTripSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    return reply.code(410).send(
      ok(
        {
          error: 'ENDPOINT_DEPRECATED',
          message: 'This endpoint is deprecated. Use PATCH /v1/trips/:tripId/start instead.',
          canonical: `/v1/trips/${parsed.data.tripId}/start`,
        },
        request.id,
      ),
    );
  });

  // GET /route-stops — get all stops for driver's assigned route
  app.get('/route-stops', {
    preHandler: mobileRoute(['DRIVER']),
  }, async (request, reply) => {
    const driverId = request.user!.sub;
    const stops = await driverService.getRouteStops(driverId);
    return reply.send(ok(stops, request.id));
  });

  // GET /trip-summary/:tripId — get trip summary with absent students
  app.get<{ Params: { tripId: string } }>('/trip-summary/:tripId', {
    preHandler: mobileRoute(['DRIVER']),
  }, async (request, reply) => {
    const driverId = request.user!.sub;
    const summary = await driverService.getTripSummary(request.params.tripId, driverId);
    return reply.send(ok(summary, request.id));
  });

  // POST /end-trip/:tripId — DEPRECATED endpoint (returns 410)
  app.post<{ Params: { tripId: string } }>('/end-trip/:tripId', {
    preHandler: mobileRoute(['DRIVER']),
  }, async (request, reply) => {
    return reply.code(410).send(
      ok(
        {
          error: 'ENDPOINT_DEPRECATED',
          message: 'This endpoint is deprecated. Use POST /v1/trips/:tripId/end instead.',
          canonical: `/v1/trips/${request.params.tripId}/end`,
        },
        request.id,
      ),
    );
  });
}
