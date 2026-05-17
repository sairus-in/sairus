import { Prisma } from '@prisma/client';
import { ConnectionOptions, Job, Worker } from 'bullmq';
import Redis from 'ioredis';
import { env } from '../lib/env';
import { firebaseAdmin } from '../lib/firebase';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { runWithRequestContext } from '../lib/correlation';
import { sendSms } from '../lib/msg91';
import { circuitExecute } from '../lib/redis-circuit';
import type { NotificationPayload } from 'shared';
import type { NotificationJobData } from '../lib/queue';

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: {
    error?: string;
  };
}

interface ExpoPushResponse {
  data?: ExpoPushTicket[];
  errors?: Array<{ message?: string }>;
}

const notificationWorkerConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

notificationWorkerConnection.on('error', (error) => {
  logger.warn({
    event: 'notification_worker_redis_error',
    source: 'SYSTEM',
    meta: { error: String(error) },
  });
});

const pushBatchSize = 500;
const expoPushBatchSize = 100;
const expoPushEndpoint = 'https://exp.host/--/api/v2/push/send';
const expoTokenPattern = /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/;

function isExpoPushToken(token: string) {
  return expoTokenPattern.test(token);
}

function normalizePushData(metadata: Record<string, unknown> | undefined) {
  const data: Record<string, string> = {};

  if (!metadata) {
    return data;
  }

  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === 'string') {
      data[key] = value;
      continue;
    }

    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      data[key] = String(value);
      continue;
    }

    data[key] = JSON.stringify(value);
  }

  return data;
}

async function sendExpoPushBatch(tokens: string[], payload: NotificationPayload, jobId: string | undefined) {
  const data = {
    ...normalizePushData(payload.metadata),
    type: payload.type,
  };

  const staleTokens: string[] = [];

  for (let i = 0; i < tokens.length; i += expoPushBatchSize) {
    const tokenChunk = tokens.slice(i, i + expoPushBatchSize);
    const messages = tokenChunk.map((to) => ({
      to,
      title: payload.title,
      body: payload.body,
      sound: 'default' as const,
      priority: 'high' as const,
      data,
    }));

    const response = await circuitExecute<Response | null>(
      async () => fetch(expoPushEndpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
      }),
      'allow_degraded',
      async () => null,
      'expo-push',
    );

    if (!response) {
      logger.warn({
        event: 'push_expo_degraded',
        source: 'SYSTEM',
        meta: { jobId, tokenCount: tokenChunk.length },
      });
      continue;
    }

    if (!response.ok) {
      throw new Error(`Expo push request failed with status ${response.status}`);
    }

    const parsed = (await response.json()) as ExpoPushResponse;
    const tickets = Array.isArray(parsed.data) ? parsed.data : [];

    let successCount = 0;
    let failureCount = 0;

    tickets.forEach((ticket, index) => {
      if (ticket.status === 'ok') {
        successCount += 1;
        return;
      }

      failureCount += 1;
      const errorCode = ticket.details?.error;
      if (errorCode === 'DeviceNotRegistered') {
        staleTokens.push(tokenChunk[index]);
      }
    });

    if (parsed.errors?.length) {
      logger.warn({
        event: 'push_expo_response_errors',
        source: 'SYSTEM',
        meta: {
          jobId,
          errorCount: parsed.errors.length,
          tokenCount: tokenChunk.length,
        },
      });
    }

    logger.info({
      event: 'push_expo_batch_sent',
      source: 'SYSTEM',
      meta: {
        jobId,
        successCount,
        failureCount,
        tokenCount: tokenChunk.length,
      },
    });
  }

  return staleTokens;
}

async function sendFcmPushBatch(tokens: string[], payload: NotificationPayload, jobId: string | undefined) {
  if (!firebaseAdmin) {
    logger.warn({
      event: 'push_fcm_transport_unavailable',
      source: 'SYSTEM',
      meta: { jobId, tokenCount: tokens.length },
    });
    return [] as string[];
  }
  const firebase = firebaseAdmin;

  const data = {
    ...normalizePushData(payload.metadata),
    type: payload.type,
  };

  const staleTokens: string[] = [];

  for (let i = 0; i < tokens.length; i += pushBatchSize) {
    const tokenChunk = tokens.slice(i, i + pushBatchSize);

    try {
      const response = await circuitExecute(
        async () => firebase.messaging().sendEachForMulticast({
          tokens: tokenChunk,
          notification: {
            title: payload.title,
            body: payload.body,
          },
          data,
        }),
        'allow_degraded',
        async () => ({
          successCount: 0,
          failureCount: tokenChunk.length,
          responses: [],
        }),
        'firebase-fcm',
      );

      logger.info({
        event: 'push_fcm_batch_sent',
        source: 'SYSTEM',
        meta: {
          jobId,
          successCount: response.successCount,
          failureCount: response.failureCount,
          tokenCount: tokenChunk.length,
        },
      });

      if (response.failureCount > 0) {
        response.responses.forEach((resp, index) => {
          if (!resp.success) {
            const errorCode = resp.error?.code;
            if (
              errorCode === 'messaging/invalid-registration-token' ||
              errorCode === 'messaging/registration-token-not-registered' ||
              errorCode === 'messaging/mismatched-sender-id'
            ) {
              staleTokens.push(tokenChunk[index]);
            }
          }
        });
      }
    } catch (error) {
      logger.error({
        event: 'push_fcm_batch_failed',
        source: 'SYSTEM',
        meta: { jobId, tokenCount: tokenChunk.length },
      }, error);
      throw error;
    }
  }

  return staleTokens;
}

