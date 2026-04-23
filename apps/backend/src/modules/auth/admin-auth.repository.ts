/**
 * ADMIN AUTH REPOSITORY
 *
 * All Prisma access for admin authentication lives here.
 * Service layer orchestrates; repository executes.
 *
 * No business logic in this file. Repository returns raw Prisma types;
 * service transforms and validates them.
 */

import * as bcrypt from 'bcryptjs';
import { AuthAuditEventType } from 'shared';
import { prisma } from '../../lib/prisma';

/**
 * Retrieve an admin user by email with auth fields (password hash, MFA secrets, etc.)
 * Used during login to validate credentials.
 */
export const getUserByEmailForAuth = async (email: string) => {
  const normalizedEmail = email.toLowerCase().trim();
  return prisma.adminUser.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      isSuspended: true,
      suspendedAt: true,
      suspendReason: true,
      passwordHash: true,
      sessionVersion: true,
      mfaEnabled: true,
      mfaSecretEncrypted: true,
      createdById: true,
      lastLoginAt: true,
    },
  });
};

export const getUserByIdForAuth = async (adminId: string) => {
  return prisma.adminUser.findUnique({
    where: { id: adminId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      isSuspended: true,
      suspendedAt: true,
      suspendReason: true,
      passwordHash: true,
      sessionVersion: true,
      mfaEnabled: true,
      mfaSecretEncrypted: true,
      createdById: true,
      lastLoginAt: true,
    },
  });
};

/**
 * Retrieve an admin user by ID with minimal fields for session.
 * Used to load admin info for authenticated requests.
 */
export const getUserById = async (adminId: string) => {
  return prisma.adminUser.findUnique({
    where: { id: adminId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      isSuspended: true,
      mfaEnabled: true,
      mfaSecretEncrypted: true,
    },
  });
};

export const listAdminUsersForManagement = async () => {
  return prisma.adminUser.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      isSuspended: true,
      mfaEnabled: true,
      createdAt: true,
      updatedAt: true,
      deactivatedAt: true,
      suspendedAt: true,
      suspendReason: true,
      scopes: {
        select: {
          routeId: true,
          department: true,
        },
      },
      trustedDevices: {
        where: { revokedAt: null },
        select: {
          id: true,
          label: true,
          userAgent: true,
          firstSeenAt: true,
          lastSeenAt: true,
          lastIpCountry: true,
        },
        orderBy: { lastSeenAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
};

/**
 * Retrieve an admin by email (public info only, no sensitive fields).
 * Safe for pre-auth checks or reset/invite flows.
 */
export const findAdminByEmail = async (email: string) => {
  const normalizedEmail = email.toLowerCase().trim();
  return prisma.adminUser.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
    },
  });
};

export const getLatestAdminLoginSuccess = async (adminId: string) => {
  return prisma.authAuditEvent.findFirst({
    where: {
      actorId: adminId,
      eventType: AuthAuditEventType.ADMIN_LOGIN_SUCCESS,
    },
    select: {
      createdAt: true,
      metadata: true,
    },
    orderBy: { createdAt: 'desc' },
  });
};

/**
 * Compare plain password against bcrypt hash.
 * Uses constant-time comparison to prevent timing attacks.
 */
export const verifyPasswordHash = async (hash: string, plainPassword: string): Promise<boolean> => {
  return bcrypt.compare(plainPassword, hash);
};

/**
 * Hash a password using bcrypt with cost factor 12.
 * Returns the hash for storage in database.
 */
export const hashPassword = async (plainPassword: string): Promise<string> => {
  return bcrypt.hash(plainPassword, 12);
};

/**
 * Create an admin invite with all required fields.
 * Generates an invite token hash and sets expiration.
 */
export const createAdminInvite = async (data: {
  email: string;
  name: string;
  role: 'COORDINATOR' | 'TRANSPORT_OFFICER' | 'FACULTY' | 'MANAGEMENT';
  passwordHash: string;
  inviteTokenHash: string;
  inviteTokenExpiresAt: Date;
  createdById: string;
  routeIds?: string[];
  department?: string | null;
}) => {
  return prisma.adminUser.create({
    data: {
      email: data.email.toLowerCase().trim(),
      name: data.name,
      role: data.role,
      passwordHash: data.passwordHash,
      inviteTokenHash: data.inviteTokenHash,
      inviteTokenExpiresAt: data.inviteTokenExpiresAt,
      createdById: data.createdById,
      isActive: false, // Activated after password is set
      scopes: {
        create: [
          ...(data.routeIds?.map((routeId) => ({ routeId })) ?? []),
          ...(data.department ? [{ department: data.department }] : []),
        ],
      },
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
    },
  });
};

