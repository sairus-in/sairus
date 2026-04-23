import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const unique = (values: Array<string | null | undefined>) =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value))));

async function backfillAdminScope() {
  const unscopedAdmins = await prisma.adminUser.findMany({
    where: {
      scopes: { none: {} },
    },
    select: {
      id: true,
      email: true,
      role: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${unscopedAdmins.length} unscoped admin accounts`);

  let migrated = 0;
  let skipped = 0;

  for (const admin of unscopedAdmins) {
    if (admin.role === 'TRANSPORT_OFFICER' || admin.role === 'MANAGEMENT') {
      console.log(`  SKIP ${admin.email} (${admin.role}) — role does not require scoped rows`);
      skipped++;
      continue;
    }

    const linkedUser = await prisma.user.findFirst({
      where: { email: admin.email },
      select: {
        id: true,
        department: true,
        coordinatedRoutes: {
          select: {
            routeId: true,
          },
        },
      },
    });

    if (!linkedUser) {
      console.warn(`  SKIP ${admin.email} (${admin.role}) — no legacy user found by email`);
      skipped++;
      continue;
    }

    const routeIds = unique(linkedUser.coordinatedRoutes.map((route) => route.routeId));
    const rows =
      admin.role === 'COORDINATOR'
        ? routeIds.map((routeId) => ({ adminUserId: admin.id, routeId }))
        : admin.role === 'FACULTY' && linkedUser.department
          ? [{ adminUserId: admin.id, department: linkedUser.department }]
          : [];

    if (rows.length === 0) {
      console.warn(`  SKIP ${admin.email} (${admin.role}) — no legacy scope data found`);
      skipped++;
      continue;
    }

    await prisma.adminScope.createMany({
      data: rows,
      skipDuplicates: true,
    });

    console.log(
      `  OK   ${admin.email} (${admin.role}) → routes: ${routeIds.join(', ') || 'none'} dept: ${linkedUser.department ?? 'none'}`,
    );
    migrated++;
  }

  console.log(`\nDone. Migrated: ${migrated}, Skipped: ${skipped}`);
}

backfillAdminScope()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
