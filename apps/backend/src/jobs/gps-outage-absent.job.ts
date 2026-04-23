import { prisma } from '../lib/prisma';
import { io } from '../websocket/socket';

export async function processOutageAbsentFinalization(tripId: string, outageMinutes: number) {
  try {
    const pendingLogs = await prisma.attendanceLog.findMany({
      where: { tripId, status: 'PENDING' },
      select: { id: true, userId: true }
    });

    if (pendingLogs.length === 0) {
      console.info(JSON.stringify({
        event: 'gps_outage_absent_skipped',
        tripId,
        reason: 'NO_PENDING_STUDENTS'
      }));
      return { count: 0 };
    }

    const ops = pendingLogs.map(log => {
      return prisma.$transaction([
        prisma.attendanceLog.update({
          where: { id: log.id },
          data: { status: 'ABSENT', method: 'SYSTEM_AUTO' }
        }),
        prisma.attendanceEvent.create({
          data: {
            attendanceId: log.id,
            type: 'TRIP_END_ABSENT',
            method: 'SYSTEM_AUTO',
            actorId: log.userId,
            newStatus: 'ABSENT',
            previousStatus: 'PENDING',
            metadata: {
              gpsOutageFinalization: true,
              outageMinutes
            }
          }
        }),
        prisma.attendanceEvent.create({
          data: {
            attendanceId: log.id,
            type: 'ARRIVAL_FLAGGED',
            method: 'SYSTEM_AUTO',
            actorId: log.userId,
            newStatus: 'ABSENT',
            previousStatus: 'ABSENT',
            metadata: {
              reason: 'GPS Outage Window Expired without self-report'
            }
          }
        })
      ]);
    });

    await Promise.all(ops);

    const payload = { tripId, count: pendingLogs.length };
    io.to('admin').emit('trip:absent_finalized', payload);
    pendingLogs.forEach((log) => {
      io.to(`user:${log.userId}`).emit('trip:absent_finalized', payload);
    });

    console.info(JSON.stringify({
      event: 'gps_outage_absent_finalized',
      tripId,
      count: pendingLogs.length,
      outageMinutes
    }));

    return { count: pendingLogs.length };

  } catch (error) {
    console.error(JSON.stringify({
      event: 'gps_outage_absent_failed',
      tripId,
      error: error instanceof Error ? error.message : String(error)
    }));
    throw error;
  }
}
