import { prisma } from '../../lib/prisma';
import { importRepository, ImportRowPayload } from './import.repository';
import { getTodayDateKey } from 'shared';

type ValidationContext = {
  validRouteIds: Set<string>;
  validStopIds: Set<string>;
  liveRouteStudents: Map<string, string[]>; // routeId -> userId[]
  existingMap: Map<
    string,
    {
      id: string;
      phone: string;
      routeAssignment?: { routeId: string; stopId: string } | null;
    }
  >;
};

/**
 * Stage 1: Pre-fetch all validation data
 * Captures state at validation time to detect conflicts
 */
const buildValidationContext = async (rows: ImportRowPayload[]): Promise<ValidationContext> => {
  // Fetch all routes and stops
  const { valid: validRouteIds } = await importRepository.validateRoutes(
    rows.map((r) => r.assignedRouteId)
  );
  const { valid: validStopIds } = await importRepository.validateStops(
    rows.map((r) => r.assignedStopId)
  );

  // Critical: Fetch live trip routes (students assigned to these cannot be modified)
  const liveRouteStudents = await importRepository.getActiveTripRoutes();

  // Fetch existing students
  const phones = rows.map((row) => row.phone).filter(Boolean) as string[];
  const existingMap = await importRepository.getExistingUsersByPhone(phones);

  return {
    validRouteIds,
    validStopIds,
    liveRouteStudents,
    existingMap,
  };
};

/**
 * Normalize row data (trim strings, convert types)
 */
const normalizeImportRow = (row: ImportRowPayload): ImportRowPayload => ({
  phone: row.phone?.trim(),
  name: row.name?.trim(),
  rollNumber: row.rollNumber?.trim(),
  email: row.email?.trim() || undefined,
  department: row.department?.trim() || undefined,
  year: row.year === '' || row.year === undefined || row.year === null ? undefined : Number(row.year),
  assignedRouteId: row.assignedRouteId?.trim() || undefined,
  assignedStopId: row.assignedStopId?.trim() || undefined,
});

/**
 * Stage 2: Validate single row against context
 * Checks: mandatory fields, route/stop existence, live trip conflicts
 */
const validateImportRow = (row: ImportRowPayload, context: ValidationContext) => {
  const normalized = normalizeImportRow(row);

  if (!normalized.phone || !normalized.name || !normalized.rollNumber) {
    return { normalized, status: 'ERROR', errorReason: 'Missing mandatory fields (phone, name, rollNumber)' };
  }

  if (normalized.assignedRouteId && !context.validRouteIds.has(normalized.assignedRouteId)) {
    return { normalized, status: 'ERROR', errorReason: `Invalid route ID: ${normalized.assignedRouteId}` };
  }

  if (normalized.assignedStopId && !context.validStopIds.has(normalized.assignedStopId)) {
    return { normalized, status: 'ERROR', errorReason: `Invalid stop ID: ${normalized.assignedStopId}` };
  }

  // RACE CONDITION FIX: Check if trying to assign to a route with active trip
  if (normalized.assignedRouteId && context.liveRouteStudents.has(normalized.assignedRouteId)) {
    return {
      normalized,
      status: 'ERROR',
      errorReason: `Cannot assign to route ${normalized.assignedRouteId} during a live trip`,
    };
  }

  // Check if student is already assigned to a live route and is being modified
  const existing = normalized.phone ? context.existingMap.get(normalized.phone) : undefined;
  if (existing?.routeAssignment) {
    const assignedRoute = existing.routeAssignment.routeId;
    if (context.liveRouteStudents.has(assignedRoute)) {
      return {
        normalized,
        status: 'ERROR',
        errorReason: `Cannot modify student assigned to currently live route: ${assignedRoute}`,
      };
    }
  }

  return { normalized, status: 'VALID', errorReason: null };
};

/**
 * Stage 3: Execute pending rows in a SINGLE batch transaction
 * All-or-nothing: if any upsert fails, entire batch rolls back
 * This replaces the per-row transaction pattern (P2 optimization)
 */
