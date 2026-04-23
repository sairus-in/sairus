import { notificationsService } from '../notifications/notifications.service';
import { cloudTasksClient, queuePath, BACKEND_URL } from '../../lib/cloud-tasks';
import { env } from '../../lib/env';
import { NOTIFICATION_TYPE } from 'shared';
import { io } from '../../websocket/socket';
import { logger } from '../../lib/logger';
import { NotificationDispatchPriority } from '../../lib/queue';
import { incidentsRepository } from './incidents.repository';
import type { IncidentStatus, EscalationLevel } from '@prisma/client';

export class IncidentsService {

  /**
   * Driver reports a critical breakdown or SOS.
   * Instantly notifies route coordinators via all channels.
   * Enqueues Cloud Tasks escalation job at +10 minutes.
   */
  async reportIncident(
    tripId: string,
    driverId: string,
    type: string,
    description: string
  ) {
    // 1. Fetch trip context
    const trip = await incidentsRepository.getTripWithContext(tripId);
    if (!trip) throw new Error('Trip not found');

    // 2. Create the Incident record
    const incident = await incidentsRepository.createIncident(
      tripId,
      trip.busId,
      trip.routeId,
      driverId,
      type,
      description
    );

    // 3. Get route coordinators and notify
    const coordinatorUserIds = await incidentsRepository.getRouteCoordinators(trip.routeId);

    if (coordinatorUserIds.length > 0) {
      await notificationsService.dispatch(
        coordinatorUserIds,
        {
          title: `SOS: ${trip.bus.number} Breakdown`,
          body: `Driver reported ${type}: ${description}. Route ${trip.route.name} affected.`,
          type: NOTIFICATION_TYPE.BREAKDOWN_ALERT,
          metadata: { incidentId: incident.id, tripId },
        },
        ['PUSH', 'IN_APP', 'SMS'],
        { priority: NotificationDispatchPriority.CRITICAL },
      );
    }

    // 4. Enqueue Cloud Tasks job to escalate in +10 minutes if still REPORTED
    await this.enqueueEscalationJob(incident.id, 'REPORTED');

    if (io) {
      io.to('admin').emit('incident:reported', {
        incidentId: incident.id,
        tripId,
        busId: trip.busId,
        busNumber: trip.bus.number,
        routeName: trip.route.name,
        type,
        reportedAt: incident.reportedAt.toISOString(),
      });
    }

    logger.info({
      source: 'SYSTEM',
      event: 'incident_reported',
      meta: { incidentId: incident.id, tripId, type },
    });

    return incident;
  }

  /**
   * Enqueue Cloud Tasks job to escalate incident if still in current status after 10 minutes.
   * Uses idempotency: if status has already changed, the job does nothing.
   */
  private async enqueueEscalationJob(incidentId: string, expectedStatus: IncidentStatus) {
    try {
      const url = `${BACKEND_URL}/v1/jobs/incidents/escalate`;
      const delaySeconds = 10 * 60; // 10 minutes

      await cloudTasksClient.createTask({
        parent: queuePath,
        task: {
          scheduleTime: { seconds: Math.floor(Date.now() / 1000) + delaySeconds },
          httpRequest: {
            httpMethod: 'POST',
            url,
            headers: {
              'Content-Type': 'application/json',
              'x-cloud-tasks-secret': env.CLOUD_TASKS_SECRET || 'dev-secret',
            },
            body: Buffer.from(JSON.stringify({
              incidentId,
              expectedStatus,
            })).toString('base64'),
          }
        }
      });

      logger.info({
        source: 'SYSTEM',
        event: 'incident_escalation_job_enqueued',
        meta: { incidentId, delaySeconds },
      });
    } catch (error) {
      logger.error({
        source: 'SYSTEM',
        event: 'incident_escalation_job_failed',
        meta: { incidentId, error: String(error) },
      });
      // Don't throw — escalation failure shouldn't break incident creation
    }
  }

  /**
   * Handles Cloud Tasks escalation job.
   * If incident is still in the expected status, escalates to next level.
   * Otherwise, does nothing (incident was already resolved/assigned).
   */
  async processEscalation(incidentId: string, expectedStatus: IncidentStatus) {
    const incident = await incidentsRepository.getIncidentById(incidentId);

    // If already resolved or escalated, do nothing
    if (incident.status !== expectedStatus) {
      logger.info({
        source: 'SYSTEM',
        event: 'escalation_skipped_status_changed',
        meta: { incidentId, currentStatus: incident.status, expectedStatus },
      });
      return;
    }

    const nextLevel = this.getNextEscalationLevel(incident.escalationLevel);
    if (!nextLevel) {
      logger.info({
        source: 'SYSTEM',
        event: 'escalation_max_level_reached',
        meta: { incidentId, currentLevel: incident.escalationLevel },
      });
      return;
    }

    // Update escalation level
    const updated = await incidentsRepository.updateIncidentEscalationLevel(incidentId, nextLevel);

    // Get escalation recipients
    const recipients = await incidentsRepository.getEscalationRecipients(nextLevel, incident.routeId!);

    if (recipients.length > 0) {
      await notificationsService.dispatch(
        recipients,
        {
          title: `⚠️ ESCALATED: Unresolved Incident`,
          body: `Incident ${incidentId} has been escalated to ${nextLevel}. Bus ${updated.trip.bus?.number || '?'} on Route ${updated.trip.route.name}.`,
          type: NOTIFICATION_TYPE.BREAKDOWN_ALERT,
          metadata: { incidentId, escalatedTo: nextLevel },
        },
        ['PUSH', 'IN_APP', 'SMS'],
        { priority: NotificationDispatchPriority.CRITICAL },
      );
    }

    // Enqueue next escalation if there's a further level
    const nextNextLevel = this.getNextEscalationLevel(nextLevel);
    if (nextNextLevel) {
      await this.enqueueEscalationJob(incidentId, expectedStatus);
    }

    if (io) {
      io.to('admin').emit('incident:escalated', {
        incidentId,
        escalatedTo: nextLevel,
        tripId: incident.tripId,
      });
    }

    logger.info({
      source: 'SYSTEM',
      event: 'incident_escalated',
      meta: { incidentId, escalatedTo: nextLevel },
    });
  }

  /**
   * List incidents with filtering, sorting, and pagination.
   * Used by admin panel to display incident history.
   */
  async listIncidents(filters: any) {
    return await incidentsRepository.listIncidents(filters);
  }

  /**
   * Get a single incident with full context.
   */
  async getIncident(incidentId: string) {
    return await incidentsRepository.getIncidentById(incidentId);
  }

  /**
   * Coordinator or Admin marks incident as resolved.
   */
  async resolveIncident(incidentId: string, resolverId: string, resolutionNotes: string) {
    return await incidentsRepository.resolveIncident(incidentId, resolverId, resolutionNotes);
  }

  /**
   * Get the next escalation level in the chain.
   */
  private getNextEscalationLevel(current: EscalationLevel): EscalationLevel | null {
    const chain: EscalationLevel[] = ['COORDINATOR', 'TRANSPORT_OFFICER', 'PRINCIPAL'];
    const idx = chain.indexOf(current);
    return idx >= 0 && idx < chain.length - 1 ? chain[idx + 1] : null;
  }
}

export const incidentsService = new IncidentsService();
