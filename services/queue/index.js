'use strict';

const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const HAS_REDIS_URL = Boolean(process.env.REDIS_URL);
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const USE_STUB = !HAS_REDIS_URL && !IS_PRODUCTION;
const WORKER_HEARTBEAT_KEY = 'eventflow:messenger:worker-heartbeat';
const WORKER_HEARTBEAT_INTERVAL_MS = 10_000;
const WORKER_HEARTBEAT_TTL_SECONDS = 45;
const WORKER_HEARTBEAT_STALE_MS = 30_000;
const QUEUE_HEALTH_TIMEOUT_MS = 1_500;
const QUEUE_HEALTH_CACHE_MS = 5_000;

let context = { logger: console, db: null, postmark: null };
const workers = [];
let notificationsQueue;
let emailQueue;
let redis;
let workerHeartbeatTimer = null;
let cachedHealth = null;
let cachedHealthAt = 0;

class InProcessQueue {
  constructor(name) {
    this.name = name;
    this.processor = null;
  }

  async add(_name, data, opts = {}) {
    if (this.processor) {
      await this.processor({ id: opts.jobId || null, data });
    }
    return { id: opts.jobId || null };
  }

  async close() {
    return undefined;
  }
}

function initQueues() {
  if (IS_PRODUCTION && !HAS_REDIS_URL) {
    throw new Error(
      '[queue] REDIS_URL is required when NODE_ENV=production. Refusing to start with in-process queue fallback.'
    );
  }
  if (notificationsQueue && emailQueue) {
    return;
  }
  if (USE_STUB) {
    notificationsQueue = new InProcessQueue('notifications');
    emailQueue = new InProcessQueue('email');
    return;
  }
  redis = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    connectTimeout: 5_000,
  });
  notificationsQueue = new Queue('notifications', { connection: redis });
  emailQueue = new Queue('email', { connection: redis });
}

function setQueueContext(next) {
  context = { ...context, ...(next || {}) };
}

function getQueues() {
  initQueues();
  return { notificationsQueue, emailQueue, useStub: USE_STUB };
}

function withTimeout(promise, timeoutMs = QUEUE_HEALTH_TIMEOUT_MS) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('queue health check timed out')), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function evaluateWorkerHeartbeat(rawHeartbeat, now = Date.now()) {
  const heartbeatAt = Number(rawHeartbeat);
  if (!Number.isFinite(heartbeatAt) || heartbeatAt <= 0) {
    return { status: 'missing', ageMs: null, healthy: false };
  }
  const ageMs = Math.max(0, now - heartbeatAt);
  return {
    status: ageMs <= WORKER_HEARTBEAT_STALE_MS ? 'healthy' : 'stale',
    ageMs,
    healthy: ageMs <= WORKER_HEARTBEAT_STALE_MS,
  };
}

function unavailableHealth(reason) {
  return {
    ready: false,
    mode: HAS_REDIS_URL ? 'redis' : 'unconfigured',
    producer: HAS_REDIS_URL ? 'unavailable' : 'missing_configuration',
    worker: 'unavailable',
    workerHeartbeatAgeMs: null,
    reason,
  };
}

async function getQueueHealth({ force = false, requireWorker = IS_PRODUCTION } = {}) {
  const now = Date.now();
  if (!force && cachedHealth && now - cachedHealthAt < QUEUE_HEALTH_CACHE_MS) {
    return cachedHealth;
  }

  if (IS_PRODUCTION && !HAS_REDIS_URL) {
    cachedHealth = unavailableHealth('missing_redis_configuration');
    cachedHealthAt = now;
    return cachedHealth;
  }

  if (USE_STUB) {
    cachedHealth = {
      ready: true,
      mode: 'in_process',
      producer: 'ready',
      worker: 'not_required',
      workerHeartbeatAgeMs: null,
      reason: null,
    };
    cachedHealthAt = now;
    return cachedHealth;
  }

  try {
    initQueues();
    await withTimeout(redis.ping());
    const workerHeartbeat = requireWorker
      ? evaluateWorkerHeartbeat(await withTimeout(redis.get(WORKER_HEARTBEAT_KEY)), now)
      : { status: 'not_required', ageMs: null, healthy: true };
    cachedHealth = {
      ready: workerHeartbeat.healthy,
      mode: 'redis',
      producer: 'ready',
      worker: workerHeartbeat.status,
      workerHeartbeatAgeMs: workerHeartbeat.ageMs,
      reason: workerHeartbeat.healthy ? null : 'worker_heartbeat_unavailable',
    };
  } catch {
    cachedHealth = unavailableHealth('redis_unreachable');
  }
  cachedHealthAt = now;
  return cachedHealth;
}