const executePendingRowsInternal = async (sessionId: string) => {
  // RACE CONDITION FIX: Mark session as IMPORTING immediately
  // This prevents concurrent execution attempts
  await importRepository.markSessionImporting(sessionId);

  // Fetch session with all pending rows
  const session = await importRepository.getSessionWithPendingRows(sessionId);

  if (!session) throw new Error('Session not found');

  if (session.rows.length === 0) {
    // No pending rows, just sync state
    await importRepository.syncSessionState(sessionId);
    return { success: true, imported: 0, failed: 0 };
  }

  // OPTIMIZATION: Single $transaction for all upserts (batch)
  // Prepare data for batch operations
  const usersToUpsert = session.rows.map((row) => row.rowData as ImportRowPayload);
  const assignmentsToCreate = session.rows
    .filter((row) => {
      const data = row.rowData as ImportRowPayload;
      return data.assignedRouteId && data.assignedStopId;
    })
    .map((row) => ({
      rowId: row.id,
      data: row.rowData as ImportRowPayload,
    }));

  let imported = 0;
  let failed = 0;
  const rowResults = new Map<
    string,
    { userId: string; errorField: string | null; errorReason: string | null }
  >();

  try {
    // Execute everything in a single transaction
    await prisma.$transaction(async (tx) => {
      // Batch upsert all users
      const upsertedUsers = await importRepository.batchUpsertUsers(usersToUpsert, tx);

      // Map phone -> userId for route assignment creation
      const phoneToUserId = new Map<string, string>();
      upsertedUsers.forEach((user, idx) => {
        const phone = usersToUpsert[idx].phone;
        if (phone) {
          phoneToUserId.set(phone, user.id);
        }
      });

      // Batch create route assignments
      const assignmentsToInsert = assignmentsToCreate.map((item) => {
        const userId = phoneToUserId.get((item.data.phone as string) || '');
        if (!userId) throw new Error(`User not found for phone ${item.data.phone}`);

        return {
          userId,
          routeId: item.data.assignedRouteId || '',
          stopId: item.data.assignedStopId || '',
        };
      });

      if (assignmentsToInsert.length > 0) {
        await importRepository.createRouteAssignments(assignmentsToInsert, tx);
      }

      // Update all import rows to IMPORTED status (batch)
      const successfulRowIds = session.rows.map((r) => r.id);
      const upsertedMap = new Map(upsertedUsers.map((u) => [u.phone, u.id]));

      for (const row of session.rows) {
        const data = row.rowData as ImportRowPayload;
        const userId = upsertedMap.get(data.phone || '');

        if (userId) {
          await importRepository.updateImportRowStatus(
            row.id,
            'IMPORTED',
            { userId, errorField: null, errorReason: null },
            tx
          );
          imported++;
        } else {
          throw new Error(`Failed to upsert user ${data.phone}`);
        }
      }
    });
  } catch (error: any) {
    // If transaction fails, mark all pending rows as failed
    for (const row of session.rows) {
      await prisma.importRow.update({
        where: { id: row.id },
        data: {
          status: 'FAILED',
          errorField: 'EXECUTION',
          errorReason: error.message || 'Transaction failed',
        },
      });
      failed++;
    }
  }

  // Sync session state
  await importRepository.syncSessionState(sessionId);

  return { success: true, imported, failed };
};

const syncSessionState = async (sessionId: string) => {
  return importRepository.syncSessionState(sessionId);
};

export const importService = {
  /**
   * Stage 1: Validate bulk student import
   * Pre-fetches all context, validates each row, creates session
   * Does NOT modify any data yet
   */
  async validateBulkStudents(userId: string, rows: ImportRowPayload[], fileChecksum: string) {
    // Pre-fetch all required context (routes, stops, live trips, existing users)
    const context = await buildValidationContext(rows);

    const results = [];
    let newStudents = 0;
    let updatedStudents = 0;

    for (let i = 0; i < rows.length; i++) {
      const candidate = validateImportRow(rows[i], context);
      const existing = candidate.normalized.phone ? context.existingMap.get(candidate.normalized.phone) : undefined;

      if (candidate.status === 'VALID') {
        if (existing) updatedStudents++;
        else newStudents++;
      }

      results.push({
        rowNumber: i + 1,
        rowData: candidate.normalized,
        status: candidate.status,
        errorReason: candidate.errorReason,
      });
    }

    // Create session via repository
    const session = await importRepository.createSession({
      type: 'STUDENT_IMPORT' as any,
      initiatedById: userId,
      fileChecksum,
      totalRows: rows.length,
      status: (results.some((row) => row.status === 'ERROR') ? 'VALIDATED_WITH_ERRORS' : 'READY_TO_IMPORT') as any,
    });

    // Batch create rows via repository
    await importRepository.createImportRows(
      results.map((row) => ({
        sessionId: session.id,
        rowNumber: row.rowNumber,
        rowData: row.rowData,
        status: row.status === 'ERROR' ? 'FAILED' : 'PENDING',
        errorField: row.status === 'ERROR' ? 'VALIDATION' : null,
        errorReason: row.errorReason,
      }))
    );

    return {
      sessionId: session.id,
      validCount: results.filter((row) => row.status === 'VALID').length,
      errorCount: results.filter((row) => row.status === 'ERROR').length,
      newStudents,
      updatedStudents,
      errors: results.filter((row) => row.status === 'ERROR'),
    };
  },

  /**
   * Stage 3: Execute import session
   * Runs batch transaction for all pending rows
   * Includes race condition fix: marks session IMPORTING before execution
   */
  async executeImportSession(sessionId: string, userId: string) {
    void userId;
    const session = await importRepository.getSession(sessionId);

    if (!session) throw new Error('Session not found');
    if (!['READY_TO_IMPORT', 'VALIDATED_WITH_ERRORS', 'DONE_WITH_ERRORS'].includes(session.status)) {
      throw new Error(`Cannot execute session in status ${session.status}`);
    }

    return executePendingRowsInternal(sessionId);
  },

  /**
   * Get import session detail with all rows
   */
  async getImportSessionDetail(sessionId: string) {
    return importRepository.getSessionDetail(sessionId);
  },

  /**
   * Retry failed rows that had execution errors
   * Resets them to PENDING and re-runs execution
   */
  async retryFailedRows(sessionId: string, userId: string) {
    void userId;
    const session = await importRepository.getSession(sessionId);

    if (!session) {
      throw new Error('Session not found');
    }

    const failedRows = await importRepository.getFailedExecutionRows(sessionId);

    if (failedRows.length === 0) {
      return { success: true, retried: 0, failed: 0 };
    }

    // Reset failed rows to pending
    await importRepository.resetFailedRows(sessionId);

    // Execute again
    const result = await executePendingRowsInternal(sessionId);
    return { success: true, retried: result.imported, failed: result.failed };
  },

  /**
   * Update a single import row (admin manual edit)
   * Re-validates and updates status
   */
  async updateImportRow(sessionId: string, rowId: string, rowData: ImportRowPayload) {
    const row = await importRepository.rowExists(rowId, sessionId);

    if (!row) {
      throw new Error('Import row not found');
    }

    // Re-validate with current context
    const context = await buildValidationContext([rowData]);
    const validation = validateImportRow(rowData, context);

    // Update via repository
    const updatedRow = await importRepository.updateRow(rowId, {
      rowData: validation.normalized,
      status: validation.status === 'VALID' ? 'PENDING' : 'FAILED',
      errorField: validation.status === 'VALID' ? null : 'VALIDATION',
      errorReason: validation.errorReason,
      userId: null,
    });

    // Sync session state
    await syncSessionState(sessionId);

    return updatedRow;
  },
};
