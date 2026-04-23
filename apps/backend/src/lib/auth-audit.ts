import { prisma } from './prisma'
import { logger } from './logger'
import { AuthAuditEventType } from 'shared'
import * as crypto from 'crypto'

interface AuditEventInput {
  actorType:  string
  actorId?:   string
  targetType?: string
  targetId?:  string
  eventType:  AuthAuditEventType
  ipAddress?: string
  deviceId?:  string
  metadata?:  Record<string, unknown>
}

/**
 * Fire-and-forget audit event writer.
 * Auth flow is NEVER blocked by audit log failure.
 */
export const writeAuthAuditEvent = async (input: AuditEventInput): Promise<void> => {
  prisma.authAuditEvent.create({
    data: {
      actorType:  input.actorType,
      actorId:    input.actorId,
      targetType: input.targetType,
      targetId:   input.targetId,
      eventType:  input.eventType,
      ipAddress:  input.ipAddress,
      deviceId:   input.deviceId,   // always hashed — never raw device identifier
      metadata:   input.metadata as any,   // never contains raw phone, email, or password
    }
  }).catch(err => {
    // Log but never throw — a logging failure must not break authentication
    logger.error({ event: 'auth_audit_write_failed', error: err.message } as any)
  })
}

/**
 * Creates a deterministic 16-character hash of an email or phone for log metadata.
 * Never logs raw PII in metadata.
 */
export const hashForLog = (value: string): string => {
  return crypto.createHash('sha256').update(value.toLowerCase().trim()).digest('hex').slice(0, 16)
}
