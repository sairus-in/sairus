/**
 * Admin Authentication Routes (HTTP Layer)
 * Fastify routes for all auth flows
 * 
 * Implements:
 *   - Request/response validation
 *   - Cookie management
 *   - Error handling & logging
 *   - Device fingerprinting extraction
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import * as authService from './admin-auth-service-v2';
import {
  FingerprintSignalsClient,
  AuthError,
  AdminRole,
  AdminPermission,
  CONSTANTS,
  AUTH_ERROR_RESPONSES,
} from './admin-auth-types';
import { logger } from '../../lib/logger';

// ─── VALIDATION SCHEMAS ───────────────────────────────────

const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpCode: z.string().length(6),
});

const FingerprintSignalsSchema = z.object({
  userAgent: z.string(),
  acceptLanguage: z.string(),
  timezone: z.string(),
  screenRes: z.string(),
  colorDepth: z.number(),
  platform: z.string(),
  hardwareConcurrency: z.number(),
  deviceMemory: z.number().optional(),
});

const RefreshRequestSchema = z.object({
  refreshToken: z.string(),
});

const StepUpRequestSchema = z.object({
  password: z.string().min(1),
});

const ErrorResponseSchema = z.object({
  ok: z.boolean(),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

const SuccessResponseSchema = z.object({
  ok: z.boolean(),
  data: z.record(z.any()),
});

// ─── MIDDLEWARE & HELPERS ─────────────────────────────────

/**
 * Extract IP address from request
 * Handles X-Forwarded-For, Cloudflare-Client-IP, etc.
 */
function getClientIP(request: FastifyRequest): string {
  const xForwarded = request.headers['x-forwarded-for'];
  const cfIP = request.headers['cf-connecting-ip'];
  const clientIP = request.headers['client-ip'];

  if (xForwarded) {
    const ips = Array.isArray(xForwarded)
      ? xForwarded[0].split(',')[0]
      : xForwarded.split(',')[0];
    return ips.trim();
  }

  if (cfIP) {
    return Array.isArray(cfIP) ? cfIP[0] : cfIP;
  }

  if (clientIP) {
    return Array.isArray(clientIP) ? clientIP[0] : clientIP;
  }

  return request.ip || '127.0.0.1';
}

/**
 * Geolocate IP address (simplified)
 * In production, use MaxMind or similar
 */
async function geolocateIP(ip: string): Promise<{ country: string; asn: string }> {
  // TODO: Integrate MaxMind GeoIP2 or similar
  // For now, return placeholder
  return { country: 'US', asn: 'AS15169' };
}

/**
 * Extract device fingerprint from request body
 */
function extractFingerprint(body: any): FingerprintSignalsClient | null {
  try {
    return FingerprintSignalsSchema.parse(body.fingerprint || {});
  } catch (error) {
    logger.warn('Invalid fingerprint data', { error });
    return null;
  }
}

/**
 * Set secure cookies
 */
function setAuthCookies(
  reply: FastifyReply,
  accessToken: string,
  refreshToken: string,
  options?: { maxAge?: number }
): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const maxAge = options?.maxAge || CONSTANTS.SESSION_ABSOLUTE_TTL_HOURS * 3600 * 1000;

  // Access token in httpOnly cookie (15 minutes)
  reply.setCookie('access_token', accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/api/admin',
    maxAge: CONSTANTS.ACCESS_TOKEN_TTL_MINUTES * 60 * 1000,
  });

  // Refresh token in httpOnly cookie (24 hours)
  reply.setCookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/api/admin/auth/refresh',
    maxAge,
  });
}

/**
 * Clear auth cookies on logout
 */
function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie('access_token', { path: '/api/admin' });
  reply.clearCookie('refresh_token', { path: '/api/admin/auth/refresh' });
}

// ─── ERROR HANDLING ───────────────────────────────────────