export const updateAdminProfileAndScopes = async (data: {
  adminId: string;
  name?: string;
  role?: 'COORDINATOR' | 'TRANSPORT_OFFICER' | 'FACULTY' | 'MANAGEMENT';
  routeIds?: string[];
  department?: string | null;
}) => {
  return prisma.$transaction(async (tx) => {
    const admin = await tx.adminUser.update({
      where: { id: data.adminId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.role !== undefined ? { role: data.role } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
      },
    });

    if (data.routeIds !== undefined || data.department !== undefined) {
      await tx.adminScope.deleteMany({
        where: { adminUserId: data.adminId },
      });

      const scopeRows = [
        ...(data.routeIds ?? []).map((routeId) => ({ adminUserId: data.adminId, routeId })),
        ...(data.department ? [{ adminUserId: data.adminId, department: data.department }] : []),
      ];

      if (scopeRows.length > 0) {
        await tx.adminScope.createMany({
          data: scopeRows,
        });
      }
    }

    return admin;
  });
};

export const suspendAdminUser = async (data: {
  adminId: string;
  suspendedBy: string;
  reason: string;
}) => {
  return prisma.$transaction(async (tx) => {
    await tx.adminSuspension.create({
      data: {
        adminId: data.adminId,
        suspendedBy: data.suspendedBy,
        reason: data.reason,
      },
      select: { id: true },
    });

    return tx.adminUser.update({
      where: { id: data.adminId },
      data: {
        isActive: false,
        isSuspended: true,
        suspendedAt: new Date(),
        suspendedBy: data.suspendedBy,
        suspendReason: data.reason,
        deactivatedAt: new Date(),
        deactivatedById: data.suspendedBy,
        sessionVersion: { increment: 1 },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        isSuspended: true,
        suspendedAt: true,
        suspendReason: true,
      },
    });
  });
};

export const unsuspendAdminUser = async (data: {
  adminId: string;
  unsuspendedBy: string;
  reason?: string | null;
}) => {
  return prisma.$transaction(async (tx) => {
    const openSuspension = await tx.adminSuspension.findFirst({
      where: {
        adminId: data.adminId,
        unsuspendedAt: null,
      },
      orderBy: { suspendedAt: 'desc' },
      select: { id: true },
    });

    if (openSuspension) {
      await tx.adminSuspension.update({
        where: { id: openSuspension.id },
        data: {
          unsuspendedAt: new Date(),
          unsuspendedBy: data.unsuspendedBy,
          unsuspendReason: data.reason ?? null,
        },
        select: { id: true },
      });
    }

    return tx.adminUser.update({
      where: { id: data.adminId },
      data: {
        isActive: true,
        isSuspended: false,
        suspendedAt: null,
        suspendedBy: null,
        suspendReason: null,
        deactivatedAt: null,
        deactivatedById: null,
        sessionVersion: { increment: 1 },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        isSuspended: true,
      },
    });
  });
};

/**
 * Update admin last login info and session metadata.
 * Called after successful password + MFA (if enabled) verification.
 */
export const updateLoginInfo = async (adminId: string, data: {
  lastLoginAt: Date;
  lastLoginIp: string;
  lastLoginUserAgent: string;
}) => {
  return prisma.adminUser.update({
    where: { id: adminId },
    data,
    select: { id: true },
  });
};

export const countTrustedDevices = async (adminId: string) => {
  return prisma.adminTrustedDevice.count({
    where: {
      adminId,
      revokedAt: null,
    },
  });
};

export const findTrustedDeviceByHash = async (adminId: string, deviceHash: string) => {
  return prisma.adminTrustedDevice.findUnique({
    where: {
      adminId_deviceHash: {
        adminId,
        deviceHash,
      },
    },
    select: {
      id: true,
      label: true,
      userAgent: true,
      lastSeenAt: true,
      lastIpCountry: true,
      revokedAt: true,
    },
  });
};

