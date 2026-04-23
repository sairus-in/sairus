import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_ISSUER: z.string().default('college-bus-system'),
  JWT_MOBILE_AUDIENCE: z.string().default('college-bus-mobile'),
  JWT_ADMIN_AUDIENCE: z.string().default('college-bus-admin'),
  ADMIN_MFA_ISSUER: z.string().default('College Bus Admin'),
  ADMIN_MFA_ENCRYPTION_KEY: z.string().optional(),
  BACKEND_URL: z.string().default('http://localhost:3000'),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  GOOGLE_CLOUD_PROJECT: z.string().optional(),
  CLOUD_TASKS_QUEUE: z.string().default('system-jobs'),
  CLOUD_TASKS_LOCATION: z.string().default('asia-south1'),
  CLOUD_TASKS_SA_EMAIL: z.string().optional(),
  CLOUD_TASKS_SECRET: z.string().optional(),
  ADMIN_COOKIE_DOMAIN: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  FIREBASE_DATABASE_URL: z.string().optional(),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_ALERT_TEMPLATE_ID: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.NODE_ENV === 'production') {
    if (!value.CORS_ALLOWED_ORIGINS || value.CORS_ALLOWED_ORIGINS.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ALLOWED_ORIGINS'],
        message: 'CORS_ALLOWED_ORIGINS must be configured in production',
      });
    }

    if (!value.BACKEND_URL || value.BACKEND_URL.includes('localhost')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BACKEND_URL'],
        message: 'BACKEND_URL must be set to the public backend URL in production',
      });
    }

    if (!value.GOOGLE_CLOUD_PROJECT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GOOGLE_CLOUD_PROJECT'],
        message: 'GOOGLE_CLOUD_PROJECT is required in production',
      });
    }

    if (!value.CLOUD_TASKS_SA_EMAIL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CLOUD_TASKS_SA_EMAIL'],
        message: 'CLOUD_TASKS_SA_EMAIL is required in production',
      });
    }

    if (!value.CLOUD_TASKS_SECRET || value.CLOUD_TASKS_SECRET.length < 16) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CLOUD_TASKS_SECRET'],
        message: 'CLOUD_TASKS_SECRET must be configured with a non-trivial value in production',
      });
    }

    if (value.JWT_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET must be at least 32 characters in production',
      });
    }

    if (!value.ADMIN_MFA_ENCRYPTION_KEY || value.ADMIN_MFA_ENCRYPTION_KEY.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ADMIN_MFA_ENCRYPTION_KEY'],
        message: 'ADMIN_MFA_ENCRYPTION_KEY must be at least 32 characters in production',
      });
    }

    if (!value.FIREBASE_PROJECT_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FIREBASE_PROJECT_ID'],
        message: 'FIREBASE_PROJECT_ID is required in production',
      });
    }

    if (!value.FIREBASE_SERVICE_ACCOUNT_JSON) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FIREBASE_SERVICE_ACCOUNT_JSON'],
        message: 'FIREBASE_SERVICE_ACCOUNT_JSON is required in production',
      });
    }

    if (!value.FIREBASE_DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FIREBASE_DATABASE_URL'],
        message: 'FIREBASE_DATABASE_URL is required in production',
      });
    }
  }

  if (value.MSG91_AUTH_KEY && !value.MSG91_ALERT_TEMPLATE_ID) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['MSG91_ALERT_TEMPLATE_ID'],
      message: 'MSG91_ALERT_TEMPLATE_ID is required when MSG91_AUTH_KEY is configured',
    });
  }
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const formatted = parsedEnv.error.issues
    .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
    .join('\n');

  throw new Error(`Invalid environment configuration:\n${formatted}`);
}

export const env = parsedEnv.data;
export const isProduction = env.NODE_ENV === 'production';
