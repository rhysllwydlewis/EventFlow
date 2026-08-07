'use strict';

const http = require('http');
const dbUnified = require('../db-unified');
const mongoDb = require('../db');
const postmark = require('../utils/postmark');
const {
  setQueueContext,
  shutdownQueues,
  startWorkerHeartbeat,
  getQueueHealth,
  isWorkerFleetReady,
} = require('../services/queue');
const { startNotificationWorker } = require('../services/queue/workers/notification.worker');
const { startEmailWorker } = require('../services/queue/workers/email.worker');
const { startNotificationFanoutReconciler } = require('../services/notificationFanout.service');

let stopFanoutReconciler = null;
let healthServer = null;
let shuttingDown = false;

function assertWorkerEnv() {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }
  const required = ['MONGODB_URI', 'REDIS_URL', 'BASE_URL', 'POSTMARK_API_KEY'];
  const missing = required.filter(key => !String(process.env[key] || '').trim());
  if (missing.length > 0) {
    throw new Error(`[queue] production worker configuration missing: ${missing.join(', ')}`);
  }
  if (!/^https:\/\//i.test(process.env.BASE_URL)) {
    throw new Error('[queue] BASE_URL must use HTTPS for production message email links');
  }
  if (!postmark.isPostmarkEnabled()) {
    throw new Error('[queue] Postmark failed to initialize for production message delivery');
  }
}

function startHealthServer({ port = Number(process.env.PORT || 3000) } = {}) {
  healthServer = http.createServer(async (req, res) => {
    if (req.method !== 'GET' || String(req.url || '').split('?')[0] !== '/api/ready') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    let queueHealth;
    try {
      queueHealth = await getQueueHealth({ force: true, requireWorker: false });
    } catch {
      queueHealth = { ready: false, reason: 'queue_probe_failed' };
    }
    const consumersReady = isWorkerFleetReady();
    const ready = consumersReady && queueHealth.ready;
    res.writeHead(ready ? 200 : 503, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(
      JSON.stringify({
        ready,
        process: 'worker',
        consumers: consumersReady ? 'ready' : 'unavailable',
        redis: queueHealth.producer || 'unavailable',
      })
    );
  });
  return new Promise((resolve, reject) => {
    healthServer.once('error', reject);
    healthServer.listen(port, '0.0.0.0', () => {
      healthServer.removeListener('error', reject);
      resolve(healthServer);
    });
  });
}

function stopHealthServer() {
  if (!healthServer) {
    return Promise.resolve();
  }
  const server = healthServer;
  healthServer = null;
  return new Promise(resolve => server.close(() => resolve()));
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
  await startHealthServer();
  console.info('[queue] workers started');
}

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.info(`[queue] shutting down (${signal})`);
  await stopHealthServer();
  await stopFanoutReconciler?.();
  await shutdownQueues().catch(() => {});
  process.exit(0);
}

if (require.main === module) {
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  start().catch(err => {
    console.error('[queue] worker startup failed', err);
    process.exit(1);
  });
}

module.exports = { assertWorkerEnv, startHealthServer, stopHealthServer, start, shutdown };
