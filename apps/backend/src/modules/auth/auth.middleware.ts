import { FastifyRequest, FastifyReply } from 'fastify'
import * as jwt from 'jsonwebtoken'
import { getAuthUserState } from '../../lib/auth-cache'
import { writeAuthAuditEvent } from '../../lib/auth-audit'
import { jwtConfig } from '../../lib/auth-config'
import { AppError } from '../../lib/errors'
import { redis } from '../../lib/redis'
import { circuitExecute } from '../../lib/redis-circuit'
import { logger } from '../../lib/logger'
import { metrics } from '../../lib/metrics'
import { MobileJWTPayload, Role, AuthAuditEventType } from 'shared'

export const requireMobileAuth = async (
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> => {

  // ── Check 1: Token present ───────────────────────────────────────────
  const token = req.headers.authorization?.replace('Bearer ', '').trim()
  if (!token) {
    throw new AppError(401, 'UNAUTHORIZED', req.id)
  }

  // ── Check 2: JWT signature valid and not expired ─────────────────────
  let payload: MobileJWTPayload
  try {
    payload = jwt.verify(token, jwtConfig.secret, {
      issuer: jwtConfig.issuer,
      audience: jwtConfig.mobileAudience,
      algorithms: [jwtConfig.algorithm],
    }) as MobileJWTPayload
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      // TOKEN_EXPIRED is a normal condition — mobile app refreshes silently
      throw new AppError(401, 'TOKEN_EXPIRED', req.id)
    }
    throw new AppError(401, 'INVALID_TOKEN', req.id)
  }

  // ── Check 3: Token type ──────────────────────────────────────────────
  // Prevents admin JWTs from being used on mobile endpoints and vice versa
  if (payload.type !== 'MOBILE') {
    throw new AppError(403, 'WRONG_TOKEN_TYPE', req.id)
  }

  // ── Check 4: Required fields present ────────────────────────────────
  // Validates token structure — defense against malformed tokens
  if (!payload.sub || !payload.deviceId || payload.sv === undefined || !payload.role) {
    throw new AppError(401, 'INVALID_TOKEN_STRUCTURE', req.id)
  }

  // ── Check 5: User exists and is active ──────────────────────────────
  // Redis cache hit: ~1ms. DB fallback: ~10ms.
  const authState = await getAuthUserState(payload.sub)
  if (!authState) {
    throw new AppError(401, 'USER_NOT_FOUND', req.id)
  }
  if (!authState.isActive || authState.authStatus === 'DISABLED') {
    throw new AppError(403, 'ACCOUNT_DISABLED', req.id)
  }

  // ── Check 6: sessionVersion matches ─────────────────────────────────
  // Any JWT with an old sv is permanently rejected.
  if (payload.sv !== authState.sessionVersion) {
    void writeAuthAuditEvent({
      actorType: 'MOBILE_USER',
      actorId:   payload.sub,
      eventType: AuthAuditEventType.STALE_SESSION_REJECTED,
      metadata:  { tokenSv: payload.sv, currentSv: authState.sessionVersion }
    })
    throw new AppError(401, 'SESSION_REVOKED', req.id)
  }

  const blacklisted = await circuitExecute(
    () => redis.get(`jwt:blacklist:${payload.sub}`),
    'skip_silent',
    async () => {
      logger.warn({
        event: 'jwt_blacklist_check_skipped',
        source: 'SYSTEM',
        meta: { userId: payload.sub },
      })
      await metrics.increment('auth.jwt_blacklist.redis_skipped')
      return null
    },
    'auth-jwt-blacklist',
  )
  if (blacklisted) {
    throw new AppError(401, 'SESSION_REVOKED', req.id)
  }

  // ── Check 7: forcedReloginAt — emergency time-based cutoff ──────────
  if (authState.forcedReloginAt) {
    const forcedAtSeconds = new Date(authState.forcedReloginAt).getTime() / 1000
    if (payload.iat < forcedAtSeconds) {
      void writeAuthAuditEvent({
        actorType: 'MOBILE_USER',
        actorId:   payload.sub,
        eventType: AuthAuditEventType.FORCED_RELOGIN_REQUIRED,
        metadata:  { tokenIat: payload.iat, forcedAtSeconds }
      })
      throw new AppError(401, 'FORCED_RELOGIN_REQUIRED', req.id)
    }
  }

  // ── Check 8: Device binding ──────────────────────────────────────────
  // The deviceId in the JWT must match the registered device in the cache.
  if (!authState.registeredDeviceId || payload.deviceId !== authState.registeredDeviceId) {
    void writeAuthAuditEvent({
      actorType: 'MOBILE_USER',
      actorId:   payload.sub,
      eventType: AuthAuditEventType.DEVICE_MISMATCH_REJECTED,
      deviceId:  payload.deviceId,
      metadata:  { hasRegisteredDevice: !!authState.registeredDeviceId }
    })
    throw new AppError(401, 'DEVICE_MISMATCH', req.id)
  }

  // ── All checks passed — attach user to request ───────────────────────
  req.user = {
    ...payload,
    role: authState.role as Role,
    userId: payload.sub,
  }
}

// ── Role guard factory ───────────────────────────────────────────────────────
export const requireRole = (allowedRoles: Role[]) => {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!req.user || req.user.type !== 'MOBILE') {
      throw new AppError(401, 'UNAUTHORIZED', req.id)
    }
    if (!allowedRoles.includes(req.user.role as Role)) {
      throw new AppError(403, 'FORBIDDEN', req.id)
    }
  }
}
