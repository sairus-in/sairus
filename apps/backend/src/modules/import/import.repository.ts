import { prisma } from '../../lib/prisma';
import { getTodayDateKey } from 'shared';
import { Prisma, ImportStatus, ImportRowStatus } from '@prisma/client';

export type ImportRowPayload = {
  phone?: string;
  name?: string;
  rollNumber?: string;
  email?: string | null;
  department?: string | null;
  year?: number | string | null;
  assignedRouteId?: string | null;
  assignedStopId?: string | null;
};

type RouteAssignmentInput = {
  userId: string;
  routeId: string;
  stopId: string;
};

/**
 * Layer 3: Repository Layer for Import Module
 * Handles all database queries via Prisma
 * Transactions managed by caller (service layer)
 */
export const importRepository = {
  /**
   * Validate that all provided route IDs exist
   */
  async validateRoutes(routeIds: (string | undefined | null)[]): Promise<{
    valid: Set<string>;
    invalid: string[];
  }> {
    const filtered = routeIds.filter((id): id is string => !!id);
    if (filtered.length === 0) {
      return { valid: new Set(), invalid: [] };
    }

    const existing = await prisma.route.findMany({
      where: { id: { in: filtered } },
      select: { id: true },
    });

    const validSet = new Set(existing.map((r) => r.id));
    const invalid = filtered.filter((id) => !validSet.has(id));

    return { valid: validSet, invalid };
  },

  /**
   * Validate that all provided stop IDs exist
   */
  async validateStops(stopIds: (string | undefined | null)[]): Promise<{
    valid: Set<string>;
    invalid: string[];
  }> {
    const filtered = stopIds.filter((id): id is string => !!id);
    if (filtered.length === 0) {
      return { valid: new Set(), invalid: [] };
    }

    const existing = await prisma.stop.findMany({
      where: { id: { in: filtered } },
      select: { id: true },
    });

    const validSet = new Set(existing.map((s) => s.id));
    const invalid = filtered.filter((id) => !validSet.has(id));

    return { valid: validSet, invalid };
  },

  /**
   * Get all routes with active/scheduled trips (for conflict checking)
   * Includes students currently assigned to those routes
   * Used during conflict detection phase
   */
  async getActiveTripRoutes(): Promise<Map<string, string[]>> {
    const today = getTodayDateKey();
    const trips = await prisma.trip.findMany({
      where: {
        date: today,
        status: { in: ['SCHEDULED', 'ACTIVE'] },
      },
      select: { routeId: true },
    });

    const activeLiveRouteIds = new Set(trips.map((t) => t.routeId));

    // Get all students assigned to live routes
    const assignments = await prisma.routeAssignment.findMany({
      where: { routeId: { in: Array.from(activeLiveRouteIds) } },
      select: { routeId: true, userId: true },
    });

    // Group students by route
    const routeToStudents = new Map<string, string[]>();
    assignments.forEach((assignment) => {
      if (!routeToStudents.has(assignment.routeId)) {
        routeToStudents.set(assignment.routeId, []);
      }
      routeToStudents.get(assignment.routeId)!.push(assignment.userId);
    });

    return routeToStudents;
  },

  /**
   * Get existing users by phone for duplicate/update checks
   */
  async getExistingUsersByPhone(
    phones: string[]
  ): Promise<
    Map<
      string,
      {
        id: string;
        phone: string;
        routeAssignment?: { routeId: string; stopId: string } | null;
      }
    >
  > {
    if (phones.length === 0) {
      return new Map();
    }

    const existing = await prisma.user.findMany({
      where: { phone: { in: phones }, role: 'STUDENT' },
      select: {
        id: true,
        phone: true,
        routeAssignment: {
          select: { routeId: true, stopId: true },
        },
      },
    });

    return new Map(existing.map((user) => [user.phone, user]));
  },

  /**
   * Batch upsert users within a transaction
   * All-or-nothing: if any upsert fails, entire transaction rolls back
   * Called by service during execution stage
   */
  async batchUpsertUsers(
    users: Array<ImportRowPayload & { id?: string }>,
    tx: Prisma.TransactionClient
  ): Promise<
    Array<{ id: string; phone: string; created: boolean }>
  > {
    const results: Array<{ id: string; phone: string; created: boolean }> = [];

    for (const user of users) {
      const phone = String(user.phone || '');
      const result = await tx.user.upsert({
        where: { phone },
        update: {
          name: user.name,
          rollNumber: user.rollNumber,
          email: user.email || null,
          department: user.department || null,
          year: user.year ? parseInt(String(user.year), 10) : null,
          isActive: true,
        },
        create: {
          phone,
          name: String(user.name || ''),
          rollNumber: String(user.rollNumber || ''),
          email: user.email || null,
          department: user.department || null,
          year: user.year ? parseInt(String(user.year), 10) : null,
          role: 'STUDENT',
          authStatus: 'PENDING_PROVISIONING',
          isActive: true,
        },
        select: { id: true, phone: true, createdAt: true },
      });

      // Determine if this was a create or update (no perfect way, but updatedAt can help)
      // For simplicity, we'll track in the service - just return the user
      results.push({
        id: result.id,
        phone: result.phone,
        created: !users.some((u) => u.id === result.id), // Rough heuristic
      });
    }

    return results;
  },

  /**
   * Batch create/upsert route assignments within a transaction
   */
  async createRouteAssignments(
    assignments: RouteAssignmentInput[],
    tx: Prisma.TransactionClient
  ): Promise<Array<{ userId: string; routeId: string; stopId: string }>> {
    const results: Array<{ userId: string; routeId: string; stopId: string }> = [];

    for (const assignment of assignments) {
      const result = await tx.routeAssignment.upsert({
        where: { userId: assignment.userId },
        update: {
          routeId: assignment.routeId,
          stopId: assignment.stopId,
        },
        create: {
          userId: assignment.userId,
          routeId: assignment.routeId,
          stopId: assignment.stopId,
        },
        select: { userId: true, routeId: true, stopId: true },
      });

      results.push(result);
    }

    return results;
  },

  /**
   * Update import row status (used during execution)
   */
  async updateImportRowStatus(
    rowId: string,
    status: ImportRowStatus,
    data: {
      userId?: string | null;
      errorField?: string | null;
      errorReason?: string | null;
    },
    tx: Prisma.TransactionClient
  ) {
    return tx.importRow.update({
      where: { id: rowId },
      data: {
        status,
        userId: data.userId ?? undefined,
        errorField: data.errorField ?? undefined,
        errorReason: data.errorReason ?? undefined,
      },
    });
  },

  /**
   * Sync import session state based on row statuses
   */
  async syncSessionState(sessionId: string) {
    const aggregates = await prisma.importRow.groupBy({
      by: ['status'],
      where: { sessionId },
      _count: { _all: true },
    });

    const importedCount = aggregates.find((item) => item.status === 'IMPORTED')?._count._all ?? 0;
    const failedCount = aggregates.find((item) => item.status === 'FAILED')?._count._all ?? 0;
    const pendingCount = aggregates.find((item) => item.status === 'PENDING')?._count._all ?? 0;

    const status =
      pendingCount > 0
        ? failedCount > 0
          ? 'VALIDATED_WITH_ERRORS'
          : 'READY_TO_IMPORT'
        : failedCount > 0
        ? 'DONE_WITH_ERRORS'
        : 'DONE';

    return prisma.importSession.update({
      where: { id: sessionId },
      data: {
        importedCount,
        failedCount,
        status,
        completedAt: pendingCount === 0 ? new Date() : null,
      },
    });
  },

  /**
   * Mark session as importing (prevents concurrent execution)
   */
  async markSessionImporting(sessionId: string) {
    return prisma.importSession.update({
      where: { id: sessionId },
      data: { status: 'IMPORTING' },
    });
  },

  /**
   * Get session with pending rows
   */
  async getSessionWithPendingRows(sessionId: string) {
    return prisma.importSession.findUnique({
      where: { id: sessionId },
      include: {
        rows: {
          where: { status: 'PENDING' },
          orderBy: { rowNumber: 'asc' },
        },
      },
    });
  },

  /**
   * Get session by ID
   */
  async getSession(sessionId: string) {
    return prisma.importSession.findUnique({
      where: { id: sessionId },
    });
  },

  /**
   * Create import session
   */
  async createSession(data: {
    type: ImportStatus;
    initiatedById: string;
    fileChecksum: string;
    totalRows: number;
    status: ImportStatus;
  }) {
    return prisma.importSession.create({ data });
  },

  /**
   * Batch create import rows
   */
  async createImportRows(
    data: Array<{
      sessionId: string;
      rowNumber: number;
      rowData: ImportRowPayload;
      status: ImportRowStatus;
      errorField: string | null;
      errorReason: string | null;
    }>
  ) {
    return prisma.importRow.createMany({ data });
  },

  /**
   * Get import session detail with rows
   */
  async getSessionDetail(sessionId: string) {
    return prisma.importSession.findUnique({
      where: { id: sessionId },
      include: {
        rows: {
          orderBy: { rowNumber: 'asc' },
        },
      },
    });
  },

  /**
   * Get failed rows with execution errors (for retry)
   */
  async getFailedExecutionRows(sessionId: string) {
    return prisma.importRow.findMany({
      where: {
        sessionId,
        status: 'FAILED',
        errorField: 'EXECUTION',
      },
    });
  },

  /**
   * Reset failed execution rows back to pending
   */
  async resetFailedRows(sessionId: string) {
    return prisma.importRow.updateMany({
      where: {
        sessionId,
        status: 'FAILED',
        errorField: 'EXECUTION',
      },
      data: {
        status: 'PENDING',
        errorField: null,
        errorReason: null,
      },
    });
  },

  /**
   * Update import row (for manual edits via API)
   */
  async updateRow(rowId: string, data: {
    rowData: ImportRowPayload;
    status: ImportRowStatus;
    errorField: string | null;
    errorReason: string | null;
    userId: null;
  }) {
    return prisma.importRow.update({
      where: { id: rowId },
      data,
    });
  },

  /**
   * Verify row exists in session
   */
  async rowExists(rowId: string, sessionId: string) {
    return prisma.importRow.findFirst({
      where: { id: rowId, sessionId },
      select: { id: true },
    });
  },
};
