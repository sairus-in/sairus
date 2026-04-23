import { randomUUID } from 'crypto';
import { ForbiddenError } from '../../lib/errors';
import { ResolvedAdminAccessContext } from '../../lib/admin-access';
import { prisma } from '../../lib/prisma';
import { redis } from '../../lib/redis';
import { AdminAttendanceReportOverview, AdminAttendanceTrendPoint, AdminReportStatus } from 'shared';

const REPORT_TTL_SECONDS = 60 * 60;
const CHECKED_IN_STATUSES = new Set(['PRESENT', 'LATE_BOARD', 'MANUAL']);

type PersistedReportStatus = AdminReportStatus & {
  createdAt?: number;
  updatedAt?: number;
  requestedByAdminId: string;
  scopeRouteIds: string[];
  requestedRouteId?: string | null;
};

class ReportsService {
  private statusKey(jobId: string) {
    return `job:${jobId}:status`;
  }

  private artifactKey(jobId: string) {
    return `job:${jobId}:artifact`;
  }

  private async setStatus(jobId: string, payload: PersistedReportStatus) {
    await redis.set(this.statusKey(jobId), JSON.stringify(payload), 'EX', REPORT_TTL_SECONDS);
  }

  private toPublicStatus(status: PersistedReportStatus): AdminReportStatus {
    return {
      status: status.status,
      progress: status.progress,
      resultUrl: status.resultUrl,
      error: status.error,
      totalTripsAnalyzed: status.totalTripsAnalyzed,
      summary: status.summary,
    };
  }

  private resolveScopedRouteIds(access: ResolvedAdminAccessContext, requestedRouteId?: string): string[] {
    if (access.role === 'COORDINATOR') {
      const allowedRouteIds = access.scope.routeIds;
      if (allowedRouteIds.length === 0) {
        throw new ForbiddenError('NO_COORDINATOR_SCOPE');
      }

      if (requestedRouteId) {
        if (!allowedRouteIds.includes(requestedRouteId)) {
          throw new ForbiddenError('REPORT_OUTSIDE_SCOPE');
        }

        return [requestedRouteId];
      }

      return allowedRouteIds;
    }

    return requestedRouteId ? [requestedRouteId] : [];
  }

  private assertReportAccess(access: ResolvedAdminAccessContext, status: PersistedReportStatus) {
    if (access.role !== 'COORDINATOR') {
      return;
    }

    if (status.requestedByAdminId !== access.adminId) {
      throw new ForbiddenError('REPORT_OWNERSHIP_REQUIRED');
    }

    if (status.scopeRouteIds.length === 0) {
      throw new ForbiddenError('REPORT_OUTSIDE_SCOPE');
    }

    const allowedRouteIds = new Set(access.scope.routeIds);
    const hasOutOfScopeRoute = status.scopeRouteIds.some((routeId) => !allowedRouteIds.has(routeId));
    if (hasOutOfScopeRoute) {
      throw new ForbiddenError('REPORT_OUTSIDE_SCOPE');
    }
  }

  private buildTripWhere(startDate: string, endDate: string, routeIds: string[]) {
    return {
      date: { gte: startDate, lte: endDate },
      ...(routeIds.length > 0 ? { routeId: { in: routeIds } } : {}),
    };
  }

