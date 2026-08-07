'use strict';

const dbUnified = require('../db-unified');
const mongoDb = require('../db');
const postmark = require('../utils/postmark');
const { setQueueContext, shutdownQueues, startWorkerHeartbeat } = require('../services/queue');
const { startNotificationWorker } = require('../services/queue/workers/notification.worker');
const { startEmailWorker } = require('../services/queue/workers/email.worker');
const { startNotificationFanoutReconciler } = require('../services/notificationFanout.service');

let stopFanoutReconciler = null;

function assertWorkerEnv() {
  if (process.env.NODE_ENV === 'production' && !process.env.REDIS_URL) {
    throw new Error(
      '[queue] REDIS_URL is required in production for node scripts/worker.js (BullMQ cannot run in fallback mode)'
    );
  }
}

async function start() {
  assertWorkerEnv();
  await dbUnified.initializeDatabase();
  const status = await dbUnified.getStatus();
  if (
    process.env.NODE_ENV === 'production' &&
    (status.backend !== 'mongodb' || !status.connected)
  ) {
    throw new Error('[queue] MongoDB is required for production workers');
  }
  const db = await mongoDb.getDb();
  setQueueContext({ db, postmark, logger: console });
  startNotificationWorker();
  startEmailWorker();
  stopFanoutReconciler = await startNotificationFanoutReconciler({ db, logger: console });
  // Advertise readiness only after workers and durable recovery are initialized.
  await startWorkerHeartbeat();
  console.info('[queue] workers started');
}

async function shutdown(signal) {
  console.info(`[queue] shutting down (${signal})`);
  stopFanoutReconciler?.();
  await shutdownQueues().catch(() => {});
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch(err => {
  console.error('[queue] worker startup failed', err);
  process.exit(1);
});
