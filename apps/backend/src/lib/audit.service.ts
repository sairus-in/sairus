import { logger } from './logger';
import { prisma } from './prisma';

export type AuditAction =
  | 'RESOLVE_CORRECTION'
  | 'COORDINATOR_MARK_ALL_PRESENT'
  | 'END_TRIP'
  | 'FCM_TOKEN_UPDATED'
  | 'DEVICE_MISMATCH_ATTEMPT';

export interface AuditActorContext {
  actorType: 'ADMIN_USER' | 'MOBILE_USER' | 'SYSTEM';
  actorId: string;
  routeIds?: string[];
  ip?: string;
}

interface AuditParams {
  actor: AuditActorContext;
  action: AuditAction;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
}

class AuditService {
  log(params: AuditParams): void {
    void prisma.auditLog.create({
      data: {
        actorType: params.actor.actorType,
        actorId: params.actor.actorId,
        action: params.action,
        routeIds: params.actor.routeIds ?? [],
        entityType: params.entityType,
        entityId: params.entityId,
        before: params.before as object | undefined,
        after: params.after as object | undefined,
        meta: params.meta as object | undefined,
        ip: params.actor.ip,
      },
    }).catch((error) => {
      logger.error({
        event: 'audit_log_write_failed',
        source: 'SYSTEM',
        userId: params.actor.actorId,
        meta: {
          actorType: params.actor.actorType,
          action: params.action,
          entityType: params.entityType,
          entityId: params.entityId,
        },
      }, error);
    });
  }
}

export const auditService = new AuditService();
