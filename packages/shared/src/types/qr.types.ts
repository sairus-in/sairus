export const QR_PURPOSE = {
  ATTENDANCE: 'ATTENDANCE',
} as const;

export type QRPurpose = typeof QR_PURPOSE[keyof typeof QR_PURPOSE];

// The shape of the actual JWT payload that gets signed into the QR string
export interface QRPayload {
  purpose: QRPurpose;
  busId: string;
  routeId: string;
  currentStopId: string | null;
  tripId: string;
  issuedAt: number; // Unix timestamp in ms
  nonce: string; // UUID v4 for one-time burnout
}

// Result of successfully parsing and decoding a QR token
export interface QRToken {
  payload: QRPayload;
  rawToken: string;
}