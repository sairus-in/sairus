import { z } from 'zod';

export const stopSchema = z.object({
  id: z.string().cuid().optional(),
  name: z.string().min(2, 'Stop name must be at least 2 characters'),
  area: z.string().min(2).nullable(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  isActive: z.boolean().default(true),
});

export const routeStopConfigSchema = z.object({
  id: z.string().cuid().optional(),
  stopId: z.string().cuid(),
  sequence: z.number().int().min(0),
  scheduledTimeMorning: z.number().int().min(0).max(1439),
  scheduledTimeReturn: z.number().int().min(0).max(1439),
  isActive: z.boolean().default(true),
  stop: stopSchema.optional(),
});

export const createRouteSchema = z.object({
  name: z.string().min(2, 'Route name is required'),
  area: z.string().min(2),
  stops: z.array(routeStopConfigSchema).min(2, 'A route must have at least 2 stops'),
});
