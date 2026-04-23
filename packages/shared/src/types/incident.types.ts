export const INCIDENT_TYPE = {
  MECHANICAL_FAILURE: 'MECHANICAL_FAILURE',
  FLAT_TYRE: 'FLAT_TYRE',
  ACCIDENT: 'ACCIDENT',
  DRIVER_UNWELL: 'DRIVER_UNWELL',
  ROUTE_BLOCKED: 'ROUTE_BLOCKED',
  OTHER: 'OTHER',
} as const;

export type IncidentType = typeof INCIDENT_TYPE[keyof typeof INCIDENT_TYPE];

export const INCIDENT_STATUS = {
  REPORTED: 'REPORTED',
  ASSIGNED: 'ASSIGNED',
  RESOLVED: 'RESOLVED',
} as const;

export type IncidentStatus = typeof INCIDENT_STATUS[keyof typeof INCIDENT_STATUS];

export const ESCALATION_LEVEL = {
  COORDINATOR: 'COORDINATOR', // t=0
  TRANSPORT_OFFICER: 'TRANSPORT_OFFICER', // t=10 mins
  PRINCIPAL: 'PRINCIPAL', // t=20 mins
} as const;

export type EscalationLevel = typeof ESCALATION_LEVEL[keyof typeof ESCALATION_LEVEL];

export interface Incident {
  id: string;
  tripId: string;
  busId: string;
  routeId: string;
  driverId: string;
  
  type: IncidentType;
  status: IncidentStatus;
  description: string;
  
  lat?: number;
  lng?: number;
  
  escalationLevel: EscalationLevel;
  alternateBusId?: string | null;
  resolvedById?: string | null;
  resolutionNotes?: string | null;
  
  reportedAt: string;
  resolvedAt?: string | null;
  
  createdAt: string;
  updatedAt: string;
}
