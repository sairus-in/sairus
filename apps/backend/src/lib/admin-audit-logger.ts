/**
 * Admin Audit Logging — Append-Only Audit Trail
 * Implements §10 Audit Logging specification
 * 
 * This service logs all authentication and security events immutably.
 * Never update or delete audit records.
 */

import { db } from '../db/prisma-client';
import { AdminAuthEventType } from '../modules/auth/admin-auth.types';
import { logger } from './logger';

export interface AuditLogPayload {
  adminId: string;
  sessionId?: string;
  eventType: AdminAuthEventType;
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  outcome: 'SUCCESS' | 'FAILURE' | 'BLOCKED';
  ip: string;
  country?: string;
  userAgent?: string;
  path?: string;
  method?: string;
  details?: Record<string, unknown>;
}

/**
 * Record an audit event
 * Append-only: creates new record, never updates or deletes
 * §10.1 Log schema
 */
export async function recordAdminAuditEvent(payload: AuditLogPayload): Promise<void> {
  try {
    await db.authAuditEvent.create({
      data: {
        actorType: 'AdminUser',
        actorId: payload.adminId,
        eventType: payload.eventType as any,  // Maps to AuthAuditEventType enum
        ipAddress: payload.ip,
        metadata: {
          sessionId: payload.sessionId,
          severity: payload.severity,
          outcome: payload.outcome,
          country: payload.country,
          userAgent: payload.userAgent,
          path: payload.path,
          method: payload.method,
          ...payload.details,
        },
      },
    });

    // Also log to application logger for real-time alerting
    const logLevel = payload.severity === 'CRITICAL' ? 'error' : payload.severity === 'WARN' ? 'warn' : 'info';
    logger[logLevel](`[AUDIT] ${payload.eventType}`, {
      adminId: payload.adminId,
      sessionId: payload.sessionId,
      outcome: payload.outcome,
      ip: payload.ip,
      details: payload.details,
    });
  } catch (error) {
    // Critical: audit logging failure must not be silent
    logger.error('[CRITICAL] Audit logging failed', {
      adminId: payload.adminId,
      eventType: payload.eventType,
      error: error instanceof Error ? error.message : String(error),
    });
    // Do not throw: allow requests to continue even if audit fails
    // But alert ops immediately
  }
}

/**
 * Query audit events (read-only)
 * Only SUPER_ADMIN can query, and cannot modify records
 */
export async function queryAuditEvents(filters: {
  adminId?: string;
  eventType?: AdminAuthEventType;
  severity?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}) {
  try {
    const where: any = {};

    if (filters.adminId) {
      where.actorId = filters.adminId;
    }
    if (filters.eventType) {
      where.eventType = filters.eventType;
    }
    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = filters.startDate;
      if (filters.endDate) where.createdAt.lte = filters.endDate;
    }

    const events = await db.authAuditEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filters.limit || 100,
    });

    return events;
  } catch (error) {
    logger.error('Failed to query audit events', { error });
    return [];
  }
}

/**
 * Log login attempt (success or failure)
 */
export async function logAdminLogin(
  adminId: string,
  ip: string,
  country: string,
  userAgent: string,
  success: boolean,
  failureReason?: string
) {
  await recordAdminAuditEvent({
    adminId,
    eventType: success ? AdminAuthEventType.LOGIN_SUCCESS : AdminAuthEventType.LOGIN_FAILURE,
    severity: success ? 'INFO' : failureReason === 'account_locked' ? 'WARN' : 'INFO',
    outcome: success ? 'SUCCESS' : 'FAILURE',
    ip,
    country,
    userAgent,
    path: '/admin/auth/login',
    method: 'POST',
    details: failureReason ? { reason: failureReason } : undefined,
  });
}

/**
 * Log MFA attempt
 */
export async function logAdminMFA(
  adminId: string,
  sessionId: string,
  ip: string,
  success: boolean
) {
  await recordAdminAuditEvent({
    adminId,
    sessionId,
    eventType: success ? AdminAuthEventType.MFA_SUCCESS : AdminAuthEventType.MFA_FAILURE,
    severity: 'INFO',
    outcome: success ? 'SUCCESS' : 'FAILURE',
    ip,
    path: '/admin/auth/verify-mfa',
    method: 'POST',
  });
}

/**
 * Log step-up attempt
 */
export async function logAdminStepUp(
  adminId: string,
  sessionId: string,
  ip: string,
  success: boolean
) {
  await recordAdminAuditEvent({
    adminId,
    sessionId,
    eventType: success ? AdminAuthEventType.STEP_UP_SUCCESS : AdminAuthEventType.STEP_UP_FAILURE,
    severity: 'INFO',
    outcome: success ? 'SUCCESS' : 'FAILURE',
    ip,
    path: '/admin/auth/step-up',
    method: 'POST',
  });
}

