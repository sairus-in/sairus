import 'dotenv/config';

import { randomUUID } from 'crypto';
import { prisma } from '../src/lib/prisma';
import { redis } from '../src/lib/redis';
import { AppError } from '../src/lib/errors';
import { attendanceService } from '../src/modules/attendance/attendance.service';
import { markAbsentStudents } from '../src/jobs/mark-absent.job';
import { reconcileRedis } from '../src/jobs/reconcile-redis.job';
import { qrService } from '../src/modules/qr/qr.service';
import { tripsService } from '../src/modules/trips/trips.service';
import { getISODateIST } from 'shared';

type SmokeFixture = {
  studentId: string;
  driverId: string;
  busId: string;
  routeId: string;
  stopId: string;
  routeAssignmentId: string;
  busAssignmentId: string;
  tripId: string;
};

const keepArtifacts = process.env.E2E_KEEP_DATA === '1';

const assertStep = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const seedDashboardStats = async () => {
  await redis.hset('dashboard:stats', {
    activeTrips: '0',
    checkedIn: '0',
    gpsOffline: '0',
    openCorrections: '0',
  });
};

const buildFixture = (): SmokeFixture => {
  const runId = randomUUID();

  return {
    studentId: `student_${runId}`,
    driverId: `driver_${runId}`,
    busId: `bus_${runId}`,
    routeId: `route_${runId}`,
    stopId: `stop_${runId}`,
    routeAssignmentId: `route_assignment_${runId}`,
    busAssignmentId: `bus_assignment_${runId}`,
    tripId: `trip_${runId}`,
  };
};

const cleanupFixture = async (fixture: SmokeFixture) => {
  await redis.del(
    'dashboard:stats',
    'active-trips',
    `trip:${fixture.tripId}:state`
  );

  await prisma.attendanceEvent.deleteMany({
    where: {
      attendance: {
        tripId: fixture.tripId,
      },
    },
  });

  await prisma.attendanceLog.deleteMany({
    where: { tripId: fixture.tripId },
  });

  await prisma.waitRequest.deleteMany({
    where: { tripId: fixture.tripId },
  });

  await prisma.trip.deleteMany({
    where: { id: fixture.tripId },
  });

  await prisma.busAssignment.deleteMany({
    where: { id: fixture.busAssignmentId },
  });

  await prisma.routeAssignment.deleteMany({
    where: { id: fixture.routeAssignmentId },
  });

  await prisma.routeStop.deleteMany({
    where: { routeId: fixture.routeId },
  });

  await prisma.stop.deleteMany({
    where: { id: fixture.stopId },
  });

  await prisma.bus.deleteMany({
    where: { id: fixture.busId },
  });

  await prisma.route.deleteMany({
    where: { id: fixture.routeId },
  });

  await prisma.user.deleteMany({
    where: { id: { in: [fixture.studentId, fixture.driverId] } },
  });
};

const seedFixture = async (fixture: SmokeFixture) => {
  const today = getISODateIST();

  await prisma.user.create({
    data: {
      id: fixture.studentId,
      phone: `90${Math.floor(Math.random() * 1_000_000_00).toString().padStart(8, '0')}`,
      email: `${fixture.studentId}@example.test`,
      role: 'STUDENT',
      name: 'Smoke Test Student',
      rollNumber: fixture.studentId.toUpperCase(),
      department: 'QA',
      year: 2,
      authStatus: 'ACTIVE',
    },
  });

  await prisma.user.create({
    data: {
      id: fixture.driverId,
      phone: `91${Math.floor(Math.random() * 1_000_000_00).toString().padStart(8, '0')}`,
      email: `${fixture.driverId}@example.test`,
      role: 'DRIVER',
      name: 'Smoke Test Driver',
      licenseNumber: `LIC-${fixture.driverId.slice(-8)}`,
      authStatus: 'ACTIVE',
    },
  });

  await prisma.bus.create({
    data: {
      id: fixture.busId,
      number: `SMOKE-${fixture.busId.slice(-6)}`,
      plateNumber: `PLATE-${fixture.busId.slice(-6)}`,
      capacity: 50,
    },
  });

  await prisma.route.create({
    data: {
      id: fixture.routeId,
      name: `Smoke Route ${fixture.routeId.slice(-6)}`,
      area: 'Smoke Area',
      activeDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    },
  });

  await prisma.stop.create({
    data: {
      id: fixture.stopId,
      name: 'Smoke Stop',
      lat: 12.9716,
      lon: 77.5946,
    },
  });

  await prisma.routeStop.create({
    data: {
      routeId: fixture.routeId,
      stopId: fixture.stopId,
      sequence: 1,
      scheduledTimeMorning: 420,
      scheduledTimeReturn: 1020,
    },
  });

  await prisma.routeAssignment.create({
    data: {
      id: fixture.routeAssignmentId,
      userId: fixture.studentId,
      routeId: fixture.routeId,
      stopId: fixture.stopId,
      isActive: true,
    },
  });

  await prisma.busAssignment.create({
    data: {
      id: fixture.busAssignmentId,
      busId: fixture.busId,
      routeId: fixture.routeId,
      driverId: fixture.driverId,
      effectiveFrom: new Date(),
      isActive: true,
    },
  });

  await prisma.trip.create({
    data: {
      id: fixture.tripId,
      busAssignmentId: fixture.busAssignmentId,
      busId: fixture.busId,
      routeId: fixture.routeId,
      driverId: fixture.driverId,
      type: 'MORNING',
      status: 'SCHEDULED',
      date: today,
      expectedCount: 1,
    },
  });
};

