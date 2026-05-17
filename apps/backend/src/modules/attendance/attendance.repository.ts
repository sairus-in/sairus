import { prisma } from '../../lib/prisma';
import { Prisma, AttendanceStatus, CheckInMethod, AttendanceEventType, AttendanceLog, Trip } from '@prisma/client';
import { BadRequestError } from '../../lib/errors';

interface UpsertAttendanceLogData {
  userId: string;
  tripId: string;
  busId: string;
  routeId: string;
  date: string;
  dateKey: string;
  status: 'PRESENT' | 'LATE_BOARD' | 'ABSENT' | 'PENDING' | 'EXCUSED' | 'MANUAL';
  method?: 'QR_SCAN' | 'MANUAL_DRIVER' | 'MANUAL_ADMIN' | 'SYSTEM_AUTO';
  checkedInAt?: Date;
  lat?: number;
  lon?: number;
  distanceToBus?: number;
  distanceToStop?: number;
  geofenceMethod?: string;
  failReason?: string | null;
  arrivalVerified?: boolean;
  arrivalLat?: number;
  arrivalLon?: number;
  arrivalDistance?: number;
  arrivalVerifiedAt?: Date;
  arrivalMethod?: string;
  driverNote?: string;
}

interface CreateAttendanceEventData {
  attendanceId: string;
  type: AttendanceEventType;
  method: CheckInMethod;
  actorId: string;
  previousStatus: AttendanceStatus | null;
  newStatus: AttendanceStatus;
  metadata?: any;
}

/**
 * Layer 3: Repository — all Prisma calls live here.
 * No business logic. Just data access. Maps Prisma errors to AppError.
 */
export class AttendanceRepository {
  private isBoardedStatus(status: string | null | undefined) {
    return status === 'PRESENT' || status === 'LATE_BOARD' || status === 'MANUAL';
  }

  // ============ CORE ATTENDANCE OPERATIONS ============

