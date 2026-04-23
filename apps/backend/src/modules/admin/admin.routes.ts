import { FastifyInstance, FastifyRequest } from 'fastify';
import { adminService } from './admin.service';
import { reportsService } from './reports.service';
import { requireAdminAuth, requireAdminStepUp } from '../auth/admin-auth.middleware';
import { adminRoute } from '../../middleware/route-guards';
import { attendanceService } from '../attendance/attendance.service';
import { importService } from '../import/import.service';
import { getAdminAccessContext, assertAdminAction } from '../../lib/admin-access';
import { invalidateAdminAuthCache } from '../../lib/auth-cache';
import { writeAuthAuditEvent, hashForLog } from '../../lib/auth-audit';
import { revokeAdminAuthState } from '../../lib/auth-state-change';
import { sendInviteEmail } from '../../lib/email';
import { AppError } from '../../lib/errors';
import { ok, okList, buildPagination, AuthAuditEventType } from 'shared';
import { serializeImportSessionDetail, serializeImportSessionSummary } from './admin.serializers';
import { AdminAction } from 'shared';
import * as crypto from 'crypto';
import * as z from 'zod';
import * as adminAuthRepository from '../auth/admin-auth.repository';

const messageSchema = z.object({
  body: z.string().min(1).max(1000),
  busId: z.string().cuid().optional(),
  routeId: z.string().cuid().optional(),
  context: z.object({
    contextType: z.enum(['TRIP', 'INCIDENT', 'GPS_OUTAGE', 'ROUTE', 'BROADCAST']),
    contextId: z.string(),
    tripId: z.string().cuid().optional(),
    incidentId: z.string().cuid().optional(),
    busId: z.string().cuid().optional(),
    routeId: z.string().cuid().optional(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
  }).optional(),
  type: z.enum(['DIRECT', 'BROADCAST_ALL', 'BROADCAST_ROUTE', 'BROADCAST_BUS', 'SYSTEM_EVENT']).default('DIRECT'),
  priority: z.enum(['NORMAL', 'URGENT']).default('NORMAL'),
});

const tripIdParamSchema = z.object({
  tripId: z.string().cuid(),
});

const correctionPatchSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  note: z.string().max(500).optional(),
});

const incidentResolveSchema = z.object({
  resolution: z.string().min(1).max(500),
});

const incidentEscalateSchema = z.object({
  note: z.string().max(500).optional(),
});

const notifyAffectedSchema = z.object({
  note: z.string().max(500).optional(),
});

const delegateRequestSchema = z.object({
  note: z.string().max(500).optional(),
});

const assignSubstituteSchema = z.object({
  alternateBusId: z.string().cuid(),
});

const attendanceOverviewQuerySchema = z.object({
  startDate: z.string().min(10),
  endDate: z.string().min(10),
  routeId: z.string().cuid().optional(),
});

const auditLogQuerySchema = z.object({
  actorId: z.string().optional(),
  action: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
});

const adminUserBodySchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  role: z.enum(['COORDINATOR', 'TRANSPORT_OFFICER', 'FACULTY', 'MANAGEMENT']),
  routeIds: z.array(z.string().cuid()).max(50).default([]),
  department: z.string().trim().min(2).max(120).optional().nullable(),
}).superRefine((data, ctx) => {
  if (data.role === 'COORDINATOR' && data.department) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['department'],
      message: 'Coordinators should be scoped by route, not department.',
    });
  }

  if (data.role === 'FACULTY' && data.routeIds.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['routeIds'],
      message: 'Faculty should not receive route scope.',
    });
  }
});

const updateAdminUserBodySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  role: z.enum(['COORDINATOR', 'TRANSPORT_OFFICER', 'FACULTY', 'MANAGEMENT']).optional(),
  routeIds: z.array(z.string().cuid()).max(50).optional(),
  department: z.string().trim().min(2).max(120).nullable().optional(),
}).refine((data) => Object.values(data).some((value) => value !== undefined), {
  message: 'At least one field must be provided.',
});

const adminUserIdParamSchema = z.object({
  id: z.string().cuid(),
});

const suspendAdminBodySchema = z.object({
  reason: z.string().trim().min(8).max(500),
});

const unsuspendAdminBodySchema = z.object({
  reason: z.string().trim().max(500).optional().nullable(),
});

