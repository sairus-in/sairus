// DEV ONLY — Axios adapter that intercepts all API calls when a dev_token_* is
// active and returns realistic mock responses. Never bundled in production
// because every call-site is guarded by `if (__DEV__)`.
//
// Return shape: the full backend envelope { success, data, timestamp } so that
// parseEnvelope() and the driver-service data-access patterns both work
// identically to real API responses.

import type { InternalAxiosRequestConfig } from 'axios';

// ── Shared dev IDs ────────────────────────────────────────────────────────────
const DEV_TRIP_ID    = 'dev_trip_001';
const DEV_BUS_ID     = 'dev_bus_001';
const DEV_ROUTE_ID   = 'dev_route_001';
const DEV_STOP_ID    = 'dev_stop_001';

const now = () => new Date().toISOString();
const today = () => new Date().toISOString().split('T')[0];

// Wraps data in the standard backend success envelope
const ok = (data: unknown) => ({
  success: true,
  data,
  timestamp: now(),
});

// ── Mock data factories ───────────────────────────────────────────────────────

function studentHome() {
  return ok({
    screenState: {
      status: 'trip_active',
      tripId: DEV_TRIP_ID,
      busId:  DEV_BUS_ID,
      canCheckIn: true,
      busEta: null,
      distanceRemainingM: null,
    },
    meta: {
      studentName: 'Dev Student',
      avatarUrl:   null,
      resolvedAt:  now(),
    },
    student: {
      id:         'dev_student_001',
      name:       'Dev Student',
      rollNumber: 'DEV-001',
      department: 'Computer Science',
      year:       3,
      routeId:    DEV_ROUTE_ID,
      routeName:  'Route A',
      stopId:     DEV_STOP_ID,
      stopName:   'Main Gate',
      busId:      DEV_BUS_ID,
      busNumber:  'KA-01-DEV-42',
    },
    transport: {
      trip: {
        id:                  DEV_TRIP_ID,
        type:                'MORNING',
        status:              'ACTIVE',
        routeName:           'Route A',
        busId:               DEV_BUS_ID,
        busNumber:           'KA-01-DEV-42',
        driverName:          'Dev Driver',
        gpsStatus:           'LIVE',
        expectedCount:       24,
        boardedCount:        18,
        scheduledDeparture:  '07:30',
        minutesLate:         0,
        canCheckIn:          true,
        checkInReason:       null,
        isSubstitute:        false,
        originalBusNumber:   null,
        substituteInfo:      null,
      },
      attendance: {
        today:           null,
        checkedInAt:     null,
        busNumber:       null,
        arrivalVerified: null,
      },
      history: {
        presentCount:       18,
        absentCount:         2,
        percentage:         90,
        pendingCorrections:  0,
      },
      alerts: {
        yesterdayAbsent:    false,
        yesterdayDate:      null,
        substituteAssigned: false,
      },
      routeGeometry: null,
    },
    features: {
      hasAssignment:      true,
      canCheckIn:         true,
      canSkipToday:       false,
      canUseLiveMap:      true,
      canRequestCorrection: false,
    },
  });
}

function attendanceHistory() {
  const dates = [0, 1, 2, 3, 4, 5, 6].map((n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
  });

  return ok({
    data: [
      { id: 'dev_log_001', date: dates[0], status: 'PRESENT',  checkedInAt: `${dates[0]}T07:28:00.000Z`, busNumber: 'KA-01-DEV-42', tripType: 'MORNING' },
      { id: 'dev_log_002', date: dates[1], status: 'ABSENT',   checkedInAt: null,                         busNumber: null,             tripType: 'MORNING' },
      { id: 'dev_log_003', date: dates[2], status: 'PRESENT',  checkedInAt: `${dates[2]}T07:31:00.000Z`, busNumber: 'KA-01-DEV-42', tripType: 'MORNING' },
      { id: 'dev_log_004', date: dates[3], status: 'PRESENT',  checkedInAt: `${dates[3]}T07:29:00.000Z`, busNumber: 'KA-01-DEV-42', tripType: 'MORNING' },
      { id: 'dev_log_005', date: dates[4], status: 'LATE_BOARD', checkedInAt: `${dates[4]}T07:45:00.000Z`, busNumber: 'KA-01-DEV-42', tripType: 'MORNING' },
      { id: 'dev_log_006', date: dates[5], status: 'ABSENT',   checkedInAt: null,                         busNumber: null,             tripType: 'MORNING' },
      { id: 'dev_log_007', date: dates[6], status: 'PRESENT',  checkedInAt: `${dates[6]}T07:27:00.000Z`, busNumber: 'KA-01-DEV-42', tripType: 'MORNING' },
    ],
    pagination: { page: 1, limit: 20, total: 7, hasMore: false },
  });
}

function attendanceLog(logId: string) {
  return ok({
    id:             logId,
    date:           today(),
    status:         'PRESENT',
    checkedInAt:    `${today()}T07:28:00.000Z`,
    busNumber:      'KA-01-DEV-42',
    tripType:       'MORNING',
    distanceToBus:  12,
    distanceToStop: 8,
  });
}

