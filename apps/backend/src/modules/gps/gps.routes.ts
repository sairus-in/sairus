import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { cuidSchema, ok } from 'shared';
import { AppError } from '../../lib/errors';
import { mobileRoute } from '../../middleware/route-guards';
import { checkRateLimit, RateLimits } from '../../lib/rate-limit';
import { gpsService } from './gps.service';

const pingSchema = z.object({
  busId: z.string().cuid(),
  tripId: z.string().cuid().optional(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  speed: z.number().min(0),
  heading: z.number().min(0).max(360),
  accuracy: z.number().min(0),
  timestamp: z.number().int().positive(),
  isDelegated: z.boolean().optional(),
});

export async function gpsRoutes(app: FastifyInstance) {

  // Hardened GPS Routing: accepts pings from Driver AND authorized Delegates
  app.post('/ping', {
    preHandler: mobileRoute(['DRIVER']),
  }, async (request, reply) => {
    const parsed = pingSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    // Rate limit: 30 pings per minute per bus
    await checkRateLimit((app as any).redis, {
      ...RateLimits.gpsPing(parsed.data.busId),
      reply,
    });

    const payload = {
      ...parsed.data,
      userId: request.user!.sub, // Ensure source validation in processPing works
    };

    const result = await gpsService.processPing(payload);
    if (!result.accepted) {
      throw new AppError(403, 'GPS_PING_REJECTED', result.reason);
    }

    return reply.send(ok({ source: result.source }, request.id));
  });
}
