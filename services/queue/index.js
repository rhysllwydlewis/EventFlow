'use strict';

const crypto = require('crypto');
const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const HAS_REDIS_URL = Boolean(process.env.REDIS_URL);
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const USE_STUB = !HAS_REDIS_URL && !IS_PRODUCTION;
// Preserve BullMQ's historical default so an upgrade does not orphan in-flight
// jobs. Deployments that share Redis should opt into an environment-specific prefix.
const QUEUE_NAMESPACE = process.env.EVENTFLOW_QUEUE_NAMESPACE || 'bull';
if (!/^[a-zA-Z0-9:_-]{1,80}$/.test(QUEUE_NAMESPACE)) {
  throw new Error(
    'EVENTFLOW_QUEUE_NAMESPACE must be 1-80 letters, digits, colons, underscores, or hyphens'
  );
}
const WORKER_HEARTBEAT_KEY = `${QUEUE_NAMESPACE}:messenger:worker-heartbeats`;
const WORKER_INSTANCE_ID =
  process.env.EVENTFLOW_WORKER_INSTANCE_ID ||
  process.env.RAILWAY_DEPLOYMENT_ID ||
  process.env.HOSTNAME ||
  crypto.randomUUID();
const WORKER_HEARTBEAT_INTERVAL_MS = 10_000;
const WORKER_HEARTBEAT_TTL_SECONDS = 45;
const WORKER_HEARTBEAT_STALE_MS = 30_000;
const QUEUE_HEALTH_TIMEOUT_MS = 1_500;
const WORKER_READY_TIMEOUT_MS = 10_000;
const QUEUE_HEALTH_CACHE_MS = 5_000;
const REQUIRED_WORKER_QUEUES = new Set(['notifications', 'email']);

let context = { logger: console, db: null, postmark: null };
const workers = [];
const workerStates = new Map();
let notificationsQueue;
let emailQueue;
let redis;
let workerHeartbeatTimer = null;
const healthCache = new Map();

function stableJobId(kind, values) {
  const digest = crypto
    .createHash('sha256')
    .update(values.map(value => String(value)).join('\u0000'))
    .digest('hex')
    .slice(0, 40);
  return `${kind}-${digest}`;
}

function notificationJobId(messageId) {
  return stableJobId('message', [messageId]);
}

function emailJobId(messageId, recipientId) {
  return stableJobId('message-email', [messageId, recipientId]);
}

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

  // eslint-disable-next-line require-await -- must return a Promise to stay interchangeable with BullMQ's Queue.close()
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
  // ioredis logs "[ioredis] Unhandled error event" straight to stderr for any
  // connection we own that has no 'error' listener of its own (BullMQ does not
  // attach one on our behalf when we supply the connection). Route it through
  // the app logger instead so outages show up in structured logs.
  redis.on('error', error => {
    context.logger?.error?.('[queue] redis connection error', { error: error.message });
  });
  notificationsQueue = new Queue('notifications', {
    connection: redis,
    prefix: QUEUE_NAMESPACE,
  });
  emailQueue = new Queue('email', { connection: redis, prefix: QUEUE_NAMESPACE });
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
  const cacheKey = requireWorker ? 'worker' : 'producer';
  const cached = healthCache.get(cacheKey);
  if (!force && cached && now - cached.at < QUEUE_HEALTH_CACHE_MS) {
    return cached.value;
  }

  if (IS_PRODUCTION && !HAS_REDIS_URL) {
    const health = unavailableHealth('missing_redis_configuration');
    healthCache.set(cacheKey, { value: health, at: now });
    return health;
  }

  if (USE_STUB) {
    const health = {
      ready: true,
      mode: 'in_process',
      producer: 'ready',
      worker: 'not_required',
      workerHeartbeatAgeMs: null,
      reason: null,
    };
    healthCache.set(cacheKey, { value: health, at: now });
    return health;
  }

  let health = unavailableHealth('redis_unreachable');
  try {
    initQueues();
    await withTimeout(redis.ping());
    let workerHeartbeat = { status: 'not_required', ageMs: null, healthy: true };
    if (requireWorker) {
      const latest = await withTimeout(redis.zrevrange(WORKER_HEARTBEAT_KEY, 0, 0, 'WITHSCORES'));
      workerHeartbeat = evaluateWorkerHeartbeat(latest?.[1], now);
    }
    health = {
      ready: workerHeartbeat.healthy,
      mode: 'redis',
      producer: 'ready',
      worker: workerHeartbeat.status,
      workerHeartbeatAgeMs: workerHeartbeat.ageMs,
      reason: workerHeartbeat.healthy ? null : 'worker_heartbeat_unavailable',
    };
  } catch {
    health = unavailableHealth('redis_unreachable');
  }
  healthCache.set(cacheKey, { value: health, at: now });
  return health;
}