function driverAssignment() {
  return ok({
    trip: {
      id:                  DEV_TRIP_ID,
      busId:               DEV_BUS_ID,
      routeId:             DEV_ROUTE_ID,
      type:                'MORNING',
      status:              'SCHEDULED',
      scheduledDeparture:  '07:30',
      minutesLate:         0,
    },
    bus:              { number: 'KA-01-DEV-42' },
    route:            { name: 'Route A' },
    expectedStudents: 24,
  });
}

function routeStops() {
  // Driver service reads data?.stops ?? data?.data ?? data.
  // The mock returns ok([...]) so data.data = [...] which resolves correctly.
  return ok([
    { id: 'dev_stop_001', name: 'Main Gate',     order: 1, studentCount: 8  },
    { id: 'dev_stop_002', name: 'North Campus',  order: 2, studentCount: 10 },
    { id: 'dev_stop_003', name: 'Library Block', order: 3, studentCount: 6  },
  ]);
}

function tripSummary() {
  return ok({
    boardedCount:    18,
    expectedCount:   24,
    startedAt:       `${today()}T07:30:00.000Z`,
    arrivedAt:       `${today()}T08:15:00.000Z`,
    duration:        '45 min',
    absentStudents:  [],
    date:            today(),
  });
}

// ── Route matcher ─────────────────────────────────────────────────────────────

type MockHandler = (url: string) => unknown;

const ROUTES: Array<{ pattern: RegExp; methods: string[]; handler: MockHandler }> = [
  // Student home
  { pattern: /^\/v1\/student\/home$/,             methods: ['get'],         handler: () => studentHome() },
  // Attendance
  { pattern: /^\/v1\/attendance\/history$/,       methods: ['get'],         handler: () => attendanceHistory() },
  { pattern: /^\/v1\/attendance\/logs\/[^/]+$/,   methods: ['get'],         handler: (u) => attendanceLog(u.split('/').pop() ?? 'dev_log_001') },
  { pattern: /^\/v1\/attendance\/checkin$/,       methods: ['post'],        handler: () => ok({ attendanceStatus: 'PRESENT', checkedInAt: now(), distanceToBus: 12, distanceToStop: 8 }) },
  { pattern: /^\/v1\/attendance\/corrections$/,   methods: ['post'],        handler: () => ok({ id: 'dev_correction_001', status: 'PENDING' }) },
  { pattern: /^\/v1\/attendance\/skip-today$/,    methods: ['post'],        handler: () => ok({ ok: true }) },
  { pattern: /^\/v1\/attendance\/self-report$/,   methods: ['post'],        handler: () => ok({ success: true, attendanceStatus: 'PRESENT', id: 'dev_sr_001' }) },
  { pattern: /^\/v1\/attendance\/verify-arrival$/,methods: ['post'],        handler: () => ok({ ok: true }) },
  // Driver
  { pattern: /^\/v1\/driver\/today-assignment$/,  methods: ['get'],         handler: () => driverAssignment() },
  { pattern: /^\/v1\/driver\/route-stops$/,       methods: ['get'],         handler: () => routeStops() },
  { pattern: /^\/v1\/driver\/trip-summary\/[^/]+$/,methods: ['get'],        handler: () => tripSummary() },
  // Trip actions
  { pattern: /^\/v1\/trips\/[^/]+\/start$/,       methods: ['patch','post'],handler: () => ok({ tripId: DEV_TRIP_ID, status: 'ACTIVE',    startedAt: now() }) },
  { pattern: /^\/v1\/trips\/[^/]+\/end$/,         methods: ['post'],        handler: () => ok({ tripId: DEV_TRIP_ID, status: 'COMPLETED', endedAt:   now() }) },
  // GPS + incidents
  { pattern: /^\/v1\/gps\/ping$/,                 methods: ['post'],        handler: () => ok({ ok: true }) },
  { pattern: /^\/v1\/incidents\/report$/,         methods: ['post'],        handler: () => ok({ id: 'dev_incident_001', status: 'REPORTED' }) },
];

// ── Adapter ───────────────────────────────────────────────────────────────────

// Simulates ~100ms network round-trip so loading states render naturally
const MOCK_DELAY_MS = 100;

export async function devMockAdapter(config: InternalAxiosRequestConfig): Promise<{
  data: unknown;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  config: InternalAxiosRequestConfig;
  request: Record<string, never>;
}> {
  await new Promise<void>((r) => setTimeout(r, MOCK_DELAY_MS));

  const url    = config.url ?? '';
  const method = (config.method ?? 'get').toLowerCase();

  for (const { pattern, methods, handler } of ROUTES) {
    if (pattern.test(url) && methods.includes(method)) {
      return {
        data:       handler(url),
        status:     200,
        statusText: 'OK',
        headers:    { 'content-type': 'application/json' },
        config,
        request:    {},
      };
    }
  }

  throw new Error(`[DEV MOCK] Unmocked endpoint: ${method.toUpperCase()} ${url} — add a handler to dev-api-mock.ts`);
}
