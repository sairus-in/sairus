import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { cuidSchema, ok, okList, buildPagination, PUSH_TOKEN_PROVIDER, serializeUser } from 'shared';
import { AppError } from '../../lib/errors';
import { mobileRoute, adminRoute } from '../../middleware/route-guards';
import { checkRateLimit, RateLimits } from '../../lib/rate-limit';
import { cacheIdempotentResponse, IDEMPOTENCY_TTL } from '../../plugins/idempotency';
import { assertActor } from '../../spine/auth';
import { usersService } from './users.service';

const bulkImportSchema = z.array(z.object({
  phone: z.string(),
  name: z.string(),
  email: z.string().email().optional(),
  rollNumber: z.string(),
  department: z.string(),
  year: z.number().int().min(1).max(6),
  assignedRouteId: cuidSchema.optional(),
  assignedStopId: cuidSchema.optional(),
}));

const assignStudentSchema = z.object({
  routeId: cuidSchema,
  stopId: cuidSchema,
});

const bulkAssignStudentsSchema = z.object({
  studentIds: z.array(cuidSchema).min(1).max(1000),
  routeId: cuidSchema,
  stopId: cuidSchema,
});

const updateStudentSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(6),
  rollNumber: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  year: z.number().int().min(1).max(6).optional().nullable(),
  routeId: cuidSchema.optional(),
  stopId: cuidSchema.optional(),
});

const updatePushTokenSchema = z.object({
  pushToken: z.string().min(1).max(4096).optional(),
  fcmToken: z.string().min(1).max(4096).optional(),
  pushTokenProvider: z.enum([PUSH_TOKEN_PROVIDER.EXPO, PUSH_TOKEN_PROVIDER.FCM]).optional(),
}).refine(
  (value) => Boolean(value.pushToken || value.fcmToken),
  { message: 'pushToken or fcmToken is required', path: ['pushToken'] },
);

