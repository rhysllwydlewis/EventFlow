'use strict';

const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const HAS_REDIS_URL = Boolean(process.env.REDIS_URL);
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const USE_STUB = !HAS_REDIS_URL && !IS_PRODUCTION;

let context = { logger: console, db: null, postmark: null };
const workers = [];
let notificationsQueue;
let emailQueue;
let redis;

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
  redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
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
    removeOnComplete: 100,
    removeOnFail: 500,
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
  await Promise.all(workers.map(w => w.close().catch(() => {})));
  workers.length = 0;
  await Promise.all([notificationsQueue?.close?.(), emailQueue?.close?.()]);
  await redis?.quit?.().catch(() => {});
  notificationsQueue = null;
  emailQueue = null;
  redis = null;
}

function getQueueContext() {
  return context;
}

module.exports = {
  IS_PRODUCTION,
  HAS_REDIS_URL,
  REDIS_URL,
  USE_STUB,
  getQueues,
  setQueueContext,
  getQueueContext,
  enqueueNotificationJob,
  enqueueEmailJob,
  createWorker,
  shutdownQueues,
};