export async function adminRoutes(app: FastifyInstance) {
  // All administrative routes require JWT auth and specific clearance logic
  app.addHook('onRequest', requireAdminAuth);

  const requireAction = async (
    request: FastifyRequest,
    action: AdminAction,
    resource?: { routeId?: string | null },
  ) => {
    const access = await getAdminAccessContext(request.user!.sub);
    assertAdminAction(access, action, resource);
    return access;
  };

  app.get('/admin-users', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'MANAGEMENT'])
  }, async (request, reply) => {
    await requireAction(request, 'INVITE_ADMIN');
    const admins = await adminAuthRepository.listAdminUsersForManagement();

    return reply.send(okList(
      admins.map((admin) => ({
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        isActive: admin.isActive,
        isSuspended: admin.isSuspended,
        mfaEnabled: admin.mfaEnabled,
        createdAt: admin.createdAt.toISOString(),
        updatedAt: admin.updatedAt.toISOString(),
        deactivatedAt: admin.deactivatedAt?.toISOString() ?? null,
        suspendedAt: admin.suspendedAt?.toISOString() ?? null,
        suspendReason: admin.suspendReason ?? null,
        routeIds: admin.scopes.map((scope) => scope.routeId).filter((value): value is string => Boolean(value)),
        department: admin.scopes.map((scope) => scope.department).find((value): value is string => Boolean(value)) ?? null,
        trustedDeviceCount: admin.trustedDevices.length,
        lastTrustedDeviceCountry: admin.trustedDevices[0]?.lastIpCountry ?? null,
      })),
      buildPagination(1, admins.length || 1, admins.length),
      request.id,
    ));
  });

  app.post('/admin-users', {
    preHandler: [...adminRoute(['TRANSPORT_OFFICER', 'MANAGEMENT']), requireAdminStepUp]
  }, async (request, reply) => {
    const access = await requireAction(request, 'INVITE_ADMIN');
    const parsed = adminUserBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    const existingAdmin = await adminAuthRepository.findAdminByEmail(parsed.data.email);
    if (existingAdmin) {
      throw new AppError(409, 'RESOURCE_CONFLICT');
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const actorId = request.user!.sub;
    const passwordHash = await adminAuthRepository.hashPassword(crypto.randomBytes(32).toString('hex'));

    const admin = await adminAuthRepository.createAdminInvite({
      email: parsed.data.email.toLowerCase().trim(),
      name: parsed.data.name,
      role: parsed.data.role,
      passwordHash,
      inviteTokenHash: tokenHash,
      inviteTokenExpiresAt: expiresAt,
      createdById: actorId,
      routeIds: parsed.data.routeIds,
      department: parsed.data.department,
    });

    await sendInviteEmail(parsed.data.email, parsed.data.name, rawToken);

    void writeAuthAuditEvent({
      actorType: 'ADMIN_USER',
      actorId,
      targetType: 'ADMIN_USER',
      targetId: admin.id,
      eventType: AuthAuditEventType.ADMIN_CREATED,
      ipAddress: request.ip,
      metadata: {
        targetEmail: hashForLog(parsed.data.email),
        role: parsed.data.role,
        routeScopeCount: parsed.data.routeIds.length,
        department: parsed.data.department ?? null,
        actorScope: access.scope.routeIds,
      },
    });

    return reply.code(201).send(ok({
      id: admin.id,
      email: admin.email,
      role: admin.role,
      inviteSent: true,
    }, request.id));
  });

  app.patch<{ Params: { id: string } }>('/admin-users/:id', {
    preHandler: [...adminRoute(['TRANSPORT_OFFICER', 'MANAGEMENT']), requireAdminStepUp]
  }, async (request, reply) => {
    await requireAction(request, 'INVITE_ADMIN');

    const params = adminUserIdParamSchema.safeParse(request.params);
    if (!params.success) {
      throw new AppError(400, 'VALIDATION_ERROR', params.error.issues);
    }

    const parsed = updateAdminUserBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    const routeIds =
      parsed.data.role === 'FACULTY'
        ? []
        : parsed.data.routeIds;
    const department =
      parsed.data.role === 'COORDINATOR'
        ? null
        : parsed.data.department;

    const updatedAdmin = await adminAuthRepository.updateAdminProfileAndScopes({
      adminId: params.data.id,
      name: parsed.data.name,
      role: parsed.data.role,
      routeIds,
      department,
    });

    await revokeAdminAuthState(params.data.id);
    await invalidateAdminAuthCache(params.data.id);

    void writeAuthAuditEvent({
      actorType: 'ADMIN_USER',
      actorId: request.user!.sub,
      targetType: 'ADMIN_USER',
      targetId: updatedAdmin.id,
      eventType: AuthAuditEventType.ADMIN_ROLE_CHANGED,
      ipAddress: request.ip,
      metadata: {
        role: updatedAdmin.role,
        routeScopeCount: routeIds?.length ?? null,
        department,
      },
    });

    return reply.send(ok({
      id: updatedAdmin.id,
      name: updatedAdmin.name,
      email: updatedAdmin.email,
      role: updatedAdmin.role,
    }, request.id));
  });

  app.delete<{ Params: { id: string } }>('/admin-users/:id', {
    preHandler: [...adminRoute(['TRANSPORT_OFFICER', 'MANAGEMENT']), requireAdminStepUp]
  }, async (request, reply) => {
    await requireAction(request, 'INVITE_ADMIN');

    const params = adminUserIdParamSchema.safeParse(request.params);
    if (!params.success) {
      throw new AppError(400, 'VALIDATION_ERROR', params.error.issues);
    }

    if (params.data.id === request.user!.sub) {
      throw new AppError('You cannot deactivate your own administrator account.', 409, 'RESOURCE_CONFLICT');
    }

    await revokeAdminAuthState(params.data.id, {
      isActive: false,
      deactivatedAt: new Date(),
      deactivatedById: request.user!.sub,
    });

    void writeAuthAuditEvent({
      actorType: 'ADMIN_USER',
      actorId: request.user!.sub,
      targetType: 'ADMIN_USER',
      targetId: params.data.id,
      eventType: AuthAuditEventType.ACCOUNT_DEACTIVATED,
      ipAddress: request.ip,
    });

    return reply.send(ok({ deactivated: true }, request.id));
  });

  app.post<{ Params: { id: string } }>('/admin-users/:id/reactivate', {
    preHandler: [...adminRoute(['TRANSPORT_OFFICER', 'MANAGEMENT']), requireAdminStepUp]
  }, async (request, reply) => {
    await requireAction(request, 'INVITE_ADMIN');

    const params = adminUserIdParamSchema.safeParse(request.params);
    if (!params.success) {
      throw new AppError(400, 'VALIDATION_ERROR', params.error.issues);
    }

    const reactivatedAdmin = await revokeAdminAuthState(params.data.id, {
      isActive: true,
      deactivatedAt: null,
      deactivatedById: null,
    });

    void writeAuthAuditEvent({
      actorType: 'ADMIN_USER',
      actorId: request.user!.sub,
      targetType: 'ADMIN_USER',
      targetId: reactivatedAdmin.id,
      eventType: AuthAuditEventType.ACCOUNT_REACTIVATED,
      ipAddress: request.ip,
    });

    return reply.send(ok({ reactivated: true }, request.id));
  });

  app.post<{ Params: { id: string } }>('/admin-users/:id/suspend', {
    preHandler: [...adminRoute(['MANAGEMENT']), requireAdminStepUp]
  }, async (request, reply) => {
    await requireAction(request, 'INVITE_ADMIN');

    const params = adminUserIdParamSchema.safeParse(request.params);
    if (!params.success) {
      throw new AppError(400, 'VALIDATION_ERROR', params.error.issues);
    }

    const parsed = suspendAdminBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    if (params.data.id === request.user!.sub) {
      throw new AppError('You cannot suspend your own administrator account.', 409, 'RESOURCE_CONFLICT');
    }

    const suspendedAdmin = await adminAuthRepository.suspendAdminUser({
      adminId: params.data.id,
      suspendedBy: request.user!.sub,
      reason: parsed.data.reason,
    });

    await invalidateAdminAuthCache(params.data.id);

    void writeAuthAuditEvent({
      actorType: 'ADMIN_USER',
      actorId: request.user!.sub,
      targetType: 'ADMIN_USER',
      targetId: suspendedAdmin.id,
      eventType: AuthAuditEventType.ACCOUNT_DEACTIVATED,
      ipAddress: request.ip,
      metadata: {
        lifecycleAction: 'suspend',
        reason: parsed.data.reason,
      },
    });

    return reply.send(ok({
      suspended: true,
      reason: parsed.data.reason,
    }, request.id));
  });

  app.post<{ Params: { id: string } }>('/admin-users/:id/unsuspend', {
    preHandler: [...adminRoute(['MANAGEMENT']), requireAdminStepUp]
  }, async (request, reply) => {
    await requireAction(request, 'INVITE_ADMIN');

    const params = adminUserIdParamSchema.safeParse(request.params);
    if (!params.success) {
      throw new AppError(400, 'VALIDATION_ERROR', params.error.issues);
    }

    const parsed = unsuspendAdminBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    const unsuspendedAdmin = await adminAuthRepository.unsuspendAdminUser({
      adminId: params.data.id,
      unsuspendedBy: request.user!.sub,
      reason: parsed.data.reason ?? null,
    });

    await invalidateAdminAuthCache(params.data.id);

    void writeAuthAuditEvent({
      actorType: 'ADMIN_USER',
      actorId: request.user!.sub,
      targetType: 'ADMIN_USER',
      targetId: unsuspendedAdmin.id,
      eventType: AuthAuditEventType.ACCOUNT_REACTIVATED,
      ipAddress: request.ip,
      metadata: {
        lifecycleAction: 'unsuspend',
        reason: parsed.data.reason ?? null,
      },
    });

    return reply.send(ok({
      unsuspended: true,
    }, request.id));
  });

  // ==========================================
  // PATTERN 1: LIVE OPS (Redis <100ms)
  // ==========================================

  app.get('/live/dashboard', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR'])
  }, async (request, reply) => {
    const access = await requireAction(request, 'VIEW_DASHBOARD');
    const data = await adminService.getLiveDashboardStats(access);
    return reply.send(ok(data, request.id));
  });

  app.get('/live/command-center', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR', 'MANAGEMENT'])
  }, async (request) => {
    const access = await requireAction(request, 'VIEW_COMMAND_CENTER');
    const data = await adminService.getCommandCenter(access);
    return ok(data, request.id);
  });

  app.get('/stats', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR'])
  }, async (_request, reply) => {
    return reply.code(410).send(ok({
      error: 'ENDPOINT_DEPRECATED',
      message: 'This endpoint is deprecated. Use GET /v1/admin/live/dashboard instead.',
      canonical: '/v1/admin/live/dashboard',
    }, _request.id));
  });

  app.get('/live/trips/active', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR', 'MANAGEMENT'])
  }, async (request, reply) => {
    const access = await requireAction(request, 'VIEW_COMMAND_CENTER');
    const data = await adminService.getActiveTrips(access);
    return reply.send(ok(data, request.id));
  });

  app.get('/active-trips', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR'])
  }, async (_request, reply) => {
    return reply.code(410).send(ok({
      error: 'ENDPOINT_DEPRECATED',
      message: 'This endpoint is deprecated. Use GET /v1/admin/live/trips/active instead.',
      canonical: '/v1/admin/live/trips/active',
    }, _request.id));
  });

  app.get<{ Params: { id: string } }>('/live/trips/:id', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR', 'MANAGEMENT'])
  }, async (request, reply) => {
    const access = await requireAction(request, 'VIEW_TRIP_DETAIL');
    const state = await adminService.getTripState(request.params.id, access);
    if (!state) {
      throw new AppError(404, 'TRIP_NOT_FOUND', 'Trip not active or missing state');
    }
    return reply.send(ok(state, request.id));
  });

  app.get('/live/alerts', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR'])
  }, async (request, reply) => {
    const access = await requireAction(request, 'VIEW_COMMAND_CENTER');
    const data = await adminService.getLiveAlerts(access);
    return reply.send(ok(data, request.id));
  });

  // ==========================================
  // PATTERN 2: OPERATIONAL (PostgreSQL with Cache)
  // ==========================================

  app.get('/corrections', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR'])
  }, async (request, reply) => {
    const access = await requireAction(request, 'REVIEW_CORRECTIONS');
    const data = await adminService.getPendingCorrections(access);
    const itemCount = Array.isArray(data) ? data.length : (data as any)?.length ?? 0;
    return reply.send(okList(data as any[], buildPagination(1, 100, itemCount), request.id));
  });

  app.post<{ Params: { id: string }, Body: { status: 'APPROVED' | 'REJECTED' } }>('/corrections/:id/resolve', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR'])
  }, async (request, reply) => {
    const access = await requireAction(request, 'REVIEW_CORRECTIONS');
    const { id } = request.params;
    const { status } = request.body;
    const reviewerId = request.user!.sub;
    
    const result = await adminService.resolveCorrection(id, status, reviewerId, access, {
      actorType: 'ADMIN_USER',
      actorId: reviewerId,
      routeIds: access.scope.routeIds,
      ip: request.ip,
    });
    return reply.send(ok(result, request.id));
  });

  app.patch<{ Params: { id: string } }>('/corrections/:id', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR'])
  }, async (request, reply) => {
    const access = await requireAction(request, 'REVIEW_CORRECTIONS');
    const parsed = correctionPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    const updated = await adminService.resolveCorrection(
      request.params.id,
      parsed.data.action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      request.user!.sub,
      access,
      {
        actorType: 'ADMIN_USER',
        actorId: request.user!.sub,
        routeIds: access.scope.routeIds,
        ip: request.ip,
      },
    );

    return reply.send(ok({
      correctionId: updated.id,
      newStatus: updated.status,
      attendanceUpdated: parsed.data.action === 'APPROVE',
    }, request.id));
  });

  app.get<{ Params: { id: string } }>('/trips/:id/students', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR', 'MANAGEMENT'])
  }, async (request, reply) => {
    const access = await requireAction(request, 'VIEW_TRIP_DETAIL');
    const data = await adminService.getTripStudents(request.params.id, access);
    const itemCount = Array.isArray(data) ? data.length : (data as any)?.length ?? 0;
    return reply.send(okList(data as any[], buildPagination(1, itemCount, itemCount), request.id));
  });

  app.get<{ Params: { id: string } }>('/trips/:id/timeline', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR', 'MANAGEMENT'])
  }, async (request, reply) => {
    const access = await requireAction(request, 'VIEW_TRIP_DETAIL');
    const data = await adminService.getTripTimeline(request.params.id, access);
    const itemCount = Array.isArray(data) ? data.length : (data as any)?.length ?? 0;
    return reply.send(okList(data as any[], buildPagination(1, itemCount, itemCount), request.id));
  });

  app.get<{ Querystring: { status?: string } }>('/incidents', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR', 'MANAGEMENT'])
  }, async (request, reply) => {
    const access = await requireAction(request, 'VIEW_INCIDENTS');
    const data = await adminService.getIncidents(request.query.status, access);
    return reply.send(okList(data, buildPagination(1, data.length, data.length), request.id));
  });

  app.patch<{ Params: { id: string } }>('/incidents/:id/resolve', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR'])
  }, async (request, reply) => {
    const access = await requireAction(request, 'RESOLVE_INCIDENTS');
    const parsed = incidentResolveSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    const incident = await adminService.resolveIncident(
      request.params.id,
      request.user!.sub,
      parsed.data.resolution,
      access,
    );
    return reply.send(ok({ status: incident.status }, request.id));
  });

  app.post<{ Params: { id: string } }>('/incidents/:id/escalate', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR'])
  }, async (request, reply) => {
    const access = await requireAction(request, 'ESCALATE_INCIDENTS');
    const parsed = incidentEscalateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    const result = await adminService.escalateIncident(request.params.id, request.user!.sub, parsed.data.note, access);
    return reply.send(ok(result, request.id));
  });

  app.post<{ Params: { id: string } }>('/incidents/:id/assign-substitute', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR'])
  }, async (request, reply) => {
    const access = await requireAction(request, 'ASSIGN_SUBSTITUTE');
    const parsed = assignSubstituteSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    const result = await adminService.assignSubstitute(request.params.id, parsed.data.alternateBusId, request.user!.sub, access);
    return reply.send(ok(result, request.id));
  });

  app.get<{ Querystring: { busId?: string, limit?: number, contextType?: string, contextId?: string } }>('/messages', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR', 'MANAGEMENT'])
  }, async (request, reply) => {
    const access = await requireAction(request, 'VIEW_MESSAGES');
    const data = await adminService.getMessages({
      busId: request.query.busId,
      limit: request.query.limit,
      contextType: request.query.contextType,
      contextId: request.query.contextId,
    }, access);
    return reply.send(okList(data, buildPagination(1, data.length, data.length), request.id));
  });

  app.post('/messages', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR'])
  }, async (request, reply) => {
    const access = await requireAction(request, 'SEND_MESSAGE_TO_DRIVER');
    const parsed = messageSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_MESSAGE_PAYLOAD', parsed.error.issues);
    }

    const result = await adminService.sendMessage(request.user!.sub, parsed.data, access);
    return reply.send(ok(result, request.id));
  });

  app.post<{ Params: { tripId: string } }>('/trips/:tripId/notify-affected', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR'])
  }, async (request, reply) => {
    const access = await requireAction(request, 'SEND_MESSAGE_TO_DRIVER');
    const parsed = notifyAffectedSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    const result = await adminService.notifyAffectedUsers(request.params.tripId, request.user!.sub, parsed.data.note, access);
    return reply.send(ok(result, request.id));
  });

  app.post<{ Params: { tripId: string } }>('/trips/:tripId/request-delegate', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR'])
  }, async (request, reply) => {
    const access = await requireAction(request, 'COORDINATOR_OVERRIDE');
    const parsed = delegateRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    const result = await adminService.requestDelegateSupport(request.params.tripId, request.user!.sub, parsed.data.note, access);
    return reply.send(ok(result, request.id));
  });

  app.get<{ Params: { tripId: string } }>('/trips/:tripId/substitute-candidates', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR'])
  }, async (request) => {
    const access = await requireAction(request, 'ASSIGN_SUBSTITUTE');
    const data = await adminService.getSubstituteCandidates(request.params.tripId, access);
    return ok(data, request.id);
  });

  // ==========================================
  // PATTERN 3: ASYNC REPORTING (Cloud Tasks)
  // ==========================================

  app.post<{ Body: { startDate: string, endDate: string, routeId?: string } }>('/reports/attendance', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR', 'MANAGEMENT'])
  }, async (request, reply) => {
    const access = await requireAction(request, 'VIEW_ATTENDANCE_REPORTS');
    const { startDate, endDate, routeId } = request.body;
    assertAdminAction(access, 'VIEW_ATTENDANCE_REPORTS', routeId ? { routeId } : undefined);
    const result = await reportsService.enqueueAttendanceReport(access, startDate, endDate, routeId);
    return reply.send(ok(result, request.id));
  });

  app.get('/reports/attendance/overview', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR', 'MANAGEMENT'])
  }, async (request, reply) => {
    const access = await requireAction(request, 'VIEW_ATTENDANCE_REPORTS');
    const parsed = attendanceOverviewQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    assertAdminAction(access, 'VIEW_ATTENDANCE_REPORTS', parsed.data.routeId ? { routeId: parsed.data.routeId } : undefined);
    const data = await reportsService.getAttendanceOverview(access, parsed.data.startDate, parsed.data.endDate, parsed.data.routeId);
    return reply.send(ok(data, request.id));
  });

  app.get<{ Params: { jobId: string } }>('/reports/:jobId/status', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR', 'MANAGEMENT'])
  }, async (request, reply) => {
    const access = await requireAction(request, 'VIEW_ATTENDANCE_REPORTS');
    const data = await reportsService.getJobStatus(access, request.params.jobId);
    return reply.send(ok(data, request.id));
  });

  app.get<{ Params: { jobId: string } }>('/reports/:jobId/download', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR', 'MANAGEMENT'])
  }, async (request, reply) => {
    const access = await requireAction(request, 'VIEW_ATTENDANCE_REPORTS');
    const artifact = await reportsService.downloadAttendanceReport(access, request.params.jobId);
    if (!artifact) {
      throw new AppError(404, 'REPORT_ARTIFACT_NOT_FOUND');
    }

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="attendance-report-${request.params.jobId}.csv"`);
    return reply.send(artifact);
  });

  // ==========================================
  // D5: OPERATIONS CENTER
  // ==========================================

  app.get('/ops/import-sessions', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'MANAGEMENT'])
  }, async (request, reply) => {
    await requireAction(request, 'VIEW_IMPORT_SESSIONS');
    const { prisma } = await import('../../lib/prisma');
    const sessions = await prisma.importSession.findMany({
      orderBy: { startedAt: 'desc' },
      take: 50
    });
    return reply.send(okList(sessions.map(serializeImportSessionSummary), buildPagination(1, 50, sessions.length), request.id));
  });

  app.get<{ Params: { id: string } }>('/ops/import-sessions/:id', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'MANAGEMENT'])
  }, async (request, reply) => {
    await requireAction(request, 'VIEW_IMPORT_SESSIONS');
    const session = await importService.getImportSessionDetail(request.params.id);
    if (!session) {
      throw new AppError(404, 'IMPORT_SESSION_NOT_FOUND');
    }

    return reply.send(ok(serializeImportSessionDetail(session), request.id));
  });

  app.post<{ Params: { id: string } }>('/ops/import-sessions/:id/retry-failed', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'MANAGEMENT'])
  }, async (request, reply) => {
    await requireAction(request, 'RETRY_IMPORT_ROWS');
    const result = await importService.retryFailedRows(request.params.id, request.user!.sub);
    return reply.send(ok(result, request.id));
  });

  app.get('/ops/pending-auth', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'MANAGEMENT'])
  }, async (request, reply) => {
    await requireAction(request, 'VIEW_PENDING_AUTH');
    const { prisma } = await import('../../lib/prisma');
    const data = await prisma.user.findMany({
      where: { authStatus: { in: ['PENDING_PROVISIONING', 'AUTH_PROVISION_FAILED'] } },
      select: { id: true, name: true, phone: true, authStatus: true, authProvisionError: true },
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    return reply.send(okList(data, buildPagination(1, 100, data.length), request.id));
  });

  app.get('/audit-log', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'MANAGEMENT'])
  }, async (request, reply) => {
    await requireAction(request, 'VIEW_AUDIT_LOG');

    const parsed = auditLogQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    const { actorId, action, entityType, entityId, from, to, page, limit } = parsed.data;
    const { prisma } = await import('../../lib/prisma');

    const where: {
      actorId?: string;
      action?: string;
      entityType?: string;
      entityId?: string;
      createdAt?: {
        gte?: Date;
        lte?: Date;
      };
    } = {};

    if (actorId) {
      where.actorId = actorId;
    }
    if (action) {
      where.action = action;
    }
    if (entityType) {
      where.entityType = entityType;
    }
    if (entityId) {
      where.entityId = entityId;
    }
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      };
    }

    const [total, entries] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return reply.send(okList(entries.map((entry) => ({
      id: entry.id,
      actorType: entry.actorType,
      actorId: entry.actorId,
      action: entry.action,
      routeIds: entry.routeIds,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before,
      after: entry.after,
      meta: entry.meta,
      ip: entry.ip,
      createdAt: entry.createdAt.toISOString(),
    })), buildPagination(page, limit, total), request.id));
  });

  app.get('/ops/gps-outages', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR'])
  }, async (request, reply) => {
    const access = await requireAction(request, 'REVIEW_GPS_OUTAGE');
    const data = await adminService.getGpsOutageQueue(access);
    const itemCount = Array.isArray(data) ? data.length : (data as any)?.length ?? 0;
    return reply.send(okList(data as unknown as any[], buildPagination(1, itemCount, itemCount), request.id));
  });

  app.get('/ops/gps-outage-corrections', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR'])
  }, async (request, reply) => {
    const access = await requireAction(request, 'REVIEW_GPS_OUTAGE');
    const data = await adminService.getGpsOutageCorrections(access);
    return reply.send(okList(data, buildPagination(1, data.length, data.length), request.id));
  });

  app.post<{ Params: { tripId: string } }>('/ops/gps-outages/:tripId/coordinator-override', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'COORDINATOR'])
  }, async (request, reply) => {
    const access = await requireAction(request, 'COORDINATOR_OVERRIDE');
    const parsed = tripIdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_TRIP_ID', parsed.error.issues);
    }

    await adminService.assertTripAccess(parsed.data.tripId, 'COORDINATOR_OVERRIDE', access);
    const result = await attendanceService.coordinatorMarkAllPresent(parsed.data.tripId, request.user!.sub, {
      actorType: 'ADMIN_USER',
      actorId: request.user!.sub,
      routeIds: access.scope.routeIds,
      ip: request.ip,
    });
    return reply.send(ok(result, request.id));
  });
}
