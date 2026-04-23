import { FastifyReply, FastifyRequest } from 'fastify';
import * as crypto from 'crypto';
import { adminSecurityConfig } from './auth-config';
import { isProduction } from './env';

const adminSameSite: 'strict' | 'lax' = isProduction ? 'strict' : 'lax';

const adminJwtCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: adminSameSite,
  maxAge: 8 * 60 * 60,
  path: '/',
  domain: adminSecurityConfig.cookieDomain,
};

const adminCsrfCookieOptions = {
  httpOnly: false,
  secure: isProduction,
  sameSite: adminSameSite,
  maxAge: 8 * 60 * 60,
  path: '/',
  domain: adminSecurityConfig.cookieDomain,
};

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const generateAdminCsrfToken = (): string => crypto.randomBytes(32).toString('hex');

export const setAdminSessionCookies = (reply: FastifyReply, jwtToken: string): string => {
  const csrfToken = generateAdminCsrfToken();
  reply.setCookie('admin_jwt', jwtToken, adminJwtCookieOptions);
  reply.setCookie('admin_csrf', csrfToken, adminCsrfCookieOptions);
  return csrfToken;
};

export const ensureAdminCsrfCookie = (req: FastifyRequest, reply: FastifyReply): string | null => {
  const existingToken = req.cookies?.admin_csrf;
  if (existingToken) {
    return existingToken;
  }

  const csrfToken = generateAdminCsrfToken();
  reply.setCookie('admin_csrf', csrfToken, adminCsrfCookieOptions);
  return csrfToken;
};

export const clearAdminSessionCookies = (reply: FastifyReply): void => {
  reply.clearCookie('admin_jwt', {
    path: adminJwtCookieOptions.path,
    domain: adminJwtCookieOptions.domain,
  });
  reply.clearCookie('admin_csrf', {
    path: adminCsrfCookieOptions.path,
    domain: adminCsrfCookieOptions.domain,
  });
};

export const requiresAdminCsrfProtection = (req: FastifyRequest): boolean =>
  unsafeMethods.has(req.method.toUpperCase());

export const hasValidAdminCsrfToken = (req: FastifyRequest): boolean => {
  const cookieToken = req.cookies?.admin_csrf;
  const headerValue = req.headers['x-csrf-token'];
  const headerToken = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  if (!cookieToken || !headerToken) {
    return false;
  }

  const cookieBuffer = Buffer.from(cookieToken);
  const headerBuffer = Buffer.from(headerToken);

  if (cookieBuffer.length !== headerBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(cookieBuffer, headerBuffer);
};