  private formatLabel(date: string) {
    const value = new Date(`${date}T00:00:00Z`);
    return value.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  private buildCsv(overview: AdminAttendanceReportOverview, trips: Array<{
    date: string;
    tripId: string;
    routeName: string;
    busNumber: string;
    driverName: string;
    status: string;
    expectedCount: number;
    boardedCount: number;
    absentCount: number;
  }>) {
    const summaryRows = [
      ['Attendance Report'],
      [`Date Range`, `${overview.startDate} to ${overview.endDate}`],
      [`Route`, overview.routeName || 'All routes'],
      [`Trips Analyzed`, String(overview.totalTrips)],
      [`Expected Riders`, String(overview.totalExpected)],
      [`Checked In`, String(overview.totalCheckedIn)],
      [`Absent`, String(overview.totalAbsent)],
      [`Attendance Rate`, `${overview.attendanceRate}%`],
      [],
      ['Daily Trend'],
      ['Date', 'Expected', 'Checked In', 'Absent', 'Attendance Rate'],
      ...overview.trends.map((point: AdminAttendanceTrendPoint) => [
        point.date,
        String(point.expected),
        String(point.checkedIn),
        String(point.absent),
        `${point.attendanceRate}%`,
      ]),
      [],
      ['Trip Breakdown'],
      ['Date', 'Trip ID', 'Route', 'Bus', 'Driver', 'Status', 'Expected', 'Boarded', 'Absent'],
      ...trips.map((trip) => [
        trip.date,
        trip.tripId,
        trip.routeName,
        trip.busNumber,
        trip.driverName,
        trip.status,
        String(trip.expectedCount),
        String(trip.boardedCount),
        String(trip.absentCount),
      ]),
    ];

    return summaryRows
      .map((row: string[]) => row.map((cell: string) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
  }

  private async getAttendanceOverviewInternal(
    startDate: string,
    endDate: string,
    routeIds: string[],
    requestedRouteId?: string,
  ): Promise<AdminAttendanceReportOverview> {
    const [trips, groupedAttendance, route] = await Promise.all([
      prisma.trip.findMany({
        where: this.buildTripWhere(startDate, endDate, routeIds),
        select: {
          id: true,
          date: true,
          expectedCount: true,
          boardedCount: true,
          absentCount: true,
          route: { select: { id: true, name: true } },
        },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.attendanceLog.groupBy({
        by: ['dateKey', 'status'],
        where: {
          dateKey: { gte: startDate, lte: endDate },
          ...(routeIds.length > 0 ? { routeId: { in: routeIds } } : {}),
        },
        _count: { _all: true },
        orderBy: [{ dateKey: 'asc' }],
      }),
      (requestedRouteId ?? (routeIds.length === 1 ? routeIds[0] : undefined))
        ? prisma.route.findUnique({
            where: { id: requestedRouteId ?? routeIds[0] },
            select: { id: true, name: true },
          })
        : Promise.resolve(null),
    ]);

    const trendMap = new Map<string, AdminAttendanceTrendPoint>();

    for (const trip of trips) {
      const current = trendMap.get(trip.date) ?? {
        date: trip.date,
        label: this.formatLabel(trip.date),
        expected: 0,
        checkedIn: 0,
        absent: 0,
        attendanceRate: 0,
      };

      current.expected += trip.expectedCount;
      trendMap.set(trip.date, current);
    }

    for (const row of groupedAttendance) {
      const current = trendMap.get(row.dateKey) ?? {
        date: row.dateKey,
        label: this.formatLabel(row.dateKey),
        expected: 0,
        checkedIn: 0,
        absent: 0,
        attendanceRate: 0,
      };

      if (CHECKED_IN_STATUSES.has(row.status)) {
        current.checkedIn += row._count._all;
      }

      trendMap.set(row.dateKey, current);
    }

    const trends = Array.from(trendMap.values())
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((point) => {
        const absent = Math.max(point.expected - point.checkedIn, 0);
        const attendanceRate = point.expected > 0
          ? Number(((point.checkedIn / point.expected) * 100).toFixed(1))
          : 0;

        return {
          ...point,
          absent,
          attendanceRate,
        };
      });

    const totalExpected = trends.reduce((sum, point) => sum + point.expected, 0);
    const totalCheckedIn = trends.reduce((sum, point) => sum + point.checkedIn, 0);
    const totalAbsent = Math.max(totalExpected - totalCheckedIn, 0);

    return {
      startDate,
      endDate,
      routeId: requestedRouteId ?? route?.id ?? undefined,
      routeName: route?.name ?? (requestedRouteId ? null : routeIds.length === 1 ? trips[0]?.route.name ?? null : null),
      totalTrips: trips.length,
      totalExpected,
      totalCheckedIn,
      totalAbsent,
      attendanceRate: totalExpected > 0 ? Number(((totalCheckedIn / totalExpected) * 100).toFixed(1)) : 0,
      trends,
    };
  }

  async getAttendanceOverview(
    access: ResolvedAdminAccessContext,
    startDate: string,
    endDate: string,
    routeId?: string,
  ): Promise<AdminAttendanceReportOverview> {
    const scopedRouteIds = this.resolveScopedRouteIds(access, routeId);
    return this.getAttendanceOverviewInternal(startDate, endDate, scopedRouteIds, routeId);
  }

  async enqueueAttendanceReport(
    access: ResolvedAdminAccessContext,
    startDate: string,
    endDate: string,
    routeId?: string,
  ) {
    const jobId = randomUUID();
    const scopedRouteIds = this.resolveScopedRouteIds(access, routeId);
    const metadata = {
      requestedByAdminId: access.adminId,
      scopeRouteIds: scopedRouteIds,
      requestedRouteId: routeId ?? null,
    };

    await this.setStatus(jobId, {
      status: 'QUEUED',
      progress: 5,
      createdAt: Date.now(),
      ...metadata,
    });

    void this.processAttendanceReport(jobId, startDate, endDate, metadata);

    return { jobId };
  }

  private async processAttendanceReport(
    jobId: string,
    startDate: string,
    endDate: string,
    metadata: Pick<PersistedReportStatus, 'requestedByAdminId' | 'scopeRouteIds' | 'requestedRouteId'>,
  ) {
    try {
      await this.setStatus(jobId, {
        status: 'PROCESSING',
        progress: 20,
        updatedAt: Date.now(),
        ...metadata,
      });

      const overview = await this.getAttendanceOverviewInternal(
        startDate,
        endDate,
        metadata.scopeRouteIds,
        metadata.requestedRouteId ?? undefined,
      );

      await this.setStatus(jobId, {
        status: 'PROCESSING',
        progress: 65,
        totalTripsAnalyzed: overview.totalTrips,
        summary: overview,
        updatedAt: Date.now(),
        ...metadata,
      });

      const trips = await prisma.trip.findMany({
        where: this.buildTripWhere(startDate, endDate, metadata.scopeRouteIds),
        select: {
          id: true,
          date: true,
          status: true,
          expectedCount: true,
          boardedCount: true,
          absentCount: true,
          route: { select: { name: true } },
          bus: { select: { number: true } },
          driver: { select: { name: true } },
        },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      });

      const csv = this.buildCsv(
        overview,
        trips.map((trip) => ({
          date: trip.date,
          tripId: trip.id,
          routeName: trip.route.name,
          busNumber: trip.bus.number,
          driverName: trip.driver.name,
          status: trip.status,
          expectedCount: trip.expectedCount,
          boardedCount: trip.boardedCount,
          absentCount: trip.absentCount,
        })),
      );

      await redis.set(this.artifactKey(jobId), csv, 'EX', REPORT_TTL_SECONDS);

      await this.setStatus(jobId, {
        status: 'COMPLETED',
        progress: 100,
        resultUrl: `/v1/admin/reports/${jobId}/download`,
        totalTripsAnalyzed: overview.totalTrips,
        summary: overview,
        updatedAt: Date.now(),
        ...metadata,
      });
    } catch (error) {
      await this.setStatus(jobId, {
        status: 'FAILED',
        error: error instanceof Error ? error.message : 'Failed to generate attendance report',
        updatedAt: Date.now(),
        ...metadata,
      });
    }
  }

  async getJobStatus(access: ResolvedAdminAccessContext, jobId: string): Promise<AdminReportStatus | null> {
    const raw = await redis.get(this.statusKey(jobId));
    if (!raw) {
      return null;
    }

    const status = JSON.parse(raw) as PersistedReportStatus;
    this.assertReportAccess(access, status);
    return this.toPublicStatus(status);
  }

  async downloadAttendanceReport(access: ResolvedAdminAccessContext, jobId: string) {
    const raw = await redis.get(this.statusKey(jobId));
    if (!raw) {
      return null;
    }

    const status = JSON.parse(raw) as PersistedReportStatus;
    this.assertReportAccess(access, status);

    return redis.get(this.artifactKey(jobId));
  }
}

export const reportsService = new ReportsService();
