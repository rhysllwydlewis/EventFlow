'use strict';

const { ObjectId } = require('mongodb');
const { enqueueNotificationJob } = require('./queue');

const DEFAULT_RECONCILE_INTERVAL_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 60_000;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_QUEUED_RECOVERY_MS = 5 * 60_000;
const DEFAULT_BATCH_SIZE = 100;

function toObjectId(id) {
  return id instanceof ObjectId ? id : new ObjectId(String(id));
}

function sanitizeFanoutError(error) {
  return String(error?.message || error || 'notification fan-out failed')
    .replace(/rediss?:\/\/[^@\s]+@/gi, 'redis://[redacted]@')
    .slice(0, 300);
}

function createFanoutState(recipientIds, now = new Date()) {
  const recipients = [...new Set((recipientIds || []).filter(Boolean).map(String))];
  return {
    status: recipients.length > 0 ? 'pending' : 'not_required',
    recipientIds: recipients,
    attempts: 0,
    updatedAt: now,
  };
}

async function markFanoutQueued(messagesCollection, messageId, now = new Date()) {
  await messagesCollection.updateOne(
    {
      _id: toObjectId(messageId),
      // A fast worker may already have completed the job before add() returns.
      // Only the producer's pending/reconciling states may become queued.
      'notificationFanout.status': { $in: ['pending', 'reconciling'] },
    },
    {
      $set: {
        'notificationFanout.status': 'queued',
        'notificationFanout.queuedAt': now,
        'notificationFanout.updatedAt': now,
      },
      $unset: {
        'notificationFanout.lastError': '',
        'notificationFanout.nextRetryAt': '',
        'notificationFanout.leaseUntil': '',
      },
    }
  );
}

async function markFanoutProcessed(messagesCollection, messageId, now = new Date()) {
  await messagesCollection.updateOne(
    {
      _id: toObjectId(messageId),
      // Competing enqueue/reconcile callbacks must not regress terminal success.
      'notificationFanout.status': { $nin: ['processed', 'not_required'] },
    },
    {
      $set: {
        'notificationFanout.status': 'processed',
        'notificationFanout.processedAt': now,
        'notificationFanout.updatedAt': now,
      },
      $unset: {
        'notificationFanout.lastError': '',
        'notificationFanout.nextRetryAt': '',
        'notificationFanout.leaseUntil': '',
      },
    }
  );
}

async function markFanoutFailed(
  messagesCollection,
  messageId,
  error,
  { now = new Date(), retryDelayMs = DEFAULT_RETRY_DELAY_MS } = {}
) {
  await messagesCollection.updateOne(
    {
      _id: toObjectId(messageId),
      // A late failure callback must not overwrite a successful competing run.
      'notificationFanout.status': { $nin: ['processed', 'not_required'] },
    },
    {
      $set: {
        'notificationFanout.status': 'failed',
        'notificationFanout.lastError': sanitizeFanoutError(error),
        'notificationFanout.nextRetryAt': new Date(now.getTime() + retryDelayMs),
        'notificationFanout.updatedAt': now,
      },
      $unset: { 'notificationFanout.leaseUntil': '' },
      $inc: { 'notificationFanout.attempts': 1 },
    }
  );
}

function buildFanoutPayload(message, contextTitle = '') {
  return {
    messageId: String(message._id),
    conversationId: String(message.conversationId),
    recipients: message.notificationFanout?.recipientIds || [],
    senderName: message.senderName,
    preview: String(message.content || '').substring(0, 200),
    contextTitle,
  };
}

