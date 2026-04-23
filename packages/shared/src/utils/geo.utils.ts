// packages/shared/src/utils/geo.utils.ts
// Canonical geofence evaluation — used identically on backend and mobile.
// lon not lng — locked everywhere.

import { GEOFENCE } from '../constants';

export function getDistanceMetres(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R  = 6_371_000; // Earth radius in metres
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a  = Math.sin(Δφ / 2) ** 2 +
             Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type GeofenceStatus = 'PRESENT' | 'LATE_BOARD' | 'FAIL';
export type GeofenceMethod = 'BUS' | 'STOP' | 'BOTH' | null;

export interface GeofenceResult {
  status:         GeofenceStatus;
  method:         GeofenceMethod;
  distanceToBus:  number | null;   // rounded metres, null if no bus GPS
  distanceToStop: number;          // rounded metres
}

/**
 * 3-tier geofence evaluation:
 *   PRESENT   — within HARD_RADIUS (100m) of bus OR stop
 *   LATE_BOARD — within SOFT_RADIUS (150m), but outside HARD_RADIUS
 *   FAIL      — beyond SOFT_RADIUS (> 150m) — hard reject
 *
 * busLat/busLon may be null if GPS is offline — in that case only stop distance is used.
 */
export function evaluateCheckin(
  lat: number,
  lon: number,
  busLat:     number | null,
  busLon:     number | null,
  stopLat:    number,
  stopLon:    number,
  hardRadius  = GEOFENCE.HARD_RADIUS_METRES,
  softRadius  = GEOFENCE.SOFT_RADIUS_METRES,
): GeofenceResult {
  const distanceToStop = getDistanceMetres(lat, lon, stopLat, stopLon);
  const distanceToBus  = busLat !== null && busLon !== null
    ? getDistanceMetres(lat, lon, busLat, busLon)
    : null;

  const minDistance = Math.min(distanceToBus ?? Infinity, distanceToStop);

  const nearBus  = distanceToBus !== null && distanceToBus <= hardRadius;
  const nearStop = distanceToStop <= hardRadius;
  const method: GeofenceMethod =
    nearBus && nearStop ? 'BOTH' : nearBus ? 'BUS' : nearStop ? 'STOP' : null;

  const status: GeofenceStatus =
    minDistance <= hardRadius ? 'PRESENT' :
    minDistance <= softRadius ? 'LATE_BOARD' :
    'FAIL';

  return {
    status,
    method,
    distanceToBus:  distanceToBus !== null ? Math.round(distanceToBus) : null,
    distanceToStop: Math.round(distanceToStop),
  };
}

/**
 * Checks if a coordinate is within the college gate radius.
 * Used for arrival verification feature.
 */
export function isAtCollegeGate(
  lat: number,
  lon: number,
  radiusMetres = GEOFENCE.COLLEGE_GATE_RADIUS_METRES,
): boolean {
  const distance = getDistanceMetres(
    lat, lon,
    GEOFENCE.COLLEGE_GATE_LAT,
    GEOFENCE.COLLEGE_GATE_LON,
  );
  return distance <= radiusMetres;
}
