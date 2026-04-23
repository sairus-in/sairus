import { redis } from '../../lib/redis';
import { auditService, AuditActorContext } from '../../lib/audit.service';
import { cacheDel, cacheGet, cacheHIncrBy, cacheSet } from '../../lib/cache';
import { prisma } from '../../lib/prisma';
import { NotFoundError, BadRequestError } from '../../lib/errors';
import { ResolvedAdminAccessContext, assertAdminAction } from '../../lib/admin-access';
import {
  AdminAction,
  AdminActionContext,
  AdminCommandCenterPayload,
  AdminCommandEntity,
  AdminGpsOutageCorrection,
  AdminGpsOutageItem,
  AdminGpsOutageQueueResponse,
  AdminLiveAlert,
  AdminMessageInput,
  AdminPriorityLevel,
  AdminSubstituteCandidate,
  NOTIFICATION_TYPE,
  TRIP,
  getTodayDateKey,
} from 'shared';
import { io } from '../../websocket/socket';
import { notificationsService } from '../notifications/notifications.service';

type MessageQuery = {
  busId?: string;
  limit?: number;
  contextType?: string;
  contextId?: string;
};

type ResolvedMessageContext = {
  contextType: string;
  contextId: string;
  busId?: string;
  routeId?: string;
  tripId?: string;
  incidentId?: string;
  derivedType: 'DIRECT' | 'BROADCAST_ALL' | 'BROADCAST_ROUTE' | 'BROADCAST_BUS' | 'SYSTEM_EVENT';
};

const PRIORITY_ORDER: Record<AdminPriorityLevel, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

const minutesSince = (value?: Date | string | null) => {
  if (!value) {
    return null;
  }

  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Math.max(1, Math.floor((Date.now() - timestamp) / 60000));
};

const priorityLabel = (priority: AdminPriorityLevel) => priority[0] + priority.slice(1).toLowerCase();

const normalizeAlert = (rawAlert: string): AdminLiveAlert => {
  const parsed = JSON.parse(rawAlert) as Partial<AdminLiveAlert> & Record<string, unknown>;

  return {
    type: typeof parsed.type === 'string' ? parsed.type : 'UNKNOWN',
    priority: typeof parsed.priority === 'number' ? parsed.priority : 1,
    summary:
      typeof parsed.summary === 'string'
        ? parsed.summary
        : typeof parsed.type === 'string'
          ? parsed.type.replace(/_/g, ' ')
          : 'Live operations alert',
    timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now(),
    tripId: typeof parsed.tripId === 'string' ? parsed.tripId : undefined,
    busId: typeof parsed.busId === 'string' ? parsed.busId : undefined,
    busNumber: typeof parsed.busNumber === 'string' ? parsed.busNumber : undefined,
    routeName: typeof parsed.routeName === 'string' ? parsed.routeName : undefined,
    metadata: typeof parsed.metadata === 'object' && parsed.metadata !== null
      ? parsed.metadata as Record<string, unknown>
      : undefined,
  };
};

export class AdminService {
  private isCoordinatorAccess(access?: ResolvedAdminAccessContext): access is ResolvedAdminAccessContext {
    return access?.role === 'COORDINATOR';
  }

  private getScopedRouteIds(access?: ResolvedAdminAccessContext): string[] | null {
    return this.isCoordinatorAccess(access) ? access.scope.routeIds : null;
  }

  private getScopedCacheKey(baseKey: string, access?: ResolvedAdminAccessContext) {
    const routeIds = this.getScopedRouteIds(access);
    if (!routeIds) {
      return baseKey;
    }

    const suffix = routeIds.length > 0 ? routeIds.slice().sort().join(',') : 'none';
    return `${baseKey}:routes:${suffix}`;
  }

  private assertRouteAction(
    access: ResolvedAdminAccessContext | undefined,
    action: AdminAction,
    routeId?: string | null,
  ) {
    if (!access) {
      return;
    }

    if (this.isCoordinatorAccess(access) && !routeId) {
      throw new BadRequestError('ROUTE_CONTEXT_REQUIRED');
    }

    assertAdminAction(access, action, routeId ? { routeId } : undefined);
  }

