'use strict';

const express = require('express');
const logger = require('../utils/logger');
const emailLogService = require('../services/emailLog.service');

const router = express.Router();

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
    return res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('[postmark-webhook] Failed to process webhook:', err.message);
    return res.status(200).json({ ok: true, matched: false });
  }
});

module.exports = router;