export const upsertTrustedDevice = async (data: {
  adminId: string;
  deviceHash: string;
  userAgent: string;
  acceptLanguage?: string | null;
  label?: string | null;
  ipAddress?: string | null;
  ipCountry?: string | null;
}) => {
  return prisma.adminTrustedDevice.upsert({
    where: {
      adminId_deviceHash: {
        adminId: data.adminId,
        deviceHash: data.deviceHash,
      },
    },
    create: {
      adminId: data.adminId,
      deviceHash: data.deviceHash,
      userAgent: data.userAgent,
      acceptLanguage: data.acceptLanguage ?? null,
      label: data.label ?? null,
      lastIpAddress: data.ipAddress ?? null,
      lastIpCountry: data.ipCountry ?? null,
    },
    update: {
      revokedAt: null,
      revokedById: null,
      userAgent: data.userAgent,
      acceptLanguage: data.acceptLanguage ?? null,
      label: data.label ?? undefined,
      lastSeenAt: new Date(),
      lastIpAddress: data.ipAddress ?? null,
      lastIpCountry: data.ipCountry ?? null,
    },
    select: {
      id: true,
      label: true,
      userAgent: true,
      lastSeenAt: true,
      lastIpCountry: true,
    },
  });
};

export const getAdminFingerprint = async (adminId: string) => {
  return prisma.adminFingerprint.findUnique({
    where: { adminId },
    select: {
      adminId: true,
      userAgent: true,
      acceptLanguage: true,
      timezone: true,
      screenRes: true,
      colorDepth: true,
      platform: true,
      hardwareConcurrency: true,
      deviceMemory: true,
      ipCountry: true,
      ipASN: true,
      fpHash: true,
      lastVerdict: true,
      lastDriftScore: true,
      lastSeenAt: true,
    },
  });
};

export const upsertAdminFingerprint = async (data: {
  adminId: string;
  userAgent: string;
  acceptLanguage: string;
  timezone: string;
  screenRes: string;
  colorDepth: number;
  platform: string;
  hardwareConcurrency: number;
  deviceMemory?: number | null;
  ipCountry: string;
  ipASN: string;
  fpHash: string;
  lastVerdict: string;
  lastDriftScore: number;
  lastSeenAt?: Date;
}) => {
  const lastSeenAt = data.lastSeenAt ?? new Date();

  return prisma.adminFingerprint.upsert({
    where: { adminId: data.adminId },
    create: {
      adminId: data.adminId,
      userAgent: data.userAgent,
      acceptLanguage: data.acceptLanguage,
      timezone: data.timezone,
      screenRes: data.screenRes,
      colorDepth: data.colorDepth,
      platform: data.platform,
      hardwareConcurrency: data.hardwareConcurrency,
      deviceMemory: data.deviceMemory ?? null,
      ipCountry: data.ipCountry,
      ipASN: data.ipASN,
      fpHash: data.fpHash,
      lastVerdict: data.lastVerdict,
      lastDriftScore: data.lastDriftScore,
      lastSeenAt,
    },
    update: {
      userAgent: data.userAgent,
      acceptLanguage: data.acceptLanguage,
      timezone: data.timezone,
      screenRes: data.screenRes,
      colorDepth: data.colorDepth,
      platform: data.platform,
      hardwareConcurrency: data.hardwareConcurrency,
      deviceMemory: data.deviceMemory ?? null,
      ipCountry: data.ipCountry,
      ipASN: data.ipASN,
      fpHash: data.fpHash,
      lastVerdict: data.lastVerdict,
      lastDriftScore: data.lastDriftScore,
      lastSeenAt,
    },
    select: {
      adminId: true,
      fpHash: true,
      lastVerdict: true,
      lastDriftScore: true,
      lastSeenAt: true,
    },
  });
};

export const createAdminBehaviorEvent = async (data: {
  adminId: string;
  sessionId?: string | null;
  eventType: string;
  metadata?: Record<string, unknown> | null;
  timestamp?: Date;
}) => {
  return prisma.adminBehaviorEvent.create({
    data: {
      adminId: data.adminId,
      sessionId: data.sessionId ?? null,
      eventType: data.eventType,
      metadata: (data.metadata ?? undefined) as any,
      timestamp: data.timestamp ?? new Date(),
    },
    select: { id: true },
  });
};

