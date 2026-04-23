import { FastifyInstance } from 'fastify';
import { ok } from 'shared';
import { AppError } from '../../lib/errors';
import { checkRateLimit, RateLimits } from '../../lib/rate-limit';
import { redis } from '../../lib/redis';
import { requireMobileAuth } from './auth.middleware';
import {
  mobileLogin,
  mobileRefresh,
  mobileLogout,
  checkMobileLoginRateLimit,
  getMobileUserProfile,
  revokeAllSessionsForUser,
} from './mobile-auth.service';
import { MobileJWTPayload } from 'shared';

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { firebaseToken: string; deviceId: string } }>('/login', async (req, reply) => {
    const { firebaseToken, deviceId } = req.body;
    if (!firebaseToken || !deviceId) {
      throw new AppError('firebaseToken and deviceId are required', 400, 'BAD_REQUEST');
    }

    await checkMobileLoginRateLimit(req.ip);
    const result = await mobileLogin(firebaseToken, deviceId, req.ip);
    return reply.send(result);
  });

  app.post<{ Body: { firebaseToken: string; deviceId: string } }>('/refresh', async (req, reply) => {
    const { firebaseToken, deviceId } = req.body;
    if (!firebaseToken || !deviceId) {
      throw new AppError('Bad request', 400, 'BAD_REQUEST');
    }

    await checkRateLimit(redis, {
      ...RateLimits.mobileRefresh(req.ip),
      max: 15,
      reply,
    });

    const result = await mobileRefresh(firebaseToken, deviceId);
    return reply.send(result);
  });

  app.post('/logout', { preHandler: requireMobileAuth }, async (req, reply) => {
    const user = req.user as MobileJWTPayload;
    await mobileLogout(user.sub, user.deviceId);
    reply.send(ok({ message: 'Logged out' }, req.id));
  });

  app.post('/logout-all', { preHandler: requireMobileAuth }, async (req, reply) => {
    const userId = req.user!.sub;
    const deviceId = (req.user as MobileJWTPayload).deviceId;

    await checkRateLimit(redis, {
      ...RateLimits.logoutAll(userId),
      reply,
    });

    await revokeAllSessionsForUser(userId, deviceId);
    reply.send(ok({ message: 'All sessions logged out' }, req.id));
  });

  app.get('/me', { preHandler: requireMobileAuth }, async (req, reply) => {
    const userId = req.user!.sub;
    const user = await getMobileUserProfile(userId);

    return reply.send(
      ok(
        {
          id: user.id,
          name: user.name,
          phone: user.phone,
          email: user.email,
          role: user.role,
          isActive: user.isActive,
          department: user.department,
          year: user.year,
          rollNumber: user.rollNumber,
          routeAssignment: user.routeAssignment,
        },
        req.id,
      ),
    );
  });
}