export async function usersRoutes(app: FastifyInstance) {

  app.patch('/fcm-token', {
    preHandler: mobileRoute(['STUDENT', 'DRIVER', 'PARENT']),
  }, async (request, reply) => {
    const parsed = updatePushTokenSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    const pushToken = parsed.data.pushToken ?? parsed.data.fcmToken!;

    await usersService.updatePushToken(
      request.user!.sub,
      pushToken,
      parsed.data.pushTokenProvider,
    );

    return reply.send(ok({}, request.id));
  });

  // GET /v1/users - Protected listing w/ scoped role serializers
  app.get('/', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'MANAGEMENT', 'COORDINATOR', 'FACULTY'], true),
  }, async (request, reply) => {
    const querySchema = z.object({
      role: z.string().optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      search: z.string().optional(),
      routeId: cuidSchema.optional(),
      status: z.string().optional(),
      authStatus: z.string().optional(),
    });

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
    }
    const actor = assertActor(request);
    const { role, page, limit, search, routeId, status, authStatus } = parsed.data;

    const whereClause: any = {};
    if (role) whereClause.role = role;
    if (search) {
      whereClause.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { rollNumber: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status !== undefined) {
      whereClause.isActive = status === 'active';
    }
    if (authStatus) {
      whereClause.authStatus = authStatus;
    }

    if (request.coordinatorRouteIds) {
      whereClause.routeAssignment = {
        routeId: { in: request.coordinatorRouteIds },
        isActive: true,
      };
    }

    if (routeId) {
      if (routeId === 'unassigned') {
        whereClause.routeAssignment = null;
      } else if (!whereClause.routeAssignment) {
        whereClause.routeAssignment = { routeId, isActive: true };
      } else if (request.coordinatorRouteIds) {
        // Prevent overriding external routeId outside scoped bounds
        const intersected = request.coordinatorRouteIds.includes(routeId) ? routeId : undefined;
        whereClause.routeAssignment.routeId = intersected || 'BANNED';
      }
    }

    const { total, users } = await usersService.listUsers(whereClause, page, limit);

    const data = users.map((user) => {
      const base = serializeUser(actor, user)!;
      return {
        ...base,
        routeId: user.routeAssignment?.routeId ?? null,
        stopId: user.routeAssignment?.stopId ?? null,
        busNumber: user.routeAssignment?.route?.assignments?.[0]?.bus?.number ?? null,
      };
    });

    return reply.send(okList(data, buildPagination(page, limit, total), request.id));
  });

  // Admin Only: Bulk CSV Import
  app.post('/import', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'MANAGEMENT']),
  }, async (request, reply) => {
    const parsed = bulkImportSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    try {
      const results = await usersService.bulkImportStudents(parsed.data);
      const body = ok({ count: results.length }, request.id);
      await cacheIdempotentResponse(request, 201, body, IDEMPOTENCY_TTL.TWO_DAYS);
      return reply.code(201).send(body);
    } catch (error) {
      throw new AppError(500, 'BULK_IMPORT_FAILED', {
        details: [{ message: error instanceof Error ? error.message : 'Unexpected error' }],
      });
    }
  });

  // Assign Student to Route + Stop
  app.post('/:studentId/assign', {
    preHandler: adminRoute(['COORDINATOR', 'TRANSPORT_OFFICER'], true),
  }, async (request, reply) => {
    const params = z.object({ studentId: cuidSchema }).safeParse(request.params);
    if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', params.error.issues);

    const parsed = assignStudentSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    try {
      // Rate limit: 10 assignments per hour per coordinator
      await checkRateLimit((app as any).redis, {
        key: `rl:assign:${request.user!.sub}`,
        max: 10,
        windowSeconds: 3600,
        reply,
      });

      const assignment = await usersService.assignStudent(
        params.data.studentId,
        parsed.data.routeId,
        parsed.data.stopId,
      );
      const body = ok(assignment, request.id);
      await cacheIdempotentResponse(request, 201, body, IDEMPOTENCY_TTL.ONE_HOUR);
      return reply.code(201).send(body);
    } catch (error) {
      throw new AppError(400, 'STUDENT_ASSIGNMENT_FAILED', {
        details: [{ message: error instanceof Error ? error.message : 'Unexpected error' }],
      });
    }
  });

  app.post('/assign-bulk', {
    preHandler: adminRoute(['COORDINATOR', 'TRANSPORT_OFFICER'], true),
  }, async (request, reply) => {
    const parsed = bulkAssignStudentsSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    try {
      // Rate limit: 5 bulk assigns per hour per coordinator
      await checkRateLimit((app as any).redis, {
        key: `rl:bulk-assign:${request.user!.sub}`,
        max: 5,
        windowSeconds: 3600,
        reply,
      });

      const result = await usersService.bulkAssignStudents(
        parsed.data.studentIds,
        parsed.data.routeId,
        parsed.data.stopId,
      );
      const body = ok(result, request.id);
      await cacheIdempotentResponse(request, 201, body, IDEMPOTENCY_TTL.ONE_HOUR);
      return reply.code(201).send(body);
    } catch (error) {
      throw new AppError(400, 'BULK_ASSIGN_FAILED', {
        details: [{ message: error instanceof Error ? error.message : 'Unexpected error' }],
      });
    }
  });

  app.patch('/:studentId', {
    preHandler: adminRoute(['TRANSPORT_OFFICER']),
  }, async (request, reply) => {
    const params = z.object({ studentId: cuidSchema }).safeParse(request.params);
    if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', params.error.issues);

    const parsed = updateStudentSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    try {
      const actor = assertActor(request);
      const student = await usersService.updateStudent(params.data.studentId, parsed.data);
      const data = serializeUser(actor, student);
      if (!data) {
        throw new AppError(404, 'USER_NOT_FOUND');
      }
      return reply.send(ok(data, request.id));
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(400, 'STUDENT_UPDATE_FAILED', {
        details: [{ message: error instanceof Error ? error.message : 'Unexpected error' }],
      });
    }
  });
}
