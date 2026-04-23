import { redis } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { NotificationDispatchPriority } from '../lib/queue';
import { notificationsService } from '../modules/notifications/notifications.service';
import { io } from '../websocket/socket';

export async function processOutageEscalation(tripId: string, busId: string) {
  try {
    // 1. Check if gps:status is still OFFLINE (may have recovered)
    const currentStatus = await redis.get(`gps:status:${busId}`);
    if (currentStatus !== 'OFFLINE') {
      console.info(JSON.stringify({
        event: 'outage_escalation_skipped_recovered',
        tripId,
        busId,
        currentStatus,
      }));
      return { skipped: true, reason: 'RECOVERED' };
    }

    // 2. Check if a delegate activated
    const delegateExists = await redis.get(`trip:delegate:${tripId}`);
    if (delegateExists) {
      console.info(JSON.stringify({
        event: 'outage_escalation_skipped_delegate_active',
        tripId,
        busId,
      }));
      return { skipped: true, reason: 'DELEGATE_ACTIVE' };
    }

    // Still offline and no delegate — escalate
    
    // a. Fetch route coordinators for this trip
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        route: {
          include: { coordinators: true }
        }
      }
    });

    if (!trip || trip.status !== 'ACTIVE') {
      return { skipped: true, reason: 'TRIP_NOT_ACTIVE' };
    }

    // Pending count
    const pendingCount = await prisma.attendanceLog.count({
      where: { tripId, status: 'PENDING' }
    });

    // b. Send FCM push to each coordinator
    const coordinators = trip.route.coordinators;
    
    for (const coordinator of coordinators) {
      await notificationsService.dispatch(
        [coordinator.userId],
        {
          type: 'GPS_OUTAGE_ESCALATION',
          title: `Bus ${busId} GPS offline 10 min. No delegate found.`,
          body: `${pendingCount} students not yet checked in. Tap to review.`,
          metadata: {
            tripId,
            busId,
            screen: `/admin/trips/${tripId}/outage`
          }
        },
        ['PUSH'],
        { priority: NotificationDispatchPriority.CRITICAL },
      );

      // c. Emit socket to coordinator room
      io.to(`user:${coordinator.userId}`).emit('outage:escalation', {
        tripId,
        busId,
        pendingCount,
      });
    }

    // d. Log structured event
    console.info(JSON.stringify({
      event: 'outage_escalation_fired',
      tripId,
      busId,
      pendingCount,
      coordinatorsNotified: coordinators.length,
    }));

    return { escalated: true, coordinatorsNotified: coordinators.length };

  } catch (error) {
    console.error(JSON.stringify({
      event: 'outage_escalation_failed',
      tripId,
      busId,
      error: error instanceof Error ? error.message : String(error)
    }));
    throw error;
  }
}