function errorHandler(error: any, reply: FastifyReply): void {
  if (error instanceof AuthError) {
    reply.status(error.statusCode).send({
      ok: false,
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }

  if (error instanceof z.ZodError) {
    reply.status(400).send({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request body',
        details: error.errors,
      },
    });
    return;
  }

  logger.error('Unhandled error in auth route', { error });
  reply.status(500).send({
    ok: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    },
  });
}

// ─── ROUTES ───────────────────────────────────────────────

export async function registerAuthRoutes(fastify: FastifyInstance) {
  // ─── POST /api/admin/auth/login ──────────────────────

  fastify.post<{ Body: any }>(
    '/api/admin/auth/login',
    async (request, reply) => {
      try {
        // Validate body
        const body = LoginRequestSchema.parse(request.body);

        // Extract fingerprint
        const fingerprint = extractFingerprint(request.body);
        if (!fingerprint) {
          throw new AuthError(
            'INVALID_FINGERPRINT',
            'Missing or invalid device fingerprint.',
            400
          );
        }

        // Get IP and geo info
        const ip = getClientIP(request);
        const geo = await geolocateIP(ip);

        // Call auth service
        const { accessToken, refreshToken } = await authService.adminLogin(
          body.email,
          body.password,
          body.totpCode,
          fingerprint,
          ip,
          geo.country,
          geo.asn
        );

        // Set cookies and return tokens
        setAuthCookies(reply, accessToken, refreshToken);

        reply.status(200).send({
          ok: true,
          data: {
            accessToken,
            refreshToken,
          },
        });
      } catch (error) {
        errorHandler(error, reply);
      }
    }
  );

  // ─── POST /api/admin/auth/refresh ───────────────────

  fastify.post<{ Body: any }>(
    '/api/admin/auth/refresh',
    async (request, reply) => {
      try {
        // Get refresh token from cookie or body
        let refreshToken = request.cookies.refresh_token;
        if (!refreshToken && request.body?.refreshToken) {
          refreshToken = request.body.refreshToken;
        }

        if (!refreshToken) {
          throw new AuthError(
            'UNAUTHORIZED',
            AUTH_ERROR_RESPONSES.UNAUTHORIZED.message,
            401
          );
        }

        const ip = getClientIP(request);
        const geo = await geolocateIP(ip);

        const { accessToken, newRefreshToken } = await authService.adminRefresh(
          refreshToken,
          ip,
          geo.country
        );

        setAuthCookies(reply, accessToken, newRefreshToken);

        reply.status(200).send({
          ok: true,
          data: {
            accessToken,
            refreshToken: newRefreshToken,
          },
        });
      } catch (error) {
        errorHandler(error, reply);
      }
    }
  );

  // ─── POST /api/admin/auth/step-up ───────────────────

  fastify.post<{ Body: any }>(
    '/api/admin/auth/step-up',
    {
      onRequest: [requireAuth], // Must be authenticated
    },
    async (request, reply) => {
      try {
        const body = StepUpRequestSchema.parse(request.body);
        const adminId = (request as any).adminId;
        const sessionId = (request as any).sessionId;
        const ip = getClientIP(request);

        const { stepUpToken } = await authService.initiateStepUp(
          adminId,
          body.password,
          sessionId,
          ip
        );

        reply.status(200).send({
          ok: true,
          data: { stepUpToken },
        });
      } catch (error) {
        errorHandler(error, reply);
      }
    }
  );

  // ─── POST /api/admin/auth/logout ────────────────────

  fastify.post(
    '/api/admin/auth/logout',
    {
      onRequest: [requireAuth],
    },
    async (request, reply) => {
      try {
        const adminId = (request as any).adminId;
        const sessionId = (request as any).sessionId;
        const jti = (request as any).jti;
        const remainingTokenTtl = (request as any).remainingTokenTtl || 900; // 15 min default
        const ip = getClientIP(request);

        await authService.adminLogout(adminId, sessionId, jti, remainingTokenTtl, ip);

        clearAuthCookies(reply);

        reply.status(200).send({
          ok: true,
          data: { message: 'Logged out successfully.' },
        });
      } catch (error) {
        errorHandler(error, reply);
      }
    }
  );

  // ─── POST /api/admin/auth/logout-all ────────────────

  fastify.post(
    '/api/admin/auth/logout-all',
    {
      onRequest: [
        requireAuth,
        requirePermission(AdminPermission.MANAGE_SETTINGS),
      ],
    },
    async (request, reply) => {
      try {
        const adminId = (request as any).adminId;

        await authService.adminLogoutAll(adminId, 'admin_requested');

        clearAuthCookies(reply);

        reply.status(200).send({
          ok: true,
          data: { message: 'All sessions revoked.' },
        });
      } catch (error) {
        errorHandler(error, reply);
      }
    }
  );

  // ─── GET /api/admin/auth/me ─────────────────────────

  fastify.get(
    '/api/admin/auth/me',
    {
      onRequest: [requireAuth],
    },
    async (request, reply) => {
      try {
        const adminId = (request as any).adminId;
        const role = (request as any).role;
        const permissions = (request as any).permissions;

        // In production, fetch full admin profile from DB
        reply.status(200).send({
          ok: true,
          data: {
            id: adminId,
            role,
            permissions,
          },
        });
      } catch (error) {
        errorHandler(error, reply);
      }
    }
  );
}

