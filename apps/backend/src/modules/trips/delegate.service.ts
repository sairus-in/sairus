import { prisma } from '../../lib/prisma';
import { redis } from '../../lib/redis';
import { firebaseAdmin } from '../../lib/firebase';
import { io } from '../../websocket/socket';
import { BadRequestError, ConflictError, ForbiddenError } from '../../lib/errors';
import { getDistanceMetres } from 'shared';
import crypto from 'crypto';
import { notificationsService } from '../notifications/notifications.service';
import { logger } from '../../lib/logger';
import { metrics } from '../../lib/metrics';

const ALLOWED_DELEGATE_ROLES = ['STAFF', 'NCC_OFFICER', 'FACULTY', 'COORDINATOR', 'TRANSPORT_OFFICER', 'MANAGEMENT'] as const;

export class DelegateService {

  async checkEligibility(tripId: string, userId: string, lat: number, lon: number) {
    const [user, trip] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.trip.findUnique({ where: { id: tripId } }),
    ]);

    if (!user || !trip) throw new BadRequestError('INVALID_DATA');

    if (!ALLOWED_DELEGATE_ROLES.includes(user.role as (typeof ALLOWED_DELEGATE_ROLES)[number])) {
      return { eligible: false, reason: 'ROLE_NOT_AUTHORIZED' };
    }

    if (trip.status !== 'ACTIVE') return { eligible: false, reason: 'TRIP_NOT_ACTIVE' };

    const gpsStatus = await redis.get(`gps:status:${trip.busId}`);
    if (gpsStatus !== 'OFFLINE') return { eligible: false, reason: 'BUS_GPS_NOT_OFFLINE', gpsStatus };

    const existingDelegate = await redis.get(`trip:delegate:${tripId}`);
    if (existingDelegate) return { eligible: false, reason: 'DELEGATE_ALREADY_ACTIVE' };

    const lastPosStr = await redis.get(`bus:${trip.busId}:lastPosition`);
    let distance = null;

    if (lastPosStr) {
      const busPos = JSON.parse(lastPosStr);
      distance = getDistanceMetres(lat, lon, busPos.lat, busPos.lon);
      if (distance > 200) {
        return { eligible: false, reason: 'NOT_NEAR_BUS', distance, maxAllowed: 200 };
      }
    } else {
      const routeAssignment = await prisma.routeAssignment.findFirst({
        where: { userId, routeId: trip.routeId, isActive: true },
      });
      if (!routeAssignment) {
        return { eligible: false, reason: 'NO_POSITION_AND_NO_ROUTE_ASSOCIATION' };
      }
    }

    return { eligible: true, gpsStatus, distance, maxAllowed: 200 };
  }

  async activateDelegation(tripId: string, userId: string, lat: number, lon: number, delegateType: 'GPS' | 'KIOSK' | 'BOTH') {
    await metrics.inc('delegate_activation_attempt_total');

    const operationId = crypto.randomUUID();
    const lockKey = `trip:delegate:activate:${tripId}`;
    
    // Acquire short activation lock
    const lockAcquired = await redis.setnx(lockKey, operationId);
    if (!lockAcquired) {
      throw new ConflictError('ACTIVATION_IN_PROGRESS');
    }
    await redis.expire(lockKey, 10);

    try {
      const [user, trip] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId } }),
        prisma.trip.findUnique({ where: { id: tripId } }),
      ]);

      if (!user || !trip) throw new BadRequestError('INVALID_DATA');

      if (!ALLOWED_DELEGATE_ROLES.includes(user.role as (typeof ALLOWED_DELEGATE_ROLES)[number])) {
        throw new ForbiddenError('ROLE_NOT_AUTHORIZED');
      }

      if (trip.status !== 'ACTIVE') {
        throw new BadRequestError('TRIP_NOT_ACTIVE');
      }

      const gpsStatus = await redis.get(`gps:status:${trip.busId}`);
      if (gpsStatus !== 'OFFLINE') {
        throw new BadRequestError('BUS_GPS_NOT_OFFLINE', { currentStatus: gpsStatus });
      }

      const existingDelegate = await redis.get(`trip:delegate:${tripId}`);
      if (existingDelegate) {
        const delegateUser = await prisma.user.findUnique({ where: { id: JSON.parse(existingDelegate).userId } });
        throw new ConflictError('DELEGATE_ALREADY_ACTIVE', { delegateName: delegateUser?.name });
      }

      const lastPosStr = await redis.get(`bus:${trip.busId}:lastPosition`);
      let activationMethod = 'ROUTE_ASSOCIATION';
      let distanceFromBus = null;

      if (lastPosStr) {
        const busPos = JSON.parse(lastPosStr);
        distanceFromBus = Math.round(getDistanceMetres(lat, lon, busPos.lat, busPos.lon));
        if (distanceFromBus > 200) {
          throw new ForbiddenError('NOT_NEAR_BUS', { distance: distanceFromBus, maxAllowed: 200 });
        }
        activationMethod = 'GEOFENCE';
      } else {
        const routeAssignment = await prisma.routeAssignment.findFirst({
          where: { userId, routeId: trip.routeId, isActive: true }
        });
        if (!routeAssignment) {
          throw new ForbiddenError('NO_POSITION_AND_NO_ROUTE_ASSOCIATION');
        }
      }

      const delegateRecord = await prisma.tripDelegate.create({
        data: {
          tripId,
          delegateId: userId,
          delegateType,
          status: 'PENDING',
          activationLat: lat,
          activationLon: lon,
          distanceFromBus,
          activationMethod,
          operationId,
        }
      });

      try {
        await prisma.$transaction([
          prisma.trip.updateMany({
            where: { id: tripId, delegateId: null },
            data: { delegateId: userId, gpsOutageStart: new Date() }
          }),
          prisma.tripDelegate.update({
            where: { id: delegateRecord.id },
            data: { status: 'ACTIVE', activatedAt: new Date() }
          })
        ]);
      } catch (txError) {
        await prisma.tripDelegate.update({
          where: { id: delegateRecord.id },
          data: { status: 'FAILED', endReason: 'CONCURRENT_ACTIVATION' }
        });
        throw new ConflictError('DELEGATE_ALREADY_ACTIVE');
      }

      await redis.setex(
        `trip:delegate:${tripId}`,
        12 * 60 * 60,
        JSON.stringify({
          userId, delegateType, operationId,
          activatedAt: Date.now(),
          busId: trip.busId,
        })
      );

      await redis.expire(lockKey, 12 * 60 * 60);

      if (firebaseAdmin) {
        await firebaseAdmin.database().ref(`/buses/${trip.busId}`).update({
          delegateActive: true,
          delegateSource: user.role,
          gpsStatus: 'LIVE',
        });
      }

      if (io) {
        const payload = {
          tripId,
          busId: trip.busId,
          routeId: trip.routeId,
          delegateType,
        };
        io.to(`bus:${trip.busId}`).emit('delegate:activated', payload);
        io.to('admin').emit('delegate:activated', payload);
      }

      logger.info({
        event: 'delegate_activated',
        tripId, busId: trip.busId, userId,
        operationId, source: 'DELEGATE',
        meta: { delegateType, activationMethod, distanceFromBus }
      });

      await metrics.inc('delegate_activation_success_total');
      await metrics.gaugeInc('active_delegations_gauge');

      return { success: true, tripId, busId: trip.busId, operationId };

    } catch (error: any) {
      if (!(error instanceof ConflictError && error.code === 'ACTIVATION_IN_PROGRESS')) {
        await redis.del(lockKey);
      }
      await metrics.inc('delegate_activation_fail_total', { reason: error.message || 'UNKNOWN' });
      throw error;
    }
  }

  async endDelegation(tripId: string, reason: any, requesterId: string) {
    const activeDelegateStr = await redis.get(`trip:delegate:${tripId}`);
    if (!activeDelegateStr) return;
    const activeDelegate = JSON.parse(activeDelegateStr);

    await prisma.$transaction([
      prisma.tripDelegate.updateMany({
        where: { tripId, delegateId: activeDelegate.userId, status: 'ACTIVE' },
        data: { status: 'ENDED', endedAt: new Date(), endReason: reason as any }
      }),
      prisma.trip.update({
        where: { id: tripId },
        data: { delegateId: null }
      })
    ]);

    await redis.del(`trip:delegate:${tripId}`);
    await redis.del(`trip:delegate:activate:${tripId}`);
    await redis.del(`trip:delegate:heartbeat:${tripId}`);

    if (firebaseAdmin) {
      await firebaseAdmin.database().ref(`/buses/${activeDelegate.busId}`).update({
        delegateActive: false, delegateSource: null, source: 'DRIVER'
      });
    }

    if (io) {
      const payload = { tripId, busId: activeDelegate.busId, userId: activeDelegate.userId, reason };
      io.to(`user:${activeDelegate.userId}`).emit('delegation:ended', payload);
      io.to('admin').emit('delegation:ended', payload);
    }

    logger.info({
      event: 'delegation_ended',
      tripId, userId: activeDelegate.userId, source: 'SYSTEM',
      meta: { reason, requesterId }
    });

    await metrics.gaugeDec('active_delegations_gauge');
    await metrics.inc('delegate_termination_total', { reason: String(reason) });
  }

  async handleDriverReturn(tripId: string, busId: string, delegateUserId: string, operationId: string) {
    await this.endDelegation(tripId, 'DRIVER_RETURNED', 'SYSTEM');
    logger.info({
      event: 'delegate_handback_driver_returned',
      tripId, busId, userId: delegateUserId, operationId, source: 'DRIVER'
    });
  }

  async handleWarning(tripId: string, userId: string, data: any) {
    const activeDelegateStr = await redis.get(`trip:delegate:${tripId}`);
    if (!activeDelegateStr) throw new BadRequestError('INVALID_DATA');
    
    const delegate = JSON.parse(activeDelegateStr);
    if (delegate.userId !== userId) throw new ForbiddenError('ROLE_NOT_AUTHORIZED');

    const { warningType, severity, meta } = data;
    const operationId = `warn-${tripId}-${Date.now()}`;

    // 1. Audit Log Persistence (Phase 3 tracing requirement)
    logger.info({
      event: 'delegate_warning_received',
      tripId, userId, operationId, source: 'DELEGATE',
      meta: { warningType, severity, ...meta }
    });

    await metrics.inc('delegate_warning_total', { type: warningType });

    // 2. Rate limiting Push Notifications (max 1 push per 60s per trip+type)
    const rateLimitPushKey = `rate:warn:push:${tripId}:${warningType}`;
    const pushAllowed = await redis.setnx(rateLimitPushKey, '1');
    
    if (pushAllowed) {
      await redis.expire(rateLimitPushKey, 60);
      
      if (severity === 'HIGH' || severity === 'CRITICAL') {
        await notificationsService.dispatch(
          [userId],
          {
            type: 'DELEGATE_WARNING',
            title: 'Critical Location Warning',
            body: 'Your OS is restricting location. Open the app immediately to keep GPS broadcasting.',
            metadata: { tripId, warningType }
          },
          ['PUSH']
        );
      }
    }

    // 3. Coordinator Escalation Rate Limiting (max 3 per 10 mins)
    if (severity === 'CRITICAL') {
      const rateLimitCoordKey = `rate:warn:coord:${tripId}`;
      const countStr = await redis.get(rateLimitCoordKey);
      let count = countStr ? parseInt(countStr, 10) : 0;
      
      if (count < 3) {
        await redis.incr(rateLimitCoordKey);
        if (count === 0) await redis.expire(rateLimitCoordKey, 600); // 10 minutes
        
        logger.warn({
          event: 'delegate_warning_escalation_eligible',
          tripId, operationId, source: 'SYSTEM',
          meta: { warningCount: count + 1 }
        });
        // Logic to ping coordinator falls here or handled by the external heartbeat monitor
      }
    }
  }
}

export const delegateService = new DelegateService();
