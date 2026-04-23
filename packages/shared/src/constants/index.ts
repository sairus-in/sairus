// packages/shared/src/constants/index.ts
// Single source of truth for all system-wide constants.
// Import from here — never hardcode values in services.

export const GEOFENCE = {
  HARD_RADIUS_METRES: 100,
  SOFT_RADIUS_METRES: 150,   // set equal to HARD to disable soft zone after calibration
  ACCURACY_WARNING_THRESHOLD: 50, // m — warn student if GPS accuracy is poor
  COLLEGE_GATE_RADIUS_METRES: 500,
  COLLEGE_GATE_LAT: 12.9900,  // UPDATE to actual college gate coordinates before go-live
  COLLEGE_GATE_LON: 80.1700,
} as const;

export const QR = {
  JWT_EXPIRY_SECONDS: 35,
  REDIS_TTL_SECONDS: 40,          // 5s grace beyond JWT expiry
  REFRESH_PUSH_AT_SECONDS: 25,    // push new QR to kiosk at t=25s
  GRACE_PERIOD_MS: 5_000,
} as const;

export const ARRIVAL_VERIFICATION = {
  PUSH_FALLBACK_DELAY_MS: 2 * 60 * 1000,   // 2 minutes after gate:reached
  VERIFICATION_WINDOW_MS: 7 * 60 * 1000,   // 7 minutes total window
  PUSH_TITLE: 'Confirm your arrival',
  PUSH_BODY: "Tap to verify you've reached college — takes 2 seconds",
} as const;

export const GPS = {
  HEARTBEAT_TTL_SECONDS: 120,
  OFFLINE_THRESHOLD_MS: 90_000,    // 90 seconds without ping = OFFLINE
  DELTA_MIN_METRES: 5,             // skip Firebase write if moved less than 5m
  PING_MOVING_MS: 3_000,           // 3s interval when speed > 5 km/h
  PING_SLOW_MS: 15_000,            // 15s when speed <= 5 km/h
  PING_PARKED_MS: 60_000,          // 60s when stationary for 5+ minutes
  RETENTION_DAYS: 30,
} as const;

export const TRIP = {
  LATE_START_ALERT_MINUTES: 10,  // alert admin if trip not started 10min past schedule
  OFFLINE_QUEUE_MAX_AGE_MS: 90 * 60 * 1000, // 90 minute mobile pre-filter for offline queue
  OUTAGE_ESCALATION_DELAY_MS: 10 * 60 * 1000,   // 10 minutes
  OUTAGE_PENDING_WINDOW_MS: 2 * 60 * 60 * 1000, // 2 hours
  SELF_REPORT_REDIS_TTL_SECONDS: 4 * 60 * 60,   // 4 hours
  OUTAGE_WINDOW_REDIS_TTL_SECONDS: 3 * 60 * 60, // 3 hours
} as const;

export const CACHE_TTL = {
  ACTIVE_TRIP_SECONDS: 300,        // 5 minutes
  ROUTE_ASSIGNMENT_SECONDS: 3600,  // 1 hour
  BUS_ASSIGNMENT_SECONDS: 3600,
} as const;

// IST timezone identifier — used in all date formatting
export const IST_TIMEZONE = 'Asia/Kolkata';

export * from './auth-audit';
