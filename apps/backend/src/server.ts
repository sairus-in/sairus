import 'dotenv/config';

import app from './app';
import { closeNotificationWorker } from './jobs/notification.worker';
import { reconcileRedis } from './jobs/reconcile-redis.job';
import { startDelegateMonitor } from './jobs/gps-delegate-heartbeat.job';
import { env } from './lib/env';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { closeWebsocket, setupWebsocket } from './websocket/socket';

let shuttingDown = false;
let delegateMonitor: NodeJS.Timeout | null = null;

const stop = async (signal: NodeJS.Signals) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  app.log.info({ signal }, 'Shutdown requested');

  if (delegateMonitor) {
    clearInterval(delegateMonitor);
    delegateMonitor = null;
  }

  const results = await Promise.allSettled([
    app.close(),
    closeWebsocket(),
    closeNotificationWorker(),
    prisma.$disconnect(),
    redis.quit(),
  ]);

  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    failures.forEach((result) => {
      if (result.status === 'rejected') {
        app.log.error(result.reason, 'Shutdown task failed');
      }
    });

    process.exit(1);
    return;
  }

  process.exit(0);
};

const start = async () => {
  try {
    const initScript = `
      if redis.call('EXISTS', KEYS[1]) == 0 then
        redis.call('HSET', KEYS[1],
          'activeTrips', '0',
          'checkedIn', '0',
          'gpsOffline', '0',
          'openCorrections', '0'
        )
        return 1
      end
      return 0
    `;

    const initialized = await redis.eval(initScript, 1, 'dashboard:stats');

    if (initialized === 1) {
      await reconcileRedis();
      app.log.info('Admin dashboard Redis stats initialized and reconciled');
    } else {
      app.log.info('Admin dashboard Redis stats already initialized by another instance');
    }

    setupWebsocket(app);
    delegateMonitor = startDelegateMonitor();

    await app.listen({ port: env.PORT, host: env.HOST });

    app.log.info(`College Bus Management API running on http://${env.HOST}:${env.PORT}`);
    app.log.info('WebSocket server attached to Fastify');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

process.once('SIGINT', () => {
  void stop('SIGINT');
});

process.once('SIGTERM', () => {
  void stop('SIGTERM');
});

void start();