async function processNotificationJob(job: Job<NotificationJobData>) {
  const { userIds, payload, channels } = job.data;

  logger.info({
    event: 'notification_job_processing',
    source: 'SYSTEM',
    meta: {
      jobId: job.id,
      requestId: job.data._meta?.requestId,
      userCount: userIds.length,
      channels,
      type: payload.type,
    },
  });

  if (channels.includes('IN_APP')) {
    for (let i = 0; i < userIds.length; i += pushBatchSize) {
      const chunk = userIds.slice(i, i + pushBatchSize);
      const metadata = (payload.metadata || {}) as Prisma.InputJsonValue;
      const records = chunk.map((id) => ({
        userId: id,
        title: payload.title,
        body: payload.body,
        type: payload.type,
        metadata,
      }));

      await prisma.notification.createMany({
        data: records,
        skipDuplicates: true,
      });
    }
  }

  if (channels.includes('PUSH')) {
    const users = await prisma.user.findMany({
      where: {
        id: { in: userIds },
        fcmToken: { not: null },
      },
      select: { id: true, fcmToken: true },
    });

    const expoTokens: string[] = [];
    const fcmTokens: string[] = [];

    users.forEach((user) => {
      if (!user.fcmToken) {
        return;
      }

      if (isExpoPushToken(user.fcmToken)) {
        expoTokens.push(user.fcmToken);
        return;
      }

      fcmTokens.push(user.fcmToken);
    });

    if (expoTokens.length === 0 && fcmTokens.length === 0) {
      logger.warn({
        event: 'push_no_push_tokens',
        source: 'SYSTEM',
        meta: { userCount: userIds.length, jobId: job.id },
      });
    }

    const staleTokens = [
      ...(expoTokens.length > 0 ? await sendExpoPushBatch(expoTokens, payload, job.id) : []),
      ...(fcmTokens.length > 0 ? await sendFcmPushBatch(fcmTokens, payload, job.id) : []),
    ];

    if (staleTokens.length > 0) {
      await prisma.user.updateMany({
        where: { fcmToken: { in: staleTokens } },
        data: { fcmToken: null },
      });

      logger.info({
        event: 'stale_push_tokens_removed',
        source: 'SYSTEM',
        meta: { count: staleTokens.length, jobId: job.id },
      });
    }
  }

  if (channels.includes('SMS')) {
    for (let i = 0; i < userIds.length; i += pushBatchSize) {
      const chunk = userIds.slice(i, i + pushBatchSize);
      const users = await prisma.user.findMany({
        where: { id: { in: chunk } },
        select: { phone: true },
      });

      await Promise.allSettled(
        users.map((user) =>
          sendSms(user.phone, env.MSG91_ALERT_TEMPLATE_ID || '', {
            message: payload.body,
          }),
        ),
      );
    }
  }
}

export const notificationWorker = new Worker<NotificationJobData>(
  'notifications',
  async (job) => {
    const requestId = job.data._meta?.requestId ?? `job:${job.id ?? 'unknown'}`;
    return runWithRequestContext(requestId, () => processNotificationJob(job));
  },
  {
    connection: notificationWorkerConnection as unknown as ConnectionOptions,
    concurrency: 5,
  },
);

notificationWorker.on('completed', (job) => {
  const requestId = job.data._meta?.requestId ?? `job:${job.id ?? 'unknown'}`;
  runWithRequestContext(requestId, () => {
    logger.info({
      event: 'notification_job_completed',
      source: 'SYSTEM',
      meta: { jobId: job.id, requestId },
    });
  });
});

notificationWorker.on('failed', (job, error) => {
  const requestId = job?.data._meta?.requestId ?? `job:${job?.id ?? 'unknown'}`;
  runWithRequestContext(requestId, () => {
    logger.error({
      event: 'notification_job_failed',
      source: 'SYSTEM',
      meta: { jobId: job?.id, requestId },
    }, error);
  });
});

export const closeNotificationWorker = async () => {
  await notificationWorker.close();
};
