import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { redis } from '../lib/redis';
import { notificationsService } from '../modules/notifications/notifications.service';
import { NOTIFICATION_TYPE } from 'shared';

export const sendArrivalPushFallback = async (tripId: string) => {
  const alreadySent = await redis.get(`arrival:fcm:sent:${tripId}`);
  if (alreadySent) return;

  const unverifiedLogs = await prisma.attendanceLog.findMany({
    where: {
      tripId,
      status: 'PRESENT',
      arrivalVerified: null,
    },
    include: { user: { select: { id: true, fcmToken: true } } }
  });

  if (unverifiedLogs.length === 0) return;

  await notificationsService.dispatch(
    unverifiedLogs.map(log => log.user.id),
    {
      title: 'Arrival verification required',
      body: 'Please confirm whether you reached the college gate.',
      type: NOTIFICATION_TYPE.ARRIVAL_VERIFICATION,
      metadata: { tripId, screen: '/(student)/verify-arrival' },
    },
    ['PUSH'],
  );

  await redis.setex(`arrival:fcm:sent:${tripId}`, 6 * 60 * 60, '1');

  logger.info({
    event: 'arrival_push_fallback_sent',
    tripId,
    meta: { studentCount: unverifiedLogs.length },
  });
};
