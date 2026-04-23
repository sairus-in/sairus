// services/driver.service.ts — All driver-facing API calls.
// RULE: This is the ONLY place driver API calls exist.
// Hooks consume these. Screens consume hooks. No exceptions.

import { api } from '../lib/api.client';
import { validateResponse, DriverTodayResponseSchema } from 'shared';

// ─── Request/Response Types ─────────────────────────────────

export interface DriverTodayAssignment {
  trip: {
    id: string;
    busId: string;
    routeId: string;
    type: 'MORNING' | 'RETURN';
    status: 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
    scheduledDeparture: string | null;
    minutesLate: number;
  } | null;
  bus: {
    number: string;
  } | null;
  route: {
    name: string;
  } | null;
  expectedStudents: number;
}

export interface StartTripPayload {
  tripId: string;
  lat: number;
  lon: number;
}

export interface TripSummaryResponse {
  boardedCount: number;
  expectedCount: number;
  startedAt: string | null;
  arrivedAt: string | null;
  duration: string | null;
  absentStudents: Array<{
    id: string;
    name: string;
    rollNumber: string;
    reason: string;
  }>;
  date: string;
}

export interface RouteStop {
  id: string;
  name: string;
  order: number;
  studentCount: number;
}

export interface BreakdownPayload {
  tripId: string;
  incidentType: string;
  description?: string;
  lat: number;
  lon: number;
}

// ─── Service ────────────────────────────────────────────────

export const driverService = {
  /** GET /v1/driver/today-assignment — Pre-trip screen data. */
  getTodayAssignment: async (): Promise<DriverTodayAssignment> => {
    const response = await api.get('/v1/driver/today-assignment');
    const rawData = response.data?.data ?? response.data;
    return validateResponse(DriverTodayResponseSchema, rawData, 'DriverTodayAssignment') as unknown as DriverTodayAssignment;
  },

  /** PATCH /v1/trips/:tripId/start — Start the morning/return trip. */
  startTrip: async (payload: StartTripPayload) => {
    const { data } = await api.patch(`/v1/trips/${payload.tripId}/start`, {});
    return data;
  },

  /** POST /v1/trips/:tripId/end — End an active trip. */
  endTrip: async (tripId: string) => {
    const { data } = await api.post(`/v1/trips/${tripId}/end`);
    return data;
  },

  /** GET /v1/driver/trip-summary/:tripId — Trip completion summary. */
  getTripSummary: async (tripId: string): Promise<TripSummaryResponse> => {
    const { data } = await api.get(`/v1/driver/trip-summary/${tripId}`);
    return data?.data ?? data;
  },

  /** GET /v1/driver/route-stops — All stops on the driver's assigned route. */
  getRouteStops: async (): Promise<RouteStop[]> => {
    const { data } = await api.get('/v1/driver/route-stops');
    return data?.stops ?? data?.data ?? data;
  },

  /** POST /v1/incidents/report — Report a breakdown or incident. */
  reportBreakdown: async (payload: BreakdownPayload) => {
    const { data } = await api.post('/v1/incidents/report', payload);
    return data;
  },
};
