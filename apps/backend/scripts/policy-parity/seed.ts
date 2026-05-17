/**
 * Parity script seed — idempotent.
 *
 * Inserts the minimal DB state needed for fixture tokens to authenticate and
 * for requireAction / policy.can() to have meaningful scope data to check.
 *
 * All IDs use a `parity-` prefix so they are trivially identifiable and
 * never conflict with production or smoke-test data.
 *
 * Run via:
 *   pnpm tsx apps/backend/scripts/policy-parity/seed.ts
 */

import 'dotenv/config';
import { prisma } from '../../src/lib/prisma';
import { redis } from '../../src/lib/redis';
import {
  PARITY_ROUTE_1_ID,
  PARITY_ROUTE_2_ID,
  PARITY_ADMIN_TO_ID,
  PARITY_ADMIN_COORD_ID,
  PARITY_ADMIN_FACULTY_ID,
  PARITY_ADMIN_MGMT_ID,
  PARITY_STUDENT_ID,
  PARITY_DRIVER_ID,
  SESSION_VERSION,
} from './fixtures';

const PLACEHOLDER_HASH = '$2b$10$parity.placeholder.hash.only.used.in.test.env.xxxxxxxxxxx';

export async function seedParityData(): Promise<void> {
  console.log('[parity:seed] Starting idempotent seed…');

  // ── Routes ──────────────────────────────────────────────────────────────────
  await prisma.route.upsert({
    where: { id: PARITY_ROUTE_1_ID },
    create: {
      id: PARITY_ROUTE_1_ID,
      name: '__parity_route_1__',
      area: 'parity-test',
      isActive: true,
      activeDays: [],
    },
    update: { isActive: true },
  });

  await prisma.route.upsert({
    where: { id: PARITY_ROUTE_2_ID },
    create: {
      id: PARITY_ROUTE_2_ID,
      name: '__parity_route_2__',
      area: 'parity-test',
      isActive: true,
      activeDays: [],
    },
    update: { isActive: true },
  });

  console.log('[parity:seed] Routes upserted.');

  // ── Admin users ─────────────────────────────────────────────────────────────
  const adminUpserts = [
    {
      id: PARITY_ADMIN_TO_ID,
      name: 'Parity Transport Officer',
      email: 'parity-to@parity.test',
      role: 'TRANSPORT_OFFICER' as const,
    },
    {
      id: PARITY_ADMIN_COORD_ID,
      name: 'Parity Coordinator',
      email: 'parity-coord@parity.test',
      role: 'COORDINATOR' as const,
    },
    {
      id: PARITY_ADMIN_FACULTY_ID,
      name: 'Parity Faculty',
      email: 'parity-faculty@parity.test',
      role: 'FACULTY' as const,
    },
    {
      id: PARITY_ADMIN_MGMT_ID,
      name: 'Parity Management',
      email: 'parity-mgmt@parity.test',
      role: 'MANAGEMENT' as const,
    },
  ] as const;

  for (const admin of adminUpserts) {
    await prisma.adminUser.upsert({
      where: { id: admin.id },
      create: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        passwordHash: PLACEHOLDER_HASH,
        role: admin.role,
        isActive: true,
        sessionVersion: SESSION_VERSION,
        mfaEnabled: false,
      },
      update: {
        isActive: true,
        sessionVersion: SESSION_VERSION,
        role: admin.role,
      },
    });
  }

  console.log('[parity:seed] Admin users upserted.');

  // Coordinator gets route-1 scope (not route-2, so we can test out-of-scope)
  const existingScope = await prisma.adminScope.findFirst({
    where: { adminUserId: PARITY_ADMIN_COORD_ID, routeId: PARITY_ROUTE_1_ID },
  });
  if (!existingScope) {
    await prisma.adminScope.create({
      data: {
        adminUserId: PARITY_ADMIN_COORD_ID,
        routeId: PARITY_ROUTE_1_ID,
      },
    });
    console.log('[parity:seed] Coordinator scope created.');
  } else {
    console.log('[parity:seed] Coordinator scope already exists.');
  }

  // Faculty gets department scope
  const existingFacultyScope = await prisma.adminScope.findFirst({
    where: { adminUserId: PARITY_ADMIN_FACULTY_ID, department: 'parity-dept' },
  });
  if (!existingFacultyScope) {
    await prisma.adminScope.create({
      data: {
        adminUserId: PARITY_ADMIN_FACULTY_ID,
        department: 'parity-dept',
      },
    });
    console.log('[parity:seed] Faculty scope created.');
  } else {
    console.log('[parity:seed] Faculty scope already exists.');
  }

  // ── Mobile users ─────────────────────────────────────────────────────────────
  await prisma.user.upsert({
    where: { id: PARITY_STUDENT_ID },
    create: {
      id: PARITY_STUDENT_ID,
      name: 'Parity Student',
      phone: '+910000000001',
      role: 'STUDENT',
      isActive: true,
      authStatus: 'ACTIVE',
      sessionVersion: SESSION_VERSION,
      registeredDeviceId: 'parity-device-student-1',
    },
    update: {
      isActive: true,
      sessionVersion: SESSION_VERSION,
      registeredDeviceId: 'parity-device-student-1',
    },
  });

  await prisma.user.upsert({
    where: { id: PARITY_DRIVER_ID },
    create: {
      id: PARITY_DRIVER_ID,
      name: 'Parity Driver',
      phone: '+910000000002',
      role: 'DRIVER',
      isActive: true,
      authStatus: 'ACTIVE',
      sessionVersion: SESSION_VERSION,
      registeredDeviceId: 'parity-device-driver-1',
    },
    update: {
      isActive: true,
      sessionVersion: SESSION_VERSION,
      registeredDeviceId: 'parity-device-driver-1',
    },
  });

  console.log('[parity:seed] Mobile users upserted.');

  // Warm Redis auth cache entries so the middleware doesn't have to hit DB
  const adminAuthStates = [
    { id: PARITY_ADMIN_TO_ID, role: 'TRANSPORT_OFFICER' },
    { id: PARITY_ADMIN_COORD_ID, role: 'COORDINATOR' },
    { id: PARITY_ADMIN_FACULTY_ID, role: 'FACULTY' },
    { id: PARITY_ADMIN_MGMT_ID, role: 'MANAGEMENT' },
  ] as const;

  for (const { id, role } of adminAuthStates) {
    await redis.setex(
      `auth:admin:${id}`,
      8 * 60 * 60,
      JSON.stringify({ isActive: true, sessionVersion: SESSION_VERSION, role, mfaEnabled: false }),
    );
  }

  await redis.setex(
    `auth:user:${PARITY_STUDENT_ID}`,
    24 * 60 * 60,
    JSON.stringify({
      isActive: true,
      authStatus: 'ACTIVE',
      role: 'STUDENT',
      sessionVersion: SESSION_VERSION,
      registeredDeviceId: 'parity-device-student-1',
      forcedReloginAt: null,
    }),
  );

  await redis.setex(
    `auth:user:${PARITY_DRIVER_ID}`,
    24 * 60 * 60,
    JSON.stringify({
      isActive: true,
      authStatus: 'ACTIVE',
      role: 'DRIVER',
      sessionVersion: SESSION_VERSION,
      registeredDeviceId: 'parity-device-driver-1',
      forcedReloginAt: null,
    }),
  );

  console.log('[parity:seed] Redis auth cache warmed.');
  console.log('[parity:seed] Done.');
}

seedParityData()
  .catch((err) => {
    console.error('[parity:seed] Fatal:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });
