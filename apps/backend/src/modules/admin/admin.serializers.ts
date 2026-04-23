type ImportRowRecord = {
  id: string;
  rowNumber: number;
  status: string;
  errorField: string | null;
  errorReason: string | null;
  rowData: unknown;
  userId: string | null;
};

type ImportSessionRecord = {
  id: string;
  type: string;
  totalRows: number;
  importedCount: number;
  failedCount: number;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
};

type ImportSessionDetailRecord = ImportSessionRecord & {
  rows: ImportRowRecord[];
};

export const serializeImportSessionSummary = (session: ImportSessionRecord) => ({
  id: session.id,
  type: session.type,
  totalRows: session.totalRows,
  importedCount: session.importedCount,
  failedCount: session.failedCount,
  status: session.status,
  startedAt: session.startedAt.toISOString(),
  completedAt: session.completedAt ? session.completedAt.toISOString() : null,
});

export type SerializedImportSessionSummary = ReturnType<typeof serializeImportSessionSummary>;

export const serializeImportSessionDetail = (session: ImportSessionDetailRecord) => ({
  ...serializeImportSessionSummary(session),
  rows: session.rows.map((row) => ({
    id: row.id,
    rowNumber: row.rowNumber,
    status: row.status,
    errorField: row.errorField,
    errorReason: row.errorReason,
    rowData: (typeof row.rowData === 'object' && row.rowData !== null
      ? row.rowData
      : {}) as Record<string, unknown>,
    userId: row.userId,
  })),
});

export type SerializedImportSessionDetail = ReturnType<typeof serializeImportSessionDetail>;
