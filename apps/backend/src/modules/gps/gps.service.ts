import { Prisma } from '@prisma/client';
import { redis } from '../../lib/redis';
import { firebaseAdmin } from '../../lib/firebase';
import { io } from '../../websocket/socket';
import { getDistanceMetres, GPS } from 'shared';
import { delegateService } from '../trips/delegate.service';
import { logger } from '../../lib/logger';
import { metrics } from '../../lib/metrics';
import { gpsRepository, GpsRepository } from './gps.repository';
import { circuitExecute } from '../../lib/redis-circuit';
import { getRouteAssignmentCached } from '../../lib/cache';

export interface GPSPingPayload {
  userId: string;
  busId: string;
  tripId?: string;
  lat: number;
  lon: number;
  speed: number;
  heading: number;
  accuracy: number;
  timestamp: number; // unix ms from device
  isDelegated?: boolean;
}

export class GpsService {

  // [HARDENED Change 7] Batch GPS persistence
  private gpsBuffer: Prisma.GpsLogCreateManyInput[] = [];
  private readonly repository: GpsRepository;

  constructor(repository: GpsRepository = gpsRepository) {
    this.repository = repository;
    setInterval(async () => {
      if (this.gpsBuffer.length === 0) return;
      const batch = [...this.gpsBuffer];
      this.gpsBuffer = [];
      await this.repository.createManyGpsLogs(batch);
      logger.info({ event: 'gps_batch_flushed', meta: { count: batch.length }, source: 'SYSTEM' });
    }, 5000);
  }

  private async queueGPSForPersistence(log: Prisma.GpsLogCreateManyInput) {
    this.gpsBuffer.push(log);
    if (this.gpsBuffer.length > 100) {
      const batch = [...this.gpsBuffer];
      this.gpsBuffer = [];
      await this.repository.createManyGpsLogs(batch);
    }
  }

  async processPing(payload: GPSPingPayload) {
    const { userId, busId, tripId, lat, lon, speed, heading, accuracy, timestamp } = payload;
    const operationId = `ping-${busId}-${timestamp}`;

    let source: 'DRIVER' | 'DELEGATE' = 'DRIVER';

    // Source Validation (Hardened Change 6)
    if (tripId) {
      const trip = await this.repository.findTripById(tripId);
      if (!trip) {
        await metrics.inc('gps_ping_rejected_total', { reason: 'TRIP_NOT_FOUND' });
        return { accepted: false, reason: 'TRIP_NOT_FOUND' };
      }

      const activeDelegateStr = await redis.get(`trip:delegate:${tripId}`);
      if (activeDelegateStr) {
        const delegate = JSON.parse(activeDelegateStr);
        if (userId === trip.driverId) {
          const driverPingCount = await redis.incr(`trip:driver:return:${tripId}`);
          await redis.expire(`trip:driver:return:${tripId}`, 15);

          if (driverPingCount >= 2) {
            await redis.del(`trip:driver:return:${tripId}`);
            await delegateService.handleDriverReturn(tripId, busId, delegate.userId, operationId);
            source = 'DRIVER';
          } else {
            source = 'DELEGATE';
            logger.info({
              event: 'driver_return_ping_1_of_2',
              tripId, busId, userId, operationId, source: 'DRIVER'
            });
          }
        } else if (userId === delegate.userId) {
          source = 'DELEGATE';
          // Explicit heartbeat tracking for Phase 3 monitor
          await redis.set(`trip:delegate:heartbeat:${tripId}`, String(Date.now()));
          await redis.set(`trip:delegate:health:${tripId}`, 'LIVE');
        } else {
          logger.warn({
            event: 'gps_ping_rejected_unknown_source',
            tripId, busId, userId, operationId, source: 'SYSTEM'
          });
          await metrics.inc('gps_ping_rejected_total', { reason: 'NOT_AUTHORIZED_GPS_SOURCE' });
          return { accepted: false, reason: 'NOT_AUTHORIZED_GPS_SOURCE' };
        }
      } else {
        if (userId !== trip.driverId) {
          await metrics.inc('gps_ping_rejected_total', { reason: 'NOT_THE_DRIVER' });
          return { accepted: false, reason: 'NOT_THE_DRIVER' };
        }
        source = 'DRIVER';
      }
    }

    const lastPosStr = await redis.get(`bus:${busId}:lastPosition`);
    if (lastPosStr) {
      const last = JSON.parse(lastPosStr);
      const moved = getDistanceMetres(last.lat, last.lon, lat, lon);
      if (moved < 5) {
        await metrics.inc('gps_ping_rejected_total', { reason: 'DELTA_TOO_SMALL' });
        return { accepted: false, reason: 'DELTA_TOO_SMALL' };
      }
    }

    // Compute ETA and distance for active trip
    let etaMin: number | null = null;
    let distanceRemainingM: number | null = null;

    if (tripId) {
      const etaDistance = await this.computeTripEtaDistance(busId, tripId, lat, lon, speed);
      if (etaDistance) {
        etaMin = etaDistance.etaMin;
        distanceRemainingM = etaDistance.distanceRemainingM;
      }
    }

    const liveState = {
      lat, lon, speed, heading, accuracy,
      gpsStatus: 'LIVE', lastUpdated: timestamp, source,
      delegateActive: source === 'DELEGATE',
      etaMin,
      distanceRemainingM,
    };

    await redis.set(`gps:heartbeat:${busId}`, Date.now().toString(), 'EX', GPS.HEARTBEAT_TTL_SECONDS);
    await redis.setex(`bus:${busId}:live`, 120, JSON.stringify(liveState));
    await redis.setex(`bus:${busId}:lastPosition`, 300, JSON.stringify({ lat, lon }));

    const firebase = firebaseAdmin;
    if (firebase) {
      await circuitExecute(
        () => firebase.database().ref(`/buses/${busId}`).update(liveState),
        'skip_silent',
        async () => undefined,
        'firebase-rtdb-gps',
      );
    }

    if (io) {
      io.to(`bus:${busId}`).emit('gps:update', liveState);
      io.to('admin').emit('gps:position', {
        busId,
        lat,
        lon,
        speed,
        heading,
        gpsStatus: 'LIVE',
      });
    }

    await this.queueGPSForPersistence({
      busId, tripId: tripId ?? null,
      lat, lon, speed, heading, accuracy,
      timestamp: new Date(timestamp),
      providedBy: source, providerId: userId,
    });

    await metrics.inc('gps_pings_received_total', { source });
    
    return { accepted: true, source };
  }

