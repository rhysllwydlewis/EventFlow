'use strict';

const express = require('express');
const logger = require('../utils/logger');
const dbUnified = require('../db-unified');
const emailLogService = require('../services/emailLog.service');
const { removeLoadedRouterRoute } = require('../utils/legacyRouterRoute');

const removedLegacyPostmarkRoutes = removeLoadedRouterRoute(
  require.resolve('./webhooks'),
  '/postmark',
  'post'
);
if (removedLegacyPostmarkRoutes > 0) {
  logger.info('[postmark-webhook] Disabled obsolete legacy /postmark handler');
}

const router = express.Router();
const DELIVERY_FAILURE_STATUSES = new Set(['bounced', 'complained', 'suppressed', 'failed']);

function hasWebhookCredentials() {
  return !!(process.env.POSTMARK_WEBHOOK_USER && process.env.POSTMARK_WEBHOOK_PASS);
}

function basicAuthValid(req) {
  const auth = req.get('authorization') || '';
  if (!auth.startsWith('Basic ')) {
    return false;
  }
  let decoded = '';
  try {
    decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
  } catch (_err) {
    return false;
  }
  const separator = decoded.indexOf(':');
  if (separator < 0) {
    return false;
  }
  const user = decoded.slice(0, separator);
  const pass = decoded.slice(separator + 1);
  return user === process.env.POSTMARK_WEBHOOK_USER && pass === process.env.POSTMARK_WEBHOOK_PASS;
}

async function syncReviewRequestDelivery(result, payload = {}) {
  if (!result || !result.matched || !result.id) {
    return false;
  }

  const emailLog = await emailLogService.getLog(result.id);
  if (!emailLog || emailLog.template !== 'review-request') {
    return false;
  }

  let reviewRequest = await dbUnified.findOne('reviewRequests', {
    emailLogId: result.id,
  });
  if (!reviewRequest && emailLog.postmarkMessageId) {
    reviewRequest = await dbUnified.findOne('reviewRequests', {
      providerMessageId: emailLog.postmarkMessageId,
    });
  }
  if (!reviewRequest) {
    return false;
  }

  const eventAt = emailLog.lastEventAt || new Date().toISOString();
  const status = emailLog.status || 'unknown';
  const updates = {
    deliveryStatus: status,
    deliveryUpdatedAt: eventAt,
  };

  if (status === 'delivered') {
    updates.deliveredAt = eventAt;
    updates.retryable = false;
  } else if (status === 'opened') {
    updates.emailOpenedAt = eventAt;
  } else if (status === 'clicked') {
    updates.emailClickedAt = eventAt;
  } else if (DELIVERY_FAILURE_STATUSES.has(status)) {
    updates.deliveryFailedAt = eventAt;
    updates.lastError = `Postmark delivery status: ${status}`;
    updates.retryable = status === 'bounced' ? payload.Inactive !== true : false;
    if (reviewRequest.status === 'pending' || reviewRequest.status === 'sent') {
      updates.status = 'failed';
      updates.failedAt = eventAt;
    }
  }

  await dbUnified.updateOne(
    'reviewRequests',
    { id: reviewRequest.id },
    {
      $set: updates,
    }
  );
  return true;
}

router.post('/postmark', express.json({ limit: '128kb' }), async (req, res) => {
  const isProduction = process.env.NODE_ENV === 'production';
  if (!hasWebhookCredentials()) {
    if (isProduction || process.env.POSTMARK_WEBHOOK_ENABLED === 'true') {
      logger.warn('[postmark-webhook] Credentials missing; rejecting webhook request.');
      return res.status(503).json({ ok: false, error: 'Webhook is not configured.' });
    }
  } else if (!basicAuthValid(req)) {
    return res.status(401).set('WWW-Authenticate', 'Basic realm="Postmark Webhook"').json({
      ok: false,
      error: 'Invalid webhook credentials.',
    });
  }

  const payload = req.body || {};
  const type = payload.RecordType || payload.Type;
  if (!type || typeof payload !== 'object' || Array.isArray(payload)) {
    return res.status(400).json({ ok: false, error: 'Invalid Postmark webhook payload.' });
  }

  try {
    const result = await emailLogService.appendWebhookEvent(payload);
    try {
      result.reviewRequestUpdated = await syncReviewRequestDelivery(result, payload);
    } catch (syncError) {
      logger.warn(
        '[postmark-webhook] Email log updated but review-request delivery sync failed:',
        syncError.message
      );
      result.reviewRequestUpdated = false;
    }
    return res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('[postmark-webhook] Failed to process webhook:', err.message);
    return res.status(200).json({ ok: true, matched: false });
  }
});

module.exports = router;
module.exports.syncReviewRequestDelivery = syncReviewRequestDelivery;
