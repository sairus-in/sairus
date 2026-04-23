import { prisma } from '../../lib/prisma';
import { redis } from '../../lib/redis';
import { firebaseAdmin } from '../../lib/firebase';
import { io } from '../../websocket/socket';
import { getDistanceMetres, GPS } from 'shared';
import { delegateService } from '../trips/delegate.service';
import { logger } from '../../lib/logger';
import { metrics } from '../../lib/metrics';

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
  private gpsBuffer: any[] = [];
  
  constructor() {
    setInterval(async () => {
      if (this.gpsBuffer.length === 0) return;
      const batch = [...this.gpsBuffer];
      this.gpsBuffer = [];
      await prisma.gpsLog.createMany({ data: batch });
      logger.info({ event: 'gps_batch_flushed', meta: { count: batch.length }, source: 'SYSTEM' });
    }, 5000);
  }

  private async queueGPSForPersistence(log: any) {
    this.gpsBuffer.push(log);
    if (this.gpsBuffer.length > 100) {
      const batch = [...this.gpsBuffer];
      this.gpsBuffer = [];
      await prisma.gpsLog.createMany({ data: batch });
    }
  }

  async processPing(payload: GPSPingPayload) {
    const { userId, busId, tripId, lat, lon, speed, heading, accuracy, timestamp } = payload;
    const operationId = `ping-${busId}-${timestamp}`;

    let source: 'DRIVER' | 'DELEGATE' = 'DRIVER';

    // Source Validation (Hardened Change 6)
    if (tripId) {
      const trip = await prisma.trip.findUnique({ where: { id: tripId } });
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

    const liveState = {
      lat, lon, speed, heading, accuracy,
      gpsStatus: 'LIVE', lastUpdated: timestamp, source,
      delegateActive: source === 'DELEGATE',
    };

    await redis.set(`gps:heartbeat:${busId}`, Date.now().toString(), 'EX', GPS.HEARTBEAT_TTL_SECONDS);
    await redis.setex(`bus:${busId}:live`, 120, JSON.stringify(liveState));
    await redis.setex(`bus:${busId}:lastPosition`, 300, JSON.stringify({ lat, lon }));

    if (firebaseAdmin) {
      await firebaseAdmin.database().ref(`/buses/${busId}`).update(liveState);
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
    const { count } = await prisma.gpsLog.deleteMany({
      where: { timestamp: { lt: cutoff } },
    });
    return count;
  }
}

export const gpsService = new GpsService();