export const listTrustedDevices = async (adminId: string) => {
  return prisma.adminTrustedDevice.findMany({
    where: {
      adminId,
      revokedAt: null,
    },
    select: {
      id: true,
      label: true,
      userAgent: true,
      acceptLanguage: true,
      firstSeenAt: true,
      lastSeenAt: true,
      lastIpCountry: true,
    },
    orderBy: { lastSeenAt: 'desc' },
  });
};

export const getTrustedDeviceById = async (adminId: string, deviceId: string) => {
  return prisma.adminTrustedDevice.findFirst({
    where: {
      id: deviceId,
      adminId,
    },
    select: {
      id: true,
      userAgent: true,
      label: true,
      revokedAt: true,
    },
  });
};

export const revokeTrustedDevice = async (
  adminId: string,
  deviceId: string,
  revokedById: string,
) => {
  return prisma.adminTrustedDevice.updateMany({
    where: {
      id: deviceId,
      adminId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
      revokedById,
    },
  });
};

const normalizeBackupCode = (code: string): string =>
  code.replace(/[\s-]+/g, '').toUpperCase();

export const replaceAdminBackupCodes = async (adminId: string, codeHashes: string[]) => {
  return prisma.$transaction(async (tx) => {
    await tx.adminBackupCode.deleteMany({
      where: { adminId },
    });

    if (codeHashes.length > 0) {
      await tx.adminBackupCode.createMany({
        data: codeHashes.map((codeHash) => ({
          adminId,
          codeHash,
        })),
      });
    }

    await tx.adminUser.update({
      where: { id: adminId },
      data: {
        mfaBackupCodesUsedCount: 0,
        lastMfaBackupCodeUsedAt: null,
      },
      select: { id: true },
    });

    return tx.adminBackupCode.count({
      where: {
        adminId,
        isUsed: false,
      },
    });
  });
};

export const clearAdminBackupCodes = async (adminId: string) => {
  return prisma.$transaction(async (tx) => {
    await tx.adminBackupCode.deleteMany({
      where: { adminId },
    });

    return tx.adminUser.update({
      where: { id: adminId },
      data: {
        mfaBackupCodesUsedCount: 0,
        lastMfaBackupCodeUsedAt: null,
      },
      select: { id: true },
    });
  });
};

export const getAdminBackupCodeSummary = async (adminId: string) => {
  const [totalCount, remainingCount, admin] = await Promise.all([
    prisma.adminBackupCode.count({
      where: { adminId },
    }),
    prisma.adminBackupCode.count({
      where: {
        adminId,
        isUsed: false,
      },
    }),
    prisma.adminUser.findUnique({
      where: { id: adminId },
      select: {
        mfaEnabled: true,
        lastMfaBackupCodeUsedAt: true,
      },
    }),
  ]);

  return {
    enabled: admin?.mfaEnabled ?? false,
    totalCount,
    remainingCount,
    lastUsedAt: admin?.lastMfaBackupCodeUsedAt ?? null,
  };
};

export const consumeAdminBackupCode = async (adminId: string, backupCode: string): Promise<boolean> => {
  const normalizedCode = normalizeBackupCode(backupCode);
  const candidates = await prisma.adminBackupCode.findMany({
    where: {
      adminId,
      isUsed: false,
    },
    select: {
      id: true,
      codeHash: true,
    },
  });

  for (const candidate of candidates) {
    const matches = await bcrypt.compare(normalizedCode, candidate.codeHash);
    if (!matches) {
      continue;
    }

    const usedAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.adminBackupCode.update({
        where: { id: candidate.id },
        data: {
          isUsed: true,
          usedAt,
        },
      });

      await tx.adminUser.update({
        where: { id: adminId },
        data: {
          mfaBackupCodesUsedCount: { increment: 1 },
          lastMfaBackupCodeUsedAt: usedAt,
        },
        select: { id: true },
      });
    });

    return true;
  }

  return false;
};

/**
 * Retrieve admin user for password reset flow.
 * Validates reset token and expiration.
 */