async function writeWorkerHeartbeat() {
  initQueues();
  if (USE_STUB) {
    return;
  }
  if (!isWorkerFleetReady()) {
    throw new Error('notification and email workers are not both ready');
  }
  const now = Date.now();
  await redis
    .multi()
    .zadd(WORKER_HEARTBEAT_KEY, now, WORKER_INSTANCE_ID)
    .zremrangebyscore(WORKER_HEARTBEAT_KEY, 0, now - WORKER_HEARTBEAT_TTL_SECONDS * 1000)
    .expire(WORKER_HEARTBEAT_KEY, WORKER_HEARTBEAT_TTL_SECONDS)
    .exec();
  healthCache.clear();
}

async function startWorkerHeartbeat({ intervalMs = WORKER_HEARTBEAT_INTERVAL_MS } = {}) {
  await waitForWorkersReady();
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
    const jobId = notificationJobId(job.messageId);
    await processNotificationJob({ id: jobId, data: job });
    return { id: jobId };
  }
  return notificationsQueue.add('fanout', job, {
    jobId: notificationJobId(job.messageId),
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
    const jobId = emailJobId(job.messageId, job.recipientId);
    await processEmailJob({
      id: jobId,
      data: job,
    });
    return { id: jobId };
  }
  return emailQueue.add('send-email', job, {
    jobId: emailJobId(job.messageId, job.recipientId),
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
  const worker = new Worker(queueName, processor, {
    connection: redis,
    prefix: QUEUE_NAMESPACE,
  });
  const state = { queueName, ready: false };
  workerStates.set(worker, state);
  worker.on('ready', () => {
    state.ready = true;
  });
  worker.on('error', error => {
    state.ready = false;
    context.logger?.error?.('[queue] worker connection error', {
      queueName,
      error: error.message,
    });
  });
  worker.on('closing', () => {
    state.ready = false;
  });
  worker.on('closed', () => {
    state.ready = false;
  });
  workers.push(worker);
  return worker;
}

function isWorkerFleetReady() {
  const readyQueues = new Set();
  for (const [worker, state] of workerStates.entries()) {
    if (state.ready && worker.isRunning?.()) {
      readyQueues.add(state.queueName);
    }
  }
  return [...REQUIRED_WORKER_QUEUES].every(queueName => readyQueues.has(queueName));
}

async function waitForWorkersReady() {
  if (USE_STUB) {
    return;
  }
  await Promise.all(
    workers.map(async worker => {
      await withTimeout(worker.waitUntilReady(), WORKER_READY_TIMEOUT_MS);
      const state = workerStates.get(worker);
      if (state) {
        state.ready = true;
      }
    })
  );
  if (!isWorkerFleetReady()) {
    throw new Error('notification and email workers failed readiness checks');
  }
}

async function shutdownQueues() {
  if (workerHeartbeatTimer) {
    clearInterval(workerHeartbeatTimer);
    workerHeartbeatTimer = null;
  }
  if (redis && !USE_STUB) {
    await redis.zrem(WORKER_HEARTBEAT_KEY, WORKER_INSTANCE_ID).catch(error => {
      context.logger?.warn?.('[queue] failed to remove worker heartbeat during shutdown', {
        error: error.message,
      });
    });
  }
  await Promise.all(
    workers.map(w =>
      w.close().catch(error => {
        context.logger?.warn?.('[queue] failed to close worker cleanly', { error: error.message });
      })
    )
  );
  workers.length = 0;
  workerStates.clear();
  await Promise.all([notificationsQueue?.close?.(), emailQueue?.close?.()]);
  await redis?.quit?.().catch(() => {});
  notificationsQueue = null;
  emailQueue = null;
  redis = null;
  healthCache.clear();
}

function getQueueContext() {
  return context;
}

module.exports = {
  IS_PRODUCTION,
  HAS_REDIS_URL,
  REDIS_URL,
  USE_STUB,
  QUEUE_NAMESPACE,
  WORKER_HEARTBEAT_KEY,
  WORKER_INSTANCE_ID,
  getQueues,
  setQueueContext,
  getQueueContext,
  enqueueNotificationJob,
  enqueueEmailJob,
  createWorker,
  getQueueHealth,
  evaluateWorkerHeartbeat,
  notificationJobId,
  emailJobId,
  isWorkerFleetReady,
  waitForWorkersReady,
  startWorkerHeartbeat,
  writeWorkerHeartbeat,
  shutdownQueues,
};
