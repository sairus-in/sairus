import { z } from 'zod';
import * as jwt from 'jsonwebtoken';
import { BadRequestError } from './errors';

const QRPayloadSchema = z.object({
  nonce:   z.string().min(1),
  tripId:  z.string().cuid(),
  busId:   z.string().cuid(),
  routeId: z.string().cuid(),
  purpose: z.string().optional(),
  currentStopId: z.string().nullable().optional(),
  issuedAt: z.number().optional(),
  iat:     z.number().positive().optional(),
  exp:     z.number().positive().optional(),
});
export type TypedQRPayload = z.infer<typeof QRPayloadSchema>;

export function decodeQRToken(token: string): TypedQRPayload {
  const decoded = jwt.decode(token);
  const result  = QRPayloadSchema.safeParse(decoded);
  if (!result.success) throw new BadRequestError('QR_INVALID', result.error.issues);
  return result.data;
}