export const findAdminByPasswordResetToken = async (tokenHash: string) => {
  return prisma.adminUser.findFirst({
    where: {
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: { gt: new Date() },
      isActive: true,
    },
    select: {
      id: true,
      email: true,
      name: true,
    },
  });
};

/**
 * Update password after reset flow.
 * Clears reset token and increments session version to invalidate old tokens.
 */
export const updatePasswordAfterReset = async (adminId: string, newPasswordHash: string) => {
  return prisma.adminUser.update({
    where: { id: adminId },
    data: {
      passwordHash: newPasswordHash,
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
      sessionVersion: { increment: 1 },
    },
    select: { id: true },
  });
};

/**
 * Set password reset token with expiration.
 * Used in forgot-password flow.
 */
export const setPasswordResetToken = async (adminId: string, tokenHash: string, expiresAt: Date) => {
  return prisma.adminUser.update({
    where: { id: adminId },
    data: {
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: expiresAt,
    },
    select: { id: true },
  });
};

/**
 * Retrieve admin user for invite acceptance flow.
 * Validates invite token and expiration.
 */
export const findAdminByInviteToken = async (tokenHash: string) => {
  return prisma.adminUser.findFirst({
    where: {
      inviteTokenHash: tokenHash,
      inviteTokenExpiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      email: true,
      name: true,
    },
  });
};

/**
 * Activate admin account after password is set from invite.
 * Clears invite token and increments session version.
 */
export const activateAdminAfterInvite = async (adminId: string, passwordHash: string) => {
  return prisma.adminUser.update({
    where: { id: adminId },
    data: {
      passwordHash,
      inviteTokenHash: null,
      inviteTokenExpiresAt: null,
      isActive: true,
      sessionVersion: { increment: 1 },
    },
    select: { id: true },
  });
};

/**
 * Retrieve MFA configuration for an admin.
 * Used to check if MFA is enabled and if setup is pending.
 */
export const getMfaConfig = async (adminId: string) => {
  return prisma.adminUser.findUnique({
    where: { id: adminId },
    select: {
      id: true,
      email: true,
      mfaEnabled: true,
      mfaSecretEncrypted: true,
    },
  });
};

/**
 * Update MFA secret during setup phase (before enabling).
 * Does NOT enable MFA yet — only stores encrypted secret for validation.
 */
export const setMfaSecretForSetup = async (adminId: string, encryptedSecret: string) => {
  return prisma.adminUser.update({
    where: { id: adminId },
    data: {
      mfaSecretEncrypted: encryptedSecret,
      mfaEnabled: false,
    },
    select: { id: true },
  });
};

/**
 * Enable MFA after successful TOTP code validation.
 * Increments session version to force re-authentication.
 */
export const enableMfaAfterValidation = async (adminId: string) => {
  return prisma.adminUser.update({
    where: { id: adminId },
    data: {
      mfaEnabled: true,
      sessionVersion: { increment: 1 },
    },
    select: { id: true },
  });
};

/**
 * Disable MFA after password + current TOTP validation.
 * Clears encrypted secret and increments session version.
 */
export const disableMfaAfterValidation = async (adminId: string) => {
  return prisma.adminUser.update({
    where: { id: adminId },
    data: {
      mfaEnabled: false,
      mfaSecretEncrypted: null,
      sessionVersion: { increment: 1 },
    },
    select: { id: true },
  });
};

/**
 * Get password hash for an admin.
 * Used in disable-MFA flow to verify current password.
 */
export const getPasswordHashForAdmin = async (adminId: string) => {
  const admin = await prisma.adminUser.findUnique({
    where: { id: adminId },
    select: { passwordHash: true },
  });
  return admin?.passwordHash ?? null;
};

/**
 * Count recent invitations from a given IP address.
 * Used for rate limiting invites.
 */
export const countRecentInvitesByIp = async (ipHash: string, windowSeconds: number = 3600) => {
  const windowStart = new Date(Date.now() - windowSeconds * 1000);
  return prisma.adminUser.count({
    where: {
      inviteTokenExpiresAt: { gt: new Date() }, // Not yet accepted/expired
      createdAt: { gte: windowStart },
      // Note: This is a simplification — ideally we'd track IP in a separate audit table.
      // For now, we'll rely on Redis-based rate limiting in the service layer.
    },
  });
};
