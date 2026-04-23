import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { io } from '../websocket/socket';
import { cloudTasksClient, queuePath, BACKEND_URL } from '../lib/cloud-tasks';
import { notificationsService } from '../modules/notifications/notifications.service';
import { delegateService } from '../modules/trips/delegate.service';
import { logger } from '../lib/logger';
import { metrics } from '../lib/metrics';

/**
 * Phase 3.1: Delegate Heartbeat Monitor
 * A background worker that evaluates active delegations and degrades health state 
 * through LIVE -> STALE -> LOST -> ENDED to prevent silent failures.
 */
export function startDelegateMonitor() {
  return setInterval(async () => {
    try {
      // Find trips that currently have an active delegate
      const activeTrips = await prisma.trip.findMany({
        where: { status: 'ACTIVE', delegateId: { not: null } },
        select: { id: true, delegateId: true, busId: true },
      });

      if (!activeTrips.length) return;

      for (const trip of activeTrips) {
        const { id: tripId, delegateId, busId } = trip;
        
        // 1. Acquire Idempotency Lock
        const lockKey = `trip:delegate:monitor:lock:${tripId}`;
        const acquired = await redis.set(lockKey, 'LOCK', 'EX', 5, 'NX');
        if (!acquired) continue; // Another instance is processing this trip right now

        try {
          const heartbeatStr = await redis.get(`trip:delegate:heartbeat:${tripId}`);
          const currentState = await redis.get(`trip:delegate:health:${tripId}`) || 'LIVE';
          
          const ageMs = heartbeatStr ? Date.now() - Number(heartbeatStr) : Infinity;

          // Determine next state
          let nextState: 'LIVE' | 'STALE' | 'LOST' | 'ENDED' = 'LIVE';

          if (ageMs < 15_000) {
            nextState = 'LIVE';
          } else if (ageMs < 60_000) {
            nextState = 'STALE';
          } else if (ageMs >= 60_000) {
            // Check if we should terminate. We terminate if ageMs is very high, 
            // but the specs say LOST is >90s. We'll terminate if > 3 mins (180s) 
            // after recovery attempts fail, or just enter LOST mode and let the Coordinator handle it.
            // Specs: LOST: no heartbeat for > 90 seconds. 
            // TERMINATE: explicitly terminated or automatically closed after recovery fails
            nextState = ageMs > 180_000 ? 'ENDED' : 'LOST';
          }

          if (currentState !== nextState) {
            const operationId = `monitor-degradation-${tripId}-${Date.now()}`;
            await handleStateTransition(tripId, busId, delegateId!, currentState, nextState, operationId, ageMs);
          }

        } finally {
          await redis.del(lockKey);
        }
      }
    } catch (error) {
      logger.error({ event: 'delegate_monitor_error' }, error);
    }
  }, 10_000); // Scans every 10 seconds
}

async function handleStateTransition(
  tripId: string, 
  busId: string, 
  delegateId: string, 
  fromState: string, 
  toState: 'LIVE' | 'STALE' | 'LOST' | 'ENDED',
  operationId: string,
  offlineSeconds: number
) {
  await redis.set(`trip:delegate:health:${tripId}`, toState);

  // Hardened execution trace
  logger.info({
    event: 'delegate_state_change',
    tripId, busId, userId: delegateId, operationId, source: 'SYSTEM',
    meta: { from: fromState, to: toState, outageSeconds: Math.floor(offlineSeconds / 1000) }
  });

  if (toState === 'STALE') {
    // Notify delegate app / websocket room
    io.to(`bus:${busId}`).emit('gps:status_update', { message: 'location may be delayed' });
    // Maybe dispatch a warning push to the delegate
  }

  if (toState === 'LOST') {
    // Untrust the source
    await redis.setex(`bus:${busId}:live`, 120, JSON.stringify({
      gpsStatus: 'OFFLINE',
      source: 'DELEGATE',
      delegateActive: true, // still active, but lost
    }));
    io.to(`bus:${busId}`).emit('gps:update', { gpsStatus: 'OFFLINE', source: 'DELEGATE' });
    
    // Eligible for Escalation -> Let the existing gps-outage-escalation cloud task handle coordinator pings,
    // or we can manually schedule an escalation if not already done.
    await metrics.inc('delegate_heartbeat_lost_total');
  }

  if (toState === 'ENDED') {
    await delegateService.endDelegation(tripId, 'SYSTEM_TERMINATED', 'SYSTEM');
    logger.info({
      event: 'delegate_automatically_terminated',
      tripId, busId, userId: delegateId, operationId, source: 'SYSTEM',
      meta: { reason: 'LOST_NO_RECOVERY' }
    });
  }
}