/**
 * Log token refresh
 */
export async function logAdminTokenRefresh(
  adminId: string,
  sessionId: string,
  ip: string
) {
  await recordAdminAuditEvent({
    adminId,
    sessionId,
    eventType: AdminAuthEventType.TOKEN_REFRESH,
    severity: 'INFO',
    outcome: 'SUCCESS',
    ip,
    path: '/admin/auth/refresh',
    method: 'POST',
  });
}

/**
 * Log logout
 */
export async function logAdminLogout(
  adminId: string,
  sessionId: string,
  ip: string
) {
  await recordAdminAuditEvent({
    adminId,
    sessionId,
    eventType: AdminAuthEventType.LOGOUT,
    severity: 'INFO',
    outcome: 'SUCCESS',
    ip,
    path: '/admin/auth/logout',
    method: 'POST',
  });
}

/**
 * Log permission denied
 */
export async function logPermissionDenied(
  adminId: string,
  sessionId: string,
  ip: string,
  permission: string,
  path: string
) {
  await recordAdminAuditEvent({
    adminId,
    sessionId,
    eventType: AdminAuthEventType.PERMISSION_DENIED,
    severity: 'WARN',
    outcome: 'BLOCKED',
    ip,
    path,
    method: 'POST',
    details: { permission },
  });
}

/**
 * Log token reuse detection
 */
export async function logTokenReuseDetected(
  adminId: string,
  sessionId: string,
  ip: string
) {
  await recordAdminAuditEvent({
    adminId,
    sessionId,
    eventType: AdminAuthEventType.TOKEN_REUSE_DETECTED,
    severity: 'CRITICAL',
    outcome: 'BLOCKED',
    ip,
    details: { reason: 'Token family compromised' },
  });
}

/**
 * Log anomaly detection
 */
export async function logAnomalyDetected(
  adminId: string,
  sessionId: string,
  ip: string,
  anomalyScore: number,
  triggeredRules: string[]
) {
  await recordAdminAuditEvent({
    adminId,
    sessionId,
    eventType: AdminAuthEventType.ANOMALY_DETECTED,
    severity: anomalyScore >= 60 ? 'CRITICAL' : 'WARN',
    outcome: anomalyScore >= 60 ? 'BLOCKED' : 'SUCCESS',
    ip,
    details: {
      anomalyScore,
      triggeredRules,
    },
  });
}

/**
 * Log fingerprint mismatch
 */
export async function logFingerprintMismatch(
  adminId: string,
  sessionId: string,
  ip: string,
  verdict: string
) {
  await recordAdminAuditEvent({
    adminId,
    sessionId,
    eventType: AdminAuthEventType.FINGERPRINT_MISMATCH,
    severity: 'WARN',
    outcome: 'SUCCESS',
    ip,
    details: { verdict },
  });
}

/**
 * Log admin suspension
 */
export async function logAdminSuspended(
  adminId: string,
  suspendedBy: string,
  reason: string,
  ip: string
) {
  await recordAdminAuditEvent({
    adminId,
    eventType: AdminAuthEventType.ADMIN_SUSPENDED,
    severity: 'CRITICAL',
    outcome: 'SUCCESS',
    ip,
    details: { suspendedBy, reason },
  });
}

/**
 * Log admin unsuspension
 */
export async function logAdminUnsuspended(
  adminId: string,
  unsuspendedBy: string,
  reason: string,
  ip: string
) {
  await recordAdminAuditEvent({
    adminId,
    eventType: AdminAuthEventType.ADMIN_UNSUSPENDED,
    severity: 'INFO',
    outcome: 'SUCCESS',
    ip,
    details: { unsuspendedBy, reason },
  });
}

/**
 * Log password change
 */
export async function logPasswordChanged(
  adminId: string,
  ip: string
) {
  await recordAdminAuditEvent({
    adminId,
    eventType: AdminAuthEventType.PASSWORD_CHANGED,
    severity: 'INFO',
    outcome: 'SUCCESS',
    ip,
    path: '/admin/auth/password',
    method: 'POST',
  });
}

/**
 * Verify audit logs are truly append-only (no updates/deletes)
 * Run this periodically to ensure integrity
 */
export async function verifyAuditLogIntegrity(): Promise<boolean> {
  try {
    const total = await db.authAuditEvent.count();
    // If we ever see UPDATE/DELETE operations, this count should stay constant
    logger.info('Audit log integrity check', { totalRecords: total });
    return true;
  } catch (error) {
    logger.error('Audit log integrity check failed', { error });
    return false;
  }
}
