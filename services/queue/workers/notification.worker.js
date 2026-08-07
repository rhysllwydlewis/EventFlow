'use strict';

const NotificationService = require('../../notification.service');
const { createWorker, getQueueContext, enqueueEmailJob } = require('../index');
const { markFanoutProcessed, markFanoutFailed } = require('../../notificationFanout.service');

async function processNotificationJob(job) {
  const { db, logger = console } = getQueueContext();
  if (!db) {
    throw new Error('[queue] notification job cannot run: db unavailable');
  }
  const data = job.data || {};
  const notifSvc = new NotificationService(db, null);
  const recipients = Array.isArray(data.recipients) ? data.recipients : [];
  const messages = db.collection('chat_messages_v4');
  try {
    for (const recipientId of recipients) {
      await notifSvc.notifyNewMessage(
        recipientId,
        data.senderName || 'Someone',
        data.conversationId,
        data.preview,
        { messageId: data.messageId }
      );

      await enqueueEmailJob({
        messageId: data.messageId,
        conversationId: data.conversationId,
        recipientId,
        senderName: data.senderName,
        preview: data.preview,
        contextTitle: data.contextTitle || '',
      });
    }
    await markFanoutProcessed(messages, data.messageId);
  } catch (error) {
    if (data.messageId) {
      await markFanoutFailed(messages, data.messageId, error).catch(markError => {
        logger.error('[queue] failed to persist notification fan-out failure', {
          error: markError.message,
          messageId: data.messageId,
        });
      });
    }
    throw error;
  }
}

function startNotificationWorker() {
  return createWorker('notifications', processNotificationJob);
}

module.exports = {
  processNotificationJob,
  startNotificationWorker,
};
