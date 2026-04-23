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

    const [activeTrips, checkedIn, openCorrections, activeTripRows, currentGpsOffline] = await Promise.all([
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
        select: { id: true },
      }),
      redis.hget('dashboard:stats', 'gpsOffline'),
    ]);

    const pipeline = redis.pipeline();
    pipeline.hset('dashboard:stats', {
      activeTrips,
      checkedIn,
      openCorrections,
      gpsOffline: currentGpsOffline ?? '0',
    });
    pipeline.del('active-trips');

    const activeTripIds = activeTripRows.map((trip) => trip.id);
    if (activeTripIds.length > 0) {
      pipeline.sadd('active-trips', ...activeTripIds);
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
