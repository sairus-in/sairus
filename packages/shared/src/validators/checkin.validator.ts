import { z } from 'zod';
import { cuidSchema } from '../schemas/common';

export const checkinRequestSchema = z.object({
  qrToken: z.string().min(10, 'Invalid QR token format'),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(1000).optional(),
  clientTimestamp: z.number().int().positive(),
  isReplay: z.boolean().optional(),
}).refine(
  ({ lat, lon }) => !(Math.abs(lat) < 0.001 && Math.abs(lon) < 0.001),
  { message: 'GPS_NO_FIX: Null island coordinates rejected' }
);

export const skipTodayRequestSchema = z.object({
  tripId: cuidSchema,
  reason: z.enum(['HOLIDAY', 'SICK', 'PERSONAL', 'COLLEGE_EVENT', 'OTHER']),
  notes: z.string().max(255).optional(),
});

export const waitForMeRequestSchema = z.object({
  tripId: cuidSchema,
  etaMinutes: z.number().int().min(1).max(5),
});

export const correctionRequestSchema = z.object({
  attendanceId: cuidSchema,
  reason: z.string().min(10, 'Please provide a detailed reason').max(500),
});