// ─── MIDDLEWARE ────────────────────────────────────────────

/**
 * Require authentication middleware
 * Verifies JWT, checks session, validates fingerprint
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // Get access token from cookie or Authorization header
    let token = request.cookies.access_token;
    if (!token) {
      const authHeader = request.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }
    }

    if (!token) {
      throw new AuthError(
        'UNAUTHORIZED',
        AUTH_ERROR_RESPONSES.UNAUTHORIZED.message,
        401
      );
    }

    // Verify JWT and get decoded payload
    const decoded = authService.verifyJWT(token) as any;

    // Check if token is revoked
    const isRevoked = await (request.server as any).redis.a.isTokenRevoked(decoded.jti);
    if (isRevoked) {
      throw new AuthError(
        'UNAUTHORIZED',
        AUTH_ERROR_RESPONSES.UNAUTHORIZED.message,
        401
      );
    }

    // Get session from Redis
    const session = await authService.getSessionFromJWT(token);
    if (!session) {
      throw new AuthError(
        'SESSION_EXPIRED',
        AUTH_ERROR_RESPONSES.SESSION_EXPIRED.message,
        401
      );
    }

    // Attach to request
    (request as any).adminId = decoded.sub;
    (request as any).sessionId = session.sessionId;
    (request as any).role = session.role;
    (request as any).permissions = session.permissions;
    (request as any).jti = decoded.jti;
    (request as any).fpHash = session.fpHash;
    (request as any).remainingTokenTtl = decoded.exp - Math.floor(Date.now() / 1000);
  } catch (error) {
    if (error instanceof AuthError) {
      reply.status(error.statusCode).send({
        ok: false,
        error: { code: error.code, message: error.message },
      });
    } else {
      reply.status(401).send({
        ok: false,
        error: { code: 'UNAUTHORIZED', message: AUTH_ERROR_RESPONSES.UNAUTHORIZED.message },
      });
    }
  }
}

/**
 * Require specific permission
 */
export function requirePermission(...permissions: AdminPermission[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const adminPermissions = (request as any).permissions || [];

    const hasPermission = permissions.some((p) => adminPermissions.includes(p));
    if (!hasPermission) {
      reply.status(403).send({
        ok: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: AUTH_ERROR_RESPONSES.PERMISSION_DENIED.message,
        },
      });
    }
  };
}

/**
 * Require step-up authentication
 * Used for sensitive operations
 */
export function requireStepUp() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session;
    if (!session || session.needsReauth) {
      reply.status(403).send({
        ok: false,
        error: {
          code: 'STEP_UP_REQUIRED',
          message: 'This action requires additional authentication.',
        },
      });
    }
  };
}