const run = async () => {
  const fixture = buildFixture();

  console.log('Starting backend smoke E2E');
  console.log('This script exercises DB, Redis, trip activation, QR generation, check-in, wait request, and reconciliation.');

  try {
    await seedDashboardStats();
    await seedFixture(fixture);

    console.log('Fixture seeded');

    const startedTrip = await tripsService.startTrip(fixture.tripId, fixture.driverId);
    assertStep(startedTrip.status === 'ACTIVE', 'Trip failed to transition to ACTIVE');
    assertStep((await redis.sismember('active-trips', fixture.tripId)) === 1, 'Redis active trip set was not updated');

    console.log('Trip started');

    const qrToken = await qrService.generateToken({
      tripId: fixture.tripId,
      busId: fixture.busId,
      routeId: fixture.routeId,
    });

    const checkInResult = await attendanceService.checkIn(fixture.studentId, undefined, {
      qrToken,
      lat: 12.9716,
      lon: 77.5946,
      accuracy: 5,
      clientTimestamp: Date.now(),
    });

    assertStep(checkInResult.status === 'CHECKED_IN', `Unexpected check-in status: ${checkInResult.status}`);

    const attendanceLog = await prisma.attendanceLog.findUnique({
      where: {
        userId_tripId: {
          userId: fixture.studentId,
          tripId: fixture.tripId,
        },
      },
    });

    assertStep(attendanceLog?.status === 'PRESENT', 'Attendance log was not written as PRESENT');

    console.log('Student check-in succeeded');

    let duplicateRejected = false;
    try {
      await attendanceService.checkIn(fixture.studentId, undefined, {
        qrToken,
        lat: 12.9716,
        lon: 77.5946,
        accuracy: 5,
        clientTimestamp: Date.now(),
      });
    } catch (error) {
      duplicateRejected = error instanceof AppError && error.code === 'QR_ALREADY_USED';
    }

    assertStep(duplicateRejected, 'Duplicate QR scan was not rejected');

    const waitRequest = await attendanceService.requestWait(fixture.studentId, fixture.tripId, 4);
    assertStep(waitRequest.tripId === fixture.tripId, 'Wait request was not persisted');

    console.log('Duplicate scan rejection and wait-for-me path verified');

    await prisma.trip.update({
      where: { id: fixture.tripId },
      data: { status: 'COMPLETED', endedAt: new Date() },
    });

    await redis.srem('active-trips', fixture.tripId);
    await redis.del(`trip:${fixture.tripId}:state`);

    await markAbsentStudents(fixture.tripId);
    await reconcileRedis();

    const stats = await redis.hgetall('dashboard:stats');
    assertStep(stats.activeTrips === '0', `Expected activeTrips=0, got ${stats.activeTrips}`);
    assertStep(stats.checkedIn === '1', `Expected checkedIn=1, got ${stats.checkedIn}`);

    console.log('Reconciliation verified');
    console.log('Backend smoke E2E passed');
  } catch (error) {
    console.error('Backend smoke E2E failed');
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (!keepArtifacts) {
      await cleanupFixture(fixture);
    }

    await prisma.$disconnect();
    await redis.quit();
  }
};

void run();
