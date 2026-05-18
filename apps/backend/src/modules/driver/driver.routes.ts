import { FastifyInstance } from 'fastify';
import { mobileRoute } from '../../middleware/route-guards';
import { AppError } from '../../lib/errors';
import { ok, serializeTrip } from 'shared';
import { assertActor } from '../../spine/auth';
import { serializeDriverAssignment } from './driver.serializers';
import { driverService } from './driver.service';
import { tripsService } from '../trips/trips.service';
import * as z from 'zod';

const startTripBodySchema = z.object({
  tripId: z.string().cuid(),
});

const tripIdParamsSchema = z.object({
  tripId: z.string().min(1),
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

  // POST /start-trip — legacy compatibility shim.
  app.post('/start-trip', {
    preHandler: mobileRoute(['DRIVER']),
  }, async (request, reply) => {
    const parsed = startTripBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    const actor = assertActor(request);
    const trip = await tripsService.startTrip(parsed.data.tripId, request.user!.sub);
    const serializedTrip = serializeTrip(actor, trip, { driverName: '' });
    reply.header('Deprecation', 'true');
    reply.header('Link', `</v1/trips/${parsed.data.tripId}/start>; rel="successor-version"`);
    return reply.send(ok(serializedTrip, request.id));
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

  // POST /end-trip/:tripId — legacy compatibility shim.
  app.post<{ Params: { tripId: string } }>('/end-trip/:tripId', {
    preHandler: mobileRoute(['DRIVER']),
  }, async (request, reply) => {
    const parsed = tripIdParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    const actor = assertActor(request);
    const trip = await tripsService.endTrip(parsed.data.tripId, request.user!.sub, {
      actorType: 'MOBILE_USER',
      actorId: request.user!.sub,
      ip: request.ip,
    });
    const serializedTrip = serializeTrip(actor, trip, { driverName: '' });
    reply.header('Deprecation', 'true');
    reply.header('Link', `</v1/trips/${parsed.data.tripId}/end>; rel="successor-version"`);
    return reply.send(ok(serializedTrip, request.id));
  });
}
