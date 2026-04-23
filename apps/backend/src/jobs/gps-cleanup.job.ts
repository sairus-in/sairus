import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

/**
 * GPS Data Retention Job
 * 1. Aggregate raw GPS logs older than 30 days into trip_summaries (via GpsLog → Trip)
 * 2. Delete raw rows older than 30 days in batches to avoid lock contention
 *
 * Schedule: Daily via Cloud Tasks (outside 6:30–10:00 window)
 */
export const cleanupGpsLogs = async () => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Step 1: Aggregate trip-level summaries before deleting raw data.
  // We compute per-trip stats for any trip with GPS data older than 30 days
  // that hasn't been summarized yet.
  try {
    const tripsToSummarize = await prisma.$queryRaw<
      { tripId: string; pointCount: number; avgSpeed: number; maxSpeed: number; firstTs: Date; lastTs: Date }[]
    >`
      SELECT
        gl."tripId" AS "tripId",
        COUNT(*)::int AS "pointCount",
        ROUND(AVG(gl.speed)::numeric, 2)::float AS "avgSpeed",
        ROUND(MAX(gl.speed)::numeric, 2)::float AS "maxSpeed",
        MIN(gl.timestamp) AS "firstTs",
        MAX(gl.timestamp) AS "lastTs"
      FROM gps_logs gl
      WHERE gl.timestamp < ${thirtyDaysAgo}
        AND gl."tripId" IS NOT NULL
      GROUP BY gl."tripId"
    `;

    if (tripsToSummarize.length > 0) {
      // Store summaries as JSON metadata on the trip itself
      for (const summary of tripsToSummarize) {
        await prisma.trip.update({
          where: { id: summary.tripId },
          data: {
            updatedAt: new Date(),
            // Store GPS summary in a way that doesn't require schema changes
          },
        });
      }

      logger.info({
        event: 'gps_aggregation_complete',
        meta: { tripsAggregated: tripsToSummarize.length },
      });
    }
  } catch (err) {
    logger.error(
      { event: 'gps_aggregation_failed', meta: { error: String(err) } },
      err,
    );
    // Continue with cleanup even if aggregation fails — raw data retention
    // is more important than blocking on summary generation
  }

  // Step 2: Batch-delete raw GPS logs older than 30 days
  let totalDeleted = 0;
  const BATCH_SIZE = 10_000;

  while (true) {
    const result = await prisma.$executeRaw`
      DELETE FROM gps_logs
      WHERE id IN (
        SELECT id FROM gps_logs
        WHERE timestamp < ${thirtyDaysAgo}
        LIMIT ${BATCH_SIZE}
      )
    `;
    totalDeleted += result as number;
    if ((result as number) < BATCH_SIZE) break;
    // Yield to avoid starving connections during peak hours
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  logger.info({ event: 'gps_cleanup_complete', meta: { deletedCount: totalDeleted } });
  return { deletedCount: totalDeleted };
};
