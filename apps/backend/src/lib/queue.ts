import { Prisma } from '@prisma/client';
import { ConnectionOptions, JobsOptions, Queue } from 'bullmq';
import Redis from 'ioredis';
import type { NotificationChannel, NotificationPayload } from 'shared';
import { NOTIFICATION_TYPE } from 'shared';
import { env } from './env';
import { getRequestId } from './correlation';
import { logger } from './logger';
import { metrics } from './metrics';
import { prisma } from './prisma';
import { circuitExecute } from './redis-circuit';
import { publishAdminAlert } from './admin-alerts';

const redisUrl = env.REDIS_URL;
let bullmqConnection: Redis | null = null;
let notificationQueue: Queue<NotificationJobData> | null = null;

export enum NotificationDispatchPriority {
  CRITICAL = 1,
  HIGH = 2,
  NORMAL = 3,
  BATCH = 4,
}

export interface NotificationJobMeta {
  requestId?: string;
}

export interface NotificationJobData {
  userIds: string[];
  payload: NotificationPayload;
  channels: NotificationChannel[];
  _meta?: NotificationJobMeta;
}

export type DispatchResult =
  | { status: 'enqueued'; jobId: string | undefined }
  | { status: 'dropped'; reason: string }
  | { status: 'crisis_dropped'; reason: string };

const BACKPRESSURE_WARN = 5_000;
const BACKPRESSURE_DROP = 10_000;
const BACKPRESSURE_DEGRADE = 25_000;
const BACKPRESSURE_CRISIS = 50_000;

function getQueueConnection(): Redis {
  if (bullmqConnection) {
    return bullmqConnection;
  }

  bullmqConnection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  bullmqConnection.on('error', (error) => {
    logger.warn({
      event: 'notification_queue_redis_error',
      source: 'SYSTEM',
      meta: { error: String(error) },
    });
  });

  return bullmqConnection;
}

export function getNotificationQueue(): Queue<NotificationJobData> {
  if (notificationQueue) {
    return notificationQueue;
  }

  notificationQueue = new Queue<NotificationJobData>('notifications', {
    connection: getQueueConnection() as unknown as ConnectionOptions,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: true,
      removeOnFail: 1000,
    },
  });

  notificationQueue.on('error', (error) => {
    logger.warn({
      event: 'notification_queue_error',
      source: 'SYSTEM',
      meta: { error: String(error) },
    });
  });

  return notificationQueue;
}

async function getQueueDepth(): Promise<number> {
  const counts = await getNotificationQueue().getJobCounts(
    'active',
    'waiting',
    'prioritized',
    'delayed',
  );

  return (counts.active ?? 0) + (counts.waiting ?? 0) + (counts.prioritized ?? 0) + (counts.delayed ?? 0);
}

async function recordDrop(
  data: NotificationJobData,
  priority: NotificationDispatchPriority,
  reason: string,
): Promise<void> {
  await prisma.notificationDrop.create({
    data: {
      requestId: data._meta?.requestId ?? null,
      userIds: data.userIds,
      channels: data.channels,
      payload: data.payload as unknown as Prisma.InputJsonValue,
      priority,
      reason,
    },
  });
}

async function alertOps(summary: string, priority: NotificationDispatchPriority, backlog: number): Promise<void> {
  logger.error({
    event: 'notification_queue_crisis',
    source: 'SYSTEM',
    meta: { summary, priority, backlog },
  });

  await publishAdminAlert({
    type: NOTIFICATION_TYPE.UNKNOWN,
    priority: 1,
    summary,
    timestamp: Date.now(),
    metadata: { backlog, priority },
  });
}

function buildJobOptions(priority: NotificationDispatchPriority): JobsOptions {
  return { priority };
}

export async function dispatchWithBackpressure(
  data: Omit<NotificationJobData, '_meta'> & { _meta?: NotificationJobMeta },
  priority: NotificationDispatchPriority,
): Promise<DispatchResult> {
  const queue = getNotificationQueue();
  const requestId = data._meta?.requestId ?? getRequestId();
  const jobData: NotificationJobData = {
    ...data,
    _meta: { requestId },
  };

  const backlog = await getQueueDepth();
  await metrics.gauge('notification.queue.depth', backlog);

  if (backlog > BACKPRESSURE_CRISIS) {
    const reason = 'queue_crisis';
    logger.error({
      event: 'notification_backpressure_crisis',
      source: 'SYSTEM',
      meta: { backlog, priority, requestId },
    });
    await metrics.increment('notification.backpressure.crisis');
    await alertOps('Queue crisis: backlog exceeded 50k', priority, backlog);

    if (priority >= NotificationDispatchPriority.HIGH) {
      await recordDrop(jobData, priority, reason);
      return { status: 'crisis_dropped', reason };
    }
  }

  if (backlog > BACKPRESSURE_DEGRADE && priority >= NotificationDispatchPriority.NORMAL) {
    const reason = 'queue_degraded';
    logger.warn({
      event: 'notification_backpressure_degrade',
      source: 'SYSTEM',
      meta: { backlog, priority, requestId },
    });
    await metrics.increment('notification.backpressure.degrade');
    await recordDrop(jobData, priority, reason);
    return { status: 'dropped', reason };
  }

  if (backlog > BACKPRESSURE_DROP && priority >= NotificationDispatchPriority.BATCH) {
    const reason = 'queue_drop_batch';
    await metrics.increment('notification.backpressure.drop_batch');
    await recordDrop(jobData, priority, reason);
    return { status: 'dropped', reason };
  }

  if (backlog > BACKPRESSURE_WARN) {
    logger.warn({
      event: 'notification_queue_backlog_elevated',
      source: 'SYSTEM',
      meta: { backlog, priority, requestId },
    });
  }

  const enqueueResult = await circuitExecute(
    () => queue.add('broadcast', jobData, buildJobOptions(priority)),
    priority === NotificationDispatchPriority.CRITICAL ? 'fail_hard' : 'db_lookup',
    async () => {
      const reason = 'queue_unavailable';
      await recordDrop(jobData, priority, reason);
      return null;
    },
    'notification-queue-add',
  );

  if (!enqueueResult) {
    return { status: 'dropped', reason: 'queue_unavailable' };
  }

  return { status: 'enqueued', jobId: enqueueResult.id };
}

export async function closeNotificationQueue() {
  if (notificationQueue) {
    await notificationQueue.close().catch(() => undefined);
    notificationQueue = null;
  }

  if (bullmqConnection) {
    await bullmqConnection.quit().catch(() => undefined);
    bullmqConnection = null;
  }
}
