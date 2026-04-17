'use strict';

const { createWorker, getQueueContext } = require('../index');

async function processEmailJob(job) {
  const { db, logger = console, postmark } = getQueueContext();
  if (!db || !postmark || typeof postmark.sendMail !== 'function') {
    return;
  }
  const data = job.data || {};
  const recipient = await db.collection('users').findOne({ id: data.recipientId });
  if (!recipient?.email) {
    return;
  }
  const safeSenderName = String(data.senderName || 'Someone')
    .replace(/[\r\n]/g, ' ')
    .trim();
  const safeContextTitle = String(data.contextTitle || '')
    .replace(/[\r\n]/g, ' ')
    .trim();
  const contextInfo = safeContextTitle ? ` (Re: ${safeContextTitle})` : '';

  await postmark.sendMail({
    to: recipient.email,
    subject: `New message from ${safeSenderName}${contextInfo}`,
    text: `${safeSenderName} sent you a message:\n\n"${String(data.preview || '').substring(0, 200)}"\n\nView conversation: ${process.env.BASE_URL || 'https://event-flow.co.uk'}/messenger/?conversation=${data.conversationId}`,
    from: postmark.FROM_NOREPLY,
  });
  logger.info('[queue] email sent', { recipientId: data.recipientId, messageId: data.messageId });
}

function startEmailWorker() {
  return createWorker('email', processEmailJob);
}

module.exports = {
  processEmailJob,
  startEmailWorker,
};
