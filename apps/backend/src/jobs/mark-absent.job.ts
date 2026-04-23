import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { redis } from '../lib/redis';

const dispatchJob = async (jobName: string, payload: any, delaySeconds: number) => {
  try {
     const libQueue = require('../lib/queue');
     if (libQueue?.queueJob) {
        await libQueue.queueJob(jobName, payload, { delay: delaySeconds * 1000 });
     }
  } catch(e) {
     logger.warn({ event: 'job_dispatch_failed', meta: { jobName, reason: String(e) } });
  }
};

export const markAbsentStudents = async (tripId: string) => {
  const startTime = Date.now();

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { status: true, gpsOutageStart: true }
  });

  if (!trip || trip.status !== 'COMPLETED') {
    logger.info({ event: 'mark_absent_skipped', tripId, meta: { reason: 'Not completed' } });
    return;
  }

  if (trip.gpsOutageStart) {
    const pendingLogs = await prisma.attendanceLog.findMany({
      where: { tripId, status: 'PENDING' },
      select: { id: true }
    });

    if (pendingLogs.length > 0) {
      await prisma.attendanceEvent.createMany({
        data: pendingLogs.map(log => ({
          attendanceId: log.id,
          type: 'GPS_OUTAGE_DEFERRED' as any,
          method: 'SYSTEM_AUTO',
          actorId: 'system',
          previousStatus: 'PENDING',
          newStatus: 'PENDING',
          metadata: {
            reason: 'GPS outage detected — 2-hour review window active',
            windowEndsAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          }
        })),
        skipDuplicates: true,
      });
    }

    await dispatchJob('gps-outage-absent', { tripId }, 2 * 60 * 60);
    await redis.setex(`trip:outage-window:${tripId}`, 3 * 60 * 60, '1');

    logger.info({
      event: 'mark_absent_deferred_gps_outage',
      tripId,
      meta: { pendingCount: pendingLogs.length },
    });
    return;
  }

  const result = await prisma.attendanceLog.updateMany({
    where: { tripId, status: 'PENDING' },
    data: { status: 'ABSENT' }
  });

  if (result.count > 0) {
    const operationKey = `mark-absent:${tripId}`;
    const absentLogs = await prisma.attendanceLog.findMany({
      where: { tripId, status: 'ABSENT' },
      select: { id: true }
    });

    await prisma.attendanceEvent.createMany({
      data: absentLogs.map(log => ({
        attendanceId: log.id,
        type: 'TRIP_END_ABSENT',
        method: 'SYSTEM_AUTO',
        actorId: 'system',
        previousStatus: 'PENDING',
        newStatus: 'ABSENT',
      })),
      skipDuplicates: true,
    });
  }

  logger.info({
    event: 'mark_absent_complete',
    tripId,
    meta: {
      markedCount: result.count,
      durationMs: Date.now() - startTime,
    }
  });
};