async function writeWorkerHeartbeat() {
  initQueues();
  if (USE_STUB) {
    return;
  }
  await redis.set(WORKER_HEARTBEAT_KEY, String(Date.now()), 'EX', WORKER_HEARTBEAT_TTL_SECONDS);
  cachedHealth = null;
}

async function startWorkerHeartbeat({ intervalMs = WORKER_HEARTBEAT_INTERVAL_MS } = {}) {
  await writeWorkerHeartbeat();
  if (workerHeartbeatTimer || USE_STUB) {
    return;
  }
  workerHeartbeatTimer = setInterval(() => {
    writeWorkerHeartbeat().catch(error => {
      context.logger?.error?.('[queue] worker heartbeat failed', { error: error.message });
    });
  }, intervalMs);
  workerHeartbeatTimer.unref?.();
}

async function enqueueNotificationJob(job) {
  initQueues();
  if (!job?.messageId) {
    return null;
  }
  if (USE_STUB) {
    const { processNotificationJob } = require('./workers/notification.worker');
    await processNotificationJob({ id: `message:${job.messageId}`, data: job });
    return { id: `message:${job.messageId}` };
  }
  return notificationsQueue.add('fanout', job, {
    jobId: `message:${job.messageId}`,
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    // The message document retains failure/retry evidence. Removing an exhausted
    // BullMQ job lets the reconciler safely re-add the same idempotent job ID.
    removeOnFail: true,
  });
}

async function enqueueEmailJob(job) {
  initQueues();
  if (!job?.messageId || !job?.recipientId) {
    return null;
  }
  if (USE_STUB) {
    const { processEmailJob } = require('./workers/email.worker');
    await processEmailJob({
      id: `message:${job.messageId}:recipient:${job.recipientId}`,
      data: job,
    });
    return { id: `message:${job.messageId}:recipient:${job.recipientId}` };
  }
  return emailQueue.add('send-email', job, {
    jobId: `message:${job.messageId}:recipient:${job.recipientId}`,
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}

function createWorker(queueName, processor) {
  initQueues();
  if (USE_STUB) {
    if (queueName === 'notifications') {
      notificationsQueue.processor = processor;
    } else if (queueName === 'email') {
      emailQueue.processor = processor;
    }
    return { close: async () => {} };
  }
  const worker = new Worker(queueName, processor, { connection: redis });
  workers.push(worker);
  return worker;
}

async function shutdownQueues() {
  if (workerHeartbeatTimer) {
    clearInterval(workerHeartbeatTimer);
    workerHeartbeatTimer = null;
  }
  await Promise.all(workers.map(w => w.close().catch(() => {})));
  workers.length = 0;
  await Promise.all([notificationsQueue?.close?.(), emailQueue?.close?.()]);
  await redis?.quit?.().catch(() => {});
  notificationsQueue = null;
  emailQueue = null;
  redis = null;
  cachedHealth = null;
  cachedHealthAt = 0;
}

function getQueueContext() {
  return context;
}

module.exports = {
  IS_PRODUCTION,
  HAS_REDIS_URL,
  REDIS_URL,
  USE_STUB,
  WORKER_HEARTBEAT_KEY,
  getQueues,
  setQueueContext,
  getQueueContext,
  enqueueNotificationJob,
  enqueueEmailJob,
  createWorker,
  getQueueHealth,
  evaluateWorkerHeartbeat,
  startWorkerHeartbeat,
  writeWorkerHeartbeat,
  shutdownQueues,
};
