import { z } from 'zod';

export const PaginationSchema = z.object({
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  total: z.number().int().min(0),
  hasMore: z.boolean(),
});

export const ApiSuccessSchema = <T extends z.ZodTypeAny>(dataSchema: T) => z.object({
  success: z.literal(true),
  data: dataSchema,
  pagination: PaginationSchema.optional(),
  requestId: z.string().optional(),
  timestamp: z.string(),
});

export const ApiErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  retryable: z.boolean().optional(),
  requestId: z.string().optional(),
  timestamp: z.string().optional(),
});
