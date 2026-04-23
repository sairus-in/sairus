import { z } from 'zod';

const latitudeSchema = z.number().min(-90).max(90);
const longitudeSchema = z.number().min(-180).max(180);

export const CoordinatesSchema = z.object({
  lat: latitudeSchema,
  lon: longitudeSchema,
}).refine(
  ({ lat, lon }) => !(Math.abs(lat) < 0.001 && Math.abs(lon) < 0.001),
  { message: 'Coordinates cannot be null island (0,0)' },
).refine(
  ({ lat, lon }) => !(lat === -1 && lon === -1),
  { message: 'Coordinates cannot use sentinel (-1,-1)' },
);

export const MobileCheckinPayloadSchema = z.object({
  qrToken: z.string().min(10),
  lat: latitudeSchema,
  lon: longitudeSchema,
  accuracy: z.number().min(0).max(1000).nullable().optional(),
  clientTimestamp: z.number().int().positive(),
  isLowTrust: z.boolean(),
  gpsState: z.string().min(1),
  isReplay: z.boolean().optional(),
}).refine(
  ({ lat, lon }) => !(Math.abs(lat) < 0.001 && Math.abs(lon) < 0.001),
  { message: 'Coordinates cannot be null island (0,0)' },
);

export type MobileCheckinPayload = z.infer<typeof MobileCheckinPayloadSchema>;