  /**
   * Get student by ID (for validation)
   */
  async getStudentById(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, rollNumber: true, registeredDeviceId: true }
    });
  }

  /**
   * Get trip by ID with full context (bus, route, etc)
   */
  async getTripById(tripId: string) {
    return prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        bus: { select: { id: true, number: true, plateNumber: true } },
        route: { select: { id: true, name: true } }
      }
    });
  }

  /**
   * Get active trip by bus ID (used for check-in flow)
   */
  async getTripByBusId(busId: string) {
    return prisma.trip.findFirst({
      where: { busId, status: 'ACTIVE' },
      include: {
        bus: { select: { id: true, number: true } },
        route: { select: { id: true, name: true } }
      }
    });
  }

  /**
   * Check existing attendance log for idempotency
   * Prevents double-check-in
   */
  async findExistingLog(userId: string, tripId: string) {
    return prisma.attendanceLog.findUnique({
      where: { userId_tripId: { userId, tripId } },
      select: {
        id: true,
        status: true,
        checkedInAt: true,
        method: true
      }
    });
  }

  /**
   * Upsert attendance log (idempotent)
   * Creates or updates a single student's check-in record for a trip
   */
  async upsertAttendanceLog(data: UpsertAttendanceLogData) {
    try {
      return await prisma.attendanceLog.upsert({
        where: { userId_tripId: { userId: data.userId, tripId: data.tripId } },
        update: {
          status: data.status,
          method: data.method ?? undefined,
          checkedInAt: data.checkedInAt,
          lat: data.lat,
          lon: data.lon,
          distanceToBus: data.distanceToBus,
          distanceToStop: data.distanceToStop,
          geofenceMethod: data.geofenceMethod ?? undefined,
          failReason: data.failReason,
          arrivalVerified: data.arrivalVerified,
          arrivalLat: data.arrivalLat,
          arrivalLon: data.arrivalLon,
          arrivalDistance: data.arrivalDistance,
          arrivalVerifiedAt: data.arrivalVerifiedAt,
          arrivalMethod: data.arrivalMethod,
          driverNote: data.driverNote ?? undefined,
        },
        create: {
          userId: data.userId,
          tripId: data.tripId,
          busId: data.busId,
          routeId: data.routeId,
          date: data.date,
          dateKey: data.dateKey,
          status: data.status,
          method: data.method ?? 'SYSTEM_AUTO',
          checkedInAt: data.checkedInAt,
          lat: data.lat,
          lon: data.lon,
          distanceToStop: data.distanceToStop,
          geofenceMethod: data.geofenceMethod,
          driverNote: data.driverNote,
        },
      });
    } catch (err: any) {
      if (err.code === 'P2025') {
        throw new BadRequestError('ATTENDANCE_LOG_NOT_FOUND');
      }
      throw err;
    }
  }

  /**
   * Update attendance log status and increment trip boarded count atomically.
   * Also used for driver manual mark — upserts log by userId+tripId if no logId provided.
   *
   * boardedCount is only incremented when transitioning FROM a non-boarded status
   * (ABSENT, PENDING, EXCUSED) TO a boarded status (PRESENT, MANUAL). Repeated manual
   * marks on the same student do not double-count.
   */
  async updateAttendanceLogWithTrip(
    userId: string,
    tripId: string,
    busId: string,
    routeId: string,
    date: string,
    status: string,
    data: Partial<UpsertAttendanceLogData>
  ): Promise<[AttendanceLog, Trip?]> {
    try {
      return await prisma.$transaction(async (tx) => {
        const existingLog = await tx.attendanceLog.findUnique({
          where: { userId_tripId: { userId, tripId } },
          select: { status: true },
        });

        const shouldIncrement = !this.isBoardedStatus(existingLog?.status) && this.isBoardedStatus(status);

        const log = await tx.attendanceLog.upsert({
          where: { userId_tripId: { userId, tripId } },
          update: {
            status: status as any,
            method: data.method ?? 'MANUAL_DRIVER',
            checkedInAt: data.checkedInAt,
            driverNote: data.driverNote ?? undefined,
          },
          create: {
            userId,
            tripId,
            busId,
            routeId,
            date,
            dateKey: date,
            status: status as any,
            method: data.method ?? 'MANUAL_DRIVER',
            checkedInAt: data.checkedInAt,
            driverNote: data.driverNote ?? undefined,
          },
        });

        const trip = shouldIncrement
          ? await tx.trip.update({
              where: { id: tripId },
              data: { boardedCount: { increment: 1 } },
            })
          : null;

        return trip ? [log, trip] : [log];
      });
    } catch (err: any) {
      if (err.code === 'P2025') {
        throw new BadRequestError('LOG_OR_TRIP_NOT_FOUND');
      }
      throw err;
    }
  }

  // ============ EVENT SOURCING ============

  /**
   * Create immutable attendance event (event sourcing)
   * Every state change → AttendanceEvent for audit trail
   */
  async createAttendanceEvent(data: CreateAttendanceEventData) {
    try {
      return await prisma.attendanceEvent.create({
        data: {
          attendanceId: data.attendanceId,
          type: data.type,
          method: data.method,
          actorId: data.actorId,
          previousStatus: data.previousStatus,
          newStatus: data.newStatus,
          metadata: data.metadata ?? {},
        }
      });
    } catch (err: any) {
      if (err.code === 'P2025') {
        throw new BadRequestError('ATTENDANCE_LOG_NOT_FOUND');
      }
      throw err;
    }
  }

  /**
   * Get event history for an attendance log
   */
  async getAttendanceEvents(attendanceId: string) {
    return prisma.attendanceEvent.findMany({
      where: { attendanceId },
      orderBy: { id: 'desc' }
    });
  }

  // ============ TRIP OPERATIONS ============

  /**
   * Get trip for route check (used in skip-trip flow)
   */
  async getTripByIdForRouteCheck(tripId: string) {
    return prisma.trip.findFirst({
      where: { id: tripId, status: { in: ['SCHEDULED', 'ACTIVE'] } },
      select: { id: true, date: true, routeId: true, type: true, busId: true, status: true },
    });
  }

  /**
   * Verify student is assigned to route
   */
  async getRouteAssignment(userId: string, routeId: string) {
    return prisma.routeAssignment.findFirst({
      where: { userId, routeId, isActive: true },
      select: { id: true, userId: true, routeId: true },
    });
  }

  /**
   * Get all route assignments for GPS outage override
   */
  async getRouteAssignmentsForTrip(routeId: string) {
    return prisma.routeAssignment.findMany({
      where: { routeId, isActive: true },
      select: { userId: true }
    });
  }

  // ============ SKIP TRIP ============

  /**
   * Create or update trip skip record
   */
  async upsertTripSkip(userId: string, date: string, type: 'MORNING' | 'RETURN', reason?: string) {
    return prisma.tripSkip.upsert({
      where: { userId_date_type: { userId, date, type } },
      update: { reason },
      create: { userId, date, type, reason },
    });
  }

  /**
   * Check if student skipped this trip
   */
  async findTripSkip(userId: string, date: string, type: string) {
    return prisma.tripSkip.findUnique({
      where: { userId_date_type: { userId, date, type: type as any } },
    });
  }

  // ============ WAIT REQUEST ============

  /**
   * Create or update wait request
   */
  async upsertWaitRequest(userId: string, tripId: string, etaMinutes: number) {
    return prisma.waitRequest.upsert({
      where: { userId_tripId: { userId, tripId } },
      update: { etaMinutes, status: 'PENDING' },
      create: { userId, tripId, etaMinutes },
    });
  }

  // ============ CORRECTIONS ============

  /**
   * Create correction request
   */
  async createCorrectionRequest(logId: string, userId: string, reason: string) {
    try {
      return await prisma.attendanceCorrection.create({
        data: {
          attendanceId: logId,
          requestedById: userId,
          reason,
          status: 'PENDING'
        }
      });
    } catch (err: any) {
      if (err.code === 'P2025') {
        throw new BadRequestError('LOG_NOT_FOUND');
      }
      throw err;
    }
  }

  /**
   * Update correction status with event sourcing
   */
  async updateCorrectionAndLog(
    correctionId: string,
    reviewerId: string,
    status: 'APPROVED' | 'REJECTED',
    reviewNote?: string
  ) {
    try {
      const correction = await prisma.attendanceCorrection.update({
        where: { id: correctionId },
        data: {
          status,
          reviewedById: reviewerId,
          reviewNote,
          reviewedAt: new Date()
        },
        include: { attendance: true }
      });

      if (status === 'APPROVED') {
        await prisma.$transaction([
          prisma.attendanceLog.update({
            where: { id: correction.attendanceId },
            data: { status: 'MANUAL' }
          }),
          prisma.attendanceEvent.create({
            data: {
              attendanceId: correction.attendanceId,
              type: 'MANUAL_CORRECTION',
              method: 'MANUAL_ADMIN',
              actorId: reviewerId,
              previousStatus: correction.attendance.status,
              newStatus: 'MANUAL',
              metadata: { correctionId, reviewNote }
            }
          })
        ]);
      }

      return correction;
    } catch (err: any) {
      if (err.code === 'P2025') {
        throw new BadRequestError('CORRECTION_NOT_FOUND');
      }
      throw err;
    }
  }

  /**
   * Get all pending corrections
   */
  async findPendingCorrections() {
    return prisma.attendanceCorrection.findMany({
      where: { status: 'PENDING' },
      include: {
        attendance: { include: { user: { select: { name: true, rollNumber: true } } } },
        requestedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }

  /**
   * Get pending outage-related corrections
   */
  async findPendingOutageCorrections() {
    return prisma.attendanceCorrection.findMany({
      where: {
        status: 'PENDING',
        metadata: { path: ['busGPSOffline'], equals: true }
      },
      include: {
        requestedBy: { select: { id: true, name: true, rollNumber: true, department: true } },
        attendance: {
          include: {
            trip: {
              include: {
                bus: { select: { number: true, plateNumber: true } }
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /**
   * Get log for correction eligibility check
   */
  async getLogForCorrectionCheck(logId: string, userId: string) {
    return prisma.attendanceLog.findFirst({
      where: { id: logId, userId },
      select: {
        id: true,
        status: true,
        corrections: {
          where: { status: 'PENDING' },
          select: { id: true }
        }
      }
    });
  }

  // ============ COORDINATOR OPERATIONS ============

  /**
   * Get all attendance logs for a trip (for outage override)
   */
  async getTripAttendanceLogs(tripId: string) {
    return prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        attendanceLogs: {
          select: { userId: true, status: true }
        }
      }
    });
  }

  /**
   * Bulk update attendance logs for all students on a trip
   * Used for GPS outage / emergency override
   */
  async bulkUpsertAttendanceLogs(
    tripId: string,
    busId: string,
    routeId: string,
    date: string,
    userIds: string[]
  ) {
    const ops = userIds.map(userId =>
      prisma.attendanceLog.upsert({
        where: { userId_tripId: { userId, tripId } },
        create: {
          userId,
          tripId,
          busId,
          routeId,
          date,
          dateKey: date,
          status: 'MANUAL',
          method: 'MANUAL_ADMIN',
          checkedInAt: new Date(),
          driverNote: 'Coordinator GPS Outage Override',
        },
        update: {
          status: 'MANUAL',
          method: 'MANUAL_ADMIN',
          checkedInAt: new Date(),
          driverNote: 'Coordinator GPS Outage Override',
        }
      })
    );

    return prisma.$transaction(ops);
  }

  /**
   * Mark student absent due to trip end (system auto)
   */
  async markAbsentOnTripEnd(attendanceId: string, userId: string) {
    try {
      return await prisma.$transaction([
        prisma.attendanceLog.update({
          where: { id: attendanceId },
          data: { status: 'ABSENT', method: 'SYSTEM_AUTO' }
        }),
        prisma.attendanceEvent.create({
          data: {
            attendanceId,
            type: 'TRIP_END_ABSENT',
            method: 'SYSTEM_AUTO',
            actorId: userId,
            previousStatus: 'PENDING',
            newStatus: 'ABSENT',
            metadata: { selfReportedAbsent: true }
          }
        })
      ]);
    } catch (err: any) {
      if (err.code === 'P2025') {
        throw new BadRequestError('LOG_NOT_FOUND');
      }
      throw err;
    }
  }

  /**
   * Create self-reported correction during GPS outage
   */
  async createSelfReportedCorrection(
    logId: string,
    userId: string,
    outageStartedAt: Date | null,
    outageMinutes: number,
    delegateWasActive: boolean
  ) {
    try {
      return await prisma.attendanceCorrection.create({
        data: {
          attendanceId: logId,
          requestedById: userId,
          reason: "Automatic: Bus GPS offline during trip. Student confirmed presence.",
          status: 'PENDING',
          metadata: {
            busGPSOffline: true,
            selfReported: true,
            isAutoCreated: true,
            outageStartedAt: outageStartedAt?.toISOString(),
            outageMinutes,
            delegateWasActive,
            reportedAt: new Date().toISOString()
          }
        }
      });
    } catch (err: any) {
      if (err.code === 'P2025') {
        throw new BadRequestError('LOG_NOT_FOUND');
      }
      throw err;
    }
  }

  // ============ HISTORY & LISTING ============

  async countLogs(where: Prisma.AttendanceLogWhereInput) {
    return prisma.attendanceLog.count({ where });
  }

  async findLogs(where: Prisma.AttendanceLogWhereInput, skip: number, take: number) {
    return prisma.attendanceLog.findMany({
      where,
      include: {
        trip: {
          include: {
            bus: { select: { number: true } },
          },
        },
        corrections: {
          select: { id: true, status: true },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
    });
  }

  async getLogById(logId: string, userId: string) {
    return prisma.attendanceLog.findFirst({
      where: { id: logId, userId },
      include: {
        trip: {
          include: {
            route: { select: { name: true } },
            bus: { select: { number: true, plateNumber: true } },
          },
        },
        corrections: {
          orderBy: { id: 'desc' },
        },
        events: {
          orderBy: { id: 'asc' }
        }
      },
    });
  }

  /**
   * Find single log by user and trip, with full context
   */
  async findLogByUserTrip(userId: string, tripId: string) {
    return prisma.attendanceLog.findFirst({
      where: { userId, tripId },
    });
  }

  /**
   * Update log arrival verification + create event atomically
   */
  async updateAttendanceLogArrivalAndEvent(
    logId: string,
    userId: string,
    arrivalVerified: boolean,
    arrivalLat: number,
    arrivalLon: number,
    arrivalDistance: number,
    method: string,
    previousStatus: AttendanceStatus
  ) {
    try {
      const event = arrivalVerified ? undefined : {
        data: {
          attendanceId: logId,
          type: AttendanceEventType.ARRIVAL_FLAGGED,
          method: CheckInMethod.SYSTEM_AUTO,
          actorId: userId,
          previousStatus,
          newStatus: previousStatus,
          metadata: { distanceFromGate: arrivalDistance, lat: arrivalLat, lon: arrivalLon, method },
        }
      };

      return await prisma.$transaction([
        prisma.attendanceLog.update({
          where: { id: logId },
          data: {
            arrivalVerified,
            arrivalLat,
            arrivalLon,
            arrivalDistance,
            arrivalVerifiedAt: new Date(),
            arrivalMethod: method,
          }
        }),
        ...(event ? [prisma.attendanceEvent.create(event)] : []),
      ]);
    } catch (err: any) {
      if (err.code === 'P2025') {
        throw new BadRequestError('LOG_NOT_FOUND');
      }
      throw err;
    }
  }

  /**
   * Atomic check-in: upsert log + increment trip boarded + create event
   */
  async performCheckInTransaction(
    userId: string,
    tripId: string,
    busId: string,
    routeId: string,
    date: string,
    status: 'PRESENT' | 'LATE_BOARD',
    geofenceData: any,
    previousStatus: string | null,
    overrodeTripSkip: boolean
  ): Promise<[AttendanceLog, Trip?]> {
    try {
      return await prisma.$transaction(async (tx) => {
        const existingLog = await tx.attendanceLog.findUnique({
          where: { userId_tripId: { userId, tripId } },
          select: { status: true },
        });

        const shouldIncrement = !this.isBoardedStatus(existingLog?.status) && this.isBoardedStatus(status);

        const log = await tx.attendanceLog.upsert({
          where: { userId_tripId: { userId, tripId } },
          update: {
            status,
            method: 'QR_SCAN',
            checkedInAt: new Date(),
            lat: geofenceData.lat,
            lon: geofenceData.lon,
            distanceToBus: geofenceData.distanceToBus,
            distanceToStop: geofenceData.distanceToStop,
            geofenceMethod: geofenceData.method,
            failReason: null,
          },
          create: {
            userId,
            tripId,
            busId,
            routeId,
            date,
            dateKey: date,
            status,
            method: 'QR_SCAN',
            checkedInAt: new Date(),
            lat: geofenceData.lat,
            lon: geofenceData.lon,
            distanceToBus: geofenceData.distanceToBus,
            distanceToStop: geofenceData.distanceToStop,
            geofenceMethod: geofenceData.method,
          },
        });

        const trip = shouldIncrement
          ? await tx.trip.update({
              where: { id: tripId },
              data: { boardedCount: { increment: 1 } },
            })
          : null;

        return trip ? [log, trip] : [log];
      });
    } catch (err: any) {
      if (err.code === 'P2025') {
        throw new BadRequestError('LOG_OR_TRIP_NOT_FOUND');
      }
      throw err;
    }
  }

  /**
   * Create check-in event after log has been created
   */
  async createCheckInEvent(
    logId: string,
    userId: string,
    status: 'PRESENT' | 'LATE_BOARD',
    previousStatus: AttendanceStatus | null,
    geofenceData: any,
    overrodeTripSkip: boolean
  ) {
    return this.createAttendanceEvent({
      attendanceId: logId,
      type: AttendanceEventType.CHECK_IN,
      method: CheckInMethod.QR_SCAN,
      actorId: userId,
      previousStatus,
      newStatus: status as AttendanceStatus,
      metadata: {
        distanceToBus: geofenceData.distanceToBus,
        distanceToStop: geofenceData.distanceToStop,
        geofenceMethod: geofenceData.method,
        overrodeTripSkip,
      },
    });
  }

  /**
   * Get trip with all attendance logs (for coordinator override)
   */
  async getTripWithAttendanceLogs(tripId: string) {
    return prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        attendanceLogs: {
          select: { userId: true, status: true }
        }
      }
    });
  }

  /**
   * Bulk override during outage: mark all expected students MANUAL + create events atomically
   */
  async bulkMarkPresentAndCreateEvents(
    tripId: string,
    busId: string,
    routeId: string,
    date: string,
    coordinatorId: string,
    userIds: string[]
  ) {
    try {
      const updateOps = userIds.map(userId =>
        prisma.attendanceLog.upsert({
          where: { userId_tripId: { userId, tripId } },
          create: {
            userId,
            tripId,
            busId,
            routeId,
            date,
            dateKey: date,
            status: 'MANUAL',
            method: 'MANUAL_ADMIN',
            checkedInAt: new Date(),
            driverNote: 'Coordinator GPS Outage Override',
          },
          update: {
            status: 'MANUAL',
            method: 'MANUAL_ADMIN',
            checkedInAt: new Date(),
            driverNote: 'Coordinator GPS Outage Override',
          }
        })
      );

      const logs = await prisma.$transaction(updateOps);

      // Create events for each update
      const eventOps = logs.map(log =>
        prisma.attendanceEvent.create({
          data: {
            attendanceId: log.id,
            type: 'MANUAL_CORRECTION',
            method: 'MANUAL_ADMIN',
            actorId: coordinatorId,
            previousStatus: log.status === 'MANUAL' ? log.status : 'PENDING',
            newStatus: 'MANUAL',
            metadata: { source: 'COORDINATOR_GPS_OUTAGE_OVERRIDE' },
          }
        })
      );

      await prisma.$transaction(eventOps);
      return { count: logs.length };
    } catch (err: any) {
      if (err.code === 'P2025') {
        throw new BadRequestError('TRIP_OR_ASSIGNMENT_NOT_FOUND');
      }
      throw err;
    }
  }

  async findCorrections(userId: string, skip: number, take: number) {
    return prisma.attendanceCorrection.findMany({
      where: { requestedById: userId },
      include: {
        attendance: {
          include: {
            trip: {
              include: {
                route: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  async countCorrections(userId: string) {
    return prisma.attendanceCorrection.count({ where: { requestedById: userId } });
  }

  async getScopedCorrectionOrThrow(correctionId: string) {
    return prisma.attendanceCorrection.findUnique({
      where: { id: correctionId },
      include: {
        attendance: {
          select: {
            id: true,
            tripId: true,
            routeId: true,
            status: true,
          },
        },
      },
    });
  }

  async getPendingStudentCountMap(tripIds: string[]) {
    if (tripIds.length === 0) {
      return new Map<string, number>();
    }
    const rows = await prisma.attendanceLog.groupBy({
      by: ['tripId'],
      where: { tripId: { in: tripIds }, status: 'PENDING' },
      _count: { tripId: true },
    });
    return new Map(rows.map((row) => [row.tripId, row._count.tripId]));
  }

  async getPendingOutageCorrectionCountMap(tripIds: string[]) {
    if (tripIds.length === 0) {
      return new Map<string, number>();
    }
    const rows = await prisma.attendanceCorrection.findMany({
      where: {
        status: 'PENDING',
        metadata: { path: ['busGPSOffline'], equals: true },
        attendance: { tripId: { in: tripIds } },
      },
      select: { attendance: { select: { tripId: true } } },
    });
    const counts = new Map<string, number>();
    for (const row of rows) {
      const tripId = row.attendance.tripId;
      counts.set(tripId, (counts.get(tripId) ?? 0) + 1);
    }
    return counts;
  }

  async countPendingCorrectionsForAdmin(routeIds: string[] | null) {
    return prisma.attendanceCorrection.count({
      where: {
        status: 'PENDING',
        ...(routeIds ? { attendance: { routeId: { in: routeIds } } } : {}),
      },
    });
  }

  async getGpsOutageCorrectionsForAdmin(routeIds: string[] | null, pagination?: { page: number; limit: number }) {
    const where: any = {
      status: 'PENDING',
      metadata: { path: ['busGPSOffline'], equals: true },
      ...(routeIds ? { attendance: { routeId: { in: routeIds } } } : {}),
    };
    const [corrections, total] = await Promise.all([
      prisma.attendanceCorrection.findMany({
        where,
        include: {
          requestedBy: { select: { id: true, name: true, rollNumber: true, department: true } },
          attendance: { select: { id: true, trip: { select: { id: true, routeId: true, bus: { select: { number: true, plateNumber: true } } } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: pagination ? (pagination.page - 1) * pagination.limit : undefined,
        take: pagination?.limit,
      }),
      prisma.attendanceCorrection.count({ where }),
    ]);
    return { corrections, total };
  }

  async getPendingCorrectionsForAdmin(routeIds: string[] | null, pagination?: { page: number; limit: number }) {
    const where: any = {
      status: 'PENDING',
      ...(routeIds ? { attendance: { routeId: { in: routeIds } } } : {}),
    };
    const [corrections, total] = await Promise.all([
      prisma.attendanceCorrection.findMany({
        where,
        include: {
          attendance: { include: { user: { select: { name: true, rollNumber: true, department: true } }, trip: { select: { busId: true, routeId: true, date: true } } } },
          requestedBy: { select: { name: true, role: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip: pagination ? (pagination.page - 1) * pagination.limit : undefined,
        take: pagination?.limit,
      }),
      prisma.attendanceCorrection.count({ where }),
    ]);
    return { corrections, total };
  }

  async resolveCorrectionForAdmin(correctionId: string, status: 'APPROVED' | 'REJECTED', reviewerId: string, correctionData: any) {
    return prisma.$transaction(async (tx) => {
      const res = await tx.attendanceCorrection.update({
        where: { id: correctionId },
        data: { status, reviewedById: reviewerId, reviewedAt: new Date() }
      });
      if (status === 'APPROVED') {
        await tx.attendanceEvent.create({
          data: {
            attendanceId: correctionData.attendanceId,
            type: 'MANUAL_CORRECTION',
            method: 'MANUAL_ADMIN',
            actorId: reviewerId,
            previousStatus: correctionData.attendance.status,
            newStatus: 'PRESENT',
            metadata: { reason: correctionData.reason }
          }
        });
        await tx.attendanceLog.update({
          where: { id: correctionData.attendanceId },
          data: { status: 'PRESENT' }
        });
      }
      return res;
    });
  }

  async getTripStudentsForAdmin(tripId: string, routeId: string) {
    return prisma.attendanceLog.findMany({
      where: { tripId, routeId },
      include: { user: { select: { id: true, name: true, rollNumber: true, department: true } } },
      orderBy: { user: { name: 'asc' } }
    });
  }

  async getTripTimelineForAdmin(tripId: string, routeId: string) {
    return prisma.attendanceEvent.findMany({
      where: { attendance: { tripId, routeId } },
      include: {
        actor: { select: { name: true, role: true } },
        attendance: { include: { user: { select: { name: true, rollNumber: true } } } }
      },
      orderBy: { timestamp: 'desc' }
    });
  }
}

export const attendanceRepository = new AttendanceRepository();