  /**
   * Purge GPS logs older than GPS.RETENTION_DAYS (30 days).
   * Called by the nightly gps-cleanup Cloud Tasks job.
   */
  async purgeOldLogs(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - GPS.RETENTION_DAYS);
    return this.repository.deleteLogsOlderThan(cutoff);
  }

  /**
   * Compute ETA and distance remaining for a trip's assigned student.
   * Uses Redis cache for stop data (TTL 5 min).
   */
  private async computeTripEtaDistance(
    busId: string,
    tripId: string,
    busLat: number,
    busLon: number,
    busSpeed: number,
  ): Promise<{ etaMin: number; distanceRemainingM: number } | null> {
    try {
      // Get cached route stops for this trip
      const cacheKey = `trip:${tripId}:stops`;
      let stopsData = await redis.get(cacheKey);

      let stops: Array<{ stopId: string; lat: number; lon: number; sequence: number }>;
      if (stopsData) {
        stops = JSON.parse(stopsData);
      } else {
        // Fetch from DB and cache
        const trip = await this.repository.findTripWithRouteStops(tripId);
        if (!trip?.route?.stops) return null;

        stops = trip.route.stops
          .sort((a, b) => a.sequence - b.sequence)
          .map(rs => ({
            stopId: rs.stopId,
            lat: rs.stop!.lat,
            lon: rs.stop!.lon,
            sequence: rs.sequence,
          }));

        await redis.setex(cacheKey, 300, JSON.stringify(stops));
      }

      if (stops.length === 0) return null;

      // Get student's assigned stop (first, assuming single-stop assignment)
      const assignmentCacheKey = `trip:${tripId}:studentStopId`;
      let studentStopId = await redis.get(assignmentCacheKey);

      if (!studentStopId) {
        // Try to find via active bus assignment route
        const trip = await this.repository.findTripById(tripId);
        if (!trip?.routeId) return null;

        // Get route assignments - find first student's stop
        const routeAssignments = await this.repository.findRouteAssignments(trip.routeId);
        if (routeAssignments.length === 0) return null;

        // Use first assigned stop as the target for ETA calculation
        studentStopId = routeAssignments[0].stopId;
        await redis.setex(assignmentCacheKey, 300, studentStopId);
      }

      // Find student's stop in the stops array
      const targetStop = stops.find(s => s.stopId === studentStopId);
      if (!targetStop) return null;

      // Calculate distance from bus to target stop
      const distanceToTarget = getDistanceMetres(busLat, busLon, targetStop.lat, targetStop.lon);

      // Calculate distance for remaining stops after the bus
      let distanceRemaining = 0;
      let passedBus = false;
      for (const stop of stops) {
        if (stop.stopId === studentStopId) {
          distanceRemaining = getDistanceMetres(busLat, busLon, stop.lat, stop.lon);
          break;
        }
        // Check if bus has passed this stop using 200m proximity
        const distToStop = getDistanceMetres(busLat, busLon, stop.lat, stop.lon);
        if (distToStop < 200) {
          passedBus = true;
        }
        if (passedBus) {
          // Sum distances from this stop to target
          const nextStops = stops.slice(stops.indexOf(stop) + 1);
          for (const ns of nextStops) {
            if (ns.stopId === studentStopId) {
              distanceRemaining = getDistanceMetres(stop.lat, stop.lon, ns.lat, ns.lon);
              break;
            }
            const nextDist = getDistanceMetres(stop.lat, stop.lon, ns.lat, ns.lon);
            distanceRemaining += nextDist;
          }
          if (distanceRemaining > 0) break;
        }
      }

      if (distanceRemaining === 0) {
        distanceRemaining = distanceToTarget;
      }

      // Compute ETA: distance / speed (min 5 m/s for safety) / 60
      const minSpeedMs = Math.max(busSpeed / 3.6, 5); // convert km/h to m/s, min 5 m/s
      const etaMinutes = Math.max(1, Math.round(distanceRemaining / minSpeedMs / 60));

      logger.info({
        event: 'gps_eta_computed',
        tripId,
        busId,
        source: 'SYSTEM',
        meta: {
          distanceRemainingM: Math.round(distanceRemaining),
          etaMin: etaMinutes,
        },
      });

      return { etaMin: etaMinutes, distanceRemainingM: Math.round(distanceRemaining) };
    } catch (error) {
      logger.warn({
        event: 'gps_eta_compute_error',
        tripId,
        busId,
        source: 'SYSTEM',
      }, { error: String(error) });
      return null;
    }
  }
}

export const gpsService = new GpsService();
