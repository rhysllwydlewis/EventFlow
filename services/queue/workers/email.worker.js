'use strict';

const { createWorker, getQueueContext } = require('../index');

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function processEmailJob(job) {
  const { db, logger = console, postmark } = getQueueContext();
  if (!db || !postmark || typeof postmark.sendMail !== 'function') {
    throw new Error('[queue] email job cannot run: worker context unavailable');
  }
  const data = job.data || {};
  const recipient = await db.collection('users').findOne({ id: data.recipientId });
  if (!recipient?.email) {
    logger.info('[queue] message email skipped', {
      recipientId: data.recipientId,
      messageId: data.messageId,
      reason: 'recipient_email_unavailable',
    });
    return { status: 'skipped', reason: 'recipient_email_unavailable' };
  }
  if (recipient.notify_account === false) {
    logger.info('[queue] message email skipped', {
      recipientId: data.recipientId,
      messageId: data.messageId,
      reason: 'account_email_opt_out',
    });
    return { status: 'skipped', reason: 'account_email_opt_out' };
  }
  const safeSenderName =
    String(data.senderName || 'Someone')
      .replace(/[\r\n]/g, ' ')
      .trim()
      .slice(0, 120) || 'Someone';
  const safeContextTitle = String(data.contextTitle || '')
    .replace(/[\r\n]/g, ' ')
    .trim()
    .slice(0, 120);
  const contextInfo = safeContextTitle ? ` (Re: ${safeContextTitle})` : '';
  const subject = `New message from ${safeSenderName}${contextInfo}`.slice(0, 200);
  const baseUrl = String(process.env.BASE_URL || 'https://event-flow.co.uk').replace(/\/+$/, '');
  const conversationId = encodeURIComponent(String(data.conversationId || ''));
  const preview = String(data.preview || '').substring(0, 200);
  const conversationUrl = `${baseUrl}/messenger/?conversation=${conversationId}`;

  await postmark.sendMail({
    to: recipient.email,
    subject,
    template: 'new-message',
    templateData: {
      senderName: safeSenderName,
      // contextSuffix is a plain (non-raw) template key, so loadEmailTemplate
      // escapes it itself — do not pre-escape here or it will be double-escaped.
      contextSuffix: safeContextTitle ? ` about "${safeContextTitle}"` : '',
      previewHtml: escapeHtml(preview).replace(/\n/g, '<br>') || '&nbsp;',
      conversationUrl,
    },
    text: `${safeSenderName} sent you a message:\n\n"${preview}"\n\nView conversation: ${conversationUrl}`,
    from: postmark.FROM_NOREPLY,
    tags: ['messenger-v4', 'transactional'],
    messageStream: 'outbound',
    // Never let a production worker treat the local outbox fallback as delivery.
    criticalDelivery: true,
  });
  logger.info('[queue] email sent', { recipientId: data.recipientId, messageId: data.messageId });
  return { status: 'sent' };
}

function startEmailWorker() {
  return createWorker('email', processEmailJob);
}

module.exports = {
  processEmailJob,
  startEmailWorker,
};
