import { FastifyRequest, FastifyReply } from 'fastify'
import * as jwt from 'jsonwebtoken'
import { AdminJWTPayload, AdminRole } from 'shared'
import { getAuthAdminState } from '../../lib/auth-cache'
import {
  ensureAdminCsrfCookie,
  hasValidAdminCsrfToken,
  requiresAdminCsrfProtection,
} from '../../lib/admin-session'
import { jwtConfig } from '../../lib/auth-config'
import { AppError } from '../../lib/errors'
import { checkAdminAuthenticatedRateLimit } from '../../lib/rate-limit'
import {
  isAdminReauthRequired,
  recordAdminApiBurst,
  recordAdminFingerprintAnomaly,
  recordAdminUnusualHour,
} from './admin-anomaly.service'
import { extractAdminFingerprintFromHeaders, syncAdminFingerprint } from './admin-fingerprint.service'
import { consumeAdminStepUpToken } from './admin-auth.service'

export const requireAdminAuth = async (
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> => {

  // Admin JWT comes from httpOnly cookie
  const token = req.cookies?.admin_jwt
  if (!token) {
    throw new AppError(401, 'UNAUTHORIZED', req.id)
  }

  let payload: AdminJWTPayload
  try {
    payload = jwt.verify(token, jwtConfig.secret, {
      issuer: jwtConfig.issuer,
      audience: jwtConfig.adminAudience,
      algorithms: [jwtConfig.algorithm],
    }) as AdminJWTPayload
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(401, 'TOKEN_EXPIRED', req.id)
    }
    throw new AppError(401, 'INVALID_TOKEN', req.id)
  }

  // Token type check — admin token only on admin endpoints
  if (payload.type !== 'ADMIN') {
    throw new AppError(403, 'WRONG_TOKEN_TYPE', req.id)
  }

  if (!payload.sub || payload.sv === undefined) {
    throw new AppError(401, 'INVALID_TOKEN_STRUCTURE', req.id)
  }

  const authState = await getAuthAdminState(payload.sub)
  if (!authState) {
    throw new AppError(401, 'ADMIN_NOT_FOUND', req.id)
  }
  if (!authState.isActive) {
    throw new AppError(403, 'ACCOUNT_DISABLED', req.id)
  }
  if (payload.sv !== authState.sessionVersion) {
    throw new AppError(401, 'SESSION_REVOKED', req.id)
  }

  const requestPath = req.url ?? ''
  const rateLimitState = await checkAdminAuthenticatedRateLimit(payload.sub, req.ip)

  if (await isAdminReauthRequired(payload.sub, payload.sv)) {
    throw new AppError(401, 'FORCED_RELOGIN_REQUIRED', req.id)
  }

  const fingerprintSignals = extractAdminFingerprintFromHeaders(req.headers)
  const fingerprintAssessment = await syncAdminFingerprint(payload.sub, fingerprintSignals)

  if (fingerprintAssessment.verdict === 'DRIFT' || fingerprintAssessment.verdict === 'MISMATCH') {
    const fingerprintRisk = await recordAdminFingerprintAnomaly({
      adminId: payload.sub,
      sessionVersion: payload.sv,
      verdict: fingerprintAssessment.verdict,
      score: fingerprintAssessment.score,
      changedSignals: fingerprintAssessment.changedSignals,
      ipAddress: req.ip,
      path: requestPath,
    })

    if (fingerprintRisk.action !== 'ALLOW') {
      throw new AppError(401, 'FORCED_RELOGIN_REQUIRED', req.id)
    }
  }

  if (rateLimitState.anomalyTriggered) {
    const apiBurstRisk = await recordAdminApiBurst({
      adminId: payload.sub,
      sessionVersion: payload.sv,
      requestCount: rateLimitState.adminCount,
      ipAddress: req.ip,
      path: requestPath,
      method: req.method,
    })

    if (apiBurstRisk.action !== 'ALLOW') {
      throw new AppError(401, 'FORCED_RELOGIN_REQUIRED', req.id)
    }
  }

  const isUnsafeMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())
  const isSensitiveRead =
    req.method.toUpperCase() === 'GET' &&
    ['/audit-log', '/reports/', '/ops/pending-auth'].some((fragment) => requestPath.includes(fragment))

  if (isUnsafeMethod || isSensitiveRead) {
    const unusualHourRisk = await recordAdminUnusualHour({
      adminId: payload.sub,
      sessionVersion: payload.sv,
      timezone: fingerprintSignals.timezone,
      ipAddress: req.ip,
      path: requestPath,
      method: req.method,
    })

    if (unusualHourRisk.action !== 'ALLOW') {
      throw new AppError(401, 'FORCED_RELOGIN_REQUIRED', req.id)
    }
  }

  if (await isAdminReauthRequired(payload.sub, payload.sv)) {
    throw new AppError(401, 'FORCED_RELOGIN_REQUIRED', req.id)
  }

  // ============================================================================
  // TODO(PRODUCTION_BLOCKER): Re-enable MFA enforcement before deploying to prod!
  // ============================================================================
  // MFA enforcement bypassed for local development phase
  // if (['TRANSPORT_OFFICER', 'MANAGEMENT'].includes(authState.role) && !authState.mfaEnabled) {
  //   throw new AppError(
  //     403,
  //     'MFA_REQUIRED',
  //     'Multi-factor authentication is required for administrative access. Please enable MFA in your account settings.'
  //   )
  // }

  if (requiresAdminCsrfProtection(req) && !hasValidAdminCsrfToken(req)) {
    throw new AppError(403, 'CSRF_VALIDATION_FAILED', req.id)
  }

  ensureAdminCsrfCookie(req, reply)

  req.user = {
    ...payload,
    role: authState.role as AdminRole,
    userId: payload.sub,
  }
}

// Admin role guard
export const requireAdminRole = (allowedRoles: AdminRole[]) => {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!req.user || req.user.type !== 'ADMIN') {
      throw new AppError(401, 'UNAUTHORIZED')
    }
    if (!allowedRoles.includes(req.user.role as AdminRole)) {
      throw new AppError(403, 'FORBIDDEN')
    }
  }
}

export const requireAdminStepUp = async (
  req: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> => {
  if (!req.user || req.user.type !== 'ADMIN') {
    throw new AppError(401, 'UNAUTHORIZED')
  }

  const headerValue = req.headers['x-admin-step-up']
  const stepUpToken = Array.isArray(headerValue) ? headerValue[0] : headerValue
  if (!stepUpToken) {
    throw new AppError(403, 'STEP_UP_REQUIRED')
  }

  const isValid = await consumeAdminStepUpToken(
    stepUpToken,
    req.user.sub,
    req.user.sv,
    req.ip,
    req.headers['user-agent'] || '',
  )

  if (!isValid) {
    throw new AppError(403, 'STEP_UP_REQUIRED')
  }
}

// Coordinator scope enforcement
// Coordinators can only access resources within their assigned routes
export const scopeCoordinator = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  if (req.user && req.user.type === 'ADMIN' && req.user.role === 'COORDINATOR') {
    // Attach coordinator's route scope to request for service layer consumption
    (req as any).coordinatorRouteIds = (req.user as any).coordinatorRouteIds || []
  }
}
