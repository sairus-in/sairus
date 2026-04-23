import type { NotificationChannel, NotificationPayload } from 'shared';
import { prisma } from '../../lib/prisma';
import {
  dispatchWithBackpressure,
  NotificationDispatchPriority,
} from '../../lib/queue';
import { logger } from '../../lib/logger';

type DispatchOptions = {
  priority?: NotificationDispatchPriority;
};

export class NotificationsService {
  async dispatch(
    userIds: string[],
    payload: NotificationPayload,
    channels: NotificationChannel[],
    options: DispatchOptions = {},
  ) {
    if (!userIds || userIds.length === 0) {
      return [];
    }

    const priority = options.priority ?? NotificationDispatchPriority.NORMAL;
    const jobIds: string[] = [];
    const jobMaxUsers = 5_000;

    for (let i = 0; i < userIds.length; i += jobMaxUsers) {
      const chunkedIds = userIds.slice(i, i + jobMaxUsers);
      const result = await dispatchWithBackpressure(
        {
          userIds: chunkedIds,
          payload,
          channels,
        },
        priority,
      );

      if (result.status === 'enqueued' && result.jobId) {
        jobIds.push(result.jobId);
        continue;
      }

      if (result.status !== 'enqueued') {
        logger.warn({
          event: 'notification_dispatch_not_enqueued',
          source: 'SYSTEM',
          meta: {
            reason: result.reason,
            priority,
            userCount: chunkedIds.length,
            type: payload.type,
          },
        });
      }
    }

    return jobIds;
  }

  async notifyUncheckedStudentsForSelfReport(tripId: string) {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: { bus: true },
    });
    if (!trip) {
      return;
    }

    const pendingLogs = await prisma.attendanceLog.findMany({
      where: { tripId, status: 'PENDING' },
      select: { userId: true },
    });

    if (pendingLogs.length === 0) {
      return;
    }

    const userIds = pendingLogs.map((log) => log.userId);

    await this.dispatch(
      userIds,
      {
        type: 'SELF_REPORT_PROMPT',
        title: `Were you on Bus ${trip.bus.number} today?`,
        body: 'Let us know so we can update your attendance.',
        metadata: {
          tripId,
          busNumber: trip.bus.number,
          screen: '/(student)/self-report-prompt',
        },
      },
      ['PUSH'],
      { priority: NotificationDispatchPriority.NORMAL },
    );

    logger.info({
      event: 'self_report_notifications_sent',
      source: 'SYSTEM',
      meta: { tripId, count: userIds.length },
    });
  }
}

export const notificationsService = new NotificationsService();
