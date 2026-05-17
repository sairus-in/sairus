import { withLock } from '../lib/distributed-lock';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';

const getISODateIST = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date);

export async function reconcileDashboardStats(): Promise<void> {
  const executed = await withLock('dashboard:stats:reconcile', 30_000, async () => {
    const today = getISODateIST(new Date());
    const startedAt = Date.now();

    const [activeTrips, checkedIn, openCorrections, activeTripRows, currentGpsOffline, cachedRouteIds] = await Promise.all([
      prisma.trip.count({
        where: { status: 'ACTIVE', date: today },
      }),
      prisma.attendanceLog.count({
        where: {
          status: 'PRESENT',
          trip: { date: today },
        },
      }),
      prisma.attendanceCorrection.count({
        where: { status: 'PENDING' },
      }),
      prisma.trip.findMany({
        where: { status: 'ACTIVE', date: today },
        select: { id: true, routeId: true, startedAt: true },
      }),
      redis.hget('dashboard:stats', 'gpsOffline'),
      redis.smembers('active-trips:route-ids'),
    ]);

    const pipeline = redis.pipeline();
    pipeline.hset('dashboard:stats', {
      activeTrips,
      checkedIn,
      openCorrections,
      gpsOffline: currentGpsOffline ?? '0',
    });
    pipeline.del('active-trips');
    pipeline.del('active-trips:z');
    pipeline.del('active-trips:route-ids');
    if (cachedRouteIds.length > 0) {
      pipeline.del(...cachedRouteIds.map((routeId) => `active-trips:z:route:${routeId}`));
    }

    const activeTripIds = activeTripRows.map((trip) => trip.id);
    if (activeTripIds.length > 0) {
      const activeRouteIds = Array.from(new Set(activeTripRows.map((trip) => trip.routeId)));
      pipeline.sadd('active-trips', ...activeTripIds);
      pipeline.sadd('active-trips:route-ids', ...activeRouteIds);
      activeTripRows.forEach((trip) => {
        pipeline.zadd('active-trips:z', trip.startedAt?.getTime() ?? startedAt, trip.id);
        pipeline.zadd(`active-trips:z:route:${trip.routeId}`, trip.startedAt?.getTime() ?? startedAt, trip.id);
      });
    }

    await pipeline.exec();

    logger.info({
      event: 'dashboard_stats_reconciled',
      source: 'SYSTEM',
      meta: {
        activeTrips,
        checkedIn,
        openCorrections,
        gpsOffline: currentGpsOffline ?? '0',
        activeTripIds,
        durationMs: Date.now() - startedAt,
      },
    });
  });

  if (!executed) {
    logger.info({
      event: 'dashboard_stats_reconcile_skipped_lock_held',
      source: 'SYSTEM',
      meta: { resource: 'dashboard:stats:reconcile' },
    });
  }
}
