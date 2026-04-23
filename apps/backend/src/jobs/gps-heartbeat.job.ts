import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import { publishAdminAlert } from '../lib/admin-alerts';
import { firebaseAdmin } from '../lib/firebase';
const firebaseRTDB = firebaseAdmin?.database();

let io: any;
try {
  io = require('../server').io;
} catch(e) {}

const dispatchJob = async (jobName: string, payload: any, delaySeconds: number) => {
  try {
     const libQueue = require('../lib/queue');
     if (libQueue?.queueJob) {
        await libQueue.queueJob(jobName, payload, { delay: delaySeconds * 1000 });
     }
  } catch(e) {}
};

export const checkGpsHeartbeats = async () => {
  const startTime = Date.now();
  const activeTripIds = await redis.smembers('active-trips');

  if (activeTripIds.length === 0) return;

  const statePipeline = redis.pipeline();
  activeTripIds.forEach(id => statePipeline.hgetall(`trip:${id}:state`));
  const tripStates = (await statePipeline.exec()) as Array<[Error | null, Record<string, string> | null]>;

  const busIds = tripStates
    .map(([err, state]) => (err ? null : state?.busId))
    .filter((id): id is string => !!id);

  const heartbeatPipeline = redis.pipeline();
  const statusPipeline = redis.pipeline();
  busIds.forEach(busId => {
    heartbeatPipeline.get(`gps:heartbeat:${busId}`);
    statusPipeline.get(`gps:status:${busId}`);
  });

  const [heartbeats, prevStatuses] = await Promise.all([
    heartbeatPipeline.exec() as Promise<Array<[Error | null, string | null]>>,
    statusPipeline.exec() as Promise<Array<[Error | null, string | null]>>,
  ]);

  const now = Date.now();
  const transitions: Array<{ busId: string, tripId: string, from: string, to: string }> = [];

  busIds.forEach((busId, i) => {
    const tripId = activeTripIds[i];
    const lastHeartbeat = heartbeats[i][1];
    const prevStatus = prevStatuses[i][1] ?? 'LIVE';
    const age = lastHeartbeat ? now - Number(lastHeartbeat) : Infinity;

    const newStatus =
      age < 15_000  ? 'LIVE'    :
      age < 60_000  ? 'STALE'   :
      'OFFLINE';

    if (newStatus !== prevStatus) {
      transitions.push({ busId, tripId, from: prevStatus, to: newStatus });
    }
  });

  if (transitions.length === 0) return;

  const writePipeline = redis.pipeline();
  transitions.forEach(({ busId, to }) => {
    writePipeline.set(`gps:status:${busId}`, to);
    if (to === 'OFFLINE') {
      writePipeline.setnx(`gps:offline:since:${busId}`, String(now));
    } else {
      writePipeline.del(`gps:offline:since:${busId}`);
    }
  });
  await writePipeline.exec();

  for (const { busId, tripId, from, to } of transitions) {
    if (firebaseRTDB) {
      await firebaseRTDB.ref(`/buses/${busId}/gpsStatus`).set(to);
    }
    if (io) {
      io.to('admin').emit('gps:status', { busId, tripId, status: to });
      io.to(`bus:${busId}`).emit('gps:status', { status: to });
    }

    if (to === 'OFFLINE' && from !== 'OFFLINE') {
      await redis.hincrby('dashboard:stats', 'gpsOffline', 1);
      await publishAdminAlert({
        type: 'GPS_OFFLINE',
        priority: 3,
        summary: `Bus telemetry stopped updating for trip ${tripId.slice(0, 8)}.`,
        tripId,
        busId,
        timestamp: now,
      });
      const scheduled = await redis.setnx(`gps:outage:escalation:scheduled:${tripId}`, '1');
      if (scheduled) {
        await redis.expire(`gps:outage:escalation:scheduled:${tripId}`, 60 * 60);
        await dispatchJob('gps-outage-escalation', { tripId, busId }, 5 * 60);
      }
    }

    if (from === 'OFFLINE' && to !== 'OFFLINE') {
      await redis.hincrby('dashboard:stats', 'gpsOffline', -1);
    }

    logger.info({
      event: 'gps_status_transition',
      busId, tripId, 
      meta: { from, to },
    });
  }

  logger.info({
    event: 'gps_heartbeat_complete',
    meta: {
      activeBuses: busIds.length,
      transitions: transitions.length,
      durationMs: Date.now() - startTime,
    }
  });

  const delays = [15, 30, 45];
  await Promise.all(delays.map(d => dispatchJob('gps-heartbeat-check', {}, d)));
};
