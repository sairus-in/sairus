// apps/backend/src/modules/jobs/jobs.routes.ts
// Internal Cloud Tasks webhook endpoints.
// All production calls come from GCP Cloud Tasks with an OIDC token.
// Returns 200 so Cloud Tasks treats them as successful and doesn't retry.

import { FastifyInstance } from 'fastify';
import { createDailyTrips } from '../../jobs/create-daily-trips.job';
import { markAbsentStudents } from '../../jobs/mark-absent.job';
import { checkGpsHeartbeats } from '../../jobs/gps-heartbeat.job';
import { cleanupGpsLogs } from '../../jobs/gps-cleanup.job';
import { sendArrivalPushFallback } from '../../jobs/arrival-push-fallback.job';
import { processOutageEscalation } from '../../jobs/gps-outage-escalation.job';
import { processOutageAbsentFinalization } from '../../jobs/gps-outage-absent.job';
import { processAuthProvisioning } from '../../jobs/provision-auth.job';
import { reconcileDashboardStats } from '../../jobs/reconcile-dashboard-stats.job';
import { incidentsService } from '../incidents/incidents.service';
import { AppError } from '../../lib/errors';
import { verifyCloudTask } from '../../middleware/cloud-task.middleware';
import { ok } from 'shared';
import type { IncidentStatus } from '@prisma/client';

export async function jobsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyCloudTask);

  app.post('/create-daily-trips', async (request, reply) => {
    await createDailyTrips();
    return reply.send(ok({ message: 'Daily trips created' }, request.id));
  });

  app.post('/mark-absent', async (request, reply) => {
    const body = request.body as { tripId: string };
    if (!body?.tripId) throw new AppError(400, 'MISSING_TRIP_ID', 'Missing tripId');
    await markAbsentStudents(body.tripId);
    return reply.send(ok({ message: 'Absent students marked' }, request.id));
  });

  app.post('/gps-heartbeat-check', async (request, reply) => {
    await checkGpsHeartbeats();
    return reply.send(ok({ message: 'GPS heartbeat checked' }, request.id));
  });

  app.post('/gps-cleanup', async (request, reply) => {
    await cleanupGpsLogs();
    return reply.send(ok({ message: 'GPS logs cleaned' }, request.id));
  });

  app.post('/late-start-alert', async (request, reply) => {
    const body = request.body as { tripId: string };
    if (!body?.tripId) throw new AppError(400, 'MISSING_TRIP_ID', 'Missing tripId');
    const { lateStartAlert } = await import('../../jobs/late-start-alert.job');
    await lateStartAlert({ tripId: body.tripId });
    return reply.send(ok({ message: 'Late start alert sent' }, request.id));
  });

  app.post('/reconcile-redis', async (request, reply) => {
    const { reconcileRedis } = await import('../../jobs/reconcile-redis.job');
    await reconcileRedis();
    return reply.send(ok({ message: 'Redis reconciled' }, request.id));
  });

  app.post('/reconcile-dashboard', async (request, reply) => {
    await reconcileDashboardStats();
    return reply.send(ok({ message: 'Dashboard stats reconciled' }, request.id));
  });

  app.post('/arrival-push-fallback', async (request, reply) => {
    const body = request.body as { tripId: string };
    if (!body?.tripId) throw new AppError(400, 'MISSING_TRIP_ID', 'Missing tripId');
    await sendArrivalPushFallback(body.tripId);
    return reply.send(ok({ message: 'Arrival push sent' }, request.id));
  });

  app.post('/gps-outage-escalation/:tripId', async (request, reply) => {
    const { tripId } = request.params as { tripId: string };
    const body = request.body as { busId: string };
    if (!body?.busId) throw new AppError(400, 'MISSING_BUS_ID', 'Missing busId');
    await processOutageEscalation(tripId, body.busId);
    return reply.send(ok({ message: 'Outage escalation processed' }, request.id));
  });

  app.post('/gps-outage-absent/:tripId', async (request, reply) => {
    const { tripId } = request.params as { tripId: string };
    const body = request.body as { outageMinutes: number };
    await processOutageAbsentFinalization(tripId, body?.outageMinutes || 0);
    return reply.send(ok({ message: 'Outage absence finalized' }, request.id));
  });

  app.post('/provision-auth', async (request, reply) => {
    await processAuthProvisioning();
    return reply.send(ok({ message: 'Auth provisioning processed' }, request.id));
  });

  app.post('/incidents/escalate', async (request, reply) => {
    const body = request.body as { incidentId: string; expectedStatus: IncidentStatus };
    if (!body?.incidentId) throw new AppError(400, 'MISSING_INCIDENT_ID', 'Missing incidentId');
    if (!body?.expectedStatus) throw new AppError(400, 'MISSING_EXPECTED_STATUS', 'Missing expectedStatus');
    
    await incidentsService.processEscalation(body.incidentId, body.expectedStatus);
    return reply.send(ok({ message: 'Incident escalation processed' }, request.id));
  });
}
