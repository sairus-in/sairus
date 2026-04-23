import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { DayOfWeek } from '@prisma/client';
import { randomUUID } from 'crypto';
import { getMinutesSinceMidnightIST, getTomorrowDateKey, getTomorrowDayOfWeekIST } from 'shared';

// Return random CUID/UUID
const generateId = () => randomUUID();

const getTomorrowDayOfWeek = (): DayOfWeek => getTomorrowDayOfWeekIST() as DayOfWeek;

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

const getSecondsUntilTime = (minutesFromMidnight: number) => {
  const now = new Date();
  const secondPart = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    second: '2-digit'
  }).formatToParts(now).find((part: any) => part.type === 'second')?.value;

  const currentMinutes = getMinutesSinceMidnightIST(now);
  const s = Number(secondPart ?? 0);
  const currentSeconds = currentMinutes * 60 + s;
  
  const midnightSeconds = 24 * 3600;
  const targetSeconds = minutesFromMidnight * 60;
  
  return (midnightSeconds - currentSeconds) + targetSeconds;
};

export const createDailyTrips = async () => {
  const tomorrow = getTomorrowDateKey();
  const tomorrowDay = getTomorrowDayOfWeek();

  // Separate to preserve TS inference for `route.activeDays`
  const assignments = await prisma.busAssignment.findMany({
    where: { isActive: true },
    include: {
      bus: { select: { id: true, number: true } },
      route: { select: { id: true, name: true, activeDays: true, stops: { orderBy: { sequence: 'asc' }, take: 1 } } },
      driver: { select: { id: true, name: true } },
    }
  });

  const [existingTripBusIds, studentCountsByRoute] = await Promise.all([
    prisma.trip.findMany({
      where: { date: tomorrow },
      select: { busId: true }
    }).then(trips => new Set(trips.map(t => t.busId))),

    prisma.routeAssignment.groupBy({
      by: ['routeId'],
      _count: { userId: true },
      where: { isActive: true }
    }).then(counts => new Map(counts.map(c => [c.routeId, c._count.userId])))
  ]);

  const tripsToCreate = assignments.filter(a =>
    !existingTripBusIds.has(a.busId) &&
    a.route.activeDays.includes(tomorrowDay)
  );

  if (tripsToCreate.length === 0) {
    logger.info({ event: 'daily_trips_skipped', meta: { date: tomorrow, reason: 'All already created' } });
    return;
  }

  const tripData = tripsToCreate.map(a => ({
    id: generateId(),
    status: 'SCHEDULED' as const,
    date: tomorrow,
    type: 'MORNING' as const,
    busId: a.busId,
    routeId: a.routeId,
    driverId: a.driverId,
    expectedCount: studentCountsByRoute.get(a.routeId) ?? 0,
  }));

  await prisma.trip.createMany({ data: tripData, skipDuplicates: true });

  const firstStopTime = (a: typeof assignments[0]) =>
    a.route.stops[0]?.scheduledTimeMorning ?? 435;

  await Promise.all(
    tripsToCreate.map((a, i) => {
      const trip = tripData[i];
      const minutesFromMidnight = firstStopTime(a);
      const secondsUntilDeparture = getSecondsUntilTime(minutesFromMidnight);
      const alertDelay = secondsUntilDeparture + (10 * 60);
      return dispatchJob('late-start-alert', { tripId: trip.id }, Math.max(0, alertDelay));
    })
  );

  logger.info({
    event: 'daily_trips_created',
    meta: {
      date: tomorrow,
      created: tripsToCreate.length,
      skipped: assignments.length - tripsToCreate.length,
    }
  });
};
