'use strict';

const NotificationService = require('../../notification.service');
const { createWorker, getQueueContext, enqueueEmailJob } = require('../index');

async function processNotificationJob(job) {
  const { db, logger = console } = getQueueContext();
  if (!db) {
    logger.warn('[queue] notification job skipped: db unavailable');
    return;
  }
  const data = job.data || {};
  const notifSvc = new NotificationService(db, null);
  const recipients = Array.isArray(data.recipients) ? data.recipients : [];
  for (const recipientId of recipients) {
    await notifSvc
      .notifyNewMessage(
        recipientId,
        data.senderName || 'Someone',
        data.conversationId,
        data.preview
      )
      .catch(error => logger.error('[queue] notifyNewMessage failed', { error: error.message }));

    await enqueueEmailJob({
      messageId: data.messageId,
      conversationId: data.conversationId,
      recipientId,
      senderName: data.senderName,
      preview: data.preview,
      contextTitle: data.contextTitle || '',
    }).catch(error => logger.error('[queue] enqueue email failed', { error: error.message }));
  }
}

function startNotificationWorker() {
  return createWorker('notifications', processNotificationJob);
}

module.exports = {
  processNotificationJob,
  startNotificationWorker,
};
