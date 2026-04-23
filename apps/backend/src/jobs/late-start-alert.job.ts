import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { publishAdminAlert } from '../lib/admin-alerts';
import { redis } from '../lib/redis';

// Mock dependencies
const notificationsService = {
  send: async (userId: string, payload: any) => { console.log('Mock push to', userId); }
};
let io: any;
try { io = require('../server').io; } catch(e) {}

const calculateMinutesLate = (trip: any) => {
  if (!trip?.route?.stops?.[0]?.scheduledTimeMorning) return 0;
  const scheduledMin = trip.route.stops[0].scheduledTimeMorning;
  const now = new Date();
  const currentMin = now.getHours() * 60 + now.getMinutes();
  return Math.max(0, currentMin - scheduledMin);
};

export const lateStartAlert = async ({ tripId }: { tripId: string }) => {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { bus: true, route: true, driver: true }
  });

  if (!trip) return;
  if (trip.status === 'ACTIVE' || trip.status === 'COMPLETED') {
    logger.info({ event: 'late_start_alert_skipped', tripId, meta: { reason: 'Already started' } });
    return;
  }

  const minutesLate = calculateMinutesLate(trip);

  await Promise.all([
    notificationsService.send(trip.driver.id, {
      type: 'LATE_START_DRIVER',
      data: { tripId, minutesLate: String(minutesLate) }
    }),

    (async () => {
      if (io) {
        io.to('admin').emit('trip:late-start', {
          tripId, busNumber: trip.bus.number, routeName: trip.route.name, minutesLate,
        });
      }
    })(),

    publishAdminAlert({
      type: 'LATE_START',
      priority: 2,
      summary: `${trip.route.name} is ${minutesLate} minutes late to start.`,
      tripId,
      busId: trip.busId,
      busNumber: trip.bus.number,
      routeName: trip.route.name,
      timestamp: Date.now(),
      metadata: { minutesLate },
    }),
  ]);

  logger.info({ event: 'late_start_alert_fired', tripId, meta: { minutesLate } });
};
