export const TRIP_STATUS = {
  SCHEDULED: 'SCHEDULED',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;

export type TripStatus = typeof TRIP_STATUS[keyof typeof TRIP_STATUS];

export const TRIP_DIRECTION = {
  MORNING: 'MORNING', // Home -> College
  RETURN: 'RETURN', // College -> Home
} as const;

export type TripDirection = typeof TRIP_DIRECTION[keyof typeof TRIP_DIRECTION];

export interface Trip {
  id: string; // Often derived: `routeId_YYYYMMDD_MORNING`
  routeId: string;
  busId: string;
  driverId: string;
  date: string; // YYYY-MM-DD
  direction: TripDirection;
  status: TripStatus;
  
  startedAt?: string;
  endedAt?: string;
  currentStopId?: string | null;
  
  expectedCount: number;
  boardedCount: number;
  absentCount: number;
  
  incidentsReported: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GPSPing {
  busId: string;
  tripId?: string;
  lat: number;
  lng: number;
  speed: number;    // km/h, used for map point interpolation
  heading: number;  // 0-360 degrees, used for marker rotation
  accuracy: number; // in metres
  timestamp: number; // unix ms
}

export interface TripSummary {
  id: string;
  tripId: string;
  busId: string;
  routeId: string;
  date: string;
  direction: TripDirection;
  
  startTime: string;
  endTime: string;
  durationMinutes: number;
  maxDelayMinutes: number;
  
  // Aggregate of GPS pings across the trip, compressed for history
  path: Array<{ lat: number; lng: number; speed: number; ts: number }>;
  
  createdAt: string;
}
