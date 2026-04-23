import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/prisma';
import { redis } from '../src/lib/redis';
import { logger } from '../src/lib/logger';
import { cloudTasksClient } from '../src/lib/cloud-tasks';
import { closeNotificationQueue } from '../src/lib/queue';
import { adminService } from '../src/modules/admin/admin.service';
import { attendanceService } from '../src/modules/attendance/attendance.service';
import { tripsService } from '../src/modules/trips/trips.service';
import type { AuditActorContext } from '../src/lib/audit.service';

type Mode = 'baseline' | 'prepare-down' | 'run-down';

type VerificationState = {
  correctionId: string;
  correctionAttendanceId: string;
  bulkTripId: string;
  endTripId: string;
  endTripBusId: string;
  reviewerId: string;
  adminActorId: string;
  driverId: string;
  routeId: string;
};

type VerificationActors = {
  adminActor: AuditActorContext;
  mobileActor: AuditActorContext;
  reviewerId: string;
  routeId: string;
  studentId: string;
  bulkRouteId: string;
  driverId: string;
  busId: string;
};

type AuditSummary = {
  action: string;
  actorType: string;
  actorId: string;
  entityType: string | null;
  entityId: string | null;
  beforeState: unknown;
  afterState: unknown;
  meta: unknown;
  createdAt: string;
};

const STATE_PATH = path.join(process.cwd(), 'scripts', '.phase4-verify-state.json');
const BASELINE_DATES = ['2099-04-01', '2099-04-02', '2099-04-03'];
const REDIS_DOWN_DATES = ['2099-04-11', '2099-04-12', '2099-04-13'];

const stubCloudTaskCalls: Array<Record<string, unknown>> = [];
cloudTasksClient.createTask = async (payload: Record<string, unknown>) => {
  stubCloudTaskCalls.push(payload);
  return [{ name: `stub-task-${stubCloudTaskCalls.length}` }];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureActors(): Promise<VerificationActors> {
  const [adminUser, reviewer, driver, bus, bulkRoute, studentAssignment] = await Promise.all([
    prisma.adminUser.upsert({
      where: { email: 'ops-verify-admin@example.com' },
      update: {},
      create: {
        name: 'Ops Verify Admin',
        email: 'ops-verify-admin@example.com',
        passwordHash: 'phase4-verification-not-for-login',
        role: 'TRANSPORT_OFFICER',
      },
    }),
    prisma.user.findFirst({
      where: { role: 'COORDINATOR', isActive: true },
      select: { id: true },
    }),
    prisma.user.findFirst({
      where: { role: 'DRIVER', isActive: true },
      select: { id: true },
    }),
    prisma.bus.findFirst({
      where: { isActive: true },
      select: { id: true },
    }),
    prisma.route.findFirst({
      where: {
        isActive: true,
        students: {
          some: { isActive: true },
        },
      },
      orderBy: {
        students: {
          _count: 'desc',
        },
      },
      select: { id: true },
    }),
    prisma.routeAssignment.findFirst({
      where: {
        isActive: true,
        user: { role: 'STUDENT', isActive: true },
      },
      select: {
        userId: true,
        routeId: true,
      },
    }),
  ]);

  if (!reviewer) throw new Error('No coordinator user found for resolveCorrection reviewerId');
  if (!driver) throw new Error('No driver user found for trip verification');
  if (!bus) throw new Error('No active bus found for trip verification');
  if (!bulkRoute) throw new Error('No route with active student assignments found');
  if (!studentAssignment) throw new Error('No active student route assignment found');

  return {
    adminActor: {
      actorType: 'ADMIN_USER',
      actorId: adminUser.id,
      ip: '127.0.0.1',
      routeIds: [studentAssignment.routeId],
    },
    mobileActor: {
      actorType: 'MOBILE_USER',
      actorId: driver.id,
      ip: '127.0.0.1',
      routeIds: [bulkRoute.id],
    },
    reviewerId: reviewer.id,
    routeId: studentAssignment.routeId,
    studentId: studentAssignment.userId,
    bulkRouteId: bulkRoute.id,
    driverId: driver.id,
    busId: bus.id,
  };
}

async function cleanupForDates(dates: string[]) {
  const trips = await prisma.trip.findMany({
    where: { date: { in: dates } },
    select: { id: true },
  });
  const tripIds = trips.map((trip) => trip.id);
  if (tripIds.length === 0) {
    return;
  }

  const attendanceLogs = await prisma.attendanceLog.findMany({
    where: { tripId: { in: tripIds } },
    select: { id: true },
  });
  const attendanceIds = attendanceLogs.map((log) => log.id);

  if (attendanceIds.length > 0) {
    await prisma.attendanceCorrection.deleteMany({
      where: { attendanceId: { in: attendanceIds } },
    });
    await prisma.attendanceEvent.deleteMany({
      where: { attendanceId: { in: attendanceIds } },
    });
    await prisma.attendanceLog.deleteMany({
      where: { id: { in: attendanceIds } },
    });
  }

  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { entityId: { in: tripIds } },
        { meta: { path: ['verificationDates'], array_contains: dates } },
      ],
    },
  });

  await prisma.trip.deleteMany({
    where: { id: { in: tripIds } },
  });
}

