import { FastifyInstance } from 'fastify';
import * as crypto from 'crypto';
import * as z from 'zod';
import { AuthAuditEventType, AdminJWTPayload, ok } from 'shared';
import { invalidateAdminAuthCache } from '../../lib/auth-cache';
import { getAdminAccessContext } from '../../lib/admin-access';
import { writeAuthAuditEvent, hashForLog } from '../../lib/auth-audit';
import { clearAdminSessionCookies } from '../../lib/admin-session';
import { AppError } from '../../lib/errors';
import { sendPasswordResetEmail, sendInviteEmail } from '../../lib/email';
import { validateAdminPassword } from '../../lib/password-policy';
import { checkAdminForgotPasswordRateLimit, checkAdminInviteRateLimit } from '../../lib/rate-limit';
import { revokeAdminAuthState } from '../../lib/auth-state-change';
import { adminRoute } from '../../middleware/route-guards';
import { requireAdminAuth, requireAdminStepUp } from './admin-auth.middleware';
import * as adminAuthRepository from './admin-auth.repository';
import {
  adminLogin,
  disableAdminMfa,
  enableAdminMfa,
  getAdminBackupCodeSummary,
  getAdminMfaStatus,
  initiateAdminStepUp,
  regenerateAdminBackupCodes,
  startAdminMfaSetup,
  verifyAdminLoginMfa,
} from './admin-auth.service';

const adminInviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
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

const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const adminVerifyMfaSchema = z.object({
  challengeToken: z.string().min(32),
  code: z.string().optional(),
  backupCode: z.string().optional(),
}).superRefine((data, ctx) => {
  const hasCode = typeof data.code === 'string' && data.code.trim().length > 0;
  const hasBackupCode = typeof data.backupCode === 'string' && data.backupCode.trim().length > 0;

  if (hasCode === hasBackupCode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['code'],
      message: 'Provide either a 6-digit authenticator code or a backup code.',
    });
  }

  if (hasCode && !/^\d{6}$/.test(data.code!.trim())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['code'],
      message: 'Invalid MFA code',
    });
  }

  if (hasBackupCode && data.backupCode!.replace(/[\s-]+/g, '').length < 6) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['backupCode'],
      message: 'Invalid backup code',
    });
  }
});

const enableMfaSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Invalid MFA code'),
});

const disableMfaSchema = z.object({
  password: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, 'Invalid MFA code'),
});

const stepUpSchema = z.object({
  password: z.string().min(1),
});

const tokenOnlySchema = z.object({
  token: z.string().min(32),
});

const trustedDeviceParamSchema = z.object({
  deviceId: z.string().cuid(),
});

const getHeaderValue = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? '';

const getRequestCountry = (headers: Record<string, unknown>): string => {
  const candidates = [
    headers['cf-ipcountry'],
    headers['x-vercel-ip-country'],
    headers['x-country-code'],
    headers['x-geo-country'],
  ];

  for (const candidate of candidates) {
    const value = Array.isArray(candidate) ? candidate[0] : candidate;
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim().toUpperCase();
    }
  }

  return 'ZZ';
};

