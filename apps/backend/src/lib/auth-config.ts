import { env } from './env';

const splitEnvList = (value?: string): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export const jwtConfig = {
  secret: env.JWT_SECRET,
  issuer: env.JWT_ISSUER,
  mobileAudience: env.JWT_MOBILE_AUDIENCE,
  adminAudience: env.JWT_ADMIN_AUDIENCE,
  algorithm: 'HS256' as const,
};

export const adminSecurityConfig = {
  cookieDomain: env.ADMIN_COOKIE_DOMAIN || undefined,
  mfaIssuer: env.ADMIN_MFA_ISSUER,
  mfaEncryptionKey: env.ADMIN_MFA_ENCRYPTION_KEY,
};

export const resolveAllowedOrigins = (): string[] => {
  const configuredOrigins = splitEnvList(env.CORS_ALLOWED_ORIGINS);

  if (configuredOrigins.length > 0) {
    return configuredOrigins;
  }

  if (env.NODE_ENV !== 'production') {
    return [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:5175',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5174',
      'http://127.0.0.1:5175',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:8081',
      'http://127.0.0.1:8081',
    ];
  }

  return [];
};