async function getLatestAudit(entityId: string): Promise<AuditSummary | null> {
  const row = await prisma.auditLog.findFirst({
    where: { entityId },
    orderBy: { createdAt: 'desc' },
  });

  if (!row) {
    return null;
  }

  return {
    action: row.action,
    actorType: row.actorType,
    actorId: row.actorId,
    entityType: row.entityType ?? null,
    entityId: row.entityId ?? null,
    beforeState: row.before ?? null,
    afterState: row.after ?? null,
    meta: row.meta ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function createCorrectionFixture(date: string, actors: VerificationActors) {
  const trip = await prisma.trip.create({
    data: {
      busId: actors.busId,
      routeId: actors.routeId,
      driverId: actors.driverId,
      type: 'MORNING',
      status: 'SCHEDULED',
      date,
      expectedCount: 1,
    },
  });

  const attendance = await prisma.attendanceLog.create({
    data: {
      userId: actors.studentId,
      tripId: trip.id,
      busId: trip.busId,
      routeId: trip.routeId,
      date,
      dateKey: date,
      status: 'PENDING',
      method: 'MANUAL_ADMIN',
    },
  });

  const correction = await prisma.attendanceCorrection.create({
    data: {
      attendanceId: attendance.id,
      requestedById: actors.studentId,
      reason: `Phase 4 verification correction ${date}`,
      status: 'PENDING',
      metadata: {
        verificationDates: [date],
      },
    },
  });

  return {
    tripId: trip.id,
    attendanceId: attendance.id,
    correctionId: correction.id,
  };
}

async function createBulkFixture(date: string, actors: VerificationActors) {
  const trip = await prisma.trip.create({
    data: {
      busId: actors.busId,
      routeId: actors.bulkRouteId,
      driverId: actors.driverId,
      type: 'RETURN',
      status: 'ACTIVE',
      date,
      expectedCount: 0,
      startedAt: new Date(),
    },
  });

  return { tripId: trip.id };
}

async function createEndTripFixture(date: string, actors: VerificationActors) {
  const trip = await prisma.trip.create({
    data: {
      busId: actors.busId,
      routeId: actors.bulkRouteId,
      driverId: actors.driverId,
      type: 'MORNING',
      status: 'ACTIVE',
      date,
      expectedCount: 0,
      startedAt: new Date(),
    },
  });

  return { tripId: trip.id, busId: trip.busId };
}

async function primeRedisForDownScenario(state: VerificationState) {
  await redis.del(`trip:active:${state.endTripBusId}`);
  await redis.del(`trip:${state.endTripId}:state`);
  await redis.del('active-trips');
  await redis.del('dashboard:stats');
  await redis.setex(`trip:active:${state.endTripBusId}`, 300, state.endTripId);
  await redis.sadd('active-trips', state.endTripId);
  await redis.hset('dashboard:stats', {
    activeTrips: 1,
    openCorrections: 1,
  });
  await redis.hset(`trip:${state.endTripId}:state`, {
    status: 'ACTIVE',
    busId: state.endTripBusId,
    routeId: state.routeId,
  });
}

async function runBaseline() {
  const actors = await ensureActors();
  await cleanupForDates(BASELINE_DATES);
  await redis.del('dashboard:stats');
  await redis.del('active-trips');

  const auditCountBefore = await prisma.auditLog.count();
  const correction = await createCorrectionFixture(BASELINE_DATES[0], actors);
  const bulk = await createBulkFixture(BASELINE_DATES[1], actors);
  const endTrip = await createEndTripFixture(BASELINE_DATES[2], actors);

  await redis.hset('dashboard:stats', { openCorrections: 1, activeTrips: 1 });
  await redis.setex(`trip:active:${endTrip.busId}`, 300, endTrip.tripId);
  await redis.sadd('active-trips', endTrip.tripId);
  await redis.hset(`trip:${endTrip.tripId}:state`, { status: 'ACTIVE', busId: endTrip.busId });

  await adminService.resolveCorrection(
    correction.correctionId,
    'APPROVED',
    actors.reviewerId,
    undefined,
    actors.adminActor,
  );
  await sleep(250);

  const resolvedCorrection = await prisma.attendanceCorrection.findUniqueOrThrow({
    where: { id: correction.correctionId },
    select: { status: true, reviewedById: true },
  });
  const resolvedAttendance = await prisma.attendanceLog.findUniqueOrThrow({
    where: { id: correction.attendanceId },
    select: { status: true },
  });

  const bulkResult = await attendanceService.coordinatorMarkAllPresent(
    bulk.tripId,
    actors.reviewerId,
    actors.adminActor,
  );
  await sleep(250);

  const manualCount = await prisma.attendanceLog.count({
    where: { tripId: bulk.tripId, status: 'MANUAL' },
  });

  const endedTrip = await tripsService.endTrip(
    endTrip.tripId,
    actors.driverId,
    actors.mobileActor,
  );
  await sleep(250);

  const activeTripCache = await redis.get(`trip:active:${endTrip.busId}`);
  const activeTripsMembers = await redis.smembers('active-trips');
  const dashboardStats = await redis.hgetall('dashboard:stats');

  const auditCountAfter = await prisma.auditLog.count();
  const output = {
    mode: 'baseline',
    auditCountBefore,
    auditCountAfter,
    correction: {
      correctionId: correction.correctionId,
      status: resolvedCorrection.status,
      reviewedById: resolvedCorrection.reviewedById,
      attendanceStatus: resolvedAttendance.status,
      audit: await getLatestAudit(correction.correctionId),
    },
    coordinatorMarkAllPresent: {
      tripId: bulk.tripId,
      result: bulkResult,
      manualCount,
      audit: await getLatestAudit(bulk.tripId),
    },
    endTrip: {
      tripId: endTrip.tripId,
      status: endedTrip.status,
      endedAt: endedTrip.endedAt?.toISOString() ?? null,
      activeTripCache,
      activeTripsMembers,
      dashboardStats,
      cloudTaskCalls: stubCloudTaskCalls.length,
      audit: await getLatestAudit(endTrip.tripId),
    },
  };

  console.log(JSON.stringify(output, null, 2));
}

async function prepareDown() {
  const actors = await ensureActors();
  await cleanupForDates(REDIS_DOWN_DATES);

  const correction = await createCorrectionFixture(REDIS_DOWN_DATES[0], actors);
  const bulk = await createBulkFixture(REDIS_DOWN_DATES[1], actors);
  const endTrip = await createEndTripFixture(REDIS_DOWN_DATES[2], actors);

  const state: VerificationState = {
    correctionId: correction.correctionId,
    correctionAttendanceId: correction.attendanceId,
    bulkTripId: bulk.tripId,
    endTripId: endTrip.tripId,
    endTripBusId: endTrip.busId,
    reviewerId: actors.reviewerId,
    adminActorId: actors.adminActor.actorId,
    driverId: actors.driverId,
    routeId: actors.bulkRouteId,
  };

  await primeRedisForDownScenario(state);
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');

  console.log(JSON.stringify({
    mode: 'prepare-down',
    statePath: STATE_PATH,
    state,
    seededRedis: {
      dashboardStats: await redis.hgetall('dashboard:stats'),
      activeTrips: await redis.smembers('active-trips'),
      activeTripCache: await redis.get(`trip:active:${endTrip.busId}`),
    },
  }, null, 2));
}

async function runDown() {
  const stateRaw = await fs.readFile(STATE_PATH, 'utf8');
  const state = JSON.parse(stateRaw) as VerificationState;

  const warnEvents: Array<Record<string, unknown>> = [];
  const originalWarn = logger.warn.bind(logger);
  logger.warn = ((ctx: Record<string, unknown>) => {
    warnEvents.push(ctx);
    originalWarn(ctx as any);
  }) as typeof logger.warn;

  try {
    await adminService.resolveCorrection(
      state.correctionId,
      'APPROVED',
      state.reviewerId,
      undefined,
      {
        actorType: 'ADMIN_USER',
        actorId: state.adminActorId,
        routeIds: [state.routeId],
        ip: '127.0.0.1',
      },
    );
    await sleep(250);

    const bulkResult = await attendanceService.coordinatorMarkAllPresent(
      state.bulkTripId,
      state.reviewerId,
      {
        actorType: 'ADMIN_USER',
        actorId: state.adminActorId,
        routeIds: [state.routeId],
        ip: '127.0.0.1',
      },
    );
    await sleep(250);

    const endedTrip = await tripsService.endTrip(
      state.endTripId,
      state.driverId,
      {
        actorType: 'MOBILE_USER',
        actorId: state.driverId,
        routeIds: [state.routeId],
        ip: '127.0.0.1',
      },
    );
    await sleep(400);

    const correction = await prisma.attendanceCorrection.findUniqueOrThrow({
      where: { id: state.correctionId },
      select: { status: true },
    });
    const attendance = await prisma.attendanceLog.findUniqueOrThrow({
      where: { id: state.correctionAttendanceId },
      select: { status: true },
    });
    const manualCount = await prisma.attendanceLog.count({
      where: { tripId: state.bulkTripId, status: 'MANUAL' },
    });

    console.log(JSON.stringify({
      mode: 'run-down',
      correction: {
        correctionId: state.correctionId,
        status: correction.status,
        attendanceStatus: attendance.status,
        audit: await getLatestAudit(state.correctionId),
      },
      coordinatorMarkAllPresent: {
        tripId: state.bulkTripId,
        result: bulkResult,
        manualCount,
        audit: await getLatestAudit(state.bulkTripId),
      },
      endTrip: {
        tripId: state.endTripId,
        status: endedTrip.status,
        endedAt: endedTrip.endedAt?.toISOString() ?? null,
        cloudTaskCalls: stubCloudTaskCalls.length,
        audit: await getLatestAudit(state.endTripId),
      },
      warnEvents: warnEvents.map((event) => ({
        event: event.event,
        source: event.source,
        meta: event.meta,
      })),
    }, null, 2));
  } finally {
    logger.warn = originalWarn;
  }
}

async function main() {
  const mode = process.argv[2] as Mode | undefined;
  if (!mode || !['baseline', 'prepare-down', 'run-down'].includes(mode)) {
    throw new Error('Usage: tsx scripts/verify-phase4.ts <baseline|prepare-down|run-down>');
  }

  if (mode === 'baseline') {
    await runBaseline();
  } else if (mode === 'prepare-down') {
    await prepareDown();
  } else {
    await runDown();
  }

  await prisma.$disconnect();
  await redis.quit().catch(() => undefined);
  await closeNotificationQueue().catch(() => undefined);
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => undefined);
  await redis.quit().catch(() => undefined);
  await closeNotificationQueue().catch(() => undefined);
  process.exit(1);
});
