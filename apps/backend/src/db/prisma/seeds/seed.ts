// apps/backend/src/db/prisma/seeds/seed.ts
// Dev seed: 1 route, 5 stops, 1 bus, 1 driver, 5 students, 1 coordinator
// Run: npx tsx src/db/prisma/seeds/seed.ts

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ─── 1. Create the bus ───────────────────────────────────
  const bus = await prisma.bus.upsert({
    where: { number: 'BUS-01' },
    update: {},
    create: {
      number: 'BUS-01',
      plateNumber: 'TN-01-AB-1234',
      capacity: 60,
    },
  });
  console.log('✅ Bus created:', bus.number);

  // ─── 2. Create route ─────────────────────────────────────
  const route = await prisma.route.upsert({
    where: { name: 'Route 1 — Tambaram' },
    update: {},
    create: {
      name: 'Route 1 — Tambaram',
      area: 'South Chennai',
      activeDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
    },
  });
  console.log('✅ Route created:', route.name);

  // ─── 3. Create 5 stops ───────────────────────────────────
  const stopData = [
    { name: 'Tambaram Bus Stand',    area: 'Tambaram',    lat: 12.9249, lon: 80.1000, seq: 1, morning: 7*60+15,  ret: 17*60+30 },
    { name: 'St Thomas Mount',       area: 'St Thomas',   lat: 12.9782, lon: 80.1597, seq: 2, morning: 7*60+30,  ret: 17*60+15 },
    { name: 'Pallavaram Signal',     area: 'Pallavaram',  lat: 12.9675, lon: 80.1503, seq: 3, morning: 7*60+40,  ret: 17*60+5 },
    { name: 'Chromepet Main Road',   area: 'Chromepet',   lat: 12.9516, lon: 80.1390, seq: 4, morning: 7*60+50,  ret: 16*60+55 },
    { name: 'College Main Gate',     area: 'College',     lat: 12.9900, lon: 80.1700, seq: 5, morning: 8*60+15,  ret: 16*60+30 },
  ];

  const stops = [];
  for (const s of stopData) {
    const stop = await prisma.stop.upsert({
      where: { id: `seed-stop-${s.seq}` },
      update: { lat: s.lat, lon: s.lon },
      create: { id: `seed-stop-${s.seq}`, name: s.name, area: s.area, lat: s.lat, lon: s.lon },
    });
    stops.push(stop);

    await prisma.routeStop.upsert({
      where: { routeId_stopId: { routeId: route.id, stopId: stop.id } },
      update: {},
      create: {
        routeId: route.id,
        stopId:  stop.id,
        sequence: s.seq,
        scheduledTimeMorning: s.morning,
        scheduledTimeReturn:  s.ret,
      },
    });
  }
  console.log('✅ 5 stops + route stops created');

  // ─── 4. Create driver ────────────────────────────────────
  const driver = await prisma.user.upsert({
    where: { phone: '+919000000001' },
    update: {},
    create: {
      phone: '+919000000001',
      name: 'Rajan Kumar',
      role: 'DRIVER',
      licenseNumber: 'TN-DL-001',
    },
  });
  console.log('✅ Driver created:', driver.name);

  // ─── 5. BusAssignment ────────────────────────────────────
  const assignment = await prisma.busAssignment.upsert({
    where: { id: 'seed-assignment-1' },
    update: {},
    create: {
      id: 'seed-assignment-1',
      busId: bus.id,
      routeId: route.id,
      driverId: driver.id,
      effectiveFrom: new Date('2026-01-01'),
      isActive: true,
    },
  });
  console.log('✅ BusAssignment created');

  // ─── 6. Create coordinator ───────────────────────────────
  const coordinator = await prisma.user.upsert({
    where: { phone: '+919000000002' },
    update: {},
    create: {
      phone: '+919000000002',
      name: 'Priya Sharma',
      role: 'COORDINATOR',
    },
  });
  await prisma.routeCoordinator.upsert({
    where: { userId_routeId: { userId: coordinator.id, routeId: route.id } },
    update: {},
    create: { userId: coordinator.id, routeId: route.id },
  });
  console.log('✅ Coordinator created:', coordinator.name);

  // ─── 7. Create 5 students ────────────────────────────────
  const studentData = [
    { phone: '+919100000001', name: 'Arun Prasad',   roll: 'CS2021001', dept: 'CSE', year: 3, stopSeq: 1 },
    { phone: '+919100000002', name: 'Divya Menon',   roll: 'CS2021002', dept: 'CSE', year: 3, stopSeq: 2 },
    { phone: '+919100000003', name: 'Karthik Raja',  roll: 'EC2022001', dept: 'ECE', year: 2, stopSeq: 3 },
    { phone: '+919100000004', name: 'Lakshmi Devi',  roll: 'ME2022002', dept: 'MECH', year: 2, stopSeq: 1 },
    { phone: '+919100000005', name: 'Murugan Pillai', roll: 'CS2023001', dept: 'CSE', year: 1, stopSeq: 2 },
  ];

  for (const s of studentData) {
    const student = await prisma.user.upsert({
      where: { phone: s.phone },
      update: {},
      create: {
        phone: s.phone,
        name: s.name,
        role: 'STUDENT',
        rollNumber: s.roll,
        department: s.dept,
        year: s.year,
      },
    });

    const stop = stops[s.stopSeq - 1];
    await prisma.routeAssignment.upsert({
      where: { userId: student.id },
      update: {},
      create: {
        userId: student.id,
        routeId: route.id,
        stopId:  stop.id,
        isActive: true,
      },
    });
  }
  console.log('✅ 5 students with route assignments created');

  console.log('\n✅ Seed complete. Run `pnpm run db:studio` to inspect the data.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