export async function adminAuthRoutes(app: FastifyInstance) {
  app.post('/login', async (req, reply) => {
    const parsed = adminLoginSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

    const result = await adminLogin(
      parsed.data.email,
      parsed.data.password,
      req.ip,
      getHeaderValue(req.headers['user-agent']),
      getHeaderValue(req.headers['accept-language']),
      getRequestCountry(req.headers as Record<string, unknown>),
      reply
    );

    return reply.send(result);
  });

  app.post('/verify-mfa', async (req, reply) => {
    const parsed = adminVerifyMfaSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

    const result = await verifyAdminLoginMfa(
      parsed.data.challengeToken,
      {
        code: parsed.data.code,
        backupCode: parsed.data.backupCode,
      },
      req.ip,
      getHeaderValue(req.headers['user-agent']),
      getHeaderValue(req.headers['accept-language']),
      getRequestCountry(req.headers as Record<string, unknown>),
      reply
    );

    return reply.send(result);
  });

  app.get('/me', { preHandler: [requireAdminAuth] }, async (req, reply) => {
    const adminId = (req.user as AdminJWTPayload).sub;
    const [admin, access] = await Promise.all([
      adminAuthRepository.getUserById(adminId),
      getAdminAccessContext(adminId),
    ]);

    if (!admin || !admin.isActive) {
      throw new AppError(401, 'UNAUTHORIZED');
    }

    return reply.send(ok({
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      isActive: admin.isActive,
      mfaEnabled: admin.mfaEnabled,
      routeIds: access.scope.routeIds,
      department: access.department,
    }, req.id));
  });

  app.get('/mfa/status', { preHandler: [requireAdminAuth] }, async (req, reply) => {
    const adminId = (req.user as AdminJWTPayload).sub;
    const mfaStatus = await getAdminMfaStatus(adminId);
    return reply.send(ok(mfaStatus, req.id));
  });

  app.post('/mfa/setup', { preHandler: [requireAdminAuth] }, async (req, reply) => {
    const adminId = (req.user as AdminJWTPayload).sub;
    const setup = await startAdminMfaSetup(adminId);
    return reply.send(ok(setup, req.id));
  });

  app.post('/mfa/enable', { preHandler: [requireAdminAuth] }, async (req, reply) => {
    const parsed = enableMfaSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

    const adminId = (req.user as AdminJWTPayload).sub;
    const mfaResult = await enableAdminMfa(adminId, parsed.data.code, reply);
    return reply.send(ok(mfaResult, req.id));
  });

  app.get('/mfa/backup-codes', { preHandler: [requireAdminAuth] }, async (req, reply) => {
    const adminId = (req.user as AdminJWTPayload).sub;
    const summary = await getAdminBackupCodeSummary(adminId);
    return reply.send(ok(summary, req.id));
  });

  app.post('/mfa/backup-codes/regenerate', {
    preHandler: [requireAdminAuth, requireAdminStepUp],
  }, async (req, reply) => {
    const adminId = (req.user as AdminJWTPayload).sub;
    const result = await regenerateAdminBackupCodes(adminId);
    return reply.send(ok(result, req.id));
  });

  app.post('/mfa/disable', { preHandler: [requireAdminAuth] }, async (req, reply) => {
    const parsed = disableMfaSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

    const adminId = (req.user as AdminJWTPayload).sub;
    const result = await disableAdminMfa(adminId, parsed.data.password, parsed.data.code, reply);
    return reply.send(ok(result, req.id));
  });

  app.post('/step-up', { preHandler: [requireAdminAuth] }, async (req, reply) => {
    const parsed = stepUpSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

    const authUser = req.user as AdminJWTPayload;
    const result = await initiateAdminStepUp(
      authUser.sub,
      authUser.sv,
      parsed.data.password,
      req.ip,
      getHeaderValue(req.headers['user-agent']),
    );

    return reply.send(ok(result, req.id));
  });

  app.get('/devices', { preHandler: [requireAdminAuth] }, async (req, reply) => {
    const adminId = (req.user as AdminJWTPayload).sub;
    const devices = await adminAuthRepository.listTrustedDevices(adminId);

    return reply.send(ok({
      devices: devices.map((device) => ({
        id: device.id,
        label: device.label,
        userAgent: device.userAgent,
        acceptLanguage: device.acceptLanguage,
        firstSeenAt: device.firstSeenAt.toISOString(),
        lastSeenAt: device.lastSeenAt.toISOString(),
        lastIpCountry: device.lastIpCountry,
      })),
    }, req.id));
  });

  app.delete<{ Params: { deviceId: string } }>('/devices/:deviceId', {
    preHandler: [requireAdminAuth, requireAdminStepUp],
  }, async (req, reply) => {
    const parsed = trustedDeviceParamSchema.safeParse(req.params);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

    const adminId = (req.user as AdminJWTPayload).sub;
    const device = await adminAuthRepository.getTrustedDeviceById(adminId, parsed.data.deviceId);
    if (!device || device.revokedAt) {
      throw new AppError(404, 'RESOURCE_NOT_FOUND');
    }

    const result = await adminAuthRepository.revokeTrustedDevice(adminId, parsed.data.deviceId, adminId);
    if (result.count === 0) {
      throw new AppError(404, 'RESOURCE_NOT_FOUND');
    }

    await revokeAdminAuthState(adminId);

    void writeAuthAuditEvent({
      actorType: 'ADMIN_USER',
      actorId: adminId,
      eventType: AuthAuditEventType.SESSION_VERSION_BUMPED,
      ipAddress: req.ip,
      metadata: {
        reason: 'trusted_device_revoked',
        deviceId: device.id,
        deviceLabel: device.label ?? null,
        deviceUserAgent: device.userAgent,
      },
    });

    clearAdminSessionCookies(reply);
    return reply.send(ok({ revoked: true, requiresReauth: true }, req.id));
  });

  app.post('/logout', { preHandler: [requireAdminAuth] }, async (req, reply) => {
    const adminId = (req.user as AdminJWTPayload).sub;

    await revokeAdminAuthState(adminId);

    void writeAuthAuditEvent({
      actorType: 'ADMIN_USER',
      actorId: adminId,
      eventType: AuthAuditEventType.ADMIN_LOGOUT,
    });

    clearAdminSessionCookies(reply);
    reply.send(ok({ message: 'Logged out' }, req.id));
  });

  app.post<{ Body: { email: string } }>('/forgot-password', async (req, reply) => {
    const { email } = req.body;
    if (!email) return reply.send({ message: 'If this email is registered, a reset link has been sent.' });

    await checkAdminForgotPasswordRateLimit(req.ip);

    const normalizedEmail = email.toLowerCase().trim();
    const admin = await adminAuthRepository.findAdminByEmail(normalizedEmail);

    if (admin && admin.isActive) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await adminAuthRepository.setPasswordResetToken(admin.id, tokenHash, expiresAt);

      await sendPasswordResetEmail(admin.email, admin.name, rawToken);

      void writeAuthAuditEvent({
        actorType: 'ADMIN_USER',
        actorId: admin.id,
        eventType: AuthAuditEventType.PASSWORD_RESET_REQUESTED,
        ipAddress: req.ip,
      });
    }

    reply.send({ message: 'If this email is registered, a reset link has been sent.' });
  });

  app.post<{ Body: { token: string; newPassword: string } }>('/reset-password', async (req, reply) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) throw new AppError(400, 'VALIDATION_ERROR');

    validateAdminPassword(newPassword);

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const admin = await adminAuthRepository.findAdminByPasswordResetToken(tokenHash);

    if (!admin) {
      throw new AppError(400, 'TOKEN_EXPIRED');
    }

    const passwordHash = await adminAuthRepository.hashPassword(newPassword);

    await adminAuthRepository.updatePasswordAfterReset(admin.id, passwordHash);

    await invalidateAdminAuthCache(admin.id);

    void writeAuthAuditEvent({
      actorType: 'ADMIN_USER',
      actorId: admin.id,
      eventType: AuthAuditEventType.PASSWORD_RESET_COMPLETED,
    });

    clearAdminSessionCookies(reply);
    reply.send(ok({ message: 'Password updated. Please log in.' }, req.id));
  });

  app.post('/reset-password/verify-token', async (req, reply) => {
    const parsed = tokenOnlySchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

    const tokenHash = crypto.createHash('sha256').update(parsed.data.token).digest('hex');
    const admin = await adminAuthRepository.findAdminByPasswordResetToken(tokenHash);

    if (!admin) {
      throw new AppError(400, 'TOKEN_EXPIRED');
    }

    return reply.send(ok({
      valid: true,
      emailHint: hashForLog(admin.email),
      name: admin.name,
    }, req.id));
  });

  app.post('/invite', {
    preHandler: [...adminRoute(['TRANSPORT_OFFICER', 'MANAGEMENT']), requireAdminStepUp],
  }, async (req, reply) => {
    const parsed = adminInviteSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

    const { email, name, role, routeIds, department } = parsed.data;
    const actorId = (req.user as AdminJWTPayload).sub;

    // Rate limit: 20 invites per hour per IP
    await checkAdminInviteRateLimit(req.ip);

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const passwordHash = await adminAuthRepository.hashPassword(crypto.randomBytes(32).toString());

    await adminAuthRepository.createAdminInvite({
      email: email.toLowerCase().trim(),
      name,
      role,
      passwordHash,
      inviteTokenHash: tokenHash,
      inviteTokenExpiresAt: expiresAt,
      createdById: actorId,
      routeIds,
      department,
    });

    await sendInviteEmail(email, name, rawToken);

    void writeAuthAuditEvent({
      actorType: 'ADMIN_USER',
      actorId,
      eventType: AuthAuditEventType.INVITE_SENT,
      metadata: {
        targetEmail: hashForLog(email),
        targetRole: role,
        routeScopeCount: routeIds.length,
        department: department ?? null,
      },
    });

    reply.code(201).send(ok({ message: 'Invitation sent' }, req.id));
  });

  app.post<{ Body: { token: string; password: string } }>('/set-password', async (req, reply) => {
    const { token, password } = req.body;
    if (!token || !password) throw new AppError(400, 'VALIDATION_ERROR');

    validateAdminPassword(password);

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const admin = await adminAuthRepository.findAdminByInviteToken(tokenHash);

    if (!admin) throw new AppError(400, 'TOKEN_EXPIRED');

    const passwordHash = await adminAuthRepository.hashPassword(password);

    await adminAuthRepository.activateAdminAfterInvite(admin.id, passwordHash);

    await invalidateAdminAuthCache(admin.id);

    void writeAuthAuditEvent({
      actorType: 'ADMIN_USER',
      actorId: admin.id,
      eventType: AuthAuditEventType.INVITE_ACCEPTED,
    });

    reply.send({ success: true, message: 'Account activated. Please log in.' });
  });

  app.post('/invite/verify-token', async (req, reply) => {
    const parsed = tokenOnlySchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

    const tokenHash = crypto.createHash('sha256').update(parsed.data.token).digest('hex');
    const admin = await adminAuthRepository.findAdminByInviteToken(tokenHash);

    if (!admin) {
      throw new AppError(400, 'TOKEN_EXPIRED');
    }

    return reply.send(ok({
      valid: true,
      emailHint: hashForLog(admin.email),
      name: admin.name,
    }, req.id));
  });
}
