import type { NotificationChannel, NotificationPayload } from 'shared';
import {
  dispatchWithBackpressure,
  NotificationDispatchPriority,
} from '../../lib/queue';
import { logger } from '../../lib/logger';
import { tripsRepository } from '../trips/trips.repository';

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

  async notifyUncheckedStudents(
    userIds: string[],
    busNumber: string,
    tripId: string,
  ) {
    if (userIds.length === 0) {
      return;
    }

    await this.dispatch(
      userIds,
      {
        type: 'SELF_REPORT_PROMPT',
        title: `Were you on Bus ${busNumber} today?`,
        body: 'Let us know so we can update your attendance.',
        metadata: {
          tripId,
          busNumber,
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

  async notifyUncheckedStudentsForSelfReport(tripId: string) {
    const [pendingLogs, trip] = await Promise.all([
      tripsRepository.getPendingStudentLogs(tripId),
      tripsRepository.getTripWithBusAndRoute(tripId),
    ]);

    if (!trip) {
      logger.warn({
        event: 'self_report_notification_trip_missing',
        source: 'SYSTEM',
        meta: { tripId },
      });
      return;
    }

    await this.notifyUncheckedStudents(
      pendingLogs.map((log) => log.userId),
      trip.bus.number,
      tripId,
    );
  }
}

export const notificationsService = new NotificationsService();
