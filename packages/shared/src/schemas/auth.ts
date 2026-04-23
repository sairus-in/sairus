import { z } from 'zod';
import { cuidSchema } from './common';
import { RoleSchema } from './roles';

export const RouteSummarySchema = z.object({
  id: cuidSchema,
  name: z.string(),
  area: z.string(),
});

export const StopSummarySchema = z.object({
  id: cuidSchema,
  name: z.string(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export const RouteAssignmentSchema = z.object({
  id: cuidSchema,
  routeId: cuidSchema,
  stopId: cuidSchema,
  route: RouteSummarySchema,
  stop: StopSummarySchema,
});

export const MobileUserSchema = z.object({
  id: cuidSchema,
  name: z.string(),
  phone: z.string(),
  email: z.string().email().nullable(),
  role: RoleSchema,
  isActive: z.boolean(),
  rollNumber: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
  routeAssignment: RouteAssignmentSchema.nullable().optional(),
  busNumber: z.string().optional(),
});

export const MobileBootstrapUserSchema = z.object({
  id: cuidSchema,
  name: z.string(),
  phone: z.string(),
  role: RoleSchema,
  isActive: z.boolean().optional(),
  email: z.string().email().nullable().optional(),
  rollNumber: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
  routeAssignment: RouteAssignmentSchema.nullable().optional(),
  busNumber: z.string().optional(),
});

export const MobileLoginPayloadSchema = z.object({
  firebaseToken: z.string().min(1),
  deviceId: z.string().min(1),
});

export const MobileLoginDataSchema = z.object({
  token: z.string().min(1),
  user: MobileBootstrapUserSchema,
  status: z.string().optional(),
});

export const MobileRefreshPayloadSchema = z.object({
  firebaseToken: z.string().min(1),
  deviceId: z.string().min(1),
});

export const MobileRefreshDataSchema = z.object({
  token: z.string().min(1),
});

export type MobileAuthUser = z.infer<typeof MobileUserSchema>;
export type MobileBootstrapUser = z.infer<typeof MobileBootstrapUserSchema>;
export type MobileLoginPayload = z.infer<typeof MobileLoginPayloadSchema>;
export type MobileLoginData = z.infer<typeof MobileLoginDataSchema>;
export type MobileRefreshPayload = z.infer<typeof MobileRefreshPayloadSchema>;
export type MobileRefreshData = z.infer<typeof MobileRefreshDataSchema>;
