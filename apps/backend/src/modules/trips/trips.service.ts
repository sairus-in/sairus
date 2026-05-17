import { redis } from '../../lib/redis';
import { logger } from '../../lib/logger';
import { getISODateIST, getTomorrowDayOfWeekIST, CACHE_TTL, TRIP } from 'shared';
import {
  cacheDel,
  cacheHIncrBy,
  cacheHSet,
  cacheSAdd,
  cacheSRem,
  clearActiveTripCache,
  setActiveTripCache,
} from '../../lib/cache';
import { auditService, AuditActorContext } from '../../lib/audit.service';
import { BadRequestError, ForbiddenError } from '../../lib/errors';
import { cloudTasksClient, queuePath, BACKEND_URL } from '../../lib/cloud-tasks';
import { env } from '../../lib/env';
import { notificationsService } from '../notifications/notifications.service';
import { tripsRepository } from './trips.repository';
import { attendanceService } from '../attendance/attendance.service';
import { io } from '../../websocket/socket';

export class TripsService {

  /**
   * Driver starts a pre-created SCHEDULED trip.
   * Sets Redis active trip cache on success.
   */
  async startTrip(tripId: string, driverId: string) {
    // Validate trip exists and belongs to driver
    const trip = await tripsRepository.getTripById(tripId);
    if (!trip) throw new BadRequestError('TRIP_NOT_FOUND');
    if (trip.driver.id !== driverId) throw new ForbiddenError('NOT_YOUR_TRIP');
    if (trip.status === 'ACTIVE') return trip; // idempotent
    if (trip.status !== 'SCHEDULED') throw new BadRequestError('TRIP_CANNOT_START');

    // Update trip status
    const updated = await tripsRepository.startTrip(tripId);

    // Cache the active trip in Redis — all check-ins will hit this
    await setActiveTripCache(trip.busId, trip.id);

    // Seed Admin Panel Dashboard Stats
    const startedAtMs = updated.startedAt?.getTime() ?? Date.now();
    await cacheSAdd('active-trips', tripId);
    await redis.zadd('active-trips:z', startedAtMs, tripId);
    await redis.zadd(`active-trips:z:route:${updated.route.id}`, startedAtMs, tripId);
    await redis.sadd('active-trips:route-ids', updated.route.id);
    await cacheHIncrBy('dashboard:stats', 'activeTrips', 1);
    await cacheHSet(`trip:${tripId}:state`, {
      status: 'ACTIVE', 
      boardedCount: 0, 
      gpsStatus: 'LIVE',
      startedAt: startedAtMs,
      busId: updated.bus.id,
      routeId: updated.route.id,
      busNumber: updated.bus.number, 
      routeName: updated.route.name, 
      driverName: updated.driver.name, 
      expectedCount: updated.expectedCount
    });

    if (io) {
      const payload = {
        tripId: updated.id,
        busId: updated.bus.id,
        routeId: updated.route.id,
        startedAt: updated.startedAt?.toISOString() ?? new Date().toISOString(),
      };

      io.to('admin').emit('trip:started', payload);
      io.to(`route:${updated.route.id}`).emit('trip:started', payload);
    }

    return updated;
  }