async function reconcileNotificationFanout({
  db,
  logger = console,
  enqueue = enqueueNotificationJob,
  now = new Date(),
  limit = DEFAULT_BATCH_SIZE,
} = {}) {
  if (!db) {
    throw new Error('notification fan-out reconciliation requires a database');
  }
  const messages = db.collection('chat_messages_v4');
  const conversations = db.collection('conversations_v4');
  const queuedRecoveryCutoff = new Date(now.getTime() - DEFAULT_QUEUED_RECOVERY_MS);
  const candidates = await messages
    .find({
      $or: [
        {
          'notificationFanout.status': { $in: ['pending', 'failed'] },
          'notificationFanout.nextRetryAt': { $not: { $gt: now } },
        },
        {
          'notificationFanout.status': 'reconciling',
          'notificationFanout.leaseUntil': { $lte: now },
        },
        {
          // Redis is a durable queue only when persistence/eviction settings hold.
          // Re-submit old queued markers so a lost Redis job cannot strand a message.
          'notificationFanout.status': 'queued',
          'notificationFanout.queuedAt': { $not: { $gt: queuedRecoveryCutoff } },
        },
      ],
    })
    .sort({ createdAt: 1 })
    .limit(Math.max(1, Math.min(Number(limit) || DEFAULT_BATCH_SIZE, 500)))
    .toArray();

  const summary = { scanned: candidates.length, queued: 0, failed: 0, notRequired: 0 };
  for (const candidate of candidates) {
    const claimed = await messages.findOneAndUpdate(
      {
        _id: candidate._id,
        $or: [
          {
            'notificationFanout.status': { $in: ['pending', 'failed'] },
            'notificationFanout.nextRetryAt': { $not: { $gt: now } },
          },
          {
            'notificationFanout.status': 'reconciling',
            'notificationFanout.leaseUntil': { $lte: now },
          },
          {
            'notificationFanout.status': 'queued',
            'notificationFanout.queuedAt': { $not: { $gt: queuedRecoveryCutoff } },
          },
        ],
      },
      {
        $set: {
          'notificationFanout.status': 'reconciling',
          'notificationFanout.leaseUntil': new Date(now.getTime() + DEFAULT_LEASE_MS),
          'notificationFanout.updatedAt': now,
        },
      },
      { returnDocument: 'after' }
    );
    if (!claimed) {
      continue;
    }

    const recipients = claimed.notificationFanout?.recipientIds || [];
    if (recipients.length === 0) {
      await messages.updateOne(
        { _id: claimed._id },
        {
          $set: {
            'notificationFanout.status': 'not_required',
            'notificationFanout.updatedAt': now,
          },
          $unset: { 'notificationFanout.leaseUntil': '' },
        }
      );
      summary.notRequired++;
      continue;
    }

    try {
      const conversation = await conversations.findOne({ _id: claimed.conversationId });
      await enqueue(buildFanoutPayload(claimed, conversation?.context?.referenceTitle || ''));
      await markFanoutQueued(messages, claimed._id, now);
      summary.queued++;
    } catch (error) {
      await markFanoutFailed(messages, claimed._id, error, { now });
      logger.error('[queue] notification fan-out reconciliation failed', {
        messageId: String(claimed._id),
        error: sanitizeFanoutError(error),
      });
      summary.failed++;
    }
  }
  return summary;
}

async function startNotificationFanoutReconciler({
  db,
  logger = console,
  intervalMs = DEFAULT_RECONCILE_INTERVAL_MS,
} = {}) {
  const messages = db.collection('chat_messages_v4');
  await messages.createIndex(
    {
      'notificationFanout.status': 1,
      'notificationFanout.nextRetryAt': 1,
      createdAt: 1,
    },
    { name: 'messenger_notification_fanout_recovery' }
  );
  await messages.createIndex(
    {
      'notificationFanout.status': 1,
      'notificationFanout.queuedAt': 1,
      createdAt: 1,
    },
    { name: 'messenger_notification_fanout_queued_recovery' }
  );

  let stopped = false;
  let timer = null;
  let activeRun = null;
  const run = async ({ initial = false } = {}) => {
    activeRun = reconcileNotificationFanout({ db, logger });
    try {
      await activeRun;
    } catch (error) {
      logger.error('[queue] notification fan-out reconciliation run failed', {
        error: sanitizeFanoutError(error),
      });
      if (initial) {
        stopped = true;
        throw error;
      }
    } finally {
      activeRun = null;
      if (!stopped) {
        timer = setTimeout(run, intervalMs);
        timer.unref?.();
      }
    }
  };
  await run({ initial: true });
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await activeRun?.catch(() => {});
  };
}

module.exports = {
  createFanoutState,
  markFanoutQueued,
  markFanoutProcessed,
  markFanoutFailed,
  buildFanoutPayload,
  reconcileNotificationFanout,
  startNotificationFanoutReconciler,
  sanitizeFanoutError,
};
