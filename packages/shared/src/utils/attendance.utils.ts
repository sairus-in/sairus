import { AttendanceRecord, ATTENDANCE_STATUS } from '../types/attendance.types';

/**
 * Calculates the attendance percentage for a student.
 * 
 * Formula:
 * (PRESENT + LATE_BOARD + MANUAL) / (Total - EXCUSED) * 100
 * 
 * @param records Array of attendance records for the student
 * @returns The percentage (0 to 100), rounded to 1 decimal place
 */
export function calculateAttendancePercentage(records: AttendanceRecord[]): number {
  if (records.length === 0) return 0;

  let presentCount = 0;
  let totalCount = 0;

  for (const record of records) {
    // We don't count EXCUSED towards the total expected days
    if (record.status !== ATTENDANCE_STATUS.EXCUSED) {
      totalCount++;
    }

    if (
      record.status === ATTENDANCE_STATUS.PRESENT ||
      record.status === ATTENDANCE_STATUS.LATE_BOARD ||
      record.status === ATTENDANCE_STATUS.MANUAL
    ) {
      presentCount++;
    }
  }

  if (totalCount === 0) return 0; // Prevent divide by zero if all records are EXCUSED

  const percentage = (presentCount / totalCount) * 100;
  return Math.round(percentage * 10) / 10;
}