  /**
   * Driver ends an active trip.
   * Clears Redis cache and schedules absent-marking job (Cloud Tasks).
   */
  async endTrip(tripId: string, driverId: string, auditActor?: AuditActorContext) {
    // Validate trip and ownership
    const trip = await tripsRepository.getTripById(tripId);
    if (!trip) throw new BadRequestError('TRIP_NOT_FOUND');
    if (trip.driver.id !== driverId) throw new ForbiddenError('NOT_YOUR_TRIP');
    if (trip.status === 'COMPLETED') return trip;
    if (trip.status !== 'ACTIVE') throw new BadRequestError('TRIP_NOT_ACTIVE');

    // Update trip status
    const completed = await tripsRepository.endTrip(tripId);

    // Clear Redis cache
    await clearActiveTripCache(trip.busId);

    // Admin Dashboard Cleanup
    await cacheSRem('active-trips', tripId);
    await redis.zrem('active-trips:z', tripId);
    await redis.zrem(`active-trips:z:route:${trip.routeId}`, tripId);
    if ((await redis.zcard(`active-trips:z:route:${trip.routeId}`)) === 0) {
      await redis.srem('active-trips:route-ids', trip.routeId);
    }
    await cacheHIncrBy('dashboard:stats', 'activeTrips', -1);
    await cacheDel(`trip:${tripId}:state`);

    // Handle GPS Outage Fallback Logic (Step 2)
    if (completed.gpsOutageStart) {
      const delaySeconds = Math.floor(TRIP.OUTAGE_PENDING_WINDOW_MS / 1000);
      const url = `${BACKEND_URL}/v1/jobs/gps-outage-absent/${tripId}`;
      const outageMinutes = Math.floor((completed.endedAt!.getTime() - completed.gpsOutageStart.getTime()) / 60000);

      await cloudTasksClient.createTask({
        parent: queuePath,
        task: {
          scheduleTime: { seconds: Math.floor(Date.now() / 1000) + delaySeconds },
          httpRequest: {
            httpMethod: 'POST',
            url,
            headers: {
              'Content-Type': 'application/json',
              'x-cloud-tasks-secret': env.CLOUD_TASKS_SECRET || 'dev-secret',
            },
            body: Buffer.from(JSON.stringify({ outageMinutes })).toString('base64'),
          }
        }
      });

      await redis.setex(`trip:outage-window:${tripId}`, TRIP.OUTAGE_WINDOW_REDIS_TTL_SECONDS, '1');

      console.info(JSON.stringify({
        event: 'gps_outage_pending_window_opened',
        tripId,
        outageMinutes
      }));

      const pendingLogs = await tripsRepository.getPendingStudentLogs(tripId);
      await notificationsService.notifyUncheckedStudents(
        pendingLogs.map(l => l.userId),
        trip.bus.number,
        tripId,
      );

    } else {
      // Normal path — schedule mark-absent immediately
      const url = `${BACKEND_URL}/v1/jobs/mark-absent`;
      await cloudTasksClient.createTask({
        parent: queuePath,
        task: {
          httpRequest: {
            httpMethod: 'POST',
            url,
            headers: {
              'Content-Type': 'application/json',
              'x-cloud-tasks-secret': env.CLOUD_TASKS_SECRET || 'dev-secret'
            },
            body: Buffer.from(JSON.stringify({ tripId })).toString('base64'),
          }
        }
      });
      console.info(JSON.stringify({ event: 'trip_ended_normal_mark_absent_fired', tripId }));
    }

    if (io) {
      const adminPayload = {
        tripId: completed.id,
        busId: completed.busId,
        routeId: completed.routeId,
        endedAt: completed.endedAt?.toISOString() ?? new Date().toISOString(),
      };
      const tripPayload = {
        tripId: completed.id,
        endedAt: completed.endedAt?.toISOString() ?? new Date().toISOString(),
      };

      io.to('admin').emit('trip:ended', adminPayload);
      io.to(`trip:${completed.id}`).emit('trip:ended', tripPayload);
      io.to(`route:${completed.routeId}`).emit('trip:ended', adminPayload);
    }

    if (auditActor) {
      auditService.log({
        actor: {
          ...auditActor,
          routeIds: auditActor.routeIds?.length ? auditActor.routeIds : [trip.routeId],
        },
        action: 'END_TRIP',
        entityType: 'trip',
        entityId: tripId,
        before: {
          status: trip.status,
          startedAt: trip.startedAt,
          endedAt: trip.endedAt,
        },
        after: {
          status: completed.status,
          startedAt: completed.startedAt,
          endedAt: completed.endedAt,
        },
        meta: {
          driverId,
          busId: trip.busId,
          routeId: trip.routeId,
        },
      });
    }

    // Invalidate home cache for all students on this route
    try {
      const routeStudents = await tripsRepository.getRouteStudents(completed.routeId);
      
      const invalidationPromises = routeStudents.map(({ userId }) =>
        redis.del(`student:home:${userId}`).catch(e =>
          logger.warn({
            source: 'SYSTEM',
            event: 'student_cache_invalidation_error',
            userId,
            meta: { error: String(e) },
          })
        )
      );
      
      await Promise.all(invalidationPromises);
    } catch (e) {
      logger.warn({
        source: 'SYSTEM',
        event: 'route_cache_invalidation_error',
        meta: { routeId: completed.routeId, error: String(e) },
      });
    }

    return completed;
  }

  /**
   * Get the SCHEDULED trip for the driver's bus today.
   * Driver sees this on app open — "Start Morning Trip" fullscreen prompt.
   */
  async getScheduledTripForDriver(driverId: string) {
    return await tripsRepository.getScheduledTripForDriver(driverId);
  }

  /**
   * Get all students for a trip (admin / driver view).
   */
  async getTripStudents(tripId: string) {
    return await tripsRepository.getTripStudents(tripId);
  }

  /**
   * Manual mark by driver (for students with dead phones).
   */
  async manualMark(tripId: string, studentId: string, driverId: string, note?: string) {
    return await attendanceService.driverManualMark(tripId, studentId, driverId, note);
  }

  /**
   * Get trips not started 10+ minutes past scheduled time — for admin alert panel.
   */
  async getLateStartTrips() {
    const allScheduled = await tripsRepository.getTodaysScheduledTrips();

    const nowMinutes = (() => {
      const now = new Date();
      return now.getHours() * 60 + now.getMinutes();
    })();

    return allScheduled.filter(trip => {
      const firstRouteStop = trip.route.stops[0];
      if (!firstRouteStop) return false;
      const scheduled = trip.type === 'MORNING'
        ? firstRouteStop.scheduledTimeMorning
        : firstRouteStop.scheduledTimeReturn;
      return (nowMinutes - scheduled) >= 10;
    });
  }
  async getTripByIdForAdmin(tripId: string) { return tripsRepository.getTripByIdForAdmin(tripId); }
  async getScheduledTripsForLateCheck(routeIds: string[] | null, today: string) { return tripsRepository.getScheduledTripsForLateCheck(routeIds, today); }
  async countActiveOfflineTrips(routeIds: string[]) { return tripsRepository.countActiveOfflineTrips(routeIds); }
  async getTripsByIdsAndRoutes(tripIds: string[], routeIds: string[]) { return tripsRepository.getTripsByIdsAndRoutes(tripIds, routeIds); }
  async getCompletedOutageTrips(routeIds: string[] | null) { return tripsRepository.getCompletedOutageTrips(routeIds); }
  async getTripWithBusAndRoute(tripId: string) { return tripsRepository.getTripWithBusAndRoute(tripId); }
  async getActiveBusIds() { return tripsRepository.getActiveBusIds(); }
  async getActiveTripByBus(busId: string) { return tripsRepository.getActiveTripByBus(busId); }
}

export const tripsService = new TripsService();
