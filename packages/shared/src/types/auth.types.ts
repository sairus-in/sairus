import { Role } from './user.types';
import { AdminRole } from '../schemas/common';

export interface MobileJWTPayload {
  sub:      string;   // userId (cuid from our DB)
  type:     'MOBILE'; // must be exactly this string
  role:     Role;     // STUDENT | STAFF | DRIVER
  deviceId: string;   // SHA-256 hash of device identifier
  sv:       number;   // sessionVersion — must match DB value on every request
  iat:      number;   // issued at (Unix seconds)
  exp:      number;   // expires at
}

export interface AdminJWTPayload {
  sub:   string;      // adminUserId
  type:  'ADMIN';     // must be exactly this string
  role:  AdminRole;   // COORDINATOR | TRANSPORT_OFFICER | FACULTY | MANAGEMENT
  email: string;      // for display only
  sv:    number;      // sessionVersion
  iat:   number;
  exp:   number;      
}