  private async getScopedTripOrThrow(
    tripId: string,
    access: ResolvedAdminAccessContext | undefined,
    action: AdminAction,
  ) {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        id: true,
        routeId: true,
        busId: true,
      },
    });

    if (!trip) {
      throw new NotFoundError('TRIP_NOT_FOUND');
    }

    this.assertRouteAction(access, action, trip.routeId);
    return trip;
  }

  private async getScopedIncidentOrThrow(
    incidentId: string,
    access: ResolvedAdminAccessContext | undefined,
    action: AdminAction,
  ) {
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      select: {
        id: true,
        tripId: true,
        routeId: true,
        busId: true,
      },
    });

    if (!incident) {
      throw new NotFoundError('INCIDENT_NOT_FOUND');
    }

    const routeId = incident.routeId ?? (
      await prisma.trip.findUnique({
        where: { id: incident.tripId },
        select: { routeId: true },
      })
    )?.routeId;

    this.assertRouteAction(access, action, routeId);

    return {
      ...incident,
      routeId: routeId ?? null,
    };
  }

  private async getScopedCorrectionOrThrow(
    correctionId: string,
    access: ResolvedAdminAccessContext | undefined,
    action: AdminAction,
  ) {
    const correction = await prisma.attendanceCorrection.findUnique({
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

    if (!correction) {
      throw new NotFoundError('CORRECTION_NOT_FOUND');
    }

    this.assertRouteAction(access, action, correction.attendance.routeId);
    return correction;
  }

  private async getPendingStudentCountMap(tripIds: string[]) {
    if (tripIds.length === 0) {
      return new Map<string, number>();
    }

    const rows = await prisma.attendanceLog.groupBy({
      by: ['tripId'],
      where: {
        tripId: { in: tripIds },
        status: 'PENDING',
      },
      _count: {
        tripId: true,
      },
    });

    return new Map(rows.map((row) => [row.tripId, row._count.tripId]));
  }

  private async getPendingOutageCorrectionCountMap(tripIds: string[]) {
    if (tripIds.length === 0) {
      return new Map<string, number>();
    }

    const rows = await prisma.attendanceCorrection.findMany({
      where: {
        status: 'PENDING',
        metadata: { path: ['busGPSOffline'], equals: true },
        attendance: {
          tripId: { in: tripIds },
        },
      },
      select: {
        attendance: {
          select: {
            tripId: true,
          },
        },
      },
    });

    const counts = new Map<string, number>();
    for (const row of rows) {
      const tripId = row.attendance.tripId;
      counts.set(tripId, (counts.get(tripId) ?? 0) + 1);
    }

    return counts;
  }

  private buildContext(context: AdminActionContext): AdminActionContext {
    return {
      contextType: context.contextType,
      contextId: context.contextId,
      tripId: context.tripId,
      incidentId: context.incidentId,
      busId: context.busId,
      routeId: context.routeId,
      title: context.title,
      subtitle: context.subtitle,
    };
  }

  private buildIncidentEntity(incident: any): AdminCommandEntity {
    const impactedUsers = incident.trip?.expectedCount ?? 0;
    const priority: AdminPriorityLevel =
      incident.escalationLevel === 'PRINCIPAL' || incident.type === 'ACCIDENT' ? 'CRITICAL' : 'HIGH';
    const context = this.buildContext({
      contextType: 'INCIDENT',
      contextId: incident.id,
      tripId: incident.tripId,
      incidentId: incident.id,
      busId: incident.busId,
      routeId: incident.routeId ?? undefined,
      title: `Incident • Bus ${incident.bus.number}`,
      subtitle: `${incident.type.replace(/_/g, ' ')} • ${incident.route?.name ?? incident.trip?.routeId ?? 'Unknown route'}`,
    });

    return {
      id: `incident:${incident.id}`,
      kind: 'INCIDENT',
      priority,
      title: `Bus ${incident.bus.number} • ${incident.type.replace(/_/g, ' ')}`,
      summary: incident.description,
      busNumber: incident.bus.number,
      routeName: incident.route?.name ?? incident.trip?.routeId,
      driverName: incident.trip?.driver?.name ?? null,
      statusLabel: incident.status,
      ageMinutes: minutesSince(incident.reportedAt),
      impactedUsers,
      badges: [priorityLabel(priority), incident.escalationLevel.replace(/_/g, ' ')],
      context,
      actions: [
        {
          id: `contact-driver:${incident.id}`,
          type: 'CONTACT_DRIVER',
          label: 'Contact driver',
          reason: 'Reach the bus team in the incident thread immediately.',
          priority,
          confidence: 'HIGH',
          impactedUsers,
          payload: { incidentId: incident.id, tripId: incident.tripId, busId: incident.busId },
        },
        {
          id: `notify-riders:${incident.id}`,
          type: 'NOTIFY_AFFECTED_USERS',
          label: 'Notify riders',
          reason: 'Affected riders need an update if the incident blocks the route.',
          priority,
          confidence: 'HIGH',
          impactedUsers,
          payload: { tripId: incident.tripId, incidentId: incident.id },
        },
        {
          id: `assign-substitute:${incident.id}`,
          type: 'ASSIGN_SUBSTITUTE',
          label: 'Assign substitute',
          reason: 'Swap in an alternate bus if the route cannot continue as planned.',
          priority,
          confidence: 'MEDIUM',
          impactedUsers,
          payload: { incidentId: incident.id, tripId: incident.tripId, currentBusId: incident.busId },
        },
        {
          id: `resolve-incident:${incident.id}`,
          type: 'RESOLVE_INCIDENT',
          label: 'Resolve incident',
          reason: 'Close the incident once the transport office confirms recovery.',
          priority,
          confidence: 'HIGH',
          impactedUsers,
          payload: { incidentId: incident.id },
        },
        {
          id: `escalate-incident:${incident.id}`,
          type: 'ESCALATE_INCIDENT',
          label: 'Escalate',
          reason: 'Raise the escalation level when the current owner cannot clear the issue.',
          priority,
          confidence: 'MEDIUM',
          impactedUsers,
          payload: { incidentId: incident.id, escalationLevel: incident.escalationLevel },
          disabled: incident.escalationLevel === 'PRINCIPAL',
        },
        {
          id: `open-trip:${incident.id}`,
          type: 'OPEN_TRIP',
          label: 'Open trip',
          reason: 'Review the live trip manifest and timeline.',
          priority: 'LOW',
          confidence: 'HIGH',
          impactedUsers,
          payload: { tripId: incident.tripId },
        },
      ],
    };
  }

  private buildOutageEntity(outage: AdminGpsOutageItem, driverName?: string | null): AdminCommandEntity {
    const priority: AdminPriorityLevel =
      (outage.outageDurationMinutes ?? 0) >= 10 || outage.pendingStudents > 0 ? 'CRITICAL' : 'HIGH';
    const impactedUsers = Math.max(outage.pendingStudents, outage.expectedCount);
    const context = this.buildContext({
      contextType: 'GPS_OUTAGE',
      contextId: outage.tripId,
      tripId: outage.tripId,
      busId: outage.busId,
      routeId: outage.routeId,
      title: `GPS outage • Bus ${outage.busNumber}`,
      subtitle: `${outage.routeName} • ${outage.outageDurationMinutes ?? 0} min offline`,
    });

    return {
      id: `gps-outage:${outage.tripId}`,
      kind: 'GPS_OUTAGE',
      priority,
      title: `Bus ${outage.busNumber} • GPS offline`,
      summary: `${outage.routeName} is offline with ${outage.pendingStudents} pending riders.`,
      busNumber: outage.busNumber,
      routeName: outage.routeName,
      driverName: driverName ?? null,
      statusLabel: outage.queueStatus,
      ageMinutes: outage.outageDurationMinutes,
      impactedUsers,
      badges: [
        priorityLabel(priority),
        outage.delegateActive ? 'Delegate active' : 'No delegate',
        outage.escalationScheduled ? 'Escalated' : 'Needs action',
      ],
      context,
      actions: [
        {
          id: `request-delegate:${outage.tripId}`,
          type: 'REQUEST_DELEGATE',
          label: 'Request delegate',
          reason: 'Ask nearby operators to restore tracking or provide manual coverage.',
          priority,
          confidence: 'MEDIUM',
          impactedUsers,
          payload: { tripId: outage.tripId, busId: outage.busId, routeId: outage.routeId },
        },
        {
          id: `contact-driver:${outage.tripId}`,
          type: 'CONTACT_DRIVER',
          label: 'Contact driver',
          reason: 'Confirm bus status before riders lose confidence in the route.',
          priority,
          confidence: 'HIGH',
          impactedUsers,
          payload: { tripId: outage.tripId, busId: outage.busId },
        },
        {
          id: `notify-riders:${outage.tripId}`,
          type: 'NOTIFY_AFFECTED_USERS',
          label: 'Notify riders',
          reason: 'Push an ops update to riders assigned to the affected route.',
          priority,
          confidence: 'HIGH',
          impactedUsers,
          payload: { tripId: outage.tripId, routeId: outage.routeId },
        },
        {
          id: `coordinator-override:${outage.tripId}`,
          type: 'COORDINATOR_OVERRIDE',
          label: 'Coordinator override',
          reason: 'Close pending attendance only if the transport office confirms the outage impact.',
          priority,
          confidence: outage.pendingStudents > 0 ? 'MEDIUM' : 'LOW',
          impactedUsers,
          payload: { tripId: outage.tripId, pendingStudents: outage.pendingStudents },
          disabled: outage.pendingStudents === 0,
        },
        {
          id: `open-trip:${outage.tripId}`,
          type: 'OPEN_TRIP',
          label: 'Open trip',
          reason: 'Review the active trip to decide the next step.',
          priority: 'LOW',
          confidence: 'HIGH',
          impactedUsers,
          payload: { tripId: outage.tripId },
        },
      ],
    };
  }

  private buildLateStartEntity(trip: any): AdminCommandEntity {
    const lateByMinutes = trip.lateByMinutes ?? 0;
    const priority: AdminPriorityLevel = lateByMinutes >= 20 ? 'HIGH' : 'MEDIUM';
    const impactedUsers = trip.expectedCount ?? 0;
    const context = this.buildContext({
      contextType: 'TRIP',
      contextId: trip.id,
      tripId: trip.id,
      busId: trip.busId,
      routeId: trip.routeId,
      title: `Late start • Bus ${trip.bus.number}`,
      subtitle: `${trip.route.name} • ${lateByMinutes} min late`,
    });

    return {
      id: `late-start:${trip.id}`,
      kind: 'LATE_START',
      priority,
      title: `Bus ${trip.bus.number} • Late start`,
      summary: `${trip.route.name} has not started ${lateByMinutes} minutes after schedule.`,
      busNumber: trip.bus.number,
      routeName: trip.route.name,
      driverName: trip.driver?.name ?? null,
      statusLabel: 'SCHEDULED',
      ageMinutes: lateByMinutes,
      impactedUsers,
      badges: [priorityLabel(priority), 'Needs dispatch check'],
      context,
      actions: [
        {
          id: `contact-driver:${trip.id}`,
          type: 'CONTACT_DRIVER',
          label: 'Contact driver',
          reason: 'Confirm whether the route can still launch on time.',
          priority,
          confidence: 'HIGH',
          impactedUsers,
          payload: { tripId: trip.id, busId: trip.busId },
        },
        {
          id: `notify-riders:${trip.id}`,
          type: 'NOTIFY_AFFECTED_USERS',
          label: 'Notify riders',
          reason: 'Late starts should push ETA updates to affected riders.',
          priority,
          confidence: 'MEDIUM',
          impactedUsers,
          payload: { tripId: trip.id, routeId: trip.routeId },
        },
        {
          id: `open-trip:${trip.id}`,
          type: 'OPEN_TRIP',
          label: 'Open trip',
          reason: 'Review the trip record and route context.',
          priority: 'LOW',
          confidence: 'HIGH',
          impactedUsers,
          payload: { tripId: trip.id },
        },
      ],
    };
  }

  private async resolveMessageContext(
    context?: AdminActionContext,
    busId?: string,
    routeId?: string,
    explicitType?: 'DIRECT' | 'BROADCAST_ALL' | 'BROADCAST_ROUTE' | 'BROADCAST_BUS' | 'SYSTEM_EVENT',
  ): Promise<ResolvedMessageContext> {
    if (!context) {
      return {
        contextType: 'BROADCAST',
        contextId: 'GLOBAL',
        busId,
        routeId,
        derivedType: explicitType ?? (busId ? 'BROADCAST_BUS' : routeId ? 'BROADCAST_ROUTE' : 'BROADCAST_ALL'),
      };
    }

    if (context.contextType === 'TRIP' || context.contextType === 'GPS_OUTAGE') {
      const trip = await prisma.trip.findUnique({
        where: { id: context.tripId ?? context.contextId },
        select: { id: true, busId: true, routeId: true },
      });
      if (!trip) {
        throw new NotFoundError('TRIP_NOT_FOUND');
      }

      return {
        contextType: context.contextType,
        contextId: context.contextId,
        busId: trip.busId,
        routeId: trip.routeId,
        tripId: trip.id,
        incidentId: context.incidentId,
        derivedType: explicitType ?? 'BROADCAST_BUS',
      };
    }

    if (context.contextType === 'INCIDENT') {
      const incident = await prisma.incident.findUnique({
        where: { id: context.incidentId ?? context.contextId },
        select: {
          id: true,
          busId: true,
          routeId: true,
          tripId: true,
          trip: {
            select: {
              routeId: true,
            },
          },
        },
      });
      if (!incident) {
        throw new NotFoundError('INCIDENT_NOT_FOUND');
      }

      return {
        contextType: 'INCIDENT',
        contextId: incident.id,
        busId: incident.busId,
        routeId: incident.routeId ?? incident.trip.routeId,
        tripId: incident.tripId,
        incidentId: incident.id,
        derivedType: explicitType ?? 'BROADCAST_BUS',
      };
    }

    if (context.contextType === 'ROUTE') {
      return {
        contextType: 'ROUTE',
        contextId: context.routeId ?? context.contextId,
        routeId: context.routeId ?? context.contextId,
        derivedType: explicitType ?? 'BROADCAST_ROUTE',
      };
    }

    return {
      contextType: 'BROADCAST',
      contextId: context.contextId || 'GLOBAL',
      busId,
      routeId,
      derivedType: explicitType ?? 'BROADCAST_ALL',
    };
  }

  private async getLateStartEntityInputs(access?: ResolvedAdminAccessContext) {
    const routeIds = this.getScopedRouteIds(access);
    if (routeIds && routeIds.length === 0) {
      return [];
    }

    const today = getTodayDateKey();
    const scheduledTrips = await prisma.trip.findMany({
      where: {
        date: today,
        status: 'SCHEDULED',
        ...(routeIds ? { routeId: { in: routeIds } } : {}),
      },
      include: {
        bus: { select: { number: true } },
        route: {
          select: {
            name: true,
            stops: {
              orderBy: { sequence: 'asc' },
              take: 1,
              include: { stop: true },
            },
          },
        },
        driver: { select: { name: true } },
      },
    });

    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
    const currentMinutes = hour * 60 + minute;

    return scheduledTrips
      .map((trip) => {
        const firstStop = trip.route.stops[0];
        if (!firstStop) {
          return null;
        }

        const scheduledTime = trip.type === 'MORNING'
          ? firstStop.scheduledTimeMorning
          : firstStop.scheduledTimeReturn;
        const lateByMinutes = currentMinutes - scheduledTime;
        if (lateByMinutes < TRIP.LATE_START_ALERT_MINUTES) {
          return null;
        }

        return {
          ...trip,
          lateByMinutes,
        };
      })
      .filter((trip): trip is NonNullable<typeof trip> => trip !== null);
  }

  /**
   * Pattern 1: Live Ops Dashboard Stats
   * Guaranteed < 20ms response time fed entirely via Redis.
   */
  async getLiveDashboardStats(access?: ResolvedAdminAccessContext) {
    const routeIds = this.getScopedRouteIds(access);
    if (routeIds) {
      if (routeIds.length === 0) {
        return {
          activeTrips: 0,
          checkedIn: 0,
          gpsOffline: 0,
          openCorrections: 0,
        };
      }

      const [activeTrips, gpsOffline, openCorrections] = await Promise.all([
        this.getActiveTrips(access),
        prisma.trip.count({
          where: {
            status: 'ACTIVE',
            gpsStatus: 'OFFLINE',
            routeId: { in: routeIds },
          },
        }),
        prisma.attendanceCorrection.count({
          where: {
            status: 'PENDING',
            attendance: {
              routeId: { in: routeIds },
            },
          },
        }),
      ]);

      return {
        activeTrips: activeTrips.length,
        checkedIn: activeTrips.reduce((sum, trip) => sum + (trip.boardedCount ?? 0), 0),
        gpsOffline,
        openCorrections,
      };
    }

    const stats = await redis.hgetall('dashboard:stats');
    return {
      activeTrips: parseInt(stats.activeTrips || '0', 10),
      checkedIn: parseInt(stats.checkedIn || '0', 10),
      gpsOffline: parseInt(stats.gpsOffline || '0', 10),
      openCorrections: parseInt(stats.openCorrections || '0', 10)
    };
  }

  /**
   * Pattern 1: Get Active Trips Array
   * Iterates real-time trips set to return populated Hash states.
   */
  async getActiveTrips(access?: ResolvedAdminAccessContext) {
    const tripIds = await redis.smembers('active-trips');
    if (!tripIds.length) return [];

    const routeIds = this.getScopedRouteIds(access);
    const activeTrips: any[] = [];
    for (const id of tripIds) {
      const state = await redis.hgetall(`trip:${id}:state`);
      if (routeIds && !routeIds.includes(state.routeId || '')) {
        continue;
      }
      
      // Parse numerical values back to integers
      activeTrips.push({
        id,
        ...state,
        boardedCount: parseInt(state.boardedCount || '0', 10),
        expectedCount: parseInt(state.expectedCount || '0', 10),
        startedAt: parseInt(state.startedAt || '0', 10)
      });
    }

    // Sort by startedAt descending initially (UI will override via urgencyScore)
    return activeTrips.sort((a, b) => b.startedAt - a.startedAt);
  }

  /**
   * Pattern 1: Get single Trip State
   */
  async getTripState(tripId: string, access?: ResolvedAdminAccessContext) {
    const state = await redis.hgetall(`trip:${tripId}:state`);
    if (!Object.keys(state).length) return null;

    const routeIds = this.getScopedRouteIds(access);
    if (routeIds && !routeIds.includes(state.routeId || '')) {
      return null;
    }

    return {
      id: tripId,
      ...state,
      boardedCount: parseInt(state.boardedCount || '0', 10),
      expectedCount: parseInt(state.expectedCount || '0', 10),
      startedAt: parseInt(state.startedAt || '0', 10)
    };
  }

  // ==========================================
  // PATTERN 1: LIVE ALERTS
  // ==========================================
  
  async getLiveAlerts(access?: ResolvedAdminAccessContext) {
    // Get all alerts from sorted set, top score first (newest timestamp)
    const rawAlerts = await redis.zrevrange('admin:alerts', 0, 50);
    const routeIds = this.getScopedRouteIds(access);
    if (!routeIds) {
      return rawAlerts.map(normalizeAlert);
    }

    const scopedRouteIds = new Set(routeIds);
    const parsedAlerts = rawAlerts.map((rawAlert) => {
      const parsed = JSON.parse(rawAlert) as Record<string, unknown>;
      const metadata =
        typeof parsed.metadata === 'object' && parsed.metadata !== null
          ? parsed.metadata as Record<string, unknown>
          : undefined;

      const routeId = typeof parsed.routeId === 'string'
        ? parsed.routeId
        : typeof metadata?.routeId === 'string'
          ? metadata.routeId
          : undefined;
      const tripId = typeof parsed.tripId === 'string'
        ? parsed.tripId
        : typeof metadata?.tripId === 'string'
          ? metadata.tripId
          : undefined;

      return { rawAlert, routeId, tripId };
    });

    const tripIds = Array.from(new Set(parsedAlerts.flatMap((alert) => (alert.tripId ? [alert.tripId] : []))));
    const trips = tripIds.length > 0
      ? await prisma.trip.findMany({
        where: {
          id: { in: tripIds },
          routeId: { in: routeIds },
        },
        select: { id: true },
      })
      : [];
    const allowedTripIds = new Set(trips.map((trip) => trip.id));

    return parsedAlerts
      .filter((alert) => {
        if (alert.routeId) {
          return scopedRouteIds.has(alert.routeId);
        }

        if (alert.tripId) {
          return allowedTripIds.has(alert.tripId);
        }

        return false;
      })
      .map((alert) => normalizeAlert(alert.rawAlert));
  }

  async getCommandCenter(access?: ResolvedAdminAccessContext): Promise<AdminCommandCenterPayload> {
    const routeIds = this.getScopedRouteIds(access);
    if (routeIds && routeIds.length === 0) {
      return {
        generatedAt: new Date().toISOString(),
        stats: {
          activeTrips: 0,
          criticalCount: 0,
          highCount: 0,
          unresolvedIncidents: 0,
          gpsOffline: 0,
          impactedUsers: 0,
        },
        entities: [],
      };
    }

    const [stats, outageQueue, lateStarts, unresolvedIncidents, activeTrips] = await Promise.all([
      this.getLiveDashboardStats(access),
      this.getGpsOutageQueue(access),
      this.getLateStartEntityInputs(access),
      prisma.incident.findMany({
        where: {
          status: { in: ['REPORTED', 'ASSIGNED'] },
          ...(routeIds ? { trip: { routeId: { in: routeIds } } } : {}),
        },
        include: {
          trip: {
            select: {
              id: true,
              routeId: true,
              expectedCount: true,
              driver: { select: { name: true } },
            },
          },
          route: { select: { id: true, name: true } },
          bus: { select: { number: true, plateNumber: true } },
          reportedBy: { select: { name: true, role: true } },
        },
        orderBy: { reportedAt: 'desc' },
      }),
      this.getActiveTrips(access),
    ]);

    const tripIdToDriver = new Map(activeTrips.map((trip) => [trip.id, trip.driverName ?? null]));
    const entities: AdminCommandEntity[] = [];

    for (const incident of unresolvedIncidents) {
      entities.push(this.buildIncidentEntity(incident));
    }

    for (const outage of outageQueue.activeOutages) {
      entities.push(this.buildOutageEntity(outage, tripIdToDriver.get(outage.tripId) ?? null));
    }

    for (const lateStart of lateStarts) {
      entities.push(this.buildLateStartEntity(lateStart));
    }

    for (const trip of activeTrips.filter((item) => item.gpsStatus === 'STALE')) {
      entities.push({
        id: `trip-risk:${trip.id}`,
        kind: 'TRIP_RISK',
        priority: 'MEDIUM',
        title: `Bus ${trip.busNumber} • Weak telemetry`,
        summary: `${trip.routeName} is still moving but the GPS feed is degrading.`,
        busNumber: trip.busNumber,
        routeName: trip.routeName,
        driverName: trip.driverName ?? null,
        statusLabel: trip.gpsStatus,
        ageMinutes: minutesSince(new Date(trip.startedAt)),
        impactedUsers: trip.expectedCount,
        badges: ['Medium', 'Watch signal'],
        context: this.buildContext({
          contextType: 'TRIP',
          contextId: trip.id,
          tripId: trip.id,
          busId: trip.busId,
          routeId: trip.routeId,
          title: `Trip risk • Bus ${trip.busNumber}`,
          subtitle: `${trip.routeName} • weak telemetry`,
        }),
        actions: [
          {
            id: `contact-driver:${trip.id}`,
            type: 'CONTACT_DRIVER',
            label: 'Contact driver',
            reason: 'Confirm that the route is still moving and the device has not gone to sleep.',
            priority: 'MEDIUM',
            confidence: 'HIGH',
            impactedUsers: trip.expectedCount,
            payload: { tripId: trip.id, busId: trip.busId },
          },
          {
            id: `open-trip:${trip.id}`,
            type: 'OPEN_TRIP',
            label: 'Open trip',
            reason: 'Inspect the trip feed and student manifest.',
            priority: 'LOW',
            confidence: 'HIGH',
            impactedUsers: trip.expectedCount,
            payload: { tripId: trip.id },
          },
          {
            id: `watch-only:${trip.id}`,
            type: 'WATCH_ONLY',
            label: 'Watch only',
            reason: 'Signal is weak but not yet fully offline.',
            priority: 'LOW',
            confidence: 'MEDIUM',
            impactedUsers: trip.expectedCount,
            payload: { tripId: trip.id },
          },
        ],
      });
    }

    entities.sort((left, right) => {
      const priorityDelta = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return (right.ageMinutes ?? 0) - (left.ageMinutes ?? 0);
    });

    const impactedUsers = entities.reduce((sum, entity) => sum + entity.impactedUsers, 0);

    return {
      generatedAt: new Date().toISOString(),
      stats: {
        activeTrips: stats.activeTrips,
        criticalCount: entities.filter((entity) => entity.priority === 'CRITICAL').length,
        highCount: entities.filter((entity) => entity.priority === 'HIGH').length,
        unresolvedIncidents: unresolvedIncidents.length,
        gpsOffline: stats.gpsOffline,
        impactedUsers,
      },
      entities,
    };
  }

  async getGpsOutageQueue(access?: ResolvedAdminAccessContext): Promise<AdminGpsOutageQueueResponse> {
    const activeTripIds = await redis.smembers('active-trips');
    const routeIds = this.getScopedRouteIds(access);
    const activeStatePipeline = redis.pipeline();
    activeTripIds.forEach((tripId) => activeStatePipeline.hgetall(`trip:${tripId}:state`));
    const activeStateResults = activeTripIds.length > 0
      ? await activeStatePipeline.exec() as Array<[Error | null, Record<string, string>]>
      : [];

    const activeOutageStates = activeTripIds
      .map((tripId, index) => {
        const [, state] = activeStateResults[index] ?? [];
        if (
          !state
          || Object.keys(state).length === 0
          || state.gpsStatus !== 'OFFLINE'
          || (routeIds && !routeIds.includes(state.routeId || ''))
        ) {
          return null;
        }
        return { tripId, state };
      })
      .filter((item): item is { tripId: string; state: Record<string, string> } => item !== null);

    const activeOutageTripIds = activeOutageStates.map((item) => item.tripId);
    const activePendingCountMap = await this.getPendingStudentCountMap(activeOutageTripIds);
    const activeCorrectionCountMap = await this.getPendingOutageCorrectionCountMap(activeOutageTripIds);

    const activeMetaPipeline = redis.pipeline();
    activeOutageStates.forEach(({ tripId, state }) => {
      activeMetaPipeline.get(`gps:offline:since:${state.busId}`);
      activeMetaPipeline.exists(`trip:delegate:${tripId}`);
      activeMetaPipeline.exists(`gps:outage:escalation:scheduled:${tripId}`);
    });
    const activeMetaResults = activeOutageStates.length > 0
      ? await activeMetaPipeline.exec() as Array<[Error | null, string | number | null]>
      : [];

    const activeOutages: AdminGpsOutageItem[] = activeOutageStates.map(({ tripId, state }, index) => {
      const offlineSinceRaw = activeMetaResults[index * 3]?.[1];
      const delegateActiveRaw = activeMetaResults[index * 3 + 1]?.[1];
      const escalationScheduledRaw = activeMetaResults[index * 3 + 2]?.[1];
      const offlineSince = typeof offlineSinceRaw === 'string' ? Number(offlineSinceRaw) : null;

      return {
        tripId,
        tripStatus: 'ACTIVE',
        queueStatus: 'ACTIVE_OUTAGE',
        gpsStatus: 'OFFLINE',
        busId: state.busId,
        busNumber: state.busNumber || 'Unknown',
        routeId: state.routeId || '',
        routeName: state.routeName || 'Unknown route',
        startedAt: state.startedAt ? new Date(Number(state.startedAt)).toISOString() : null,
        endedAt: null,
        outageSince: offlineSince ? new Date(offlineSince).toISOString() : null,
        outageDurationMinutes: offlineSince ? Math.max(1, Math.floor((Date.now() - offlineSince) / 60000)) : null,
        expectedCount: parseInt(state.expectedCount || '0', 10),
        boardedCount: parseInt(state.boardedCount || '0', 10),
        pendingStudents: activePendingCountMap.get(tripId) ?? 0,
        pendingOutageCorrections: activeCorrectionCountMap.get(tripId) ?? 0,
        delegateActive: delegateActiveRaw === 1,
        escalationScheduled: escalationScheduledRaw === 1,
        outageWindowOpen: false,
      };
    });

    const completedTrips = await prisma.trip.findMany({
      where: {
        status: 'COMPLETED',
        gpsOutageStart: { not: null },
        ...(routeIds ? { routeId: { in: routeIds } } : {}),
      },
      include: {
        bus: { select: { number: true } },
        route: { select: { id: true, name: true } },
      },
      orderBy: { endedAt: 'desc' },
      take: 25,
    });

    const completedTripIds = completedTrips.map((trip) => trip.id);
    const completedPendingCountMap = await this.getPendingStudentCountMap(completedTripIds);
    const completedCorrectionCountMap = await this.getPendingOutageCorrectionCountMap(completedTripIds);

    const reviewMetaPipeline = redis.pipeline();
    completedTrips.forEach((trip) => {
      reviewMetaPipeline.exists(`trip:outage-window:${trip.id}`);
      reviewMetaPipeline.exists(`trip:delegate:${trip.id}`);
    });
    const reviewMetaResults = completedTrips.length > 0
      ? await reviewMetaPipeline.exec() as Array<[Error | null, number]>
      : [];

    const reviewQueue = completedTrips
      .map((trip, index): AdminGpsOutageItem => {
        const outageWindowOpen = reviewMetaResults[index * 2]?.[1] === 1;
        const delegateActive = reviewMetaResults[index * 2 + 1]?.[1] === 1;
        const pendingStudents = completedPendingCountMap.get(trip.id) ?? 0;
        const pendingOutageCorrections = completedCorrectionCountMap.get(trip.id) ?? 0;

        return {
          tripId: trip.id,
          tripStatus: 'COMPLETED',
          queueStatus: 'OUTAGE_REVIEW',
          gpsStatus: 'RECOVERED',
          busId: trip.busId,
          busNumber: trip.bus.number,
          routeId: trip.route.id,
          routeName: trip.route.name,
          startedAt: trip.startedAt?.toISOString() ?? null,
          endedAt: trip.endedAt?.toISOString() ?? null,
          outageSince: trip.gpsOutageStart?.toISOString() ?? null,
          outageDurationMinutes:
            trip.gpsOutageStart && trip.endedAt
              ? Math.max(1, Math.floor((trip.endedAt.getTime() - trip.gpsOutageStart.getTime()) / 60000))
              : null,
          expectedCount: trip.expectedCount,
          boardedCount: trip.boardedCount,
          pendingStudents,
          pendingOutageCorrections,
          delegateActive,
          escalationScheduled: false,
          outageWindowOpen,
        };
      })
      .filter((item) => item.outageWindowOpen || item.pendingOutageCorrections > 0 || item.pendingStudents > 0);

    return {
      activeOutages,
      reviewQueue,
      generatedAt: new Date().toISOString(),
    };
  }

  async getGpsOutageCorrections(access?: ResolvedAdminAccessContext): Promise<AdminGpsOutageCorrection[]> {
    const routeIds = this.getScopedRouteIds(access);
    if (routeIds && routeIds.length === 0) {
      return [];
    }

    const corrections = await prisma.attendanceCorrection.findMany({
      where: {
        status: 'PENDING',
        metadata: { path: ['busGPSOffline'], equals: true },
        ...(routeIds ? { attendance: { routeId: { in: routeIds } } } : {}),
      },
      include: {
        requestedBy: {
          select: {
            id: true,
            name: true,
            rollNumber: true,
            department: true,
          },
        },
        attendance: {
          select: {
            id: true,
            trip: {
              select: {
                id: true,
                routeId: true,
                bus: {
                  select: {
                    number: true,
                    plateNumber: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return corrections.map((correction) => ({
      id: correction.id,
      reason: correction.reason,
      createdAt: correction.createdAt.toISOString(),
      requestedBy: correction.requestedBy,
      attendance: correction.attendance,
      metadata:
        typeof correction.metadata === 'object' && correction.metadata !== null
          ? correction.metadata as Record<string, unknown>
          : null,
    }));
  }

  // ==========================================
  // PATTERN 2: OPERATIONAL (PostgreSQL + Cache)
  // ==========================================

  async getPendingCorrections(access?: ResolvedAdminAccessContext) {
    const routeIds = this.getScopedRouteIds(access);
    if (routeIds && routeIds.length === 0) {
      return [];
    }

    const cacheKey = this.getScopedCacheKey('admin:corrections:pending', access);
    const cached = await cacheGet(cacheKey);
    if (cached) return cached;

    const corrections = await prisma.attendanceCorrection.findMany({
      where: {
        status: 'PENDING',
        ...(routeIds ? { attendance: { routeId: { in: routeIds } } } : {}),
      },
      include: {
        attendance: {
          include: { 
            user: { select: { name: true, rollNumber: true, department: true } }, 
            trip: { select: { busId: true, routeId: true, date: true } }
          }
        },
        requestedBy: { select: { name: true, role: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    cacheSet(cacheKey, corrections, 30);
    return corrections;
  }

  async resolveCorrection(
    correctionId: string,
    status: 'APPROVED' | 'REJECTED',
    reviewerId: string,
    access?: ResolvedAdminAccessContext,
    auditActor?: AuditActorContext,
  ) {
    const correction = await this.getScopedCorrectionOrThrow(correctionId, access, 'REVIEW_CORRECTIONS');
    if (correction.status !== 'PENDING') throw new BadRequestError('CORRECTION_ALREADY_RESOLVED');
    const before = {
      correctionStatus: correction.status,
      attendanceStatus: correction.attendance.status,
    };

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.attendanceCorrection.update({
        where: { id: correctionId },
        data: {
          status,
          reviewedById: reviewerId,
          reviewedAt: new Date()
        }
      });

      if (status === 'APPROVED') {
        // Find existing event to mark transition
        await tx.attendanceEvent.create({
          data: {
            attendanceId: correction.attendanceId,
            type: 'MANUAL_CORRECTION',
            method: 'MANUAL_ADMIN',
            actorId: reviewerId,
            previousStatus: correction.attendance.status,
            newStatus: 'PRESENT',
            metadata: { reason: correction.reason }
          }
        });

        await tx.attendanceLog.update({
          where: { id: correction.attendanceId },
          data: { status: 'PRESENT' }
        });
      }

      return res;
    });

    // Invalidate Pattern 2 cache and live stats
    await cacheDel(this.getScopedCacheKey('admin:corrections:pending', access));
    await cacheHIncrBy('dashboard:stats', 'openCorrections', -1);

    if (io) {
      io.to('admin').emit('gps:outage_review_updated', {
        tripId: correction.attendance.tripId,
        correctionId,
        correctionStatus: updated.status,
      });
    }

    if (auditActor) {
      auditService.log({
        actor: {
          ...auditActor,
          routeIds: auditActor.routeIds?.length ? auditActor.routeIds : [correction.attendance.routeId],
        },
        action: 'RESOLVE_CORRECTION',
        entityType: 'attendanceCorrection',
        entityId: correctionId,
        before,
        after: {
          correctionStatus: updated.status,
          attendanceStatus: status === 'APPROVED' ? 'PRESENT' : correction.attendance.status,
        },
        meta: {
          reviewerId,
          requestedAction: status,
        },
      });
    }
    
    return updated;
  }

  async assertTripAccess(
    tripId: string,
    action: AdminAction,
    access?: ResolvedAdminAccessContext,
  ) {
    await this.getScopedTripOrThrow(tripId, access, action);
  }

  async resolveIncident(
    incidentId: string,
    resolverId: string,
    resolutionNotes: string,
    access?: ResolvedAdminAccessContext,
  ) {
    const incident = await this.getScopedIncidentOrThrow(incidentId, access, 'RESOLVE_INCIDENTS');

    const updated = await prisma.incident.update({
      where: { id: incidentId },
      data: {
        status: 'RESOLVED',
        resolvedById: resolverId,
        resolutionNotes,
        resolvedAt: new Date(),
      },
    });

    if (io) {
      io.to('admin').emit('incident:updated', {
        incidentId: updated.id,
        tripId: incident.tripId,
        busId: incident.busId,
        routeId: incident.routeId,
        status: updated.status,
      });
    }

    return updated;
  }

  async getTripStudents(tripId: string, access?: ResolvedAdminAccessContext) {
    const trip = await this.getScopedTripOrThrow(tripId, access, 'VIEW_TRIP_DETAIL');
    const cacheKey = this.getScopedCacheKey(`trip:${tripId}:students`, access);
    const cached = await cacheGet(cacheKey);
    if (cached) return cached;

    const logs = await prisma.attendanceLog.findMany({
      where: {
        tripId,
        routeId: trip.routeId,
      },
      include: {
        user: { select: { id: true, name: true, rollNumber: true, department: true } }
      },
      orderBy: { user: { name: 'asc' } }
    });

    cacheSet(cacheKey, logs, 10);
    return logs;
  }

  async getTripTimeline(tripId: string, access?: ResolvedAdminAccessContext) {
    const trip = await this.getScopedTripOrThrow(tripId, access, 'VIEW_TRIP_DETAIL');
    const cacheKey = this.getScopedCacheKey(`trip:${tripId}:timeline`, access);
    const cached = await cacheGet(cacheKey);
    if (cached) return cached;

    // Get events from attendance
    const attendanceEvents = await prisma.attendanceEvent.findMany({
      where: {
        attendance: {
          tripId,
          routeId: trip.routeId,
        },
      },
      include: {
        actor: { select: { name: true, role: true } },
        attendance: { include: { user: { select: { name: true, rollNumber: true } } } }
      },
      orderBy: { timestamp: 'desc' }
    });

    // Format them into a generic timeline stream
    const timelineEvents = attendanceEvents.map(e => ({
      id: e.id,
      timestamp: e.timestamp,
      type: e.type,
      message: `${e.type.replace('_', ' ')} for ${e.attendance.user.name}`,
      actor: e.actor ? e.actor.name : 'System',
      metadata: e.metadata
    }));

    cacheSet(cacheKey, timelineEvents, 60);
    return timelineEvents;
  }

  async getIncidents(status?: string, access?: ResolvedAdminAccessContext) {
    const routeIds = this.getScopedRouteIds(access);
    if (routeIds && routeIds.length === 0) {
      return [];
    }

    const whereClause: any = {};
    if (status) {
      whereClause.status = status;
    }
    if (routeIds) {
      whereClause.trip = {
        routeId: { in: routeIds },
      };
    }

    return await prisma.incident.findMany({
      where: whereClause,
      include: {
        trip: {
          select: {
            id: true,
            routeId: true,
            date: true,
            expectedCount: true,
            driver: { select: { name: true } },
          },
        },
        route: { select: { id: true, name: true } },
        bus: { select: { number: true, plateNumber: true } },
        reportedBy: { select: { name: true, role: true } },
        resolvedBy: { select: { name: true } }
      },
      orderBy: { reportedAt: 'desc' }
    });
  }

  async getMessages(params: MessageQuery = {}, access?: ResolvedAdminAccessContext) {
    const { busId, limit = 50, contextType, contextId } = params;
    const routeIds = this.getScopedRouteIds(access);
    if (routeIds && routeIds.length === 0) {
      return [];
    }

    let whereClause: Record<string, unknown> = {};

    if (contextType && contextId) {
      whereClause = { contextType, contextId };
    } else if (busId) {
      whereClause = { busId };
    } else {
      whereClause = {
        OR: [
          { type: 'BROADCAST_ALL' },
          { contextType: 'BROADCAST', contextId: 'GLOBAL' },
        ],
      };
    }

    if (routeIds) {
      whereClause = {
        AND: [
          whereClause,
          {
            OR: [
              { routeId: { in: routeIds } },
              {
                AND: [
                  {
                    OR: [
                      { type: 'BROADCAST_ALL' },
                      { contextType: 'BROADCAST', contextId: 'GLOBAL' },
                    ],
                  },
                  { routeId: null },
                ],
              },
            ],
          },
        ],
      };
    }

    return await (prisma.message as any).findMany({
      where: whereClause,
      include: {
        sender: { select: { name: true, role: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
  }

  async sendMessage(senderId: string, input: AdminMessageInput, access?: ResolvedAdminAccessContext) {
    const resolved = await this.resolveMessageContext(input.context, input.busId, input.routeId, input.type);
    this.assertRouteAction(access, 'SEND_MESSAGE_TO_DRIVER', resolved.routeId);

    const message = await (prisma.message as any).create({
      data: {
        senderId,
        body: input.body,
        busId: resolved.busId,
        routeId: resolved.routeId,
        tripId: resolved.tripId,
        incidentId: resolved.incidentId,
        contextType: resolved.contextType,
        contextId: resolved.contextId,
        type: resolved.derivedType,
        priority: input.priority ?? 'NORMAL'
      },
      include: {
        sender: { select: { name: true, role: true } }
      }
    });

    if (io) {
      const payload = {
        id: message.id,
        body: message.body,
        isUrgent: message.priority === 'URGENT',
        busId: message.busId,
        routeId: message.routeId,
        tripId: message.tripId,
        incidentId: message.incidentId,
        contextType: message.contextType,
        contextId: message.contextId,
        type: message.type,
        priority: message.priority,
        sender: message.sender,
        createdAt: message.createdAt.toISOString(),
      };

      if (message.busId) {
        io.to(`bus:${message.busId}`).emit('admin:message', payload);

      }
      if (message.routeId) {
        io.to(`route:${message.routeId}`).emit('admin:message', payload);
      }
      if (message.tripId) {
        io.to(`trip:${message.tripId}`).emit('admin:message', payload);
      }
      io.to('admin').emit('admin:message', payload);
    }

    return message;
  }

  async notifyAffectedUsers(
    tripId: string,
    actorId: string,
    note?: string,
    access?: ResolvedAdminAccessContext,
  ) {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        bus: { select: { number: true } },
        route: { select: { id: true, name: true } },
      },
    });

    if (!trip) {
      throw new NotFoundError('TRIP_NOT_FOUND');
    }

    this.assertRouteAction(access, 'SEND_MESSAGE_TO_DRIVER', trip.routeId);

    const assignments = await prisma.routeAssignment.findMany({
      where: {
        routeId: trip.routeId,
        isActive: true,
        user: { role: 'STUDENT', isActive: true },
      },
      select: { userId: true },
    });
    const userIds = assignments.map((assignment) => assignment.userId);

    const body = note?.trim() || `Transport office update for Bus ${trip.bus.number} on ${trip.route.name}.`;

    await notificationsService.dispatch(
      userIds,
      {
        type: NOTIFICATION_TYPE.NEW_MESSAGE,
        title: `Update for Bus ${trip.bus.number}`,
        body,
        metadata: { tripId: trip.id, routeId: trip.route.id, busNumber: trip.bus.number },
      },
      ['PUSH', 'IN_APP'],
    );

    await this.sendMessage(actorId, {
      body,
      priority: 'URGENT',
      context: {
        contextType: 'TRIP',
        contextId: trip.id,
        tripId: trip.id,
        busId: trip.busId,
        routeId: trip.routeId,
      },
    }, access);

    return {
      success: true,
      notifiedUsers: userIds.length,
      tripId,
    };
  }

  async requestDelegateSupport(
    tripId: string,
    actorId: string,
    note?: string,
    access?: ResolvedAdminAccessContext,
  ) {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        bus: { select: { number: true } },
        route: { select: { id: true, name: true } },
      },
    });

    if (!trip) {
      throw new NotFoundError('TRIP_NOT_FOUND');
    }

    this.assertRouteAction(access, 'COORDINATOR_OVERRIDE', trip.routeId);

    const [coordinators, officers] = await Promise.all([
      prisma.routeCoordinator.findMany({
        where: { routeId: trip.routeId },
        select: { userId: true },
      }),
      prisma.user.findMany({
        where: {
          role: { in: ['TRANSPORT_OFFICER', 'MANAGEMENT'] },
          isActive: true,
        },
        select: { id: true },
      }),
    ]);

    const userIds = Array.from(new Set([
      ...coordinators.map((item) => item.userId),
      ...officers.map((item) => item.id),
    ].filter((userId) => userId !== actorId)));

    const body = note?.trim() || `Delegate support requested for Bus ${trip.bus.number} on ${trip.route.name}.`;

    await notificationsService.dispatch(
      userIds,
      {
        type: NOTIFICATION_TYPE.GPS_OFFLINE_DELEGATE_REQUEST,
        title: `Delegate requested for Bus ${trip.bus.number}`,
        body,
        metadata: { tripId: trip.id, routeId: trip.routeId, busId: trip.busId },
      },
      ['PUSH', 'IN_APP'],
    );

    await this.sendMessage(actorId, {
      body,
      priority: 'URGENT',
      type: 'SYSTEM_EVENT',
      context: {
        contextType: 'GPS_OUTAGE',
        contextId: trip.id,
        tripId: trip.id,
        busId: trip.busId,
        routeId: trip.routeId,
      },
    }, access);

    return {
      success: true,
      requestedUsers: userIds.length,
      tripId,
    };
  }

  async escalateIncident(
    incidentId: string,
    actorId: string,
    note?: string,
    access?: ResolvedAdminAccessContext,
  ) {
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: {
        bus: { select: { number: true } },
        route: { select: { name: true } },
        trip: { select: { routeId: true } },
      },
    });

    if (!incident) {
      throw new NotFoundError('INCIDENT_NOT_FOUND');
    }
    this.assertRouteAction(access, 'ESCALATE_INCIDENTS', incident.routeId ?? incident.trip.routeId);
    if (incident.status === 'RESOLVED' || incident.status === 'CANCELLED') {
      throw new BadRequestError('INCIDENT_NOT_ACTIVE');
    }

    const nextLevel = incident.escalationLevel === 'COORDINATOR'
      ? 'TRANSPORT_OFFICER'
      : incident.escalationLevel === 'TRANSPORT_OFFICER'
        ? 'PRINCIPAL'
        : 'PRINCIPAL';

    const updated = await prisma.incident.update({
      where: { id: incidentId },
      data: {
        escalationLevel: nextLevel,
        status: 'ASSIGNED',
        assignedAt: incident.assignedAt ?? new Date(),
      },
      include: {
        bus: { select: { number: true } },
        route: { select: { name: true } },
      },
    });

    const targetRoles = nextLevel === 'TRANSPORT_OFFICER' ? ['TRANSPORT_OFFICER'] : ['MANAGEMENT'];
    const recipients = await prisma.user.findMany({
      where: { role: { in: targetRoles as any }, isActive: true },
      select: { id: true },
    });

    const body = note?.trim()
      || `Incident on Bus ${updated.bus.number} escalated to ${nextLevel.replace(/_/g, ' ')}.`;

    await notificationsService.dispatch(
      recipients.map((recipient) => recipient.id),
      {
        type: NOTIFICATION_TYPE.BREAKDOWN_ALERT,
        title: `Incident escalated • Bus ${updated.bus.number}`,
        body,
        metadata: { incidentId: updated.id, tripId: updated.tripId, escalationLevel: nextLevel },
      },
      ['PUSH', 'IN_APP'],
    );

    await this.sendMessage(actorId, {
      body,
      priority: 'URGENT',
      type: 'SYSTEM_EVENT',
      context: {
        contextType: 'INCIDENT',
        contextId: updated.id,
        tripId: updated.tripId,
        incidentId: updated.id,
        busId: updated.busId,
        routeId: updated.routeId ?? undefined,
      },
    }, access);

    if (io) {
      io.to('admin').emit('incident:updated', {
        incidentId: updated.id,
        tripId: updated.tripId,
        busId: updated.busId,
        routeId: updated.routeId,
        status: updated.status,
        escalationLevel: updated.escalationLevel,
      });
    }

    return {
      success: true,
      incidentId: updated.id,
      escalationLevel: updated.escalationLevel,
    };
  }

  async getSubstituteCandidates(
    tripId: string,
    access?: ResolvedAdminAccessContext,
  ): Promise<AdminSubstituteCandidate[]> {
    const trip = await this.getScopedTripOrThrow(tripId, access, 'ASSIGN_SUBSTITUTE');

    const activeTrips = await prisma.trip.findMany({
      where: { status: 'ACTIVE' },
      select: { busId: true },
    });
    const activeBusIds = new Set(activeTrips.map((item) => item.busId));

    const buses = await prisma.bus.findMany({
      where: {
        isActive: true,
        id: { not: trip.busId },
      },
      include: {
        assignments: {
          where: { isActive: true },
          include: {
            route: { select: { id: true, name: true } },
            driver: { select: { id: true, name: true } },
          },
          take: 1,
        },
      },
      orderBy: { number: 'asc' },
    });

    return buses
      .map((bus) => {
        const assignment = bus.assignments[0];
        return {
          busId: bus.id,
          busNumber: bus.number,
          plateNumber: bus.plateNumber,
          driverId: assignment?.driver?.id ?? null,
          driverName: assignment?.driver?.name ?? null,
          routeId: assignment?.route?.id ?? null,
          routeName: assignment?.route?.name ?? null,
          isCurrentlyActive: activeBusIds.has(bus.id),
        };
      })
      .sort((left, right) => Number(left.isCurrentlyActive) - Number(right.isCurrentlyActive));
  }

  async assignSubstitute(
    incidentId: string,
    alternateBusId: string,
    actorId: string,
    access?: ResolvedAdminAccessContext,
  ) {
    const [incident, alternateBus] = await Promise.all([
      prisma.incident.findUnique({
        where: { id: incidentId },
        include: {
          bus: { select: { number: true } },
          route: { select: { name: true } },
          trip: { select: { routeId: true } },
        },
      }),
      prisma.bus.findUnique({
        where: { id: alternateBusId },
        select: { id: true, number: true, isActive: true },
      }),
    ]);

    if (!incident) {
      throw new NotFoundError('INCIDENT_NOT_FOUND');
    }
    this.assertRouteAction(access, 'ASSIGN_SUBSTITUTE', incident.routeId ?? incident.trip.routeId);
    if (!alternateBus || !alternateBus.isActive) {
      throw new BadRequestError('ALTERNATE_BUS_NOT_AVAILABLE');
    }
    if (incident.busId === alternateBus.id) {
      throw new BadRequestError('ALTERNATE_BUS_MATCHES_CURRENT_BUS');
    }

    const activeTrip = await prisma.trip.findFirst({
      where: { busId: alternateBus.id, status: 'ACTIVE' },
      select: { id: true },
    });
    if (activeTrip) {
      throw new BadRequestError('ALTERNATE_BUS_BUSY');
    }

    const updated = await prisma.incident.update({
      where: { id: incidentId },
      data: {
        status: 'ASSIGNED',
        assignedAt: incident.assignedAt ?? new Date(),
        alternateBusId: alternateBus.id,
      },
    });

    const body = `Substitute Bus ${alternateBus.number} assigned for Bus ${incident.bus.number}.`;

    await this.sendMessage(actorId, {
      body,
      priority: 'URGENT',
      type: 'SYSTEM_EVENT',
      context: {
        contextType: 'INCIDENT',
        contextId: incident.id,
        tripId: incident.tripId,
        incidentId: incident.id,
        busId: incident.busId,
        routeId: incident.routeId ?? undefined,
      },
    }, access);

    if (io) {
      io.to('admin').emit('incident:updated', {
        incidentId: updated.id,
        tripId: incident.tripId,
        busId: incident.busId,
        routeId: incident.routeId ?? incident.trip.routeId,
        status: updated.status,
        alternateBusId: alternateBus.id,
      });
    }

    return {
      success: true,
      incidentId: updated.id,
      alternateBusId: alternateBus.id,
      alternateBusNumber: alternateBus.number,
    };
  }
}

export const adminService = new AdminService();
